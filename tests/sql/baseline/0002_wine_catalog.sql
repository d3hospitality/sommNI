-- Migration 0002 — shared wine catalog for the unified SommNI backend.
--
-- Backs api/wines.js (search + single-wine lookup + personalized
-- recommendations). Unlike profiles/user_collection this table is a *shared*
-- read-only catalog: every authenticated or anonymous client may read it, but
-- nobody writes to it through the API — the catalog is populated server-side by
-- the wine-data pipeline (parse-winelist) using the service role. RLS therefore
-- grants public SELECT and no public write.
--
-- Apply in the Supabase SQL editor (or `supabase db push`) against the sommNI
-- project (hwqovzizjoelzfulhxem).

create extension if not exists pg_trgm;

create table if not exists public.wines (
  id            text primary key,           -- stable catalog id (slug/uuid)
  name          text not null,
  producer      text,
  vintage       int,
  region        text,
  country       text,
  grape         text,                       -- primary grape / blend label
  color         text,                       -- red | white | rose | sparkling | ...
  style         text,                       -- dry, off-dry, etc.
  price         numeric(10,2),              -- list price, nullable
  tasting_notes text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Trigram indexes power fast case-insensitive substring search (ilike *term*)
-- across the fields api/wines.js searches.
create index if not exists wines_name_trgm    on public.wines using gin (name gin_trgm_ops);
create index if not exists wines_producer_trgm on public.wines using gin (producer gin_trgm_ops);
create index if not exists wines_region_trgm  on public.wines using gin (region gin_trgm_ops);
create index if not exists wines_grape_trgm   on public.wines using gin (grape gin_trgm_ops);

-- Plain btree helpers for the filter/sort paths.
create index if not exists wines_color_idx  on public.wines (color);
create index if not exists wines_region_idx on public.wines (region);
create index if not exists wines_price_idx  on public.wines (price);

alter table public.wines enable row level security;

-- Catalog is world-readable (shared across web, Android, and G2 clients).
drop policy if exists "wines_select_public" on public.wines;
create policy "wines_select_public" on public.wines
  for select using (true);

-- No public insert/update/delete policies: writes require the service role,
-- which bypasses RLS. This keeps the catalog tamper-proof from clients.
