import { config } from './config.js';

const runwayBaseUrl = 'https://api.dev.runwayml.com/v1';
const runwayHeaders = () => ({
  Authorization: `Bearer ${config.runwayApiKey}`,
  'Content-Type': 'application/json',
  'X-Runway-Version': '2024-11-06'
});

type RunwayTask = { id: string; status?: string; output?: string[]; failure?: string; failureCode?: string };

async function runwayRequest(path: string, init?: RequestInit) {
  if (!config.runwayApiKey) throw new Error('RUNWAY_API_KEY is not configured; the approved Runway edit cannot be rendered.');
  const response = await fetch(`${runwayBaseUrl}${path}`, { ...init, headers: { ...runwayHeaders(), ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(body?.error || body?.message || `Runway request failed (${response.status}).`);
  return body;
}

export async function generateRunwayBroll(promptText: string, duration = 5) {
  const created = await runwayRequest('/image_to_video', {
    method: 'POST',
    body: JSON.stringify({ model: 'gen4.5', promptText, ratio: '1280:720', duration: Math.max(2, Math.min(10, Math.round(duration))) })
  }) as RunwayTask;
  if (!created.id) throw new Error('Runway accepted the request but did not return a task ID.');

  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const task = await runwayRequest(`/tasks/${encodeURIComponent(created.id)}`) as RunwayTask;
    if (task.status === 'SUCCEEDED') {
      if (!task.output?.[0]) throw new Error(`Runway task ${created.id} completed without a video URL.`);
      return { taskId: created.id, url: task.output[0] };
    }
    if (['FAILED', 'CANCELED'].includes(String(task.status))) {
      throw new Error(`Runway task ${created.id} ${String(task.status).toLowerCase()}: ${task.failure || task.failureCode || 'unknown error'}`);
    }
  }
  throw new Error(`Runway task ${created.id} did not finish within 20 minutes.`);
}
