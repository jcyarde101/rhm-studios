import { config } from './config.js';
import { adminClient } from './supabase.js';

type ChatTurn = { role: 'user' | 'assistant'; content: string };

function requireOpenAI() {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
}

function requireElevenLabs() {
  if (!config.elevenLabsApiKey) throw new Error('ELEVENLABS_API_KEY is not configured.');
}

export async function listDeeVoices() {
  requireElevenLabs();
  const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=50&sort=name&sort_direction=asc', {
    headers: { 'xi-api-key': config.elevenLabsApiKey }
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(body?.detail?.message || body?.detail || `ElevenLabs voices failed (${response.status}).`);
  const voices = (body.voices || []).map((voice: any) => ({
    id: voice.voice_id,
    name: voice.name,
    description: voice.description || '',
    previewUrl: voice.preview_url || null,
    labels: voice.labels || {},
    category: voice.category || ''
  }));
  voices.sort((a: any, b: any) => {
    const aFemale = String(a.labels?.gender || '').toLowerCase() === 'female' ? 0 : 1;
    const bFemale = String(b.labels?.gender || '').toLowerCase() === 'female' ? 0 : 1;
    return aFemale - bFemale || String(a.name).localeCompare(String(b.name));
  });
  return { voices, defaultVoiceId: config.elevenLabsVoiceId || null };
}

export async function transcribeDeeAudio(bytes: Buffer, mimeType: string) {
  requireOpenAI();
  if (!bytes.length) throw new Error('No microphone audio was received.');
  const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('response_format', 'json');
  form.append('prompt', 'This is a conversation with Dee, an RHM Studios assistant. Preserve devotional titles, scripture references, company names, and production terminology.');
  form.append('file', new Blob([Uint8Array.from(bytes)], { type: mimeType || 'audio/webm' }), `dee-question.${extension}`);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiApiKey}` },
    body: form
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !body.text) throw new Error(body?.error?.message || `Voice transcription failed (${response.status}).`);
  return String(body.text).trim();
}

async function loadDeeContext(ownerId: string, projectId?: string) {
  let projectQuery = adminClient
    .from('devotionals')
    .select('id,title,primary_scripture,recording_date,duration_seconds,status,created_at')
    .eq('owner_id', ownerId);
  projectQuery = projectId ? projectQuery.eq('id', projectId) : projectQuery.order('created_at', { ascending: false }).limit(1);
  const { data: project } = await projectQuery.maybeSingle();
  if (!project) return { project: null, transcript: '', review: null, userDirection: '', jobs: [] };
  const [{ data: transcript }, { data: stage }, { data: jobs }] = await Promise.all([
    adminClient.from('written_outputs').select('content').eq('devotional_id', project.id).eq('kind', 'transcript').order('version', { ascending: false }).limit(1).maybeSingle(),
    adminClient.from('workflow_stages').select('status,notes').eq('devotional_id', project.id).eq('stage', 'message').maybeSingle(),
    adminClient.from('processing_jobs').select('job_type,status,progress,error_message').eq('devotional_id', project.id).order('created_at', { ascending: false })
  ]);
  let review = null;
  let userDirection = '';
  if (stage?.notes) {
    try {
      const notes = JSON.parse(stage.notes);
      review = notes.review ?? null;
      userDirection = typeof notes.userDirection === 'string' ? notes.userDirection : '';
    } catch {}
  }
  return { project, transcript: transcript?.content ?? '', review, userDirection, jobs: jobs ?? [] };
}

export async function askDee(ownerId: string, message: string, projectId?: string, history: ChatTurn[] = []) {
  requireOpenAI();
  const context = await loadDeeContext(ownerId, projectId);
  const safeHistory = history
    .filter(turn => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .slice(-8)
    .map(turn => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
  const studioContext = JSON.stringify({
    currentProject: context.project,
    processingJobs: context.jobs,
    aiMessageReview: context.review,
    creatorDirection: context.userDirection,
    transcript: context.transcript.slice(0, 50000)
  });
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      messages: [
        {
          role: 'system',
          content: `You are Dee (spelled D-E-E), a warm, perceptive female studio assistant for RHM Studios. The creator manages several companies and needs fast, accurate briefings. Speak naturally and concisely, usually in two to five sentences unless asked for detail. Use the supplied studio data as your source of truth. Distinguish transcript facts from your own interpretation. Be candid but respectful about strengths, gaps, and possible misunderstandings. You are currently read-only: you may explain, summarize, compare, recommend, and draft suggestions, but you must never claim to approve, publish, delete, spend money, alter a project, or contact anyone. If asked to perform an action, explain that it needs the creator's explicit approval and that action permissions have not been enabled yet. Do not use markdown tables because your answer will be spoken aloud.`
        },
        { role: 'system', content: `Current private studio context:\n${studioContext}` },
        ...safeHistory,
        { role: 'user', content: message.slice(0, 5000) }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const reply = body?.choices?.[0]?.message?.content;
  if (!response.ok || !reply) throw new Error(body?.error?.message || `Dee could not respond (${response.status}).`);
  return String(reply).trim();
}

export async function synthesizeDeeSpeech(text: string, requestedVoiceId?: string) {
  requireElevenLabs();
  const voiceId = requestedVoiceId || config.elevenLabsVoiceId;
  if (!voiceId || !/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)) throw new Error('Choose an ElevenLabs voice for Dee first.');
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenLabsApiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: text.slice(0, 2500),
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true }
    })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as any;
    throw new Error(body?.detail?.message || body?.detail || `ElevenLabs speech failed (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
