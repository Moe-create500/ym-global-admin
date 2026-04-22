/**
 * GET /api/health
 *
 * System health check. Returns:
 * - status: 'ok' | 'degraded' | 'error'
 * - checks: per-component status
 * - issues: list of detected problems
 *
 * Used by:
 * - Deploy script (verifies deploy success)
 * - Monitoring/uptime checks
 * - Manual debugging
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { existsSync, statSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
}

export async function GET() {
  const checks: HealthCheck[] = [];
  const issues: string[] = [];

  // ── 1. Database connection ──
  try {
    const db = getDb();
    const result: any = db.prepare('SELECT 1 as ok').get();
    if (result?.ok === 1) {
      checks.push({ name: 'database', status: 'ok' });
    } else {
      checks.push({ name: 'database', status: 'fail', detail: 'Unexpected query result' });
      issues.push('Database query returned unexpected result');
    }
  } catch (e: any) {
    checks.push({ name: 'database', status: 'fail', detail: e.message });
    issues.push(`Database error: ${e.message}`);
  }

  // ── 2. Build files exist ──
  try {
    const nextDir = path.join(process.cwd(), '.next');
    const buildIdPath = path.join(nextDir, 'BUILD_ID');
    const prerenderManifestPath = path.join(nextDir, 'prerender-manifest.json');
    const requiredServerPath = path.join(nextDir, 'required-server-files.json');

    if (!existsSync(nextDir)) {
      checks.push({ name: 'build', status: 'fail', detail: '.next directory missing' });
      issues.push('Build directory missing — run npm run build');
    } else if (!existsSync(buildIdPath)) {
      checks.push({ name: 'build', status: 'fail', detail: 'BUILD_ID missing' });
      issues.push('Build incomplete: BUILD_ID missing');
    } else if (!existsSync(prerenderManifestPath)) {
      checks.push({ name: 'build', status: 'fail', detail: 'prerender-manifest.json missing' });
      issues.push('Build incomplete: prerender-manifest.json missing');
    } else if (!existsSync(requiredServerPath)) {
      checks.push({ name: 'build', status: 'fail', detail: 'required-server-files.json missing' });
      issues.push('Build incomplete: required-server-files.json missing');
    } else {
      checks.push({ name: 'build', status: 'ok' });
    }
  } catch (e: any) {
    checks.push({ name: 'build', status: 'fail', detail: e.message });
    issues.push(`Build check failed: ${e.message}`);
  }

  // ── 3. Memory usage ──
  try {
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    let memStatus: 'ok' | 'warn' | 'fail' = 'ok';
    if (heapPercent >= 90) {
      memStatus = 'fail';
      issues.push(`Heap usage critical: ${heapPercent}% (${heapUsedMB}MB / ${heapTotalMB}MB)`);
    } else if (heapPercent >= 80) {
      memStatus = 'warn';
      issues.push(`Heap usage high: ${heapPercent}%`);
    }

    checks.push({
      name: 'memory',
      status: memStatus,
      detail: `heap ${heapUsedMB}/${heapTotalMB}MB (${heapPercent}%), rss ${rssMB}MB`,
    });
  } catch (e: any) {
    checks.push({ name: 'memory', status: 'fail', detail: e.message });
  }

  // ── 4. Disk space (uploads dir) ──
  try {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (existsSync(uploadsDir)) {
      checks.push({ name: 'uploads_dir', status: 'ok' });
    } else {
      checks.push({ name: 'uploads_dir', status: 'warn', detail: 'uploads directory does not exist' });
      issues.push('uploads directory missing');
    }
  } catch (e: any) {
    checks.push({ name: 'uploads_dir', status: 'fail', detail: e.message });
  }

  // ── 5. Provider API keys configured ──
  const providerKeys = [
    { key: 'OPENAI_API_KEY', name: 'openai' },
    { key: 'GEMINI_API_KEY', name: 'gemini' },
    { key: 'STABILITY_API_KEY', name: 'stability' },
    { key: 'MINIMAX_API_KEY', name: 'minimax' },
  ];
  const configuredProviders: string[] = [];
  for (const p of providerKeys) {
    if (process.env[p.key]) configuredProviders.push(p.name);
  }
  if (configuredProviders.length === 0) {
    checks.push({ name: 'providers', status: 'fail', detail: 'No AI provider keys configured' });
    issues.push('No AI providers configured');
  } else if (configuredProviders.length < 2) {
    checks.push({ name: 'providers', status: 'warn', detail: `Only ${configuredProviders.length} provider(s) — no failover available` });
    issues.push('Limited provider availability — no failover');
  } else {
    checks.push({ name: 'providers', status: 'ok', detail: configuredProviders.join(', ') });
  }

  // ── Determine overall status ──
  const hasFailure = checks.some(c => c.status === 'fail');
  const hasWarning = checks.some(c => c.status === 'warn');
  const status = hasFailure ? 'error' : hasWarning ? 'degraded' : 'ok';

  const httpStatus = hasFailure ? 503 : 200;

  return NextResponse.json({
    status,
    checks,
    issues,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }, { status: httpStatus });
}
