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
  if (error || !data.user) return res.redirect('/signin');
  res.locals.user = data.user;
  next();
}

app.get('/api/me', requireUser, async (_req, res) => {
  const user = res.locals.user;
  const { data: profile } = await adminClient.from('profiles').select('display_name,avatar_url,role').eq('id', user.id).single();
  res.json({ id: user.id, email: user.email, displayName: profile?.display_name ?? user.email, avatarUrl: profile?.avatar_url ?? null, role: profile?.role ?? 'creator' });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', auth: 'supabase-google', adminConfigured: config.adminEmails.size > 0 }));
app.get(['/', '/index.html'], requireUser, (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/workflow.html', requireUser, (_req, res) => res.sendFile(path.join(root, 'workflow.html')));
app.get('/library.html', requireUser, (_req, res) => res.sendFile(path.join(root, 'library.html')));

app.use((_req, res) => res.status(404).send('Not found'));
app.listen(config.port, () => console.log(`RHM Studios running at ${config.appUrl}`));
