/**
 * Video Ad Pipeline Orchestrator
 *
 * Creates TikTok-style ad videos by combining:
 * 1. Runway B-roll clips (product-only footage)
 * 2. HeyGen avatar (creator speaking the ad script)
 * 3. FFmpeg auto-edit (interleave avatar + B-roll, avatar audio as voiceover)
 */

import { chatCompletion } from '@/lib/openai-chat';
import { createVideo as runwayCreate, getVideoStatus as runwayGetStatus } from '@/lib/runway';
import { createAvatarVideo, getAvatarVideoStatus } from '@/lib/heygen';
import { editTimeline } from '@/lib/mux';
import crypto from 'crypto';

export interface PipelineConfig {
  storeId: string;
  productId: string;
  productImageUrl: string;
  productTitle: string;
  productDescription?: string;
  adScript: string;
  avatarId: string;
  voiceId: string;
  offer?: string;
  brollCount?: number;
  brollDuration?: 5 | 10;
}

interface BRollPrompt {
  index: number;
  sceneType: string;
  prompt: string;
}

interface ClipTask {
  index: number;
  creativeId: string;
  taskId: string;
  type: 'broll' | 'avatar';
  status: string;
  videoUrl?: string;
}

/**
 * Phase 1: Generate B-roll scene prompts via ChatGPT
 */
