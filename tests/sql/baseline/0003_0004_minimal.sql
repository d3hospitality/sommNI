-- 0003/0004 are absent in the supplied sommni-api checkout. Minimal unrelated
-- ingest provenance/RPC shape: these do not participate in account/token RPCs.
create table public.ingest_sources(id uuid primary key default gen_random_uuid(), source_url text);
create table public.ingest_runs(id uuid primary key default gen_random_uuid(), source_id uuid references public.ingest_sources(id));
alter table public.ingest_sources enable row level security;
alter table public.ingest_runs enable row level security;
create function public.ingest_wines() returns void language plpgsql as $$begin raise exception 'ingest intentionally unavailable in local account harness'; end$$;
revoke all on function public.ingest_wines() from public,anon,authenticated;
