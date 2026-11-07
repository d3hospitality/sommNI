-- Test baseline from D3 migration 20261022023333_sommni_contribution_accounts.sql.
-- Only the two legacy functions exercised by contributor migration tests.
create function sommni_private.community_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'Sign in to open your contribution account' using errcode='42501'; end if;
 insert into public.sommni_members(user_id,handle) values(u,'Cellar-'||left(replace(u::text,'-',''),20)) on conflict(user_id) do nothing;
 select jsonb_build_object(
 'profile',(select to_jsonb(m)-'user_id' from public.sommni_members m where user_id=u),
 'score',(select count(*) from public.sommni_contribution_awards where user_id=u),
 'submissions',coalesce((select jsonb_agg(to_jsonb(x)) from (select c.id,c.wine_name,c.producer,v.vintage_key,c.status,c.reviewer_note,c.created_at from public.sommni_contributions c join public.sommni_vintages v on v.id=c.vintage_id where c.user_id=u order by c.created_at desc limit 50)x),'[]'::jsonb),
 'leaderboard',coalesce((select jsonb_agg(to_jsonb(x)) from (select m.handle,count(*)::int as wines from public.sommni_contribution_awards a join public.sommni_members m on m.user_id=a.user_id where m.leaderboard_visible group by m.user_id,m.handle order by count(*) desc,m.created_at,m.user_id limit 50)x),'[]'::jsonb)
 ) into result;
 return result;
end $$;
-- Default handles are short, pseudonymous, and private until the member opts in.
-- Replace UUID default in state with a unique 20-character suffix (constraint <=28).
create function sommni_private.save_member(name text, visible boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'Sign in first' using errcode='42501'; end if;
 if name is null or trim(name)!~'^[A-Za-z0-9_ -]{3,28}$' then raise exception 'Use 3–28 letters, numbers, spaces, underscores or hyphens'; end if;
 insert into public.sommni_members(user_id,handle,leaderboard_visible) values(u,trim(name),coalesce(visible,false)) on conflict(user_id) do update set handle=excluded.handle,leaderboard_visible=excluded.leaderboard_visible;
 return sommni_private.community_state();
exception when unique_violation then raise exception 'That contributor name is already taken';
end $$;

create function sommni_private.review_contribution(contribution uuid, decision text, note text, duplicate_target uuid default null) returns jsonb language plpgsql set search_path='' as $$
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
 return jsonb_build_object('status',decision,'points',case when decision='accepted' then 1 else 0 end);
end $$;

