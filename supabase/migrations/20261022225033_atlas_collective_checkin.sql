-- The atlas follows public master facts, including community-supplied bottles.
-- It never reads private tasting notes, email addresses or account identities.
create table sommni_private.atlas_region_aliases (
 country text not null references sommni_private.atlas_countries(code),
 alias text not null, region_id text not null references sommni_private.atlas_regions(id),
 primary key(country,alias)
);
alter table sommni_private.atlas_region_aliases enable row level security;
revoke all on sommni_private.atlas_region_aliases from public,anon,authenticated;
grant all on sommni_private.atlas_region_aliases to service_role;
insert into sommni_private.atlas_region_aliases(country,alias,region_id)
select country,sommni_private.normal_name(name),id from sommni_private.atlas_regions
order by (id like 'wine-%') desc,id on conflict do nothing;
insert into sommni_private.atlas_region_aliases(country,alias,region_id) values
 ('ITA','tuscany','IT-52'),('ITA','toscana','IT-52'),('ITA','piedmont','IT-21'),('ITA','piemonte','IT-21'),
 ('ITA','sicily','IT-82'),('ITA','sicilia','IT-82') on conflict do nothing;

create function sommni_private.atlas_resolve_region(c text,r text) returns text
language sql stable set search_path='' as $$
 -- Whole comma-delimited names only. Unknown and ambiguous places remain unplaced.
 select min(a.region_id) from sommni_private.atlas_region_aliases a
 where a.country=c and a.alias in (
  select sommni_private.normal_name(trim(part)) from regexp_split_to_table(coalesce(r,''),',') part
 ) having count(distinct a.region_id)=1
$$;
revoke all on function sommni_private.atlas_resolve_region(text,text) from public,anon,authenticated;

create or replace function sommni_private.atlas_valid_wines()
returns table(id uuid,catalog_id text,wine_name text,producer text,country_code text,region_id text)
language sql stable set search_path='' as $$
 select w.id,w.catalog_id,w.wine_name,w.producer,
 coalesce(o.country_code,sommni_private.atlas_country(coalesce(nullif(m.country,''),w.country))),
 coalesce(o.region_id,sommni_private.atlas_resolve_region(sommni_private.atlas_country(coalesce(nullif(m.country,''),w.country)),m.region))
 from public.sommni_wines w
 left join sommni_private.atlas_origins o on o.wine_id=w.id
 left join public.wines m on m.id=coalesce(w.catalog_id,'community-'||w.id::text)
 where coalesce(m.metadata->>'hidden','false')!='true' and exists(
  select 1 from public.sommni_vintages v where v.wine_id=w.id and v.merged_into is null and
  (v.status in ('existing','accepted') or (m.id is not null and exists(
   select 1 from public.wl_community_wines c where c.canonical_vintage_id=v.id and c.status!='declined'
  )))
 )
$$;

-- One event per canonical wine/vintage, regardless of number of savers or photo uploads.
-- Original catalog seed vintages are baseline, never new community activity.
create function sommni_private.atlas_activity()
returns table(id uuid,wine_id uuid,wine_name text,producer text,vintage text,country_code text,region_id text,added_at timestamptz)
language sql stable set search_path='' as $$
 select v.id,w.id,w.wine_name,w.producer,v.vintage_key,w.country_code,w.region_id,min(c.created_at)
 from public.wl_community_wines c
 join public.sommni_vintages v on v.id=c.canonical_vintage_id
 join sommni_private.atlas_valid_wines() w on w.id=v.wine_id
 where c.status!='declined' and v.status not in ('existing','declined','merged') and v.merged_into is null
 group by v.id,w.id,w.wine_name,w.producer,v.vintage_key,w.country_code,w.region_id
$$;
revoke all on function sommni_private.atlas_activity() from public,anon,authenticated;

create table sommni_private.atlas_checkins (
 day date primary key, period_start timestamptz not null, period_end timestamptz not null,
 summary jsonb not null, created_at timestamptz not null default now()
);
alter table sommni_private.atlas_checkins enable row level security;
revoke all on sommni_private.atlas_checkins from public,anon,authenticated;
grant all on sommni_private.atlas_checkins to service_role;

