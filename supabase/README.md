# Daybreak Supabase setup

The initial migration defines the database, security policies, and private Storage buckets for Daybreak Studio. It does not connect to or change a live Supabase project by itself.

## When you are ready

1. Create a Supabase project at `https://supabase.com/dashboard`.
2. Install the Supabase CLI.
3. Run `supabase login`.
4. Run `supabase link` and select the project.
5. Review the migration in `migrations/202607190001_initial_daybreak_schema.sql`.
6. Run `supabase db push` to apply it.
7. Put the project URL, publishable key, and secret key in the private root `.env` file.

Never put `SUPABASE_SECRET_KEY` in `index.html`, `app.js`, or any other browser code. Uploaded files use paths beginning with the signed-in user's ID so the included Storage policies keep each user's media private.
