-- Service-only pairing requests; public codes are never credentials by themselves.
create table public.sommni_pair_requests (
 id uuid primary key default gen_random_uuid(), code_hash text not null unique,
 proof_hash text not null, user_id uuid references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '30 minutes',
 claimed_at timestamptz, completed_at timestamptz, exchange_hash text,
 exchange_started_at timestamptz, device_id uuid references public.wl_linked_devices(id),
 created_at timestamptz not null default now()
);
alter table public.sommni_pair_requests enable row level security;
revoke all on public.sommni_pair_requests from anon,authenticated;
grant all on public.sommni_pair_requests to service_role;
create table public.sommni_request_windows (key text primary key, started_at timestamptz not null default now(), used integer not null default 1);
alter table public.sommni_request_windows enable row level security;
revoke all on public.sommni_request_windows from anon,authenticated;
grant all on public.sommni_request_windows to service_role;
create or replace function public.sommni_request_allow(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql set search_path='' as $$
declare n integer;
begin
 if length(p_key)>160 or p_limit not between 1 and 1000 or p_seconds not between 1 and 86400 then raise exception 'Invalid request window'; end if;
 insert into public.sommni_request_windows as w(key,used) values(p_key,1)
 on conflict(key) do update set used=case when w.started_at<now()-make_interval(secs=>p_seconds) then 1 else w.used+1 end,
 started_at=case when w.started_at<now()-make_interval(secs=>p_seconds) then now() else w.started_at end
 returning used into n;
 return n<=p_limit;
end $$;
revoke all on function public.sommni_request_allow(text,integer,integer) from public,anon,authenticated;
grant execute on function public.sommni_request_allow(text,integer,integer) to service_role;
-- Completed cached photographs remain unlimited; concurrent copies share a lease.
create or replace function public.sommni_claim_bottle(p_key text,p_lease uuid) returns text language plpgsql set search_path='' as $$
declare prior public.sommni_bottle_cutouts;
begin
 if p_key !~ '^[a-f0-9]{64}$' or p_lease is null then raise exception 'Invalid bottle claim'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,23));
 select * into prior from public.sommni_bottle_cutouts where cache_key=p_key;
 if prior.output_path is not null then return 'cached'; end if;
 if prior.lease_until>now() then return 'busy'; end if;
 insert into public.sommni_bottle_cutouts(cache_key,lease_id,lease_until) values(p_key,p_lease,now()+interval '3 minutes')
 on conflict(cache_key) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until;
 return 'claimed';
end $$;
revoke all on function public.sommni_claim_bottle(text,uuid) from public,anon,authenticated;
grant execute on function public.sommni_claim_bottle(text,uuid) to service_role;
-- A restrictive policy supplements, never replaces, existing owner policies.
create schema if not exists sommni_private;
revoke all on schema sommni_private from public,anon;
grant usage on schema sommni_private to authenticated;
create or replace function sommni_private.session_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists(select 1 from public.wl_linked_devices d where d.user_id=auth.uid() and d.session_id::text=auth.jwt()->>'session_id' and d.revoked_at is not null)
$$;
revoke all on function sommni_private.session_allowed() from public,anon;
grant execute on function sommni_private.session_allowed() to authenticated;
create policy sommni_device_session on public.user_collection as restrictive for all to authenticated using(sommni_private.session_allowed()) with check(sommni_private.session_allowed());
create policy sommni_device_study_session on public.study_review_events as restrictive for all to authenticated using(sommni_private.session_allowed()) with check(sommni_private.session_allowed());
create policy sommni_device_storage_session on storage.objects as restrictive for all to authenticated using(bucket_id not in ('winelens-bottles','winelens-audio') or sommni_private.session_allowed()) with check(bucket_id not in ('winelens-bottles','winelens-audio') or sommni_private.session_allowed());
-- Deny refresh immediately too; service role only, owner checked by the endpoint.
create or replace function public.sommni_revoke_device(p_user uuid,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 update public.wl_linked_devices set revoked_at=now() where id=p_id and user_id=p_user returning session_id into sid;
 if not found then return false; end if;
 if sid is not null then delete from auth.sessions where id=sid and user_id=p_user; end if;
 return true;
end $$;
revoke all on function public.sommni_revoke_device(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sommni_revoke_device(uuid,uuid) to service_role;
