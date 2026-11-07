-- Public free-beta endpoint writes only these isolated service-owned tables.
-- No direct anonymous/authenticated Data API access. No user collection access.
create table if not exists public.wl_community_wines (
 id uuid primary key default gen_random_uuid(),
 identity_key text not null unique,
 wine_name text not null check (length(wine_name) between 2 and 200),
 producer text not null check (length(producer) between 2 and 160),
 vintage text not null, country text not null default '', region text not null default '',
 grape text not null default '', reference_url text not null default '', details text not null default '',
 catalog_match text,
 status text not null default 'pending' check (status in ('pending','reviewing','needs_details','accepted','declined','released')),
 reviewer_notes text not null default '', release_version text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.wl_community_receipts (
 token_hash text primary key check (length(token_hash)=64),
 wine_id uuid not null references public.wl_community_wines(id),
 -- Each contributor's evidence is retained even when a duplicate is linked.
 evidence jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists wl_community_receipts_wine_idx on public.wl_community_receipts(wine_id);
create table if not exists public.wl_beta_content (
 cache_key text primary key, kind text not null check(kind in ('daily','translation')),
 locale text not null, payload jsonb, lease_id uuid, lease_until timestamptz,
 created_at timestamptz not null default now()
);
alter table public.wl_community_wines enable row level security;
alter table public.wl_community_receipts enable row level security;
alter table public.wl_beta_content enable row level security;
revoke all on public.wl_community_wines,public.wl_community_receipts,public.wl_beta_content from public,anon,authenticated;
grant select,insert,update,delete on public.wl_community_wines,public.wl_community_receipts,public.wl_beta_content to service_role;
create or replace function public.wl_beta_claim_content(p_key text,p_kind text,p_locale text,p_lease uuid)
returns boolean language plpgsql set search_path='' as $$
declare affected integer;
begin
 if p_kind not in ('daily','translation') or length(p_key)>160 then raise exception 'Invalid cache key'; end if;
 insert into public.wl_beta_content(cache_key,kind,locale,lease_id,lease_until)
 values(p_key,p_kind,p_locale,p_lease,now()+interval '3 minutes')
 on conflict(cache_key) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until
 where public.wl_beta_content.payload is null and public.wl_beta_content.lease_until<now();
 get diagnostics affected=row_count; return affected=1;
end $$;
revoke all on function public.wl_beta_claim_content(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.wl_beta_claim_content(text,text,text,uuid) to service_role;
comment on table public.wl_community_wines is 'Opt-in community suggestions. Review in Supabase; accepted does not automatically publish or modify the catalog.';
comment on table public.wl_community_receipts is 'Private hashed capability receipts and contributed evidence. Never expose through Data API.';
comment on table public.wl_beta_content is 'Versioned daily GPT practice and translations. Private service cache with atomic generation leases.';
