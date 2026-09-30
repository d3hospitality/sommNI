-- Applied to mcmtasetompygfktzhpr on 2026-09-30 with Romario's approval (before the
-- sommni-api bottle/study migrations; it does not depend on them).
begin;
create table public.wl_link_codes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 code_hash text not null unique check (length(code_hash)=64), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '10 minutes', claimed_at timestamptz
);
create index on public.wl_link_codes(user_id,created_at);
create table public.wl_redeem_attempts (
 id bigint generated always as identity primary key, network_hash text not null check(length(network_hash)=64),
 attempted_at timestamptz not null default now()
);
create index on public.wl_redeem_attempts(network_hash,attempted_at);
create table public.wl_linked_devices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 code_id uuid not null unique references public.wl_link_codes(id) on delete cascade,
 label text not null default 'Even G2', session_id uuid unique,
 created_at timestamptz not null default now(), linked_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz,
 check ((session_id is null) = (linked_at is null))
);
create index on public.wl_linked_devices(user_id) where revoked_at is null;
create table public.wl_account_deletions (user_id uuid primary key references auth.users(id) on delete cascade, started_at timestamptz not null default now());
alter table public.wl_link_codes enable row level security;
alter table public.wl_redeem_attempts enable row level security;
alter table public.wl_linked_devices enable row level security;
alter table public.wl_account_deletions enable row level security;
revoke all on public.wl_link_codes,public.wl_redeem_attempts,public.wl_linked_devices,public.wl_account_deletions from public,anon,authenticated;
grant all on public.wl_link_codes,public.wl_redeem_attempts,public.wl_linked_devices,public.wl_account_deletions to service_role;
revoke all on sequence public.wl_redeem_attempts_id_seq from public,anon,authenticated;
grant usage,select on sequence public.wl_redeem_attempts_id_seq to service_role;

create or replace function public.wl_create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,display_name,avatar_url)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'avatar_url')
 on conflict(id) do nothing;
 return new;
end $$;
-- Existing signup triggers may coexist: both must use ON CONFLICT. This one is idempotent.
drop trigger if exists wl_profile_on_signup on auth.users;
create trigger wl_profile_on_signup after insert on auth.users for each row execute function public.wl_create_profile();
insert into public.profiles(id,email,display_name,avatar_url)
select id,email,coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name'),raw_user_meta_data->>'avatar_url' from auth.users on conflict(id) do nothing;

create function public.wl_check_session(p_user_id uuid,p_session_id uuid,p_allow_deleting boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id) then return jsonb_build_object('status','revoked'); end if;
 if not p_allow_deleting and exists(select 1 from public.wl_account_deletions where user_id=p_user_id) then return jsonb_build_object('status','deleting'); end if;
 return jsonb_build_object('status','active');
end $$;

