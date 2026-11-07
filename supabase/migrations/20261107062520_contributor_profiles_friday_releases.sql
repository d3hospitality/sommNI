-- Optional public profiles; private tables remain RPC-only.
alter table public.sommni_members add column bio text not null default '' check(length(bio)<=280), add column based_in text not null default '' check(length(based_in)<=80);
create function sommni_private.save_profile(name text,visible boolean,bio text,based_in text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
 if length(coalesce(bio,''))>280 or length(coalesce(based_in,''))>80 then raise exception 'Keep your bio under 281 characters and location under 81'; end if;
 perform sommni_private.save_member(name,visible);
 update public.sommni_members set bio=trim(coalesce(save_profile.bio,'')),based_in=trim(coalesce(save_profile.based_in,'')) where user_id=auth.uid();
 return sommni_private.community_state();
end $$;
create function public.sommni_save_profile(name text,visible boolean,bio text,based_in text) returns jsonb language sql security invoker set search_path='' as $$select sommni_private.save_profile(name,visible,bio,based_in)$$;
revoke all on function sommni_private.save_profile(text,boolean,text,text),public.sommni_save_profile(text,boolean,text,text) from public,anon,authenticated;
grant execute on function sommni_private.save_profile(text,boolean,text,text),public.sommni_save_profile(text,boolean,text,text) to authenticated;

-- The existing ledger is authoritative; clients cannot mint or delete credit.
alter table public.sommni_contribution_awards drop constraint sommni_contribution_awards_points_check;
alter table public.sommni_contribution_awards alter column points set default 10;
update public.sommni_contribution_awards set points=10;
alter table public.sommni_contribution_awards add constraint sommni_contribution_awards_points_check check(points=10);
create or replace function sommni_private.initiative_state() returns jsonb language sql stable security definer set search_path='' as $$
 with scores as (
 select user_id,sum(points)::int points,sum(wines)::int wines,sum(reviews)::int reviews from (
 select user_id,sum(points)::int points,count(*)::int wines,0 reviews from public.sommni_contribution_awards group by user_id
 union all select user_id,sum(1+case when length(comment)>=40 then 2 else 0 end)::int,0,count(*)::int from public.sommni_wine_reviews where status='published' group by user_id
 ) efforts group by user_id
 ), leaders as (
 select m.handle,m.bio,m.based_in,s.points,s.wines,s.reviews from scores s join public.sommni_members m on m.user_id=s.user_id where m.leaderboard_visible and s.points>0 order by s.points desc,m.created_at,m.user_id limit 50
 ) select jsonb_build_object('points',coalesce((select points from scores where user_id=auth.uid()),0),
 'pending_wines',(select count(*) from public.sommni_contributions where user_id=auth.uid() and status='pending'),
 'verified_wines',(select count(*) from public.sommni_contribution_awards where user_id=auth.uid()),
 'publication_day','Friday',
 'leaderboard',coalesce((select jsonb_agg(to_jsonb(l)) from leaders l),'[]'::jsonb),
 'wine_count',(select count(*) from public.sommni_wines),'review_count',(select count(*) from public.sommni_wine_reviews where status='published'),
 'rules',jsonb_build_object('verified_wine',10,'rating',1,'tasting_comment',2,'comment_min_chars',40));
$$;

-- Saving a researched discovery in the Even app also queues account credit.
-- Missing provenance never blocks a local/account save; it can be added later.
create or replace function sommni_private.record_saved_discovery_credit() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid; unit uuid; year_key text; source text; country_name text; label_status text;
begin
 if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Account changed' using errcode='42501'; end if;
 w:=sommni_private.review_wine(coalesce(new.wine_id,''),new.wine_name,coalesce(new.producer,''));
 if w is null then return new; end if;
 year_key:=case when new.vintage is not null then new.vintage::text when new.metadata->>'vintage_state' in ('non_vintage','NV') then 'NV' else 'unknown' end;
 select id,status into unit,label_status from public.sommni_vintages where wine_id=w and vintage_key=year_key and merged_into is null;
 if unit is null or label_status in ('existing','accepted','merged') then return new; end if;
 source:=coalesce(new.metadata->'research_sources'->'sources'->0->>'url','');country_name:=coalesce(new.metadata->>'country','');
 if source!~'^https://' then select coalesce(reference_url,'') into source from public.wl_community_wines where canonical_vintage_id=unit and reference_url like 'https://%' order by created_at limit 1;end if;
 if length(country_name)<2 then select country into country_name from public.sommni_wines where id=w;end if;
 source:=coalesce(source,'');country_name:=coalesce(country_name,'');
 insert into public.sommni_members(user_id,handle) values(new.user_id,'Cellar-'||left(replace(new.user_id::text,'-',''),20)) on conflict(user_id) do nothing;
 insert into public.sommni_contributions(user_id,vintage_id,wine_name,producer,country,reference_url,details)
 values(new.user_id,unit,left(new.wine_name,200),left(new.producer,160),left(country_name,100),left(source,600),'')
 on conflict(user_id,vintage_id) do update set reference_url=case when sommni_contributions.reference_url='' then excluded.reference_url else sommni_contributions.reference_url end;
 return new;
end $$;

-- Preserve every submitted fact immediately, then publish verified facts in weekly batches.
create table sommni_private.friday_queue(wine_id uuid primary key references public.sommni_wines(id),updated_at timestamptz not null default now());
create table sommni_private.friday_releases(day date primary key,published_at timestamptz not null default now(),wine_count integer not null);
alter table sommni_private.friday_queue enable row level security;
alter table sommni_private.friday_releases enable row level security;
revoke all on sommni_private.friday_queue,sommni_private.friday_releases from public,anon,authenticated;
grant all on sommni_private.friday_queue,sommni_private.friday_releases to service_role;
create or replace function sommni_private.publish_community_wine(candidate public.wl_community_wines) returns void
language plpgsql security invoker set search_path='' as $$
declare label public.sommni_wines; master_id text;
begin
 select w.* into label from public.sommni_wines w join public.sommni_vintages v on v.wine_id=w.id where v.id=candidate.canonical_vintage_id;
 if label.id is null or label.catalog_id is not null then return; end if;
 master_id:='community-'||label.id::text;
 insert into public.wines(id,name,producer,region,country,grape,color,tasting_notes,metadata)
 values(master_id,candidate.wine_name,candidate.producer,candidate.region,candidate.country,candidate.grape,lower(candidate.color),candidate.tasting_notes,
 jsonb_build_object('source','community','canonical_wine_id',label.id,'community_wine_id',candidate.id,'verification','Community supplied · details may need confirmation','reference_url',candidate.reference_url,'hidden',candidate.status='declined')||candidate.beverage_metadata)
 on conflict(id) do update set
 region=case when wines.region is null or wines.region='' then excluded.region else wines.region end,
 country=case when wines.country is null or wines.country='' then excluded.country else wines.country end,
 grape=case when wines.grape is null or wines.grape='' then excluded.grape else wines.grape end,
 color=case when wines.color is null or wines.color='' then excluded.color else wines.color end,
 tasting_notes=case when wines.tasting_notes is null or wines.tasting_notes='' then excluded.tasting_notes else wines.tasting_notes end,
 metadata=wines.metadata||jsonb_strip_nulls(candidate.beverage_metadata)||jsonb_build_object('hidden',candidate.status='declined'),updated_at=now();
 return;
end $$;

revoke all on function sommni_private.publish_community_wine(public.wl_community_wines) from public,anon,authenticated;
grant execute on function sommni_private.publish_community_wine(public.wl_community_wines) to service_role;
create or replace function sommni_private.publish_saved_wine() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 select wine_id into w from public.sommni_vintages where id=new.canonical_vintage_id;
 if w is null then return new;end if;
 -- Moderation takes effect immediately; normal additions/updates wait for Friday.
 if new.status='declined' then
  update public.wines set metadata=metadata||'{"hidden":true}'::jsonb where id='community-'||w::text;
 else
  insert into sommni_private.friday_queue(wine_id) values(w) on conflict(wine_id) do update set updated_at=now();
 end if;
 return new;
end $$;

create function sommni_private.friday_cutoff(at_time timestamptz) returns timestamptz language sql immutable set search_path='' as $$
 with t as(select at_time at time zone 'America/New_York' local_time),
 f as(select date_trunc('week',local_time)+interval '4 days 21 hours' friday,local_time from t)
 select (case when local_time<friday then friday-interval '7 days' else friday end) at time zone 'America/New_York' from f
$$;
create function sommni_private.publish_friday_wines() returns void language plpgsql set search_path='' as $$
declare cutoff timestamptz:=sommni_private.friday_cutoff(now()); c public.wl_community_wines; n integer:=0; w uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('sommni-friday-release',0));
 if exists(select 1 from sommni_private.friday_releases where day=(cutoff at time zone 'America/New_York')::date) then return;end if;
 for w in select q.wine_id from sommni_private.friday_queue q where q.updated_at<=cutoff order by q.wine_id loop
  select x.* into c from public.wl_community_wines x join public.sommni_vintages v on v.id=x.canonical_vintage_id
  where v.wine_id=w and v.merged_into is null and v.status='accepted' and x.status!='declined'
  order by x.updated_at desc nulls last,x.created_at desc,x.id limit 1;
  if found then
   perform sommni_private.publish_community_wine(c);n:=n+1;
   insert into sommni_private.friday_publications(vintage_id) select id from public.sommni_vintages where wine_id=w and status='accepted' and merged_into is null on conflict do nothing;
   delete from sommni_private.friday_queue where wine_id=w;
  end if;
 end loop;
 insert into sommni_private.friday_releases(day,wine_count) values((cutoff at time zone 'America/New_York')::date,n);
