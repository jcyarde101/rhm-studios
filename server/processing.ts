import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { Upload } from 'tus-js-client';
import { config } from './config.js';
import { adminClient } from './supabase.js';
import { generateRunwayBroll } from './runway.js';

const openaiApiKey = config.openaiApiKey;
const mediaBucket = 'devotional-media';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let workerActive = false;

type MessageReview = {
  overallSynopsis: string;
  centralMessage: string;
  whatWorked: string[];
  needsClarity: string[];
  possibleConcerns: string[];
  scripturesDetected: string[];
  suggestedEmphasis: string;
};

type VisualFrame = { path: string; timestampSeconds: number; timestamp: string };
type VisualObservation = {
  timestamp: string; framing: string; lighting: string; speakerPresence: string; gestureExpression: string;
  onScreenText: string; qualityIssues: string[]; editOpportunities: string[];
};

type DirectionScene = { sourceRange?: string; purpose?: string; runwayTool?: string; prompt?: string; extraMotion?: string; placement?: string };

function parseFirstTimestamp(value = '') {
  const match = value.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function explicitlyIncludesAsset(direction: string, asset: 'intro' | 'outro') {
  return new RegExp(`\\b(?:add|include|use|prepend|append)\\b[^.]{0,60}\\b${asset}\\b`, 'i').test(direction);
}

function escapeDrawtext(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%').slice(0, 110);
}

function exactTimestamp(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function timestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  await adminClient.from('processing_jobs').update(values).eq('id', jobId);
}

async function uploadRenderedVideo(storagePath: string, filePath: string, onProgress?: (fraction: number) => void) {
  const file = await stat(filePath);
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(createReadStream(filePath) as any, {
      endpoint: `${config.supabaseUrl}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${config.supabaseAdminKey}`, 'x-upsert': 'true' },
      uploadSize: file.size,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: mediaBucket, objectName: storagePath, contentType: 'video/mp4', cacheControl: '3600' },
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onError: reject,
      onSuccess: () => resolve()
    });
    upload.start();
  });
  return file.size;
}

