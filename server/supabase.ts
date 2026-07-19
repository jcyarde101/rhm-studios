import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { CookieOptions, Request, Response } from 'express';
import { config } from './config.js';

export function createRequestClient(req: Request, res: Response) {
  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookieOptions: {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: config.appUrl.startsWith('https://')
    },
    cookies: {
      getAll: () => Object.entries(req.cookies ?? {}).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (cookies, headers) => {
        Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
        cookies.forEach(({ name, value, options }) => {
          // Supabase's cookie serializer uses seconds; Express expects milliseconds.
          const maxAge = typeof options.maxAge === 'number' ? options.maxAge * 1000 : undefined;
          res.cookie(name, value, { ...options, maxAge } as CookieOptions);
        });
      }
    }
  });
}

export const adminClient = createClient(config.supabaseUrl, config.supabaseAdminKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
