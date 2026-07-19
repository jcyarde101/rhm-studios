import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { adminClient, createRequestClient } from './supabase.js';

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const publicFiles = [
  'styles.css', 'app.js', 'workflow.css', 'workflow-image.css', 'workflow.js',
  'library.css', 'library.js', 'rhm-brand.css', 'brand-media.css', 'session.js',
  'auth.css', 'auth.js'
];
for (const file of publicFiles) app.get(`/${file}`, (_req, res) => res.sendFile(path.join(root, file)));
app.use('/assets', express.static(path.join(root, 'assets'), { dotfiles: 'deny', index: false }));

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
  res.locals.user = data.user;
  next();
}

app.get('/api/me', requireUser, async (_req, res) => {
  const user = res.locals.user;
  const { data: profile } = await adminClient.from('profiles').select('display_name,avatar_url,role').eq('id', user.id).single();
  res.json({ id: user.id, email: user.email, displayName: profile?.display_name ?? user.email, avatarUrl: profile?.avatar_url ?? null, role: profile?.role ?? 'creator' });
});

const videoBucket = 'devotional-media';
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

app.post('/api/projects', requireUser, async (req, res) => {
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

  const { data: signed, error: signedError } = await adminClient.storage
    .from(videoBucket)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (signedError || !signed?.token || !signed?.signedUrl) {
    await adminClient.from('devotionals').delete().eq('id', project.id).eq('owner_id', ownerId);
    return res.status(500).json({ error: 'A secure upload could not be started.' });
  }

  res.status(201).json({
    project,
    upload: {
      assetId: asset.id,
      bucket: videoBucket,
      path: storagePath,
      signedUrl: signed.signedUrl
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

app.get('/api/health', (_req, res) => res.json({ status: 'ok', auth: 'supabase-google', adminConfigured: config.adminEmails.size > 0 }));
app.get(['/', '/index.html'], requireUser, (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/workflow.html', requireUser, (_req, res) => res.sendFile(path.join(root, 'workflow.html')));
app.get('/library.html', requireUser, (_req, res) => res.sendFile(path.join(root, 'library.html')));

app.use((_req, res) => res.status(404).send('Not found'));
app.listen(config.port, () => console.log(`RHM Studios running at ${config.appUrl}`));