end $$;
revoke all on function sommni_private.friday_cutoff(timestamptz),sommni_private.publish_friday_wines() from public,anon,authenticated;
grant execute on function sommni_private.friday_cutoff(timestamptz),sommni_private.publish_friday_wines() to service_role;
-- New vintage approvals are queued even if no new photo/details arrive.
create function sommni_private.queue_verified_vintage() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='accepted' and old.status is distinct from new.status then
 insert into sommni_private.friday_queue(wine_id) values(new.wine_id) on conflict(wine_id) do update set updated_at=now();
 end if;return new;
end $$;
revoke all on function sommni_private.queue_verified_vintage() from public,anon,authenticated;
create trigger sommni_queue_verified after update of status on public.sommni_vintages for each row execute function sommni_private.queue_verified_vintage();
create or replace function sommni_private.atlas_daily_checkin() returns void
language plpgsql set search_path='' as $$
declare local_now timestamp:=now() at time zone 'America/New_York'; target_day date; cutoff timestamptz;
begin
 perform sommni_private.publish_friday_wines();
 target_day:=local_now::date-case when local_now::time<time '21:00' then 1 else 0 end;
 cutoff:=(target_day+time '21:00') at time zone 'America/New_York';
 insert into sommni_private.atlas_checkins(day,period_start,period_end,summary)
 values(target_day,((target_day-1)+time '21:00') at time zone 'America/New_York',cutoff,sommni_private.atlas_recap(cutoff))
 on conflict(day) do nothing;
