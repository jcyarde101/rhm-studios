import 'dotenv/config';

process.env.RHM_RENDER_COMPANION = 'true';

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
