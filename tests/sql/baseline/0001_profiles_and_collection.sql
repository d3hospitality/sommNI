-- Migration 0001 — user profiles + wine collection for the unified SommNI backend.
--
-- Backs the authenticated endpoints api/profile.js and api/collection.js. Both
-- endpoints forward the caller's Supabase JWT to PostgREST, so the RLS policies
-- below are what actually enforce per-user ownership. Apply in the Supabase SQL
-- editor (or `supabase db push`) against the sommNI project.

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, keyed on the auth user id.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text,
  display_name    text,
  avatar_url      text,
  home_restaurant text,
  preferences     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- user_collection — a user's saved/cellared wines.
-- ---------------------------------------------------------------------------
create table if not exists public.user_collection (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  wine_id    text,          -- optional link back to a catalog wine
  wine_name  text not null,
  producer   text,
  vintage    int,
  region     text,
  rating     int check (rating between 1 and 5),
  notes      text,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_collection_user_idx
  on public.user_collection (user_id, created_at desc);

alter table public.user_collection enable row level security;

drop policy if exists "collection_select_own" on public.user_collection;
create policy "collection_select_own" on public.user_collection
  for select using (auth.uid() = user_id);

drop policy if exists "collection_insert_own" on public.user_collection;
create policy "collection_insert_own" on public.user_collection
  for insert with check (auth.uid() = user_id);

drop policy if exists "collection_update_own" on public.user_collection;
create policy "collection_update_own" on public.user_collection
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "collection_delete_own" on public.user_collection;
create policy "collection_delete_own" on public.user_collection
  for delete using (auth.uid() = user_id);
