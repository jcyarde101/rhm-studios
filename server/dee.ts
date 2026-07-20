import { config } from './config.js';
import { adminClient } from './supabase.js';

type ChatTurn = { role: 'user' | 'assistant'; content: string };
type DeeNoteDraft = { shouldSave: boolean; title: string; content: string; category: 'insight' | 'question' | 'scripture' | 'direction' | 'action'; scriptures: string[] };

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
  if (!project) return { project: null, transcript: '', review: null, userDirection: '', jobs: [], notes: [], recentMemory: [] };
  const memoryCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: transcript }, { data: stage }, { data: jobs }, { data: notes }, { data: recentMemory }] = await Promise.all([
    adminClient.from('written_outputs').select('content').eq('devotional_id', project.id).eq('kind', 'transcript').order('version', { ascending: false }).limit(1).maybeSingle(),
    adminClient.from('workflow_stages').select('status,notes').eq('devotional_id', project.id).eq('stage', 'message').maybeSingle(),
    adminClient.from('processing_jobs').select('job_type,status,progress,error_message').eq('devotional_id', project.id).order('created_at', { ascending: false }),
    adminClient.from('dee_notes').select('id,title,content,category,scriptures,approved,source,created_at').eq('owner_id', ownerId).eq('devotional_id', project.id).order('created_at', { ascending: false }).limit(20),
    adminClient.from('dee_messages').select('devotional_id,role,content,created_at').eq('owner_id', ownerId).gte('created_at', memoryCutoff).order('created_at', { ascending: false }).limit(30)
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
  return { project, transcript: transcript?.content ?? '', review, userDirection, jobs: jobs ?? [], notes: notes ?? [], recentMemory: (recentMemory ?? []).reverse() };
}

function responseText(body: any) {
  return (body?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n')
    .trim();
}

function responseSources(body: any) {
  const sources = (body?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .flatMap((item: any) => item?.annotations ?? [])
    .filter((item: any) => item?.type === 'url_citation' && typeof item.url === 'string')
    .map((item: any) => ({ title: String(item.title || 'Source').slice(0, 200), url: String(item.url) }));
  return sources.filter((source: any, index: number) => sources.findIndex((item: any) => item.url === source.url) === index).slice(0, 8);
}

async function createDeeNote(ownerId: string, projectId: string, userMessage: string, reply: string) {
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['shouldSave', 'title', 'content', 'category', 'scriptures'],
    properties: {
      shouldSave: { type: 'boolean' },
      title: { type: 'string' },
      content: { type: 'string' },
      category: { type: 'string', enum: ['insight', 'question', 'scripture', 'direction', 'action'] },
      scriptures: { type: 'array', items: { type: 'string' } }
    }
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: { name: 'dee_ministry_note', strict: true, schema } },
      messages: [
        { role: 'system', content: 'Decide whether this exchange contains a durable ministry-workspace note worth revisiting: a sermon insight, unresolved coaching question, Scripture connection, creative direction, or concrete action. Do not save greetings, repetition, transient status, or sensitive personal assumptions. Notes must accurately distinguish the creator\'s words from Dee\'s suggestions. Keep the content under 500 characters.' },
        { role: 'user', content: `Creator: ${userMessage}\n\nDee: ${reply}` }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const content = body?.choices?.[0]?.message?.content;
  if (!response.ok || !content) return null;
  const draft = JSON.parse(content) as DeeNoteDraft;
  if (!draft.shouldSave || !draft.title.trim() || !draft.content.trim()) return null;
  const { data, error } = await adminClient.from('dee_notes').insert({
    devotional_id: projectId,
    owner_id: ownerId,
    title: draft.title.trim().slice(0, 160),
    content: draft.content.trim().slice(0, 4000),
    category: draft.category,
    scriptures: draft.scriptures.map(value => String(value).trim()).filter(Boolean).slice(0, 12),
    approved: false,
    source: 'dee'
  }).select('id,title,content,category,scriptures,approved,source,created_at').single();
  if (error) throw error;
  return data;
}

export async function askDee(ownerId: string, message: string, projectId?: string, _history: ChatTurn[] = []) {
  requireOpenAI();
  const context = await loadDeeContext(ownerId, projectId);
  if (!context.project) throw new Error('Open a devotional project before asking Dee about it.');
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await adminClient.from('dee_messages').delete().eq('owner_id', ownerId).lt('created_at', cutoff);
  const recentMemory = context.recentMemory.slice(-16).map((turn: any) => ({
    role: turn.role,
    content: `[Project ${turn.devotional_id || 'general'} · ${turn.created_at}] ${String(turn.content).slice(0, 2500)}`
  }));
  const studioContext = JSON.stringify({
    currentProject: context.project,
    processingJobs: context.jobs,
    aiMessageReview: context.review,
    creatorDirection: context.userDirection,
    transcript: context.transcript.slice(0, 60000),
    durableMinistryNotes: context.notes
  });
  await adminClient.from('dee_messages').insert({ devotional_id: context.project.id, owner_id: ownerId, role: 'user', content: message.slice(0, 12000) });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning: { effort: 'medium' },
      max_output_tokens: 1800,
      tools: [{ type: 'web_search' }],
      instructions: `You are Dee (D-E-E), the creator's warm, discerning associate-minister-style sounding board and ministry life coach inside RHM Studios.

Your purpose is to help the creator hear what the devotional actually communicates, deepen the biblical and pastoral possibilities, uncover missed points, and ask fruitful questions that draw out the creator's own message. Work through an associate minister's lens: attentive to Scripture, audience, pastoral care, theological coherence, practical application, and responsible communication.

For substantive questions, consider: (1) the big idea actually supported by the transcript, (2) what was said clearly, (3) overlooked or underdeveloped openings, (4) related Scripture connections and why they are relevant, (5) alternative directions without derailing the central message, (6) what listeners may need emotionally or practically, and (7) one or two coaching questions that help the creator choose. Do not force every category into every answer.

Maintain epistemic and pastoral humility. Clearly distinguish: what the creator said, what Scripture says, your interpretation, and a possible application. Never claim divine revelation, prophecy, pastoral authority, or certainty about God's private intent. Do not invent Bible quotations or references; if exact wording is uncertain, give the reference and say it should be verified in the selected translation. Treat Christian traditions charitably and flag where an interpretation may be tradition-dependent.

You may use web search when the creator asks about current events or when a timely real-world connection would materially help. When you use it, identify that material as current-event context, cite sources with readable links, and avoid turning tragedy or controversy into a forced sermon illustration.

Speak naturally, usually in a few focused paragraphs unless asked for depth. Ask thoughtful questions rather than merely agreeing. You are read-only: you may analyze, coach, suggest, and draft, but cannot approve, publish, delete, spend, alter project content, or contact anyone. Do not expose private memory as fact without context. Do not use markdown tables because answers may be spoken aloud.`,
      input: [
        { role: 'user', content: `Private studio source material:\n${studioContext}` },
        ...recentMemory,
        { role: 'user', content: message.slice(0, 5000) }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const reply = responseText(body);
  if (!response.ok || !reply) throw new Error(body?.error?.message || `Dee could not respond (${response.status}).`);
  const cleanReply = String(reply).trim();
  const sources = responseSources(body);
  await adminClient.from('dee_messages').insert({ devotional_id: context.project.id, owner_id: ownerId, role: 'assistant', content: cleanReply.slice(0, 12000), metadata: { model: 'gpt-5.6-terra', reasoning: 'medium', sources } });
  let note = null;
  try { note = await createDeeNote(ownerId, context.project.id, message, cleanReply); }
  catch (error: any) { console.error('Dee note extraction failed', { message: error?.message }); }
  return { reply: cleanReply, note, sources };
}

export async function getDeeMemory(ownerId: string, projectId: string) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await adminClient.from('dee_messages').delete().eq('owner_id', ownerId).lt('created_at', cutoff);
  const [{ data: project }, { data: messages }, { data: notes }] = await Promise.all([
    adminClient.from('devotionals').select('id').eq('id', projectId).eq('owner_id', ownerId).maybeSingle(),
    adminClient.from('dee_messages').select('id,role,content,metadata,created_at').eq('owner_id', ownerId).eq('devotional_id', projectId).gte('created_at', cutoff).order('created_at', { ascending: true }).limit(100),
    adminClient.from('dee_notes').select('id,title,content,category,scriptures,approved,source,created_at,updated_at').eq('owner_id', ownerId).eq('devotional_id', projectId).order('created_at', { ascending: false })
  ]);
  if (!project) throw new Error('This devotional project could not be found.');
  return { messages: messages ?? [], notes: notes ?? [], memoryWindowDays: 7 };
}

export async function approveDeeNote(ownerId: string, noteId: string) {
  const { data, error } = await adminClient.from('dee_notes').update({ approved: true }).eq('id', noteId).eq('owner_id', ownerId).select('id,title,content,category,scriptures,approved,source,created_at,updated_at').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This Dee note could not be found.');
  return data;
}

export async function deleteDeeNote(ownerId: string, noteId: string) {
  const { data, error } = await adminClient.from('dee_notes').delete().eq('id', noteId).eq('owner_id', ownerId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This Dee note could not be found.');
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