export async function generateBRollPrompts(config: PipelineConfig): Promise<BRollPrompt[]> {
  const count = config.brollCount || 10;

  const result = await chatCompletion([
    {
      role: 'system',
      content: `You are a product videographer creating B-roll shot lists for TikTok/Reels ads.

Generate ${count} unique B-roll scene descriptions for a product video. Each scene is 5 seconds, vertical 9:16 format.

RULES:
- Product image is provided as the first frame to Runway AI — describe what HAPPENS in the scene
- ABSOLUTELY NO TEXT, WORDS, LOGOS, OR CAPTIONS in any scene — purely visual
- Each scene should be a different angle/moment: close-up, hands interacting, unboxing, pouring, lifestyle context, etc.
- Natural lighting, real environments (kitchen counter, bathroom, desk, outdoor)
- Handheld iPhone aesthetic — NOT commercial/cinematic
- Focus on satisfying, scroll-stopping visuals (textures, pours, reveals)
- Describe the product's physical appearance accurately: "${config.productTitle}"

Return JSON: { "scenes": [{ "index": 0, "sceneType": "close-up", "prompt": "..." }, ...] }`,
    },
    {
      role: 'user',
      content: `Product: ${config.productTitle}
${config.productDescription ? `Description: ${config.productDescription}` : ''}
${config.offer ? `Offer: ${config.offer}` : ''}

Generate ${count} unique B-roll scene prompts. Each prompt should be 50-100 words describing the exact visual scene.`,
    },
  ]);

  const parsed = JSON.parse(result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
  return (parsed.scenes || []).slice(0, count);
}

/**
 * Phase 2: Fire all generation requests in parallel (10 Runway + 1 HeyGen)
 */
export async function fireAllGenerations(
  pipelineId: string,
  config: PipelineConfig,
  brollPrompts: BRollPrompt[],
  db: any
): Promise<{ brollTasks: ClipTask[]; avatarTask: ClipTask }> {
  const duration = config.brollDuration || 5;

  // Fire B-roll requests in parallel
  const brollTasks: ClipTask[] = [];
  const brollResults = await Promise.allSettled(
    brollPrompts.map(async (bp) => {
      const creativeId = crypto.randomUUID();
      const result = await runwayCreate(bp.prompt, config.productImageUrl, {
        duration: duration as 5 | 10,
        ratio: '720:1280',
      });

      db.prepare(`
        INSERT INTO creatives (id, store_id, product_id, type, title, description,
          nb_video_id, nb_status, status, template_id, pipeline_id)
        VALUES (?, ?, ?, 'video', ?, ?, ?, 'processing', 'draft', 'runway', ?)
      `).run(creativeId, config.storeId, config.productId,
        `B-Roll ${bp.index + 1}: ${bp.sceneType}`, bp.prompt,
        result.taskId, pipelineId);

      return { index: bp.index, creativeId, taskId: result.taskId, type: 'broll' as const, status: 'processing' };
    })
  );

  for (const r of brollResults) {
    if (r.status === 'fulfilled') brollTasks.push(r.value);
    else console.error(`[PIPELINE] B-roll generation failed:`, r.reason?.message);
  }

  // Fire HeyGen avatar request
  const avatarCreativeId = crypto.randomUUID();
  const avatarResult = await createAvatarVideo(config.adScript, {
    avatarId: config.avatarId,
    voiceId: config.voiceId,
  });

  db.prepare(`
    INSERT INTO creatives (id, store_id, product_id, type, title, description,
      nb_video_id, nb_status, status, template_id, pipeline_id)
    VALUES (?, ?, ?, 'video', 'Avatar - Ad Script', ?, ?, 'processing', 'draft', 'heygen', ?)
  `).run(avatarCreativeId, config.storeId, config.productId,
    config.adScript, avatarResult.videoId, pipelineId);

  // Update pipeline with task IDs
  db.prepare(`
    UPDATE video_pipelines SET
      avatar_creative_id = ?, avatar_video_id = ?,
      status = 'generating_clips', updated_at = datetime('now')
    WHERE id = ?
  `).run(avatarCreativeId, avatarResult.videoId, pipelineId);

  const avatarTask: ClipTask = {
    index: -1,
    creativeId: avatarCreativeId,
    taskId: avatarResult.videoId,
    type: 'avatar',
    status: 'processing',
  };

  return { brollTasks, avatarTask };
}

/**
 * Phase 3: Poll all tasks until complete
 */
export async function pollAllTasks(
  pipelineId: string,
  brollTasks: ClipTask[],
  avatarTask: ClipTask,
  db: any,
  options?: { maxWaitMs?: number; pollIntervalMs?: number }
): Promise<{ brollResults: ClipTask[]; avatarResult: ClipTask }> {
  const maxWait = options?.maxWaitMs || 600000; // 10 min
  const pollInterval = options?.pollIntervalMs || 10000; // 10s
  const startTime = Date.now();

  const allTasks = [...brollTasks, avatarTask];
  const pendingIds = new Set(allTasks.map(t => t.taskId));

  while (pendingIds.size > 0 && Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));

    const pollResults = await Promise.allSettled(
      allTasks.filter(t => pendingIds.has(t.taskId)).map(async (task) => {
        if (task.type === 'broll') {
          const status = await runwayGetStatus(task.taskId);
          if (status.status === 'SUCCEEDED') {
            task.status = 'completed';
            task.videoUrl = status.videoUrl || undefined;
            pendingIds.delete(task.taskId);
            db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ? WHERE id = ?")
              .run(status.videoUrl, task.creativeId);
          } else if (status.status === 'FAILED') {
            task.status = 'failed';
            pendingIds.delete(task.taskId);
            db.prepare("UPDATE creatives SET nb_status = 'failed' WHERE id = ?").run(task.creativeId);
          }
        } else {
          const status = await getAvatarVideoStatus(task.taskId);
          if (status.status === 'completed') {
            task.status = 'completed';
            task.videoUrl = status.videoUrl || undefined;
            pendingIds.delete(task.taskId);
            db.prepare("UPDATE creatives SET nb_status = 'completed', file_url = ? WHERE id = ?")
              .run(status.videoUrl, task.creativeId);
          } else if (status.status === 'failed') {
            task.status = 'failed';
            pendingIds.delete(task.taskId);
            db.prepare("UPDATE creatives SET nb_status = 'failed' WHERE id = ?").run(task.creativeId);
          }
        }
        return task;
      })
    );

    // Update completed count
    const completedCount = allTasks.filter(t => t.status === 'completed').length;
    db.prepare("UPDATE video_pipelines SET completed_clips = ?, updated_at = datetime('now') WHERE id = ?")
      .run(completedCount, pipelineId);

    console.log(`[PIPELINE] ${completedCount}/${allTasks.length} clips done (${pendingIds.size} pending)`);
  }

  // Mark remaining as timed out
  for (const task of allTasks) {
    if (pendingIds.has(task.taskId)) {
      task.status = 'timeout';
      db.prepare("UPDATE creatives SET nb_status = 'failed' WHERE id = ?").run(task.creativeId);
    }
  }

  return {
    brollResults: brollTasks,
    avatarResult: avatarTask,
  };
}

