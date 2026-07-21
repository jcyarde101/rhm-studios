import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.RHM_RENDER_COMPANION = 'true';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = path.join(projectRoot, 'render-companion.pid');
try {
  const previousPid = Number((await readFile(pidFile, 'utf8')).trim());
  if (Number.isFinite(previousPid) && previousPid > 0) {
    try {
      process.kill(previousPid, 0);
      console.log(`RHM Render Companion is already running (process ${previousPid}).`);
      process.exit(0);
    } catch {}
  }
} catch {}
await writeFile(pidFile, String(process.pid), 'utf8');
process.on('exit', () => { try { unlinkSync(pidFile); } catch {} });

const { recoverInterruptedFullRenderJobs, runNextQueuedFullRenderJob } = await import('./processing.js');
const once = process.argv.includes('--once');
let stopping = false;

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

console.log('RHM Render Companion is online.');
console.log(`1080p local rendering with ${process.env.RHM_RENDER_THREADS || '8'} FFmpeg threads.`);
console.log('Waiting for approved full-video jobs from RHM Studios...');

await recoverInterruptedFullRenderJobs();
do {
  try {
    const processed = await runNextQueuedFullRenderJob();
    if (processed) console.log('Render job finished. Checking for another approved video...');
    else if (once) break;
  } catch (error: any) {
    console.error(String(error?.message || error));
  }
  if (!once && !stopping) await new Promise(resolve => setTimeout(resolve, 6000));
} while (!once && !stopping);

console.log('RHM Render Companion stopped.');
