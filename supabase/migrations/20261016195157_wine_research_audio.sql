-- Additive research pilot. Does not alter account plans, balances or existing wines.
create table public.wl_wine_research (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 query text not null, result jsonb not null, report text not null,
 evidence jsonb not null default '[]', search_html text not null default '', image_path text,
 created_at timestamptz not null default now(), confirmed_at timestamptz
);
create index wl_wine_research_user on public.wl_wine_research(user_id,created_at desc);
create table public.wl_research_jobs (
 user_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 action text not null check(action in ('research','ask','audio')), fingerprint text not null,
 status text not null default 'running' check(status in ('running','done','failed')),
 result jsonb, created_at timestamptz not null default now(), primary key(user_id,id)
);
create index wl_research_jobs_user_date on public.wl_research_jobs(user_id,created_at);
create table public.wl_wine_audio (
 collection_id uuid not null references public.user_collection(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 fingerprint text not null, path text not null, script text not null,
 created_at timestamptz not null default now(), primary key(collection_id,fingerprint)
);
create index wl_wine_audio_user on public.wl_wine_audio(user_id);
alter table public.wl_wine_research enable row level security;
alter table public.wl_research_jobs enable row level security;
alter table public.wl_wine_audio enable row level security;
revoke all on public.wl_wine_research, public.wl_research_jobs, public.wl_wine_audio from public, anon, authenticated;
grant select on public.wl_wine_research, public.wl_wine_audio to authenticated;
grant all on public.wl_wine_research, public.wl_research_jobs, public.wl_wine_audio to service_role;
create policy research_read_own on public.wl_wine_research for select to authenticated using ((select auth.uid())=user_id);
create policy audio_read_own on public.wl_wine_audio for select to authenticated using ((select auth.uid())=user_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('winelens-audio','winelens-audio',false,8388608,array['audio/mpeg']);
create policy audio_objects_read_own on storage.objects for select to authenticated
using(bucket_id='winelens-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Only the authenticated server can create media and research records.
create function public.wl_research_begin(p_user uuid,p_id uuid,p_action text,p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.wl_research_jobs;
begin
 perform pg_advisory_xact_lock(hashtextextended('research:global',0));
 if exists(select 1 from public.wl_account_deletions where user_id=p_user) then raise exception 'account closing'; end if;
 select * into j from public.wl_research_jobs where user_id=p_user and id=p_id;
 if found then
  if j.action<>p_action or j.fingerprint<>p_fingerprint then raise exception 'request mismatch'; end if;
  return jsonb_build_object('status',j.status,'result',j.result);
 end if;
 if (select count(*) from public.wl_research_jobs where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=100 then return jsonb_build_object('status','limited'); end if;
 if exists(select 1 from public.wl_research_jobs where user_id=p_user and action=p_action and fingerprint=p_fingerprint and status='running' and created_at>now()-interval '3 minutes') then return jsonb_build_object('status','running'); end if;
 if (select count(*) from public.wl_research_jobs where user_id=p_user and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=20 then
  return jsonb_build_object('status','limited');
 end if;
 insert into public.wl_research_jobs(user_id,id,action,fingerprint) values(p_user,p_id,p_action,p_fingerprint);
 return jsonb_build_object('status','new');
end $$;
revoke all on function public.wl_research_begin(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.wl_research_begin(uuid,uuid,text,text) to service_role;
-- The reviewed draft becomes a collection row in one transaction. Repeating a confirm returns that row.
create function public.wl_research_confirm(p_user uuid,p_id uuid,p_review jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.wl_wine_research; c public.user_collection;
begin
 if exists(select 1 from public.wl_account_deletions where user_id=p_user) then raise exception 'account closing'; end if;
 select * into d from public.wl_wine_research where id=p_id and user_id=p_user for update;
 if not found then raise exception 'draft not found'; end if;
 if d.confirmed_at is not null then
  select * into c from public.user_collection where id=p_id and user_id=p_user;
  if not found then raise exception 'saved wine was removed'; end if;
  return to_jsonb(c);
 end if;
 insert into public.user_collection(id,user_id,wine_name,producer,vintage,region,notes,metadata)
 values(d.id,p_user,p_review->>'wine_name',nullif(p_review->>'producer',''),(p_review->>'vintage')::integer,
 nullif(p_review->>'region',''),'',jsonb_build_object(
 'vintage_state',p_review->>'vintage_state','country',p_review->>'country','grape',p_review->>'grape','color',p_review->>'color',
 'tasting_notes',p_review->>'tasting_notes','research_id',d.id,'research_status','user_confirmed',
 'research_sources',d.evidence,'research_checked_at',d.created_at,'research_original',d.result,
 'image_path',d.image_path,'image_source',case when d.image_path is null then null else 'photograph' end)) returning * into c;
 update public.wl_wine_research set confirmed_at=now() where id=d.id;
 return to_jsonb(c);
end $$;
revoke all on function public.wl_research_confirm(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wl_research_confirm(uuid,uuid,jsonb) to service_role;
