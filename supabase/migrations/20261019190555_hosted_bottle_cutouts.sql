-- Separate from beta AI allowances. Only the Edge service role can access this cache.
create table public.sommni_bottle_cutouts (
 cache_key text primary key check (cache_key ~ '^[a-f0-9]{64}$'),
 lease_id uuid, lease_until timestamptz,
 output_path text, provenance jsonb,
 created_at timestamptz not null default now()
);
alter table public.sommni_bottle_cutouts enable row level security;
revoke all on public.sommni_bottle_cutouts from public, anon, authenticated;
grant all on public.sommni_bottle_cutouts to service_role;
create table public.sommni_bottle_quota (
 day date primary key, used integer not null check (used between 0 and 20)
);
alter table public.sommni_bottle_quota enable row level security;
revoke all on public.sommni_bottle_quota from public, anon, authenticated;
grant all on public.sommni_bottle_quota to service_role;
create function public.sommni_claim_bottle(p_key text, p_lease uuid)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior public.sommni_bottle_cutouts; reserved integer;
begin
 if p_key !~ '^[a-f0-9]{64}$' or p_lease is null then raise exception 'Invalid bottle claim'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,23));
 select * into prior from public.sommni_bottle_cutouts where cache_key=p_key;
 if prior.output_path is not null then return 'cached'; end if;
 if prior.lease_until>now() then return 'busy'; end if;
 insert into public.sommni_bottle_quota(day,used) values ((now() at time zone 'UTC')::date,1)
 on conflict(day) do update set used=sommni_bottle_quota.used+1 where sommni_bottle_quota.used<20
 returning used into reserved;
 if reserved is null then return 'limited'; end if;
 insert into public.sommni_bottle_cutouts(cache_key,lease_id,lease_until)
 values(p_key,p_lease,now()+interval '3 minutes')
 on conflict(cache_key) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until;
 return 'claimed';
end; $$;
revoke all on function public.sommni_claim_bottle(text,uuid) from public, anon, authenticated;
grant execute on function public.sommni_claim_bottle(text,uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('sommni-bottle-cutouts','sommni-bottle-cutouts',false,2097152,array['image/png']),
 ('sommni-bottle-models','sommni-bottle-models',false,20971520,array['application/octet-stream']);