async function runFfmpegStage(args: string[], onTime?: (seconds: number) => void) {
  const threads = process.env.RHM_RENDER_COMPANION === 'true' ? Math.max(1, Number(process.env.RHM_RENDER_THREADS || 8)) : 1;
  const child = spawn((ffmpeg as { path: string }).path, ['-hide_banner', '-y', '-threads', String(threads), '-filter_threads', String(Math.min(threads, 4)), '-filter_complex_threads', String(Math.min(threads, 4)), ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errorOutput = '';
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    errorOutput = (errorOutput + text).slice(-8000);
    const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const match = matches[matches.length - 1];
    if (match) onTime?.(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${String(code)}${signal ? ` after signal ${signal}` : ''}. ${errorOutput}`)));
  });
}

async function processFullRenderJob(job: { id: string; devotional_id: string; owner_id: string }) {
  const { id: jobId, devotional_id: devotionalId, owner_id: ownerId } = job;
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'rhm-full-render-'));
  try {
    await updateJob(jobId, { status: 'running', progress: 3, started_at: new Date().toISOString(), error_message: null });
    const [{ data: project }, { data: asset }, { data: directionStage }] = await Promise.all([
      adminClient.from('devotionals').select('id,title,primary_scripture,duration_seconds').eq('id', devotionalId).eq('owner_id', ownerId).maybeSingle(),
      adminClient.from('media_assets').select('id,storage_path').eq('devotional_id', devotionalId).eq('owner_id', ownerId).eq('kind', 'source_video').maybeSingle(),
      adminClient.from('workflow_stages').select('notes,status').eq('devotional_id', devotionalId).eq('owner_id', ownerId).eq('stage', 'video_direction').maybeSingle()
    ]);
    if (!project || !asset?.storage_path) throw new Error('The source video could not be found for rendering.');
    if (directionStage?.status !== 'approved' || !directionStage.notes) throw new Error('The approved video direction could not be found for rendering.');
    let direction: any;
    try { direction = JSON.parse(directionStage.notes)?.plan; } catch { throw new Error('The approved video direction is not valid JSON.'); }
    if (!direction?.scenes?.length) throw new Error('The approved video direction contains no edit scenes; refusing to produce an unchanged video.');
    const { data: signed, error: signedError } = await adminClient.storage.from(mediaBucket).createSignedUrl(asset.storage_path, 8 * 60 * 60);
    if (signedError || !signed?.signedUrl) throw new Error('A private source-video link could not be prepared.');

    const introPath = path.join(projectRoot, 'assets', 'brand', 'intros', 'morning-devotional-intro.mp4');
    const outroPath = path.join(projectRoot, 'assets', 'brand', 'outros', 'rhm-default-outro.mp4');
    const logoPath = path.join(projectRoot, 'assets', 'rhm-logo.png');
    const outputPath = path.join(workDirectory, 'rhm-polished-master.mp4');
    const includeIntro = explicitlyIncludesAsset(String(direction.brandDirection || ''), 'intro');
    const includeOutro = explicitlyIncludesAsset(String(direction.brandDirection || ''), 'outro');
    const totalSeconds = Number(project.duration_seconds || 0);
    const introOutput = path.join(workDirectory, '01-intro.mp4');
    const sourceOutput = path.join(workDirectory, '02-source.mp4');
    const outroOutput = path.join(workDirectory, '03-outro.mp4');
    const companionMode = process.env.RHM_RENDER_COMPANION === 'true';
    const width = companionMode ? 1920 : 854;
    const height = companionMode ? 1080 : 480;
    const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`;
    const commonOutput = ['-c:v', 'libx264', '-preset', companionMode ? 'fast' : 'veryfast', '-crf', companionMode ? '20' : '22', '-profile:v', 'main', '-level', companionMode ? '4.1' : '3.1', '-g', '60', '-c:a', 'aac', '-b:a', companionMode ? '192k' : '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];

    if (includeIntro) await runFfmpegStage(['-i', introPath, '-vf', videoFilter, '-af', 'aformat=sample_rates=48000:channel_layouts=stereo', ...commonOutput, introOutput]);
    await updateJob(jobId, { progress: 7 });

    const brollScenes = (direction.scenes as DirectionScene[]).filter(scene => /b-?roll/i.test(String(scene.runwayTool)));
    if (!brollScenes.length) throw new Error('The approved direction has no Runway B-roll scenes; refusing to report a Runway render that made no Runway calls.');
    const runwayClips: Array<{ path: string; start: number; duration: number; label: string; taskId: string }> = [];
    for (let index = 0; index < brollScenes.length; index += 1) {
      const scene = brollScenes[index];
      const start = parseFirstTimestamp(scene.placement || '') ?? parseFirstTimestamp(scene.sourceRange || '');
      if (start === null) throw new Error(`Runway scene ${index + 1} has no usable placement timestamp.`);
      const generated = await generateRunwayBroll([scene.prompt, scene.extraMotion].filter(Boolean).join(' '), 5);
      const clipPath = path.join(workDirectory, `runway-${String(index + 1).padStart(2, '0')}.mp4`);
      const clipResponse = await fetch(generated.url);
      if (!clipResponse.ok) throw new Error(`Runway output ${generated.taskId} could not be downloaded (${clipResponse.status}).`);
      await writeFile(clipPath, Buffer.from(await clipResponse.arrayBuffer()));
      runwayClips.push({ path: clipPath, start, duration: 5, label: String(scene.purpose || 'Supporting visual'), taskId: generated.taskId });
      await updateJob(jobId, { progress: 8 + Math.floor(((index + 1) / brollScenes.length) * 30) });
    }

    let lastProgress = 38;
    const inputs = ['-i', signed.signedUrl, ...runwayClips.flatMap(clip => ['-i', clip.path]), '-loop', '1', '-i', logoPath];
    const filters = [`[0:v]${videoFilter}[base]`];
    let current = 'base';
    runwayClips.forEach((clip, index) => {
      const prepared = `broll${index}`;
      const overlaid = `edit${index}`;
      filters.push(`[${index + 1}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setpts=PTS-STARTPTS+${clip.start}/TB[${prepared}]`);
      filters.push(`[${current}][${prepared}]overlay=0:0:enable='between(t,${clip.start},${clip.start + clip.duration})':eof_action=pass,drawtext=text='${escapeDrawtext(clip.label)}':x=(w-text_w)/2:y=h-150:fontsize=42:fontcolor=white:borderw=3:bordercolor=black@0.75:enable='between(t,${clip.start},${clip.start + clip.duration})'[${overlaid}]`);
      current = overlaid;
    });
    const logoInput = runwayClips.length + 1;
    filters.push(`[${logoInput}:v]scale=72:-1,format=rgba,colorchannelmixer=aa=0.82[wm]`);
    filters.push(`[${current}][wm]overlay=W-w-18:H-h-18[v]`);
    await runFfmpegStage([
      ...inputs, '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '0:a:0',
      '-af', 'highpass=f=80,lowpass=f=14500,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=2.5:attack=20:release=250,aformat=sample_rates=48000:channel_layouts=stereo',
      ...commonOutput, '-shortest', sourceOutput
    ], seconds => {
      const progress = Math.min(86, 38 + Math.floor((seconds / Math.max(1, Number(project.duration_seconds || 1))) * 48));
      if (progress >= lastProgress + 2) { lastProgress = progress; void updateJob(jobId, { progress }); }
    });
    await updateJob(jobId, { progress: 84 });

    if (includeOutro) await runFfmpegStage(['-i', outroPath, '-vf', videoFilter, '-af', 'aformat=sample_rates=48000:channel_layouts=stereo', ...commonOutput, outroOutput]);
    await updateJob(jobId, { progress: 89 });
    const concatList = path.join(workDirectory, 'concat.txt');
    const segments = [includeIntro ? introOutput : null, sourceOutput, includeOutro ? outroOutput : null].filter(Boolean) as string[];
    await writeFile(concatList, segments.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    await runFfmpegStage(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-movflags', '+faststart', outputPath]);

    await updateJob(jobId, { progress: 92 });
    const storagePath = `${ownerId}/${devotionalId}/renders/rhm-polished-master.mp4`;
    const sizeBytes = await uploadRenderedVideo(storagePath, outputPath, fraction => void updateJob(jobId, { progress: Math.min(99, 92 + Math.floor(fraction * 7)) }));
    await adminClient.from('media_assets').delete().eq('devotional_id', devotionalId).eq('owner_id', ownerId).eq('kind', 'enhanced_video');
    const { error: assetError } = await adminClient.from('media_assets').insert({
      devotional_id: devotionalId, owner_id: ownerId, kind: 'enhanced_video', storage_path: storagePath,
      mime_type: 'video/mp4', size_bytes: sizeBytes, duration_seconds: totalSeconds,
      metadata: { render_job_id: jobId, render_type: 'polished_master', render_worker: companionMode ? 'rhm-local-companion' : 'server', output_resolution: `${width}x${height}`, includes_intro: includeIntro, includes_outro: includeOutro, includes_audio_cleanup: true, includes_watermark: true, includes_scripture_graphic: false, runway_task_ids: runwayClips.map(clip => clip.taskId), runway_broll_count: runwayClips.length, includes_on_screen_descriptions: true }
    });
    if (assetError) throw assetError;
    await updateJob(jobId, { status: 'completed', progress: 100, completed_at: new Date().toISOString() });
  } catch (error: any) {
    console.error('Full render job failed', { jobId, devotionalId, message: error?.message });
    await updateJob(jobId, { status: 'failed', error_message: String(error?.message || 'Unknown render error').slice(-3000), completed_at: new Date().toISOString() });
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function extractAudioChunks(sourceUrl: string, outputDirectory: string) {
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) throw new Error(`The source video could not be opened (${response.status}).`);

  const outputPattern = path.join(outputDirectory, 'audio-%03d.mp3');
  const ffmpegPath = (ffmpeg as { path: string }).path;
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'segment', '-segment_time', '480', '-reset_timestamps', '1', outputPattern
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk.toString()).slice(-4000); });
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Audio extraction failed. ${errorOutput}`)));
  });
  Readable.fromWeb(response.body as never).pipe(child.stdin);
  await completed;
  return (await readdir(outputDirectory)).filter(name => name.endsWith('.mp3')).sort().map(name => path.join(outputDirectory, name));
}

async function extractVisualFrames(sourceUrl: string, outputDirectory: string, durationSeconds: number, onProgress?: (fraction: number) => void): Promise<{ frames: VisualFrame[]; interval: number }> {
  const interval = Math.max(6, Math.ceil((Math.max(1, durationSeconds) / 280) * 2) / 2);
  const outputPattern = path.join(outputDirectory, 'frame-%05d.jpg');
  const ffmpegPath = (ffmpeg as { path: string }).path;
  const filter = `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${interval})+gt(scene\\,0.35)',scale=768:-2,showinfo`;
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'info', '-i', sourceUrl, '-an', '-vf', filter,
    '-vsync', 'vfr', '-frames:v', '400', '-q:v', '5', outputPattern
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const timestamps: number[] = [];
  let lineBuffer = '';
  let errorOutput = '';
  let lastReportedPercent = -1;
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    errorOutput = (errorOutput + text).slice(-5000);
    lineBuffer += text;
    const lines = lineBuffer.split(/[\r\n]+/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const match = line.match(/showinfo.*pts_time:([0-9.]+)/);
      if (match) timestamps.push(Number(match[1]));
      const progressMatch = durationSeconds > 0 ? line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/) : null;
      if (progressMatch) {
        const seconds = Number(progressMatch[1]) * 3600 + Number(progressMatch[2]) * 60 + Number(progressMatch[3]);
        const percent = Math.min(99, Math.floor((seconds / durationSeconds) * 100));
        if (percent >= lastReportedPercent + 2) {
          lastReportedPercent = percent;
          onProgress?.(percent / 100);
        }
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Visual frame extraction failed. ${errorOutput}`)));
  });
  const files = (await readdir(outputDirectory)).filter(name => /^frame-\d+\.jpg$/i.test(name)).sort().slice(0, 400);
  const frames = files.map((name, index) => {
    const timestampSeconds = Number.isFinite(timestamps[index]) ? timestamps[index] : index * interval;
    return { path: path.join(outputDirectory, name), timestampSeconds, timestamp: exactTimestamp(timestampSeconds) };
  });
  return { frames, interval };
}

async function analyzeVisualFrameBatch(frames: VisualFrame[]): Promise<VisualObservation[]> {
  const schema = {
    type: 'object', additionalProperties: false, required: ['observations'],
    properties: { observations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['timestamp', 'framing', 'lighting', 'speakerPresence', 'gestureExpression', 'onScreenText', 'qualityIssues', 'editOpportunities'],
      properties: {
        timestamp: { type: 'string' }, framing: { type: 'string' }, lighting: { type: 'string' }, speakerPresence: { type: 'string' },
        gestureExpression: { type: 'string' }, onScreenText: { type: 'string' }, qualityIssues: { type: 'array', items: { type: 'string' } },
        editOpportunities: { type: 'array', items: { type: 'string' } }
      }
    } } }
  };
  const content: any[] = [{ type: 'text', text: 'Analyze every timestamped frame. Return one observation for each frame in the same order.' }];
  for (const frame of frames) {
    const image = (await readFile(frame.path)).toString('base64');
    content.push({ type: 'text', text: `Timestamp ${frame.timestamp}` });
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'low' } });
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: { name: 'devotional_visual_observations', strict: true, schema } },
      messages: [
        { role: 'system', content: 'You are a factual visual continuity analyst for RHM Studios. Inspect only visible evidence. Note framing, exposure and lighting, speaker presence, visible gestures or expressions without claiming private emotion, readable on-screen text, visible quality problems, and useful edit or clip opportunities. Do not assess theology from an image and do not invent action between sampled frames. Be concise.' },
        { role: 'user', content }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const result = body?.choices?.[0]?.message?.content;
  if (!response.ok || !result) throw new Error(body?.error?.message || `Visual frame analysis failed (${response.status}).`);
  return (JSON.parse(result)?.observations || []) as VisualObservation[];
}

async function summarizeVisualAnalysis(observations: VisualObservation[], transcript: string, sampledFrameCount: number, interval: number) {
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['overallVisualSynopsis', 'presentationStrengths', 'visualIssues', 'onScreenElements', 'continuityNotes', 'editOpportunities', 'clipVisualCandidates', 'runwayPreparation'],
    properties: {
      overallVisualSynopsis: { type: 'string' }, presentationStrengths: { type: 'array', items: { type: 'string' } },
      visualIssues: { type: 'array', items: { type: 'string' } }, onScreenElements: { type: 'array', items: { type: 'string' } },
      continuityNotes: { type: 'array', items: { type: 'string' } },
      editOpportunities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['timestamp', 'recommendation', 'rationale'], properties: { timestamp: { type: 'string' }, recommendation: { type: 'string' }, rationale: { type: 'string' } } } },
      clipVisualCandidates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['timestamp', 'reason'], properties: { timestamp: { type: 'string' }, reason: { type: 'string' } } } },
      runwayPreparation: { type: 'array', items: { type: 'string' } }
    }
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.15,
      response_format: { type: 'json_schema', json_schema: { name: 'devotional_visual_analysis', strict: true, schema } },
      messages: [
        { role: 'system', content: 'Synthesize timestamped sampled-frame observations into an honest, useful visual editorial review. Distinguish visible evidence from recommendations. Align timestamps with the transcript when possible. Prioritize presentation quality, continuity, Scripture and graphic opportunities, respectful B-roll, clip readiness, and source ranges that may benefit from Runway. Never claim the unsampled frames were inspected.' },
        { role: 'user', content: `Sampled ${sampledFrameCount} frames at a baseline interval of ${interval} seconds plus detected scene changes.\n\nTranscript excerpt:\n${transcript.slice(0, 30000)}\n\nFrame observations:\n${JSON.stringify(observations).slice(0, 120000)}` }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const result = body?.choices?.[0]?.message?.content;
  if (!response.ok || !result) throw new Error(body?.error?.message || `Visual synthesis failed (${response.status}).`);
  return JSON.parse(result);
}

async function transcribeChunk(filePath: string) {
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('response_format', 'json');
  form.append('prompt', 'This is a Christian morning devotional. Preserve scripture references, names, prayer language, and the speaker\'s intended meaning.');
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), path.basename(filePath));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiApiKey}` },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
  if (!response.ok || !body.text) throw new Error(body.error?.message || `Transcription failed (${response.status}).`);
  return body.text.trim();
}

function responseText(body: any) {
  return body?.choices?.[0]?.message?.content;
}

export async function analyzeTranscript(transcript: string, userDirection = ''): Promise<MessageReview> {
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['overallSynopsis', 'centralMessage', 'whatWorked', 'needsClarity', 'possibleConcerns', 'scripturesDetected', 'suggestedEmphasis'],
    properties: {
      overallSynopsis: { type: 'string' },
      centralMessage: { type: 'string' },
      whatWorked: { type: 'array', items: { type: 'string' } },
      needsClarity: { type: 'array', items: { type: 'string' } },
      possibleConcerns: { type: 'array', items: { type: 'string' } },
      scripturesDetected: { type: 'array', items: { type: 'string' } },
      suggestedEmphasis: { type: 'string' }
    }
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: { name: 'devotional_message_review', strict: true, schema } },
      messages: [
        { role: 'system', content: 'You are a careful editorial reviewer for RHM Studios. Analyze only what the transcript conveys. Be respectful, candid, specific, and pastorally sensitive. Do not invent doctrine, intentions, scriptures, or quotations. Identify strengths, unclear transitions or claims, and anything a listener might misunderstand. Concerns are editorial observations, not declarations of theological authority.' },
        { role: 'user', content: `Review this devotional transcript.\n\nCreator clarification, if any:\n${userDirection || 'None provided yet.'}\n\nTranscript:\n${transcript}` }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const content = responseText(body);
  if (!response.ok || !content) throw new Error(body?.error?.message || `Message analysis failed (${response.status}).`);
  return JSON.parse(content) as MessageReview;
}

async function saveMessageReview(devotionalId: string, ownerId: string, review: MessageReview, userDirection = '') {
  const notes = JSON.stringify({ review, userDirection, generatedAt: new Date().toISOString() });
  const { error } = await adminClient.from('workflow_stages').upsert({
    devotional_id: devotionalId,
    owner_id: ownerId,
    stage: 'message',
    status: 'ready',
    notes
  }, { onConflict: 'devotional_id,stage' });
  if (error) throw error;
}

async function ensureVisualAnalysisJob(devotionalId: string, ownerId: string) {
  const [{ count: existingJobs }, { data: existingAnalysis }] = await Promise.all([
    adminClient.from('processing_jobs').select('id', { count: 'exact', head: true }).eq('devotional_id', devotionalId).eq('job_type', 'visual_analysis'),
    adminClient.from('visual_analyses').select('devotional_id').eq('devotional_id', devotionalId).maybeSingle()
  ]);
  if (!existingJobs && !existingAnalysis) {
    await adminClient.from('processing_jobs').insert({ devotional_id: devotionalId, owner_id: ownerId, job_type: 'visual_analysis', provider: 'openai', status: 'queued', progress: 0 });
  }
}

async function processVisualAnalysisJob(job: any) {
  const jobId = String(job.id);
  const devotionalId = String(job.devotional_id);
  const ownerId = String(job.owner_id);
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'rhm-visual-'));
  try {
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
    const [{ data: existing }, { data: project }, { data: asset }, { data: transcript }] = await Promise.all([
      adminClient.from('visual_analyses').select('devotional_id').eq('devotional_id', devotionalId).maybeSingle(),
      adminClient.from('devotionals').select('duration_seconds').eq('id', devotionalId).eq('owner_id', ownerId).single(),
      adminClient.from('media_assets').select('storage_path').eq('devotional_id', devotionalId).eq('owner_id', ownerId).eq('kind', 'source_video').single(),
      adminClient.from('written_outputs').select('content').eq('devotional_id', devotionalId).eq('owner_id', ownerId).eq('kind', 'transcript').order('version', { ascending: false }).limit(1).maybeSingle()
    ]);
    if (existing) return void await updateJob(jobId, { status: 'completed', progress: 100, completed_at: new Date().toISOString(), error_message: null });
    if (!asset || !transcript?.content) throw new Error('The source video and transcript must be ready before visual analysis.');
    const { data: signed, error: signedError } = await adminClient.storage.from(mediaBucket).createSignedUrl(asset.storage_path, 60 * 60);
    if (signedError || !signed?.signedUrl) throw new Error('A private source-video link could not be created for visual analysis.');
    await updateJob(jobId, { status: 'running', progress: 5, started_at: new Date().toISOString(), error_message: null });
    const extracted = await extractVisualFrames(signed.signedUrl, workDirectory, Number(project?.duration_seconds) || 0, fraction => {
      void updateJob(jobId, { progress: 5 + Math.round(fraction * 12) });
    });
    if (!extracted.frames.length) throw new Error('No representative video frames could be extracted.');
    await updateJob(jobId, { progress: 18 });
    const observations: VisualObservation[] = [];
    const batchSize = 20;
    for (let index = 0; index < extracted.frames.length; index += batchSize) {
      const batch = extracted.frames.slice(index, index + batchSize);
      observations.push(...await analyzeVisualFrameBatch(batch));
      const completed = Math.min(extracted.frames.length, index + batch.length);
      await updateJob(jobId, { progress: 18 + Math.round((completed / extracted.frames.length) * 62) });
    }
    await updateJob(jobId, { progress: 84 });
    const analysis = await summarizeVisualAnalysis(observations, transcript.content, extracted.frames.length, extracted.interval);
    const { error } = await adminClient.from('visual_analyses').upsert({
      devotional_id: devotionalId, owner_id: ownerId, status: 'ready', sampled_frame_count: extracted.frames.length,
      sampling_interval_seconds: extracted.interval, observations, analysis, model_provider: 'openai:gpt-4o-mini'
    }, { onConflict: 'devotional_id' });
    if (error) throw error;
    await updateJob(jobId, { status: 'completed', progress: 100, completed_at: new Date().toISOString(), error_message: null });
  } catch (error: any) {
    console.error('Visual analysis job failed', { jobId, devotionalId, message: error?.message });
    await updateJob(jobId, { status: 'failed', error_message: String(error?.message || 'Unknown visual analysis error').slice(0, 1000) });
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function processTranscriptionJob(job: any) {
  const jobId = String(job.id);
  const devotionalId = String(job.devotional_id);
  const ownerId = String(job.owner_id);
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'rhm-transcription-'));
  try {
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');

    // Retries must not redo a costly transcription when both finished outputs
    // are already present (for example, after a browser showed stale state).
    const [{ data: existingTranscript }, { data: existingMessageStage }] = await Promise.all([
      adminClient.from('written_outputs').select('id').eq('devotional_id', devotionalId).eq('kind', 'transcript').limit(1).maybeSingle(),
      adminClient.from('workflow_stages').select('id,status').eq('devotional_id', devotionalId).eq('stage', 'message').maybeSingle()
    ]);
    if (existingTranscript && existingMessageStage?.status === 'ready') {
      await updateJob(jobId, { status: 'completed', progress: 100, error_message: null, completed_at: new Date().toISOString() });
      await adminClient.from('devotionals').update({ status: 'review' }).eq('id', devotionalId);
      await ensureVisualAnalysisJob(devotionalId, ownerId);
      return;
    }

    await updateJob(jobId, { status: 'running', progress: 2, started_at: new Date().toISOString(), error_message: null });
    await adminClient.from('devotionals').update({ status: 'processing' }).eq('id', devotionalId);
    const { data: asset, error: assetError } = await adminClient
      .from('media_assets')
      .select('storage_path')
      .eq('devotional_id', devotionalId)
      .eq('kind', 'source_video')
      .single();
    if (assetError || !asset) throw new Error('The source video record was not found.');
    const { data: signed, error: signedError } = await adminClient.storage.from(mediaBucket).createSignedUrl(asset.storage_path, 60 * 60);
    if (signedError || !signed?.signedUrl) throw new Error('A private source-video link could not be created.');

    await updateJob(jobId, { progress: 8 });
    const chunks = await extractAudioChunks(signed.signedUrl, workDirectory);
    if (!chunks.length) throw new Error('No spoken-audio chunks were produced.');

    const transcriptParts: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const text = await transcribeChunk(chunks[index]);
      transcriptParts.push(`[${timestamp(index * 480)}]\n${text}`);
      await updateJob(jobId, { progress: 15 + Math.round(((index + 1) / chunks.length) * 60) });
    }
    const transcript = transcriptParts.join('\n\n');
    const { error: transcriptError } = await adminClient.from('written_outputs').upsert({
      devotional_id: devotionalId,
      owner_id: ownerId,
      kind: 'transcript',
      content: transcript,
      model_provider: 'openai:gpt-4o-mini-transcribe',
      approved: false,
      version: 1
    }, { onConflict: 'devotional_id,kind,version' });
    if (transcriptError) throw transcriptError;

    await updateJob(jobId, { progress: 82 });
    const review = await analyzeTranscript(transcript);
    await saveMessageReview(devotionalId, ownerId, review);
    await updateJob(jobId, { status: 'completed', progress: 100, completed_at: new Date().toISOString() });
    await adminClient.from('devotionals').update({ status: 'review' }).eq('id', devotionalId);
    await ensureVisualAnalysisJob(devotionalId, ownerId);
  } catch (error: any) {
    console.error('Transcription job failed', { jobId, devotionalId, message: error?.message });
    await updateJob(jobId, { status: 'failed', error_message: String(error?.message || 'Unknown processing error').slice(0, 1000) });
    await adminClient.from('devotionals').update({ status: 'uploaded' }).eq('id', devotionalId);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

export async function runQueuedProcessingJobs() {
  if (workerActive) return;
  workerActive = true;
  try {
    while (true) {
      const { data: jobs, error } = await adminClient
        .from('processing_jobs')
        .select('id,devotional_id,owner_id,job_type')
        .in('job_type', ['transcription', 'visual_analysis'])
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);
      if (error || !jobs?.length) break;
      if (jobs[0].job_type === 'visual_analysis') await processVisualAnalysisJob(jobs[0]);
      else await processTranscriptionJob(jobs[0]);
    }
  } finally {
    workerActive = false;
  }
}

