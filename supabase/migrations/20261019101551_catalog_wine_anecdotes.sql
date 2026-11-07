-- Server-owned catalog copy and audit trail; no personal library records are changed.
create table public.wl_anecdote_runs (
 id uuid primary key, token_hash text not null check(length(token_hash)=64),
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 status text not null default 'active' check(status in ('active','closed'))
);
create table public.wl_wine_anecdotes (
 wine_id text primary key, catalog_name text not null, run_id uuid not null references public.wl_anecdote_runs(id),
 status text not null default 'pending' check(status in ('pending','running','ready','needs_review','failed')),
 attempts integer not null default 0 check(attempts between 0 and 4), lease_id uuid, lease_until timestamptz,
 title text not null default '', anecdote text not null default '', scope text not null default '',
 identity_note text not null default '', sources jsonb not null default '[]',
 model text, prompt_version text, generated_at timestamptz, updated_at timestamptz not null default now(),
 check(length(anecdote)<=850), check(jsonb_typeof(sources)='array'),
 check(status<>'ready' or (length(anecdote)>=150 and jsonb_array_length(sources)>0 and scope in ('wine','producer')))
);
create table public.wl_anecdote_attempts (
 id uuid primary key, run_id uuid not null references public.wl_anecdote_runs(id), wine_id text not null references public.wl_wine_anecdotes(wine_id),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','ready','needs_review','failed')),
 model text not null, prompt_version text not null, input jsonb not null,
 research jsonb, result jsonb, provider_usage jsonb, error text
);
create index wl_anecdote_attempts_wine on public.wl_anecdote_attempts(wine_id, started_at desc);
alter table public.wl_anecdote_runs enable row level security;
alter table public.wl_wine_anecdotes enable row level security;
alter table public.wl_anecdote_attempts enable row level security;
revoke all on public.wl_anecdote_runs,public.wl_wine_anecdotes,public.wl_anecdote_attempts from public,anon,authenticated;
grant all on public.wl_anecdote_runs,public.wl_wine_anecdotes,public.wl_anecdote_attempts to service_role;
create function public.wl_claim_anecdote(p_run uuid,p_wine text,p_lease uuid) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.wl_wine_anecdotes set status='running',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '5 minutes',updated_at=now()
 where wine_id=p_wine and run_id=p_run and attempts<4 and status<>'ready'
 and (lease_until is null or lease_until<now())
 and exists(select 1 from public.wl_anecdote_runs where id=p_run and status='active' and expires_at>now());
 return found;
end; $$;
revoke all on function public.wl_claim_anecdote(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.wl_claim_anecdote(uuid,text,uuid) to service_role;
