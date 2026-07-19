-- Human-in-the-loop production decisions and approval gates.

create table public.workflow_stages (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  stage text not null check (stage in ('message', 'video_direction', 'writing', 'clips', 'final')),
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'changes_requested', 'approved')),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (devotional_id, stage)
);

create table public.edit_decisions (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  edit_type text not null check (edit_type in ('color', 'audio', 'b_roll', 'scripture', 'lower_third', 'music', 'cut')),
  start_seconds numeric(10,2),
  end_seconds numeric(10,2),
  instructions text,
  preview_storage_path text,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'changes_requested', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in ('approved', 'rejected', 'changes_requested', 'reopened')),
  comment text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.workflow_stages enable row level security;
alter table public.edit_decisions enable row level security;
alter table public.approval_events enable row level security;

create policy "workflow_stages_owner_all" on public.workflow_stages for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "edit_decisions_owner_all" on public.edit_decisions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "approval_events_owner_read" on public.approval_events for select using (owner_id = auth.uid());

create trigger workflow_stages_set_updated_at before update on public.workflow_stages
for each row execute function public.set_updated_at();
create trigger edit_decisions_set_updated_at before update on public.edit_decisions
for each row execute function public.set_updated_at();

create index workflow_stages_devotional_idx on public.workflow_stages(devotional_id, stage);
create index edit_decisions_devotional_idx on public.edit_decisions(devotional_id, start_seconds);
create index approval_events_devotional_idx on public.approval_events(devotional_id, created_at desc);