create function sommni_private.atlas_recap(cutoff timestamptz) returns jsonb
language sql stable set search_path='' as $$
 with bounds as (select ((cutoff at time zone 'America/New_York')::date-1+time '21:00') at time zone 'America/New_York' start_at),
 events as materialized(select * from sommni_private.atlas_activity() where added_at >= (select start_at from bounds) and added_at < cutoff),
 countries as(select e.country_code code,c.name,count(*)::int bottles from events e join sommni_private.atlas_countries c on c.code=e.country_code group by e.country_code,c.name order by bottles desc,c.name)
 select jsonb_build_object('date',(cutoff at time zone 'America/New_York')::date,'period_start',(select start_at from bounds),'period_end',cutoff,
 'bottles',(select count(*) from events),'countries',coalesce((select jsonb_agg(to_jsonb(c)) from countries c),'[]'::jsonb))
$$;
revoke all on function sommni_private.atlas_recap(timestamptz) from public,anon,authenticated;

-- Runs as the scheduler's trusted database role, never exposed to client roles.
create function sommni_private.atlas_daily_checkin() returns void
language plpgsql set search_path='' as $$
declare local_now timestamp:=now() at time zone 'America/New_York'; target_day date; cutoff timestamptz;
begin
 -- Repair a missed publication without changing any existing master row or review status.
 update public.wl_community_wines c set updated_at=c.updated_at
 where c.status!='declined' and exists(select 1 from public.sommni_vintages v join public.sommni_wines w on w.id=v.wine_id
 where v.id=c.canonical_vintage_id and v.merged_into is null and w.catalog_id is null
 and not exists(select 1 from public.wines m where m.id='community-'||w.id::text));
 target_day:=local_now::date-case when local_now::time<time '21:00' then 1 else 0 end;
 cutoff:=(target_day+time '21:00') at time zone 'America/New_York';
 insert into sommni_private.atlas_checkins(day,period_start,period_end,summary)
 values(target_day,((target_day-1)+time '21:00') at time zone 'America/New_York',cutoff,sommni_private.atlas_recap(cutoff))
 on conflict(day) do nothing;
end $$;
revoke all on function sommni_private.atlas_daily_checkin() from public,anon,authenticated;
grant execute on function sommni_private.atlas_daily_checkin() to service_role;

-- Existing read-only public API gains collective activity; response remains backwards compatible.
create or replace function sommni_atlas_api.atlas_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$
 with wines as materialized(select * from sommni_private.atlas_valid_wines()),
 activity as materialized(select * from sommni_private.atlas_activity()),
 regions as(select w.region_id id,w.country_code country,r.name,count(*)::int wines from wines w join sommni_private.atlas_regions r on r.id=w.region_id group by w.region_id,w.country_code,r.name),
 countries as(select country_code id,count(*)::int wines,count(*) filter(where region_id is null)::int unplaced from wines where country_code is not null group by country_code),
 weekly as(select a.country_code code,c.name,count(*)::int bottles from activity a join sommni_private.atlas_countries c on c.code=a.country_code
 where a.added_at >= date_trunc('week',now() at time zone 'America/New_York') at time zone 'America/New_York'
 group by a.country_code,c.name order by bottles desc,c.name),
 recent as(select a.id,a.wine_name,a.producer,a.vintage,a.country_code,c.name country,a.added_at from activity a left join sommni_private.atlas_countries c on c.code=a.country_code order by a.added_at desc,a.id limit 8)
 select jsonb_build_object('target',100000,'total',(select count(*) from wines),
 'regions',coalesce((select jsonb_agg(to_jsonb(r)) from regions r),'[]'::jsonb),
 'countries',coalesce((select jsonb_agg(to_jsonb(c)) from countries c),'[]'::jsonb),
 'weekly',coalesce((select jsonb_agg(to_jsonb(w)) from weekly w),'[]'::jsonb),
 'recent',coalesce((select jsonb_agg(to_jsonb(r)) from recent r),'[]'::jsonb),
 'checkin',(select summary from sommni_private.atlas_checkins order by day desc limit 1),
 'week_start',date_trunc('week',now() at time zone 'America/New_York') at time zone 'America/New_York',
 'next_checkin',(((now() at time zone 'America/New_York')::date+case when (now() at time zone 'America/New_York')::time >= time '21:00' then 1 else 0 end)+time '21:00') at time zone 'America/New_York',
 'updated_at',now())
$$;

-- Both UTC hours cover Eastern daylight and standard time. Unique day makes the other run a no-op.
create extension if not exists pg_cron;
select cron.schedule('sommni-atlas-9pm-eastern','0 1,2 * * *','select sommni_private.atlas_daily_checkin();');
select sommni_private.atlas_daily_checkin();
