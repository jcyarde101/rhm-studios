-- Daybreak Studio: initial database foundation
-- Run through the Supabase CLI migration workflow. Do not paste service-role keys here.

create extension if not exists pgcrypto;

create type public.devotional_status as enum (
  'draft', 'uploaded', 'processing', 'review', 'approved', 'published', 'failed'
);
create type public.asset_kind as enum (
  'source_video', 'enhanced_video', 'audio', 'thumbnail', 'graphic', 'ebook_artwork'
);
create type public.output_kind as enum (
  'short_description', 'full_devotional', 'prayer', 'transcript', 'social_caption'
);
create type public.job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devotionals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Untitled devotional',
  primary_scripture text,
  recording_date date,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status public.devotional_status not null default 'draft',
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind public.asset_kind not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  duration_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  start_seconds numeric(10,2) not null check (start_seconds >= 0),
  end_seconds numeric(10,2) not null check (end_seconds > start_seconds),
  aspect_ratio text not null default '9:16',
  caption_text text,
  storage_path text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.written_outputs (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind public.output_kind not null,
  content text not null default '',
  model_provider text,
  approved boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (devotional_id, kind, version)
);

create table public.scriptures (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reference text not null,
  translation text,
  passage_text text,
  sort_order integer not null default 0
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table public.devotional_categories (
  devotional_id uuid references public.devotionals(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  primary key (devotional_id, category_id)
);

create table public.ebook_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  subtitle text,
  description text,
  target_entries integer not null default 30 check (target_entries between 1 and 365),
  status text not null default 'draft' check (status in ('draft', 'review', 'ready', 'published')),
  cover_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ebook_entries (
  ebook_id uuid references public.ebook_projects(id) on delete cascade,
  devotional_id uuid references public.devotionals(id) on delete cascade,
  sort_order integer not null,
  editor_notes text,
  included boolean not null default true,
  primary key (ebook_id, devotional_id),
  unique (ebook_id, sort_order)
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_type text not null,
  provider text not null,
  status public.job_status not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  external_job_id text,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index devotionals_owner_created_idx on public.devotionals(owner_id, created_at desc);
create index media_assets_devotional_idx on public.media_assets(devotional_id);
create index clips_devotional_idx on public.clips(devotional_id);
create index written_outputs_devotional_idx on public.written_outputs(devotional_id);
create index processing_jobs_status_idx on public.processing_jobs(status, created_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger devotionals_set_updated_at before update on public.devotionals
for each row execute function public.set_updated_at();
create trigger clips_set_updated_at before update on public.clips
for each row execute function public.set_updated_at();
create trigger written_outputs_set_updated_at before update on public.written_outputs
for each row execute function public.set_updated_at();
create trigger ebook_projects_set_updated_at before update on public.ebook_projects
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.devotionals enable row level security;
alter table public.media_assets enable row level security;
alter table public.clips enable row level security;
alter table public.written_outputs enable row level security;
alter table public.scriptures enable row level security;
alter table public.categories enable row level security;
alter table public.devotional_categories enable row level security;
alter table public.ebook_projects enable row level security;
alter table public.ebook_entries enable row level security;
alter table public.processing_jobs enable row level security;

create policy "profiles_owner_all" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "devotionals_owner_all" on public.devotionals for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "media_assets_owner_all" on public.media_assets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "clips_owner_all" on public.clips for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "written_outputs_owner_all" on public.written_outputs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "scriptures_owner_all" on public.scriptures for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "categories_owner_all" on public.categories for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "ebook_projects_owner_all" on public.ebook_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "processing_jobs_owner_read" on public.processing_jobs for select using (owner_id = auth.uid());
create policy "devotional_categories_owner_all" on public.devotional_categories for all
using (exists (select 1 from public.devotionals d where d.id = devotional_id and d.owner_id = auth.uid()))
with check (exists (select 1 from public.devotionals d where d.id = devotional_id and d.owner_id = auth.uid()));
create policy "ebook_entries_owner_all" on public.ebook_entries for all
using (exists (select 1 from public.ebook_projects e where e.id = ebook_id and e.owner_id = auth.uid()))
with check (exists (select 1 from public.ebook_projects e where e.id = ebook_id and e.owner_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('devotional-media', 'devotional-media', false, 4294967296),
  ('devotional-exports', 'devotional-exports', false, 1073741824)
on conflict (id) do nothing;

create policy "users_read_own_devotional_media" on storage.objects for select
using (bucket_id = 'devotional-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users_upload_own_devotional_media" on storage.objects for insert
with check (bucket_id = 'devotional-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users_update_own_devotional_media" on storage.objects for update
using (bucket_id = 'devotional-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users_delete_own_devotional_media" on storage.objects for delete
using (bucket_id = 'devotional-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users_read_own_exports" on storage.objects for select
using (bucket_id = 'devotional-exports' and (storage.foldername(name))[1] = auth.uid()::text);

