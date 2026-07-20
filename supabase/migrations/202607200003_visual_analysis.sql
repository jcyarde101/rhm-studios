-- Timestamped visual understanding for uploaded devotional source videos.

create table if not exists public.visual_analyses (
  devotional_id uuid primary key references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready', 'approved')),
  sampled_frame_count integer not null default 0,
  sampling_interval_seconds numeric(8,2),
  observations jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  model_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visual_analyses_owner_idx on public.visual_analyses(owner_id, updated_at desc);

drop trigger if exists visual_analyses_set_updated_at on public.visual_analyses;
create trigger visual_analyses_set_updated_at before update on public.visual_analyses
for each row execute function public.set_updated_at();

alter table public.visual_analyses enable row level security;

drop policy if exists "visual_analyses_owner_all" on public.visual_analyses;
create policy "visual_analyses_owner_all" on public.visual_analyses for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "visual_analyses_admin_all" on public.visual_analyses;
create policy "visual_analyses_admin_all" on public.visual_analyses for all
using (public.is_admin()) with check (public.is_admin());

-- Pick up existing completed sample projects without re-running transcription.
insert into public.processing_jobs (devotional_id, owner_id, job_type, provider, status, progress)
select d.id, d.owner_id, 'visual_analysis', 'openai', 'queued', 0
from public.devotionals d
where exists (select 1 from public.media_assets m where m.devotional_id = d.id and m.kind = 'source_video')
  and exists (select 1 from public.written_outputs w where w.devotional_id = d.id and w.kind = 'transcript')
  and not exists (select 1 from public.visual_analyses v where v.devotional_id = d.id)
  and not exists (select 1 from public.processing_jobs j where j.devotional_id = d.id and j.job_type = 'visual_analysis');
