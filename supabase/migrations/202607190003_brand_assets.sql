-- Shared RHM logo and separate Studios/Publications usage rules.

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  brand_division text not null check (brand_division in ('studios', 'publications', 'shared')),
  asset_type text not null check (asset_type in ('logo', 'watermark', 'intro', 'outro', 'cover_mark')),
  storage_path text not null,
  is_default boolean not null default false,
  settings jsonb not null default '{"position":"top-right","opacity":0.82,"safe_area_percent":4}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_assets enable row level security;
create policy "brand_assets_owner_all" on public.brand_assets for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create trigger brand_assets_set_updated_at before update on public.brand_assets
for each row execute function public.set_updated_at();
create unique index brand_assets_one_default_idx
on public.brand_assets(owner_id, brand_division, asset_type)
where is_default;
