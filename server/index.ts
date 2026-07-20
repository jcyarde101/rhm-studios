import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { adminClient, createRequestClient } from './supabase.js';
import { recoverInterruptedProcessingJobs, regenerateMessageReview, runQueuedProcessingJobs } from './processing.js';
import { approveDeeNote, askDee, deleteDeeNote, getDeeMemory, listDeeVoices, synthesizeDeeSpeech, transcribeDeeAudio } from './dee.js';

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const publicFiles = [
  'styles.css', 'app.js', 'workflow.css', 'workflow-image.css', 'workflow-message-review.css', 'dee-agent.css', 'workflow.js', 'dee-agent.js',
  'library.css', 'library.js', 'rhm-brand.css', 'brand-media.css', 'session.js', 'voice-input.css', 'voice-input.js', 'workflow-accessibility.css', 'planning-workspace.css',
  'auth.css', 'auth.js'
];
for (const file of publicFiles) app.get(`/${file}`, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(root, file));
});
app.use('/assets', express.static(path.join(root, 'assets'), { dotfiles: 'deny', index: false }));
app.get('/vendor/tus.min.js', (_req, res) => res.sendFile(path.join(root, 'node_modules', 'tus-js-client', 'dist', 'tus.min.js')));

app.get(['/signin', '/signin.html'], async (req, res) => {
  const supabase = createRequestClient(req, res);
  const { data } = await supabase.auth.getUser();
  if (data.user) return res.redirect('/');
  res.sendFile(path.join(root, 'signin.html'));
});

