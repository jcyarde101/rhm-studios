-- Dee's private, project-aware ministry coaching memory.
-- Conversation messages expire after seven days; reviewed notes persist.

create table if not exists public.dee_messages (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.dee_notes (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 4000),
  category text not null default 'insight' check (category in ('insight', 'question', 'scripture', 'direction', 'action')),
  scriptures text[] not null default '{}',
  approved boolean not null default false,
  source text not null default 'dee' check (source in ('dee', 'creator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dee_messages_owner_recent_idx on public.dee_messages(owner_id, created_at desc);
create index if not exists dee_messages_project_recent_idx on public.dee_messages(devotional_id, created_at desc);
create index if not exists dee_notes_project_recent_idx on public.dee_notes(devotional_id, created_at desc);

drop trigger if exists dee_notes_set_updated_at on public.dee_notes;
create trigger dee_notes_set_updated_at before update on public.dee_notes
for each row execute function public.set_updated_at();

alter table public.dee_messages enable row level security;
alter table public.dee_notes enable row level security;

drop policy if exists "dee_messages_owner_all" on public.dee_messages;
create policy "dee_messages_owner_all" on public.dee_messages for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "dee_notes_owner_all" on public.dee_notes;
create policy "dee_notes_owner_all" on public.dee_notes for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "dee_messages_admin_all" on public.dee_messages;
create policy "dee_messages_admin_all" on public.dee_messages for all
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "dee_notes_admin_all" on public.dee_notes;
create policy "dee_notes_admin_all" on public.dee_notes for all
using (public.is_admin()) with check (public.is_admin());