// A Render restart stops any in-process ffmpeg/transcription work, but the
// database row remains "running". On a fresh server process there cannot be a
// local worker that still owns those rows, so put them back in the queue.
export async function recoverInterruptedProcessingJobs() {
  const { error } = await adminClient
    .from('processing_jobs')
    .update({
      status: 'queued',
      progress: 0,
      error_message: 'Processing was safely resumed after the studio restarted.',
      started_at: null,
      completed_at: null
    })
    .in('job_type', ['transcription', 'visual_analysis'])
    .eq('status', 'running');
  if (error) console.error('Interrupted processing jobs could not be recovered', { message: error.message });
}

export async function recoverInterruptedFullRenderJobs() {
  const { error } = await adminClient.from('processing_jobs').update({
    status: 'queued', progress: 1, error_message: 'The local render companion safely resumed this job.', started_at: null, completed_at: null
  }).eq('job_type', 'full_render').eq('status', 'running');
  if (error) throw new Error(`Interrupted local render jobs could not be recovered: ${error.message}`);
}

export async function runNextQueuedFullRenderJob() {
  const { data: jobs, error } = await adminClient.from('processing_jobs')
    .select('id,devotional_id,owner_id,job_type').eq('job_type', 'full_render').eq('status', 'queued')
    .order('created_at', { ascending: true }).limit(1);
  if (error) throw new Error(`The local render queue could not be checked: ${error.message}`);
  if (!jobs?.length) return false;
  await processFullRenderJob(jobs[0]);
  return true;
}

export async function regenerateMessageReview(devotionalId: string, ownerId: string, transcript: string, userDirection: string) {
  const review = await analyzeTranscript(transcript, userDirection);
  await saveMessageReview(devotionalId, ownerId, review, userDirection);
  return review;
}