/**
 * Full pipeline orchestration — runs async, updates DB at each phase.
 */
export async function runPipeline(pipelineId: string, config: PipelineConfig, db: any): Promise<void> {
  try {
    // Phase 1: Generate B-roll prompts
    console.log(`[PIPELINE] Phase 1: Generating B-roll prompts...`);
    db.prepare("UPDATE video_pipelines SET status = 'generating_prompts', updated_at = datetime('now') WHERE id = ?")
      .run(pipelineId);

    const brollPrompts = await generateBRollPrompts(config);
    db.prepare("UPDATE video_pipelines SET broll_prompts = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(brollPrompts), pipelineId);

    console.log(`[PIPELINE] Phase 1 done: ${brollPrompts.length} prompts generated`);

    // Phase 2: Fire all generations
    console.log(`[PIPELINE] Phase 2: Firing ${brollPrompts.length} Runway + 1 HeyGen...`);
    const { brollTasks, avatarTask } = await fireAllGenerations(pipelineId, config, brollPrompts, db);

    db.prepare("UPDATE video_pipelines SET total_clips = ?, updated_at = datetime('now') WHERE id = ?")
      .run(brollTasks.length + 1, pipelineId);

    console.log(`[PIPELINE] Phase 2 done: ${brollTasks.length} B-roll + 1 avatar fired`);

    // Phase 3: Poll all tasks
    console.log(`[PIPELINE] Phase 3: Polling...`);
    db.prepare("UPDATE video_pipelines SET status = 'polling', updated_at = datetime('now') WHERE id = ?")
      .run(pipelineId);

    const { brollResults, avatarResult } = await pollAllTasks(pipelineId, brollTasks, avatarTask, db);

    // Check minimum requirements
    const completedBrolls = brollResults.filter(t => t.status === 'completed' && t.videoUrl);
    if (avatarResult.status !== 'completed' || !avatarResult.videoUrl) {
      throw new Error('Avatar video failed or timed out. Cannot create final video without the avatar.');
    }
    if (completedBrolls.length < 2) {
      throw new Error(`Only ${completedBrolls.length} B-roll clips completed. Need at least 2.`);
    }

    console.log(`[PIPELINE] Phase 3 done: ${completedBrolls.length} B-rolls + avatar ready`);

    // Phase 4: FFmpeg auto-edit
    console.log(`[PIPELINE] Phase 4: Auto-editing timeline...`);
    db.prepare("UPDATE video_pipelines SET status = 'editing', updated_at = datetime('now') WHERE id = ?")
      .run(pipelineId);

    const brollUrls = completedBrolls
      .sort((a, b) => a.index - b.index)
      .map(t => t.videoUrl!);

    const result = await editTimeline(avatarResult.videoUrl!, brollUrls);

    // Phase 5: Save final video
    const finalCreativeId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO creatives (id, store_id, product_id, type, title, description,
        file_url, nb_status, status, template_id, pipeline_id)
      VALUES (?, ?, ?, 'video', ?, ?, ?, 'completed', 'draft', 'pipeline', ?)
    `).run(
      finalCreativeId, config.storeId, config.productId,
      `${config.productTitle} - Ad Pipeline`,
      config.adScript,
      result.outputUrl,
      pipelineId
    );

    db.prepare(`
      UPDATE video_pipelines SET
        status = 'completed', final_creative_id = ?, final_video_url = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(finalCreativeId, result.outputUrl, pipelineId);

    console.log(`[PIPELINE] Complete! Final video: ${result.outputUrl}`);

  } catch (err: any) {
    console.error(`[PIPELINE] Failed: ${err.message}`);
    db.prepare("UPDATE video_pipelines SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(err.message, pipelineId);
    throw err;
  }
}