end $$;
create or replace function sommni_private.atlas_valid_wines()
returns table(id uuid,catalog_id text,wine_name text,producer text,country_code text,region_id text)
language sql stable set search_path='' as $$
 select w.id,w.catalog_id,w.wine_name,w.producer,
 coalesce(o.country_code,sommni_private.atlas_country(coalesce(nullif(m.country,''),w.country))),
 coalesce(o.region_id,sommni_private.atlas_resolve_region(sommni_private.atlas_country(coalesce(nullif(m.country,''),w.country)),m.region))
 from public.sommni_wines w
 left join sommni_private.atlas_origins o on o.wine_id=w.id
 left join public.wines m on m.id=coalesce(w.catalog_id,'community-'||w.id::text)
 where m.id is not null and coalesce(m.metadata->>'hidden','false')!='true' and exists(
  select 1 from public.sommni_vintages v where v.wine_id=w.id and v.merged_into is null and
  (v.status in ('existing','accepted') or (m.id is not null and exists(
   select 1 from public.wl_community_wines c where c.canonical_vintage_id=v.id and c.status!='declined'
  )))
 )
$$;


create table sommni_private.friday_publications(vintage_id uuid primary key references public.sommni_vintages(id),published_at timestamptz not null default now());
alter table sommni_private.friday_publications enable row level security;
revoke all on sommni_private.friday_publications from public,anon,authenticated;
grant all on sommni_private.friday_publications to service_role;
create or replace function sommni_private.atlas_activity()
returns table(id uuid,wine_id uuid,wine_name text,producer text,vintage text,country_code text,region_id text,added_at timestamptz)
language sql stable set search_path='' as $$
 select v.id,w.id,w.wine_name,w.producer,v.vintage_key,w.country_code,w.region_id,coalesce(min(pub.published_at),min(c.created_at))
 from public.wl_community_wines c
 join public.sommni_vintages v on v.id=c.canonical_vintage_id
 left join sommni_private.friday_publications pub on pub.vintage_id=v.id
 join sommni_private.atlas_valid_wines() w on w.id=v.wine_id
 where c.status!='declined' and v.status not in ('existing','declined','merged') and v.merged_into is null
 group by v.id,w.id,w.wine_name,w.producer,v.vintage_key,w.country_code,w.region_id