app.get('/auth/google', async (req, res) => {
  const supabase = createRequestClient(req, res);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${config.appUrl}/auth/callback`, skipBrowserRedirect: true }
  });
  if (error || !data.url) return res.redirect('/signin?error=oauth_start');
  res.redirect(data.url);
});

app.get('/auth/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!code) return res.redirect('/signin?error=missing_code');
  const supabase = createRequestClient(req, res);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) {
    console.error('OAuth code exchange failed', {
      message: error?.message ?? 'No authenticated user was returned',
      code: error?.code,
      status: error?.status,
      verifierCookiePresent: Object.keys(req.cookies ?? {}).some(name => name.endsWith('-code-verifier'))
    });
    return res.redirect('/signin?error=exchange_failed');
  }

  const email = data.user.email.toLowerCase();
  const role = config.adminEmails.has(email) ? 'admin' : 'creator';
  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: data.user.id,
    display_name: data.user.user_metadata?.full_name ?? data.user.email,
    avatar_url: data.user.user_metadata?.avatar_url ?? null,
    role
  });
  if (profileError) return res.redirect('/signin?error=profile_setup');
  res.redirect('/');
});

app.post('/auth/logout', async (req, res) => {
  const supabase = createRequestClient(req, res);
  await supabase.auth.signOut();
  res.status(204).end();
});

async function requireUser(req: Request, res: Response, next: NextFunction) {
  const supabase = createRequestClient(req, res);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    return res.redirect('/signin');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Your secure upload session expired. Please sign in again.' });
    return res.redirect('/signin');
  }
  res.locals.user = data.user;
  res.locals.accessToken = sessionData.session.access_token;
  next();
}

app.get('/api/me', requireUser, async (_req, res) => {
  const user = res.locals.user;
  const { data: profile } = await adminClient.from('profiles').select('display_name,avatar_url,role').eq('id', user.id).single();
  res.json({ id: user.id, email: user.email, displayName: profile?.display_name ?? user.email, avatarUrl: profile?.avatar_url ?? null, role: profile?.role ?? 'creator' });
});

app.get('/api/dee/status', requireUser, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    name: 'Dee',
    mode: 'read_only',
    role: 'ministry_sounding_board',
    memoryWindowDays: 7,
    textReady: Boolean(config.openaiApiKey),
    voiceReady: Boolean(config.elevenLabsApiKey),
    defaultVoiceConfigured: Boolean(config.elevenLabsVoiceId)
  });
});

app.get('/api/dee/voices', requireUser, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(await listDeeVoices());
  } catch (error: any) {
    console.error('ElevenLabs voice list failed', { message: error?.message });
    res.status(502).json({ error: error?.message || 'Dee could not load ElevenLabs voices.' });
  }
});

app.post('/api/dee/transcribe', requireUser, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }), async (req, res) => {
  try {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const text = await transcribeDeeAudio(bytes, req.get('content-type') || 'audio/webm');
    res.json({ text });
  } catch (error: any) {
    console.error('Dee microphone transcription failed', { message: error?.message });
    res.status(502).json({ error: error?.message || 'Dee could not understand the recording.' });
  }
});

app.post('/api/dee/chat', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const message = cleanText(req.body?.message, 5000);
  const projectId = cleanText(req.body?.projectId, 100) || undefined;
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'Ask Dee a question first.' });
  try {
    const result = await askDee(res.locals.user.id, message, projectId, history);
    res.json({ ...result, mode: 'read_only', memoryWindowDays: 7 });
  } catch (error: any) {
    console.error('Dee response failed', { message: error?.message });
    res.status(502).json({ error: error?.message || 'Dee could not respond.' });
  }
});

app.post('/api/dee/chat-stream', requireUser, async (req, res) => {
  const message = cleanText(req.body?.message, 5000);
  const projectId = cleanText(req.body?.projectId, 100) || undefined;
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'Ask Dee a question first.' });
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);
  send({ type: 'ready' });
  try {
    const result = await askDee(res.locals.user.id, message, projectId, history, delta => send({ type: 'delta', delta }));
    send({ type: 'done', reply: result.reply, note: result.note, sources: result.sources, mode: 'read_only', memoryWindowDays: 7 });
  } catch (error: any) {
    console.error('Dee streaming response failed', { message: error?.message });
    send({ type: 'error', error: error?.message || 'Dee could not finish her response.' });
  } finally {
    res.end();
  }
});

app.get('/api/dee/memory', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const projectId = cleanText(req.query.projectId, 100);
  if (!projectId) return res.status(400).json({ error: 'Open a project to view Dee\'s memory.' });
  try {
    res.json(await getDeeMemory(res.locals.user.id, projectId));
  } catch (error: any) {
    res.status(404).json({ error: error?.message || 'Dee\'s memory could not be loaded.' });
  }
});

app.patch('/api/dee/notes/:noteId/approve', requireUser, async (req, res) => {
  try {
    res.json({ note: await approveDeeNote(res.locals.user.id, String(req.params.noteId)) });
  } catch (error: any) {
    res.status(404).json({ error: error?.message || 'The note could not be approved.' });
  }
});

app.delete('/api/dee/notes/:noteId', requireUser, async (req, res) => {
  try {
    await deleteDeeNote(res.locals.user.id, String(req.params.noteId));
    res.status(204).end();
  } catch (error: any) {
    res.status(404).json({ error: error?.message || 'The note could not be removed.' });
  }
});

app.post('/api/dee/speak', requireUser, async (req, res) => {
  const text = cleanText(req.body?.text, 4000);
  const voiceId = cleanText(req.body?.voiceId, 100) || undefined;
  if (!text) return res.status(400).json({ error: 'There is no response for Dee to speak.' });
  try {
    const audio = await synthesizeDeeSpeech(text, voiceId);
    res.setHeader('Cache-Control', 'no-store');
    res.type('audio/mpeg').send(audio);
  } catch (error: any) {
    console.error('Dee speech failed', { message: error?.message });
    res.status(502).json({ error: error?.message || 'Dee could not create a spoken response.' });
  }
});

function decodeScriptureEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function scriptureHtmlToText(html: string) {
  const passageHtml = html.match(/<div[^>]+id=["']bibletext["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? html;
  const tokens = passageHtml.match(/<[^>]+>|[^<]+/g) ?? [];
  let skipDepth = 0;
  let result = '';
  for (const token of tokens) {
    if (token.startsWith('<')) {
      const closing = /^<\//.test(token);
      const ignoredOpening = !closing && /class=["'][^"']*\btn\b/i.test(token);
      const ordinaryOpening = !closing && !/^<!|^<\?|\/>$/.test(token) && !/^<(br|hr|img|meta|link|input)\b/i.test(token);
      if (skipDepth) {
        if (ordinaryOpening) skipDepth += 1;
        if (closing) skipDepth -= 1;
        continue;
      }
      if (ignoredOpening) {
        skipDepth = 1;
        continue;
      }
      if (/^<br\b|^<\/(p|h\d|section|div)>/i.test(token)) result += '\n';
      continue;
    }
    if (!skipDepth) result += decodeScriptureEntities(token);
  }
  return result.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

app.get('/api/scripture', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const reference = cleanText(req.query.reference, 120);
  const requestedVersion = cleanText(req.query.version, 10).toUpperCase() || 'NLT';
  const version = new Set(['NLT', 'NLTUK', 'NTV', 'KJV']).has(requestedVersion) ? requestedVersion : 'NLT';
  if (!reference) return res.status(400).json({ error: 'Enter a scripture reference first.' });
  try {
    const url = new URL('https://api.nlt.to/api/passages');
    url.searchParams.set('ref', reference);
    url.searchParams.set('version', version);
    url.searchParams.set('key', config.nltApiKey);
    const response = await fetch(url, { headers: { accept: 'text/html' } });
    const text = scriptureHtmlToText(await response.text());
    if (!response.ok || !text) throw new Error(`Scripture provider returned ${response.status}.`);
    res.json({
      reference,
      version,
      text,
      attribution: version.startsWith('NLT')
        ? 'Scripture quotation marked NLT is taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Inc. All rights reserved.'
        : `${version} scripture text.`
    });
  } catch (error: any) {
    console.error('Scripture lookup failed', { reference, version, message: error?.message });
    res.status(502).json({ error: 'The scripture text could not be loaded right now. Your reference is still saved.' });
  }
});

const videoBucket = 'devotional-media';
const projectRef = new URL(config.supabaseUrl).hostname.split('.')[0];
const resumableUploadEndpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
const allowedVideoTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'application/octet-stream']);

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function videoExtension(fileName: string, mimeType: string) {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (extension && ['mp4', 'mov', 'webm', 'm4v'].includes(extension)) return extension;
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'video/webm') return 'webm';
  if (mimeType === 'video/x-m4v') return 'm4v';
  return 'mp4';
}

app.get('/api/projects', requireUser, async (_req, res) => {
  const ownerId = res.locals.user.id;
  const [{ data: projects, error }, { count: clipCount, error: clipError }] = await Promise.all([
    adminClient
      .from('devotionals')
      .select('id,title,primary_scripture,recording_date,duration_seconds,status,created_at,updated_at,media_assets(id,kind,size_bytes,mime_type,metadata)')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false }),
    adminClient.from('clips').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId)
  ]);
  if (error || clipError) return res.status(500).json({ error: 'Projects could not be loaded.' });

  res.json({
    counts: { projects: projects?.length ?? 0, clips: clipCount ?? 0 },
    maxUploadBytes: config.maxUploadBytes,
    projects: projects ?? []
  });
});

app.get('/api/projects/:projectId/workspace', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ownerId = res.locals.user.id;
  const projectId = String(req.params.projectId);
  const [{ data: project, error: projectError }, { data: transcript }, { data: messageStage }, { data: jobs }, { data: plan }] = await Promise.all([
    adminClient
      .from('devotionals')
      .select('id,title,primary_scripture,recording_date,duration_seconds,status,created_at,media_assets(id,kind,storage_path,size_bytes,mime_type,metadata)')
      .eq('id', projectId)
      .eq('owner_id', ownerId)
      .single(),
    adminClient
      .from('written_outputs')
      .select('content,model_provider,updated_at')
      .eq('devotional_id', projectId)
      .eq('owner_id', ownerId)
      .eq('kind', 'transcript')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('workflow_stages')
      .select('status,notes,updated_at')
      .eq('devotional_id', projectId)
      .eq('owner_id', ownerId)
      .eq('stage', 'message')
      .maybeSingle(),
    adminClient
      .from('processing_jobs')
      .select('id,job_type,status,progress,error_message,created_at,started_at,completed_at')
      .eq('devotional_id', projectId)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false }),
    adminClient
      .from('devotional_plans')
      .select('big_idea,intended_audience,desired_outcome,research_notes,questions_to_explore,updated_at')
      .eq('devotional_id', projectId)
      .eq('owner_id', ownerId)
      .maybeSingle()
  ]);
  if (projectError || !project) return res.status(404).json({ error: 'This video project could not be found.' });

  const source = (project.media_assets || []).find((asset: any) => asset.kind === 'source_video' && asset.metadata?.upload_state === 'complete');
  let videoUrl: string | null = null;
  if (source?.storage_path) {
    const { data: signed } = await adminClient.storage.from(videoBucket).createSignedUrl(source.storage_path, 60 * 60);
    videoUrl = signed?.signedUrl ?? null;
  }
  let messageReview: Record<string, unknown> | null = null;
  let userDirection = '';
  if (messageStage?.notes) {
    try {
      const notes = JSON.parse(messageStage.notes);
      messageReview = notes.review ?? null;
      userDirection = typeof notes.userDirection === 'string' ? notes.userDirection : '';
    } catch {}
  }
  res.json({ project, source, videoUrl, transcript: transcript?.content ?? null, messageReview, userDirection, messageStage, jobs: jobs ?? [], plan, planningMode: !source });
});

app.post('/api/projects/:projectId/message-review', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ownerId = res.locals.user.id;
  const projectId = String(req.params.projectId);
  const userDirection = cleanText(req.body?.userDirection, 4000);
  if (!userDirection) return res.status(400).json({ error: 'Explain what you intended the message to convey.' });
  const [{ data: project }, { data: transcript }] = await Promise.all([
    adminClient.from('devotionals').select('id').eq('id', projectId).eq('owner_id', ownerId).maybeSingle(),
    adminClient.from('written_outputs').select('content').eq('devotional_id', projectId).eq('owner_id', ownerId).eq('kind', 'transcript').order('version', { ascending: false }).limit(1).maybeSingle()
  ]);
  if (!project) return res.status(404).json({ error: 'This video project could not be found.' });
  if (!transcript?.content) return res.status(409).json({ error: 'The transcript is still processing. You can redirect the review as soon as it is ready.' });
  try {
    const review = await regenerateMessageReview(projectId, ownerId, transcript.content, userDirection);
    res.json({ review, userDirection, message: 'AI reviewed the transcript again using your clarification.' });
  } catch (error: any) {
    console.error('Message review regeneration failed', { projectId, message: error?.message });
    res.status(502).json({ error: 'AI could not refresh the message review. Please try again.' });
  }
});

app.post('/api/projects/:projectId/retry-processing', requireUser, async (req, res) => {
  const ownerId = res.locals.user.id;
  const projectId = String(req.params.projectId);
  const [{ data: job }, { data: transcript }, { data: messageStage }] = await Promise.all([
    adminClient
      .from('processing_jobs')
      .select('id,status,attempts')
      .eq('devotional_id', projectId)
      .eq('owner_id', ownerId)
      .eq('job_type', 'transcription')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient.from('written_outputs').select('id').eq('devotional_id', projectId).eq('owner_id', ownerId).eq('kind', 'transcript').limit(1).maybeSingle(),
    adminClient.from('workflow_stages').select('status').eq('devotional_id', projectId).eq('owner_id', ownerId).eq('stage', 'message').maybeSingle()
  ]);
  if (!job) return res.status(404).json({ error: 'No transcription job was found for this project.' });
  if (transcript && messageStage?.status === 'ready') {
    await Promise.all([
      adminClient.from('processing_jobs').update({ status: 'completed', progress: 100, error_message: null, completed_at: new Date().toISOString() }).eq('id', job.id).eq('owner_id', ownerId),
      adminClient.from('devotionals').update({ status: 'review' }).eq('id', projectId).eq('owner_id', ownerId)
    ]);
    return res.json({ message: 'The completed transcript and message review have been restored.', completed: true });
  }
  if (job.status === 'running' || job.status === 'queued') return res.json({ message: 'Transcription is already processing.' });
  await adminClient.from('processing_jobs').update({
    status: 'queued',
    progress: 0,
    error_message: null,
    started_at: null,
    completed_at: null,
    attempts: (job.attempts ?? 0) + 1
  }).eq('id', job.id).eq('owner_id', ownerId);
  if (config.processingWorkerEnabled) void runQueuedProcessingJobs();
  res.json({ message: 'Transcription has been queued again.' });
});

app.post('/api/projects/planning', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ownerId = res.locals.user.id;
  const title = cleanText(req.body?.title, 200);
  const scripture = cleanText(req.body?.scripture, 200) || null;
  const bigIdea = cleanText(req.body?.bigIdea, 4000);
  if (!title) return res.status(400).json({ error: 'Enter a working title for the planning workspace.' });
  const { data: project, error: projectError } = await adminClient
    .from('devotionals')
    .insert({ owner_id: ownerId, title, primary_scripture: scripture, status: 'draft' })
    .select('id,title,primary_scripture,status,created_at')
    .single();
  if (projectError || !project) return res.status(500).json({ error: 'The planning workspace could not be created.' });
  const { error: planError } = await adminClient.from('devotional_plans').insert({ devotional_id: project.id, owner_id: ownerId, big_idea: bigIdea });
  if (planError) {
    await adminClient.from('devotionals').delete().eq('id', project.id).eq('owner_id', ownerId);
    return res.status(500).json({ error: 'The research notebook could not be created.' });
  }
  res.status(201).json({ project, message: 'Your pre-recording workspace is ready.' });
});

app.put('/api/projects/:projectId/plan', requireUser, async (req, res) => {
  const ownerId = res.locals.user.id;
  const projectId = String(req.params.projectId);
  const { data: project } = await adminClient.from('devotionals').select('id').eq('id', projectId).eq('owner_id', ownerId).maybeSingle();
  if (!project) return res.status(404).json({ error: 'This planning workspace could not be found.' });
  const plan = {
    devotional_id: projectId,
    owner_id: ownerId,
    big_idea: cleanText(req.body?.bigIdea, 12000),
    intended_audience: cleanText(req.body?.intendedAudience, 6000),
    desired_outcome: cleanText(req.body?.desiredOutcome, 12000),
    research_notes: cleanText(req.body?.researchNotes, 30000),
    questions_to_explore: cleanText(req.body?.questionsToExplore, 12000)
  };
  const { data, error } = await adminClient.from('devotional_plans').upsert(plan, { onConflict: 'devotional_id' }).select('big_idea,intended_audience,desired_outcome,research_notes,questions_to_explore,updated_at').single();
  if (error || !data) return res.status(500).json({ error: 'Your planning notes could not be saved.' });
  res.json({ plan: data, message: 'Planning notes saved.' });
});

app.post('/api/projects/:projectId/prepare-upload', requireUser, async (req, res) => {
  const ownerId = res.locals.user.id;
  const projectId = String(req.params.projectId);
  const fileName = cleanText(req.body?.file?.name, 255);
  const mimeType = cleanText(req.body?.file?.type, 100) || 'application/octet-stream';
  const sizeBytes = Number(req.body?.file?.size);
  if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return res.status(400).json({ error: 'Choose a valid video file.' });
  if (!allowedVideoTypes.has(mimeType)) return res.status(415).json({ error: 'Use an MP4, MOV, M4V, or WebM video.' });
  if (sizeBytes > config.maxUploadBytes) return res.status(413).json({ error: 'This video exceeds the current 50 GB upload limit.' });
  const [{ data: project }, { data: existingSources }] = await Promise.all([
    adminClient.from('devotionals').select('id,title,status').eq('id', projectId).eq('owner_id', ownerId).maybeSingle(),
    adminClient.from('media_assets').select('id,storage_path,metadata').eq('devotional_id', projectId).eq('owner_id', ownerId).eq('kind', 'source_video')
  ]);
  if (!project) return res.status(404).json({ error: 'This planning workspace could not be found.' });
  const completedSource = (existingSources || []).find((asset: any) => asset.metadata?.upload_state === 'complete');
  if (completedSource) return res.status(409).json({ error: 'A source video is already attached to this project.' });
  const pendingSources = existingSources || [];
  if (pendingSources.length) {
    await adminClient.storage.from(videoBucket).remove(pendingSources.map((asset: any) => asset.storage_path));
    await adminClient.from('media_assets').delete().in('id', pendingSources.map((asset: any) => asset.id)).eq('owner_id', ownerId);
  }
  const extension = videoExtension(fileName, mimeType);
  const storagePath = `${ownerId}/${projectId}/source-${Date.now()}.${extension}`;
  const { data: asset, error } = await adminClient.from('media_assets').insert({
    devotional_id: projectId,
    owner_id: ownerId,
    kind: 'source_video',
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    metadata: { original_name: fileName, upload_state: 'pending', attached_after_planning: true }
  }).select('id').single();
  if (error || !asset) return res.status(500).json({ error: 'The secure media record could not be created.' });
  res.status(201).json({
    project,
    upload: { assetId: asset.id, bucket: videoBucket, path: storagePath, endpoint: resumableUploadEndpoint, accessToken: res.locals.accessToken, chunkSize: 6 * 1024 * 1024 }
  });
});

app.delete('/api/projects/:projectId/pending-upload/:assetId', requireUser, async (req, res) => {
  const ownerId = res.locals.user.id;
  const projectId = String(req.params.projectId);
  const assetId = String(req.params.assetId);
  const { data: asset } = await adminClient.from('media_assets')
    .select('id,storage_path,metadata')
    .eq('id', assetId).eq('devotional_id', projectId).eq('owner_id', ownerId).maybeSingle();
  if (!asset) return res.status(204).end();
  const metadata = (asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}) as Record<string, unknown>;
  if (metadata.upload_state === 'complete') return res.status(409).json({ error: 'A completed source video cannot be removed here.' });
  await adminClient.storage.from(videoBucket).remove([asset.storage_path]);
  await adminClient.from('media_assets').delete().eq('id', asset.id).eq('owner_id', ownerId);
  res.status(204).end();
});

app.post('/api/projects', requireUser, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ownerId = res.locals.user.id;
  const title = cleanText(req.body?.title, 200);
  const scripture = cleanText(req.body?.scripture, 200) || null;
  const recordingDateInput = cleanText(req.body?.recordingDate, 10);
  const recordingDate = /^\d{4}-\d{2}-\d{2}$/.test(recordingDateInput) ? recordingDateInput : null;
  const fileName = cleanText(req.body?.file?.name, 255);
  const mimeType = cleanText(req.body?.file?.type, 100) || 'application/octet-stream';
  const sizeBytes = Number(req.body?.file?.size);

  if (!title) return res.status(400).json({ error: 'Enter a working title.' });
  if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return res.status(400).json({ error: 'Choose a valid video file.' });
  if (!allowedVideoTypes.has(mimeType)) return res.status(415).json({ error: 'Use an MP4, MOV, M4V, or WebM video.' });
  if (sizeBytes > config.maxUploadBytes) {
    return res.status(413).json({
      error: `This video is larger than the current ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB Supabase limit.`
    });
  }

  const { data: project, error: projectError } = await adminClient
    .from('devotionals')
    .insert({ owner_id: ownerId, title, primary_scripture: scripture, recording_date: recordingDate, status: 'draft' })
    .select('id,title,primary_scripture,recording_date,status,created_at')
    .single();
  if (projectError || !project) return res.status(500).json({ error: 'The project record could not be created.' });

  const extension = videoExtension(fileName, mimeType);
  const storagePath = `${ownerId}/${project.id}/source-${Date.now()}.${extension}`;
  const { data: asset, error: assetError } = await adminClient
    .from('media_assets')
    .insert({
      devotional_id: project.id,
      owner_id: ownerId,
      kind: 'source_video',
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      metadata: { original_name: fileName, upload_state: 'pending' }
    })
    .select('id')
    .single();
  if (assetError || !asset) {
    await adminClient.from('devotionals').delete().eq('id', project.id).eq('owner_id', ownerId);
    return res.status(500).json({ error: 'The secure media record could not be created.' });
  }

  res.status(201).json({
    project,
    upload: {
      assetId: asset.id,
      bucket: videoBucket,
      path: storagePath,
      endpoint: resumableUploadEndpoint,
      accessToken: res.locals.accessToken,
      chunkSize: 6 * 1024 * 1024
    }
  });
});

app.post('/api/projects/:projectId/complete-upload', requireUser, async (req, res) => {
  const ownerId = res.locals.user.id;
  const projectId = req.params.projectId;
  const assetId = cleanText(req.body?.assetId, 100);
  const durationSeconds = Math.max(0, Math.round(Number(req.body?.durationSeconds) || 0)) || null;

  const { data: asset, error: assetError } = await adminClient
    .from('media_assets')
    .select('id,devotional_id,storage_path,mime_type,size_bytes,metadata')
    .eq('id', assetId)
    .eq('devotional_id', projectId)
    .eq('owner_id', ownerId)
    .single();
  if (assetError || !asset) return res.status(404).json({ error: 'The pending upload record was not found.' });

  const { data: storedFile, error: storageError } = await adminClient.storage.from(videoBucket).info(asset.storage_path);
  if (storageError || !storedFile) return res.status(409).json({ error: 'The upload has not finished reaching secure storage.' });

  const metadata = (asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}) as Record<string, unknown>;
  const { error: mediaUpdateError } = await adminClient
    .from('media_assets')
    .update({
      size_bytes: storedFile.size ?? asset.size_bytes,
      mime_type: storedFile.contentType ?? asset.mime_type,
      duration_seconds: durationSeconds,
      metadata: { ...metadata, upload_state: 'complete', completed_at: new Date().toISOString() }
    })
    .eq('id', asset.id)
    .eq('owner_id', ownerId);
  const { data: project, error: projectUpdateError } = await adminClient
    .from('devotionals')
    .update({ status: 'uploaded', duration_seconds: durationSeconds })
    .eq('id', projectId)
    .eq('owner_id', ownerId)
    .select('id,title,primary_scripture,recording_date,duration_seconds,status,created_at,updated_at')
    .single();
  if (mediaUpdateError || projectUpdateError || !project) return res.status(500).json({ error: 'The upload arrived, but the project could not be finalized.' });

  const { count: queuedJobs } = await adminClient
    .from('processing_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('devotional_id', projectId)
    .eq('job_type', 'transcription');
  if (!queuedJobs) {
    await adminClient.from('processing_jobs').insert({
      devotional_id: projectId,
      owner_id: ownerId,
      job_type: 'transcription',
      provider: 'openai',
      status: 'queued',
      progress: 0
    });
  }

  if (config.processingWorkerEnabled) void runQueuedProcessingJobs();

  res.json({ project, message: 'Upload complete. The project is ready for transcription.' });
});

app.post('/api/projects/:projectId/upload-failed', requireUser, async (req, res) => {
  const ownerId = res.locals.user.id;
  await adminClient
    .from('devotionals')
    .update({ status: 'failed' })
    .eq('id', req.params.projectId)
    .eq('owner_id', ownerId);
  res.status(204).end();
});

app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  auth: 'supabase-google',
  adminConfigured: config.adminEmails.size > 0,
  integrations: { openaiConfigured: Boolean(config.openaiApiKey), elevenLabsConfigured: Boolean(config.elevenLabsApiKey) }
}));
app.get(['/', '/index.html'], requireUser, (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/workflow.html', requireUser, (_req, res) => res.sendFile(path.join(root, 'workflow.html')));
app.get('/library.html', requireUser, (_req, res) => res.sendFile(path.join(root, 'library.html')));

app.use((_req, res) => res.status(404).send('Not found'));
app.listen(config.port, () => {
  console.log(`RHM Studios running at ${config.appUrl}`);
  if (config.processingWorkerEnabled) {
    setTimeout(() => void (async () => {
      await recoverInterruptedProcessingJobs();
      await runQueuedProcessingJobs();
    })(), 1500);
    setInterval(() => void runQueuedProcessingJobs(), 60_000).unref();
  }
});
