'use client';

import { useState } from 'react';
import type { AnimatedTemplateData, AnimatedSceneRecord } from './types';

interface AnimatedScenesModalProps {
  open: boolean;
  onClose: () => void;
  conceptTitle: string;
  concept?: AnimatedTemplateData['concept'];
  scenes: AnimatedSceneRecord[];
}

export function AnimatedScenesModal({
  open,
  onClose,
  conceptTitle,
  concept,
  scenes,
}: AnimatedScenesModalProps) {
  const [playingSceneIndex, setPlayingSceneIndex] = useState<number | null>(null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 px-5 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {concept?.title ?? conceptTitle ?? 'Scenes'}
            </h2>
            {concept?.angle && (
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">{concept.angle}</p>
            )}
            <p className="text-[11px] text-zinc-500 mt-2">
              {scenes.length} scene{scenes.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {(concept?.hook || concept?.script) && (
          <div className="px-5 py-3 border-b border-zinc-800 space-y-2">
            {concept?.hook && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Hook</p>
                <p className="text-xs text-zinc-300">{concept.hook}</p>
              </div>
            )}
            {concept?.script && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Full script</p>
                <p className="text-xs text-zinc-400 whitespace-pre-wrap">{concept.script}</p>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4 space-y-4">
          {scenes.map((scene) => (
            <SceneRow
              key={scene.sceneIndex}
              scene={scene}
              isPlaying={playingSceneIndex === scene.sceneIndex}
              onPlayToggle={() =>
                setPlayingSceneIndex(
                  playingSceneIndex === scene.sceneIndex ? null : scene.sceneIndex,
                )
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SceneRow({
  scene,
  isPlaying,
  onPlayToggle,
}: {
  scene: AnimatedSceneRecord;
  isPlaying: boolean;
  onPlayToggle: () => void;
}) {
  const [frameError, setFrameError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  return (
    <div className="flex gap-3 p-3 bg-zinc-800/50 border border-zinc-700 rounded">
      <div className="relative flex-shrink-0 w-32 h-32 bg-zinc-900 rounded overflow-hidden">
        {isPlaying && scene.videoUrl && !videoError ? (
          <video
            src={scene.videoUrl}
            className="w-full h-full object-cover"
            autoPlay
            controls
            onError={() => setVideoError(true)}
            onEnded={onPlayToggle}
          />
        ) : frameError || !scene.frameUrl ? (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] text-center px-2">
            Frame unavailable
          </div>
        ) : (
          <>
            <img
              src={scene.frameUrl}
              alt={`Scene ${scene.sceneIndex + 1}`}
              className="w-full h-full object-cover"
              onError={() => setFrameError(true)}
            />
            {scene.videoUrl && !videoError && (
              <button
                onClick={onPlayToggle}
                className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/60 transition-colors"
                aria-label={`Play scene ${scene.sceneIndex + 1}`}
              >
                <span className="text-white text-2xl">▶</span>
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">
          Scene {scene.sceneIndex + 1} · {scene.duration}s
        </p>
        {scene.voSegment && (
          <p className="text-sm text-zinc-200 italic">&ldquo;{scene.voSegment}&rdquo;</p>
        )}
        {scene.visualDescription && (
          <p className="text-xs text-zinc-400">{scene.visualDescription}</p>
        )}
      </div>
    </div>
  );
}