$$;

-- Keep the existing daily activity recap, and run the Friday publisher first.
-- Existing public rows are deliberately left untouched by this migration.
notify pgrst,'reload schema';
create or replace function sommni_private.review_contribution(contribution uuid, decision text, note text, duplicate_target uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare rec public.sommni_contributions; unit public.sommni_vintages; target public.sommni_vintages; already uuid;
begin
 if decision not in ('accepted','declined','duplicate') then raise exception 'Use accepted, declined or duplicate'; end if;
 if length(trim(coalesce(note,'')))<3 then raise exception 'Record the review evidence or reason'; end if;
 -- Global review lock gives deterministic ordering for approval and merge races.
 perform pg_advisory_xact_lock(hashtextextended('sommni-review',0));
 select * into rec from public.sommni_contributions where id=contribution for update;
 if not found then raise exception 'Contribution not found'; end if;
 select * into unit from public.sommni_vintages where id=rec.vintage_id for update;
 if decision='duplicate' and duplicate_target is not null and duplicate_target<>unit.id then
  select * into target from public.sommni_vintages where id=duplicate_target for update;
  if not found or target.merged_into is not null or target.vintage_key<>unit.vintage_key then raise exception 'Choose a canonical target with the same vintage'; end if;
  if exists(select 1 from public.sommni_contribution_awards where vintage_id=unit.id) then raise exception 'This wine already has an award; reconcile it before merging'; end if;
  update public.sommni_vintages set status='merged',merged_into=target.id where id=unit.id;
  update public.sommni_contributions set status='duplicate',reviewer_note=note where vintage_id=unit.id;
  return jsonb_build_object('status','duplicate','canonical_vintage',target.id);
 end if;
 if decision='accepted' then
  if unit.merged_into is not null or unit.status='existing' then raise exception 'This is already represented by a canonical wine'; end if;
  select contribution_id into already from public.sommni_contribution_awards where vintage_id=unit.id;
  if already is not null and already<>rec.id then
   update public.sommni_contributions set status='duplicate',reviewer_note=note where id=rec.id;
   return jsonb_build_object('status','duplicate','points',0);
  end if;
  update public.sommni_vintages set status='accepted' where id=unit.id;
  insert into public.sommni_contribution_awards(vintage_id,contribution_id,user_id) values(unit.id,rec.id,rec.user_id) on conflict(vintage_id) do nothing;
 elsif exists(select 1 from public.sommni_contribution_awards where contribution_id=rec.id) then
  raise exception 'Awarded contributions require an explicit audited correction';
 end if;
 update public.sommni_contributions set status=decision,reviewer_note=note where id=rec.id;
 return jsonb_build_object('status',decision,'points',case when decision='accepted' then 10 else 0 end);
end $$;

