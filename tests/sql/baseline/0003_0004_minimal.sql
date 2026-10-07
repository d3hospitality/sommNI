-- 0003/0004 are absent in the supplied sommni-api checkout. The two ingest tables below match the
-- hosted wineLENS project's columns as read on 2026-10-07 (truth funnel L0); the RPC stays a stub.
create table public.ingest_batches(
  id uuid primary key default gen_random_uuid(), source text not null, label text,
  wine_count integer not null default 0, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.ingest_wines_raw(
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.ingest_batches(id),
  wine_id text, accepted boolean not null default true, raw jsonb not null, created_at timestamptz not null default now());
alter table public.ingest_batches enable row level security;
alter table public.ingest_wines_raw enable row level security;
create function public.ingest_wines() returns void language plpgsql as $$begin raise exception 'ingest intentionally unavailable in local account harness'; end$$;
revoke all on function public.ingest_wines() from public,anon,authenticated;
