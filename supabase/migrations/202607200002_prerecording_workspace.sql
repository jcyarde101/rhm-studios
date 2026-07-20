-- Pre-recording preparation that remains attached after the video arrives.

create table if not exists public.devotional_plans (
  devotional_id uuid primary key references public.devotionals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  big_idea text not null default '',
  intended_audience text not null default '',
  desired_outcome text not null default '',
  research_notes text not null default '',
  questions_to_explore text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists devotional_plans_owner_idx on public.devotional_plans(owner_id, updated_at desc);

drop trigger if exists devotional_plans_set_updated_at on public.devotional_plans;
create trigger devotional_plans_set_updated_at before update on public.devotional_plans
for each row execute function public.set_updated_at();

alter table public.devotional_plans enable row level security;

drop policy if exists "devotional_plans_owner_all" on public.devotional_plans;
create policy "devotional_plans_owner_all" on public.devotional_plans for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "devotional_plans_admin_all" on public.devotional_plans;
create policy "devotional_plans_admin_all" on public.devotional_plans for all
using (public.is_admin()) with check (public.is_admin());
