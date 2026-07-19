import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4173),
  appUrl: process.env.APP_URL?.trim() || `http://localhost:${process.env.PORT ?? 4173}`,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024),
  supabaseUrl: required('SUPABASE_URL'),
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || required('SUPABASE_ANON_KEY'),
  supabaseAdminKey: process.env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_SERVICE_ROLE_KEY'),
  adminEmails: new Set((process.env.RHM_ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean))
};