create function public.wl_issue_code(p_user_id uuid,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.wl_link_codes;
begin
 perform pg_advisory_xact_lock(hashtextextended('wl-user:'||p_user_id::text,0));
 if exists(select 1 from public.wl_account_deletions where user_id=p_user_id) then return jsonb_build_object('status','deleting'); end if;
 if (select count(*) from public.wl_link_codes where user_id=p_user_id and created_at>now()-interval '1 hour')>=10 then return jsonb_build_object('status','rate_limited'); end if;
 if exists(select 1 from public.wl_link_codes where code_hash=p_code_hash) then return jsonb_build_object('status','collision'); end if;
 -- A new code invalidates older unused codes, while preserving issuance history for throttling.
 update public.wl_link_codes set expires_at=least(expires_at,now()) where user_id=p_user_id and claimed_at is null;
 insert into public.wl_link_codes(user_id,code_hash) values(p_user_id,p_code_hash) returning * into r;
 -- Opportunistic bounded-retention cleanup; no raw IPs or codes are stored.
 delete from public.wl_redeem_attempts where attempted_at<now()-interval '1 day';
 delete from public.wl_link_codes c where c.created_at<now()-interval '1 day' and not exists(select 1 from public.wl_linked_devices d where d.code_id=c.id);
 return jsonb_build_object('status','pending','id',r.id,'expires_at',r.expires_at);
end $$;

create function public.wl_claim_code(p_code_hash text,p_network_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.wl_link_codes; device uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('wl-network:'||p_network_hash,0));
 if (select count(*) from public.wl_redeem_attempts where network_hash=p_network_hash and attempted_at>now()-interval '10 minutes')>=20 then return jsonb_build_object('status','rate_limited'); end if;
 insert into public.wl_redeem_attempts(network_hash) values(p_network_hash);
 select * into r from public.wl_link_codes where code_hash=p_code_hash;
 if not found then return jsonb_build_object('status','invalid'); end if;
 perform pg_advisory_xact_lock(hashtextextended('wl-user:'||r.user_id::text,0));
 select * into r from public.wl_link_codes where code_hash=p_code_hash for update;
 if r.claimed_at is not null then return jsonb_build_object('status','invalid'); end if;
 if r.expires_at<=now() then return jsonb_build_object('status','expired'); end if;
 if exists(select 1 from public.wl_account_deletions where user_id=r.user_id) then return jsonb_build_object('status','deleting'); end if;
 -- Reserve slots under the user lock; concurrent redemptions cannot exceed the cap.
 if (select count(*) from public.wl_linked_devices d where d.user_id=r.user_id and d.revoked_at is null and
   ((d.linked_at is not null and exists(select 1 from auth.sessions s where s.id=d.session_id)) or (d.linked_at is null and d.created_at>now()-interval '10 minutes')))>=5 then return jsonb_build_object('status','limit_reached'); end if;
 update public.wl_link_codes set claimed_at=now() where id=r.id;
 insert into public.wl_linked_devices(user_id,code_id) values(r.user_id,r.id) returning id into device;
 return jsonb_build_object('status','claimed','id',device,'user_id',r.user_id);
end $$;

create function public.wl_finish_link(p_id uuid,p_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.wl_linked_devices;
begin
 select * into d from public.wl_linked_devices where id=p_id;
 if not found then return jsonb_build_object('status','missing'); end if;
 perform pg_advisory_xact_lock(hashtextextended('wl-user:'||d.user_id::text,0));
 if exists(select 1 from public.wl_account_deletions where user_id=d.user_id) then return jsonb_build_object('status','deleting'); end if;
 if not exists(select 1 from auth.sessions where id=p_session_id and user_id=d.user_id) then return jsonb_build_object('status','revoked'); end if;
 update public.wl_linked_devices set session_id=p_session_id,linked_at=now(),last_seen_at=now()
 where id=p_id and revoked_at is null and linked_at is null and created_at>now()-interval '10 minutes';
 if not found then return jsonb_build_object('status','invalid'); end if;
 return jsonb_build_object('status','linked');
end $$;

create function public.wl_abort_link(p_id uuid,p_session_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update public.wl_linked_devices set revoked_at=now() where id=p_id;
 delete from auth.refresh_tokens where session_id=p_session_id and session_id in(select s.id from auth.sessions s join public.wl_linked_devices d on d.user_id=s.user_id where d.id=p_id);
 delete from auth.sessions s using public.wl_linked_devices d where d.id=p_id and d.user_id=s.user_id and s.id=p_session_id;
 return jsonb_build_object('status','aborted');
end $$;

create function public.wl_code_status(p_user_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.wl_link_codes; d public.wl_linked_devices;
begin
 select * into c from public.wl_link_codes where id=p_id and user_id=p_user_id;
 if not found then return jsonb_build_object('status','missing'); end if;
 select * into d from public.wl_linked_devices where code_id=c.id;
 return jsonb_build_object('status',case when d.revoked_at is not null then 'failed' when d.linked_at is not null then 'linked' when c.expires_at<=now() then 'expired' when c.claimed_at is not null then 'claiming' else 'pending' end,'expires_at',c.expires_at);
end $$;

create function public.wl_revoke_device(p_user_id uuid,p_id uuid default null,p_session_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.wl_linked_devices;
begin
 perform pg_advisory_xact_lock(hashtextextended('wl-user:'||p_user_id::text,0));
 select * into d from public.wl_linked_devices where user_id=p_user_id and ((p_id is not null and id=p_id) or (p_id is null and session_id=p_session_id)) for update;
 if not found then return jsonb_build_object('status','missing'); end if;
 update public.wl_linked_devices set revoked_at=coalesce(revoked_at,now()) where id=d.id;
 -- Revoke this session's entire rotated refresh-token chain, never other devices.
 -- Go-live preflight: verify these auth schema columns against the hosted Auth version.
 delete from auth.refresh_tokens where session_id=d.session_id;
 delete from auth.sessions where id=d.session_id and user_id=p_user_id;
 return jsonb_build_object('status','revoked_ok');
end $$;

create function public.wl_device_status(p_user_id uuid,p_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id) then return jsonb_build_object('status','revoked'); end if;
 update public.wl_linked_devices set last_seen_at=now() where user_id=p_user_id and session_id=p_session_id and revoked_at is null;
 if not found then return jsonb_build_object('status','revoked'); end if;
 return jsonb_build_object('status','linked');
end $$;

create function public.wl_prepare_deletion(p_user_id uuid,p_keep_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('wl-user:'||p_user_id::text,0));
 insert into public.wl_account_deletions(user_id) values(p_user_id) on conflict do nothing;
 update public.wl_link_codes set expires_at=least(expires_at,now()) where user_id=p_user_id;
 update public.wl_linked_devices set revoked_at=coalesce(revoked_at,now()) where user_id=p_user_id;
 delete from auth.refresh_tokens where session_id in(select id from auth.sessions where user_id=p_user_id and id<>p_keep_session);
 delete from auth.sessions where user_id=p_user_id and id<>p_keep_session;
 return jsonb_build_object('status','deleting_ready');
end $$;
-- Prevent uploads racing deletion. This adds a restriction; it grants no access.
create function public.wl_account_open() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.wl_account_deletions where user_id=(select auth.uid()))
$$;
create policy wl_no_upload_during_deletion on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'winelens-bottles' or public.wl_account_open());

-- Explicitly remove owned rows even if the original project used NO ACTION FKs.
create function public.wl_delete_owned_rows() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.user_collection where user_id=old.id;
 delete from public.profiles where id=old.id;
 -- Study/render tables from the prerequisite migrations use ON DELETE CASCADE.
 return old;
end $$;
create trigger wl_delete_owned_rows before delete on auth.users for each row execute function public.wl_delete_owned_rows();

-- PostgreSQL grants EXECUTE to PUBLIC by default: explicitly remove it from every new function.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'wl\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant execute on function public.wl_account_open() to authenticated;
commit;

-- Rollback (maintenance window, after revoking linked sessions): remove
-- wl_no_upload_during_deletion, wl_profile_on_signup and wl_delete_owned_rows
-- triggers; drop wl_* functions; drop the four wl_* tables (devices before codes).
-- Do NOT drop profiles, user_collection, auth users or shared catalog tables.
-- Rollback cannot restore deleted accounts/files. See docs/SITE-ACCOUNTS.md.
