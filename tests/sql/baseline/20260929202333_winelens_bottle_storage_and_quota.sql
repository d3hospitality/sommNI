-- Additive wineLENS migration. Existing collection IDs and vintage columns stay intact.
-- Explicit grants support projects with automatic Data API exposure disabled.
alter table public.user_collection enable row level security;
grant select, insert, update, delete on public.user_collection to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('winelens-bottles', 'winelens-bottles', false, 8388608, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false;

drop policy if exists "winelens_bottle_read_own" on storage.objects;
create policy "winelens_bottle_read_own" on storage.objects for select to authenticated
using (bucket_id = 'winelens-bottles' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "winelens_bottle_insert_own" on storage.objects;
create policy "winelens_bottle_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'winelens-bottles' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.user_collection c where c.id::text = (storage.foldername(name))[2] and c.user_id = (select auth.uid())));
-- Immutable random paths: no UPDATE/upsert permission is needed.

create table if not exists public.bottle_render_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  slot smallint not null check (slot between 1 and 3),
  primary key (user_id, day, slot),
  unique (user_id, request_id)
);
alter table public.bottle_render_attempts enable row level security;
revoke all on public.bottle_render_attempts from anon, authenticated;
grant select, insert on public.bottle_render_attempts to authenticated;
drop policy if exists "render_attempt_read_own" on public.bottle_render_attempts;
create policy "render_attempt_read_own" on public.bottle_render_attempts for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "render_attempt_reserve_own_today" on public.bottle_render_attempts;
create policy "render_attempt_reserve_own_today" on public.bottle_render_attempts for insert to authenticated
with check (user_id = (select auth.uid()) and day = (now() at time zone 'utc')::date);
-- No user UPDATE/DELETE: attempts cannot be reset or moved to evade the daily cap.
