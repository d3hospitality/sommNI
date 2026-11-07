-- Explicit server-managed owner grant, never derived from client-editable metadata.
create table sommni_private.catalog_owners(user_id uuid primary key references auth.users(id));
alter table sommni_private.catalog_owners enable row level security;
revoke all on sommni_private.catalog_owners from public,anon,authenticated;
grant all on sommni_private.catalog_owners to service_role;
insert into sommni_private.catalog_owners(user_id)
select id from auth.users where lower(email)='ops@d3hospitality.com' and email_confirmed_at is not null;
create function sommni_private.is_catalog_owner() returns boolean language sql stable security definer set search_path='' as $$
 select sommni_private.session_allowed() and exists(select 1 from sommni_private.catalog_owners where user_id=auth.uid())
$$;
revoke all on function sommni_private.is_catalog_owner() from public,anon;
grant execute on function sommni_private.is_catalog_owner() to authenticated;
create table sommni_private.catalog_reviews(id bigint generated always as identity primary key,vintage_id uuid not null references public.sommni_vintages(id),reviewer uuid not null references auth.users(id),decision text not null,note text not null,before_state jsonb not null,created_at timestamptz not null default now());
alter table sommni_private.catalog_reviews enable row level security;
revoke all on sommni_private.catalog_reviews from public,anon,authenticated;
grant all on sommni_private.catalog_reviews to service_role;

create function public.sommni_contributor_activity() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_review',coalesce(sommni_private.is_catalog_owner(),false),
 'people',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select m.handle,m.bio,m.based_in,
 (select count(*) from public.sommni_contributions c where c.user_id=m.user_id) submissions,
 (select count(*) from public.sommni_contribution_awards a where a.user_id=m.user_id) verified,
 (select count(*) from public.sommni_wine_reviews r where r.user_id=m.user_id and r.status='published') tastings
 from public.sommni_members m where m.leaderboard_visible and (exists(select 1 from public.sommni_contributions c where c.user_id=m.user_id) or exists(select 1 from public.sommni_wine_reviews r where r.user_id=m.user_id and r.status='published')) order by m.created_at,m.user_id limit 50)x),'[]'::jsonb),
 'additions',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select a.wine_name,a.producer,a.vintage,a.country_code,a.region_id,a.added_at,
 case when m.leaderboard_visible then m.handle else 'Community contributor' end contributor,
 coalesce(aw.points,0) points
 from sommni_private.atlas_activity() a left join public.sommni_contribution_awards aw on aw.vintage_id=a.id left join public.sommni_members m on m.user_id=aw.user_id order by a.added_at desc,a.id limit 50)x),'[]'::jsonb))
$$;
revoke all on function public.sommni_contributor_activity() from public;
grant execute on function public.sommni_contributor_activity() to anon,authenticated;

create function public.sommni_owner_review_queue(page integer default 0,filter_status text default 'pending') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not sommni_private.is_catalog_owner() then raise exception 'Owner access required' using errcode='42501';end if;
 if page<0 or page>10000 or filter_status not in ('pending','accepted','declined','existing') then raise exception 'Invalid queue filter';end if;
 select jsonb_build_object('total',(select count(*) from public.sommni_vintages v where v.status=filter_status and v.merged_into is null and exists(select 1 from public.wl_community_wines c where c.canonical_vintage_id=v.id)),
 'rows',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select v.id,w.wine_name,w.producer,v.vintage_key,v.status,w.country,
 (select count(*) from public.wl_community_wines c where c.canonical_vintage_id=v.id) submissions,
 (select count(*) from public.wl_community_artwork a join public.wl_community_wines c on c.id=a.wine_id where c.canonical_vintage_id=v.id) photos,
 (select jsonb_build_object('region',c.region,'grape',c.grape,'color',c.color,'tasting_notes',c.tasting_notes,'details',c.details) from public.wl_community_wines c where c.canonical_vintage_id=v.id order by c.updated_at desc nulls last,c.id limit 1) facts,
 coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(m.handle,'Contributor'),'email',u.email,'status',c.status,'submitted_at',c.created_at,'reviewer_note',c.reviewer_note) order by c.created_at,c.id) from public.sommni_contributions c left join public.sommni_members m on m.user_id=c.user_id left join auth.users u on u.id=c.user_id where c.vintage_id=v.id),'[]'::jsonb) contributors,
 (select jsonb_build_object('decision',r.decision,'note',r.note,'at',r.created_at) from sommni_private.catalog_reviews r where r.vintage_id=v.id order by r.id desc limit 1) review
 from public.sommni_vintages v join public.sommni_wines w on w.id=v.wine_id
 where v.status=filter_status and v.merged_into is null and exists(select 1 from public.wl_community_wines c where c.canonical_vintage_id=v.id)
 order by w.wine_name,v.vintage_key,v.id limit 20 offset page*20)x),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.sommni_owner_review_queue(integer,text) from public,anon;
grant execute on function public.sommni_owner_review_queue(integer,text) to authenticated;

create function public.sommni_owner_review(vintage uuid,decision text,note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.sommni_vintages; credited uuid; result jsonb;
begin
 if not sommni_private.is_catalog_owner() then raise exception 'Owner access required' using errcode='42501';end if;
 if decision not in ('accepted','declined') or length(trim(coalesce(note,'')))<3 or length(note)>2000 then raise exception 'Choose a decision and record 3–2000 characters of review evidence';end if;
 perform pg_advisory_xact_lock(hashtextextended('sommni-review',0));
 select * into unit from public.sommni_vintages where id=vintage for update;
 if not found or unit.status!='pending' or unit.merged_into is not null then raise exception 'This wine has already been reviewed. Refresh the queue.';end if;
 insert into sommni_private.catalog_reviews(vintage_id,reviewer,decision,note,before_state) values(vintage,auth.uid(),decision,trim(note),to_jsonb(unit));
 if decision='accepted' then
  select c.id into credited from public.sommni_contributions c where c.vintage_id=vintage and c.status='pending' order by c.created_at,c.id limit 1;
  if credited is not null then
   result:=sommni_private.review_contribution(credited,'accepted',trim(note));
   update public.sommni_contributions set status='duplicate',reviewer_note='Already credited to the first verified submission.' where vintage_id=vintage and id<>credited and status='pending';
  end if;
  update public.sommni_vintages set status='accepted' where id=vintage;
 else
  update public.sommni_vintages set status='declined' where id=vintage;
  update public.sommni_contributions set status='declined',reviewer_note=trim(note) where vintage_id=vintage and status='pending';
 end if;
 -- No records are deleted. Accepted records enter the existing Friday queue.
 update public.wl_community_wines set status=decision,reviewer_notes=trim(note),updated_at=now() where canonical_vintage_id=vintage;
 return jsonb_build_object('status',decision,'credited',credited is not null,'publication','Friday, 9 p.m. Eastern');
end $$;
revoke all on function public.sommni_owner_review(uuid,text,text) from public,anon;
grant execute on function public.sommni_owner_review(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
