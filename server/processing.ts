import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { config } from './config.js';
import { adminClient } from './supabase.js';

const openaiApiKey = config.openaiApiKey;
const mediaBucket = 'devotional-media';
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

function timestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  await adminClient.from('processing_jobs').update(values).eq('id', jobId);
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

async function processTranscriptionJob(job: any) {
  const jobId = String(job.id);
  const devotionalId = String(job.devotional_id);
  const ownerId = String(job.owner_id);
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'rhm-transcription-'));
  try {
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
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
        .select('id,devotional_id,owner_id')
        .eq('job_type', 'transcription')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);
      if (error || !jobs?.length) break;
      await processTranscriptionJob(jobs[0]);
    }
  } finally {
    workerActive = false;
  }
}

export async function regenerateMessageReview(devotionalId: string, ownerId: string, transcript: string, userDirection: string) {
  const review = await analyzeTranscript(transcript, userDirection);
  await saveMessageReview(devotionalId, ownerId, review, userDirection);
  return review;
}
