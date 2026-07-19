-- Roles support a single owner today and commercial multi-user access later.

alter table public.profiles
add column if not exists role text not null default 'creator'
check (role in ('admin', 'creator', 'reviewer'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

create policy "profiles_admin_all" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "devotionals_admin_all" on public.devotionals for all using (public.is_admin()) with check (public.is_admin());
create policy "media_assets_admin_all" on public.media_assets for all using (public.is_admin()) with check (public.is_admin());
create policy "clips_admin_all" on public.clips for all using (public.is_admin()) with check (public.is_admin());
create policy "written_outputs_admin_all" on public.written_outputs for all using (public.is_admin()) with check (public.is_admin());
create policy "scriptures_admin_all" on public.scriptures for all using (public.is_admin()) with check (public.is_admin());
create policy "categories_admin_all" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "devotional_categories_admin_all" on public.devotional_categories for all using (public.is_admin()) with check (public.is_admin());
create policy "ebook_projects_admin_all" on public.ebook_projects for all using (public.is_admin()) with check (public.is_admin());
create policy "ebook_entries_admin_all" on public.ebook_entries for all using (public.is_admin()) with check (public.is_admin());
create policy "processing_jobs_admin_all" on public.processing_jobs for all using (public.is_admin()) with check (public.is_admin());
create policy "workflow_stages_admin_all" on public.workflow_stages for all using (public.is_admin()) with check (public.is_admin());
create policy "edit_decisions_admin_all" on public.edit_decisions for all using (public.is_admin()) with check (public.is_admin());
create policy "approval_events_admin_all" on public.approval_events for all using (public.is_admin()) with check (public.is_admin());
create policy "brand_assets_admin_all" on public.brand_assets for all using (public.is_admin()) with check (public.is_admin());

create policy "storage_admin_all" on storage.objects for all
using (public.is_admin()) with check (public.is_admin());
