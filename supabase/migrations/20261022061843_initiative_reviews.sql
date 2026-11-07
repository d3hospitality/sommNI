-- Explicit public reviews are separate from private user_collection notes.
create table public.sommni_wine_reviews (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 wine_id uuid not null references public.sommni_wines(id),
 vintage_key text not null default 'unknown' check(vintage_key in ('unknown','NV') or vintage_key ~ '^[12][0-9]{3}$'),
 rating smallint not null check(rating between 1 and 5),
 comment text not null default '' check(length(comment)<=2000),
 status text not null default 'published' check(status in ('published','withdrawn','hidden')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,wine_id,vintage_key)
);
create index sommni_wine_reviews_feed on public.sommni_wine_reviews(wine_id,created_at desc,id) where status='published';
create index sommni_wine_reviews_activity on public.sommni_wine_reviews(user_id,created_at desc);
alter table public.sommni_wine_reviews enable row level security;
revoke all on public.sommni_wine_reviews from public,anon,authenticated;
grant all on public.sommni_wine_reviews to service_role;
create table public.sommni_review_reports (
 review_id uuid not null references public.sommni_wine_reviews(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reason text not null check(length(reason) between 3 and 300),
 created_at timestamptz not null default now(), primary key(review_id,user_id)
);
alter table public.sommni_review_reports enable row level security;
revoke all on public.sommni_review_reports from public,anon,authenticated;
grant all on public.sommni_review_reports to service_role;
create index sommni_review_reports_user on public.sommni_review_reports(user_id);

-- Resolve existing canonical labels, never accept client-supplied identity ownership.
create function sommni_private.review_wine(ref text,n text,p text) returns uuid language sql stable set search_path='' as $$
 select w.id from public.sommni_wines w where w.catalog_id=nullif(ref,'') or w.id::text=ref or 'community-'||w.id::text=ref
 or (coalesce(ref,'')='' and w.id=(select a.wine_id from public.sommni_wine_aliases a where a.alias_key=sommni_private.normal_name(p)||'|'||sommni_private.label_name(n,p,'unknown')))
 order by w.created_at limit 1
$$;
create function sommni_private.reviews_read(wine_ref text,n text,p text,page integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; result jsonb;
begin
 if page<0 or page>10000 then raise exception 'Invalid review page'; end if;
 w:=sommni_private.review_wine(wine_ref,n,p);
 if w is null then return jsonb_build_object('ready',false,'reviews','[]'::jsonb,'mine','[]'::jsonb,'count',0); end if;
 select jsonb_build_object('ready',true,'wine_id',w,'count',count(*),'average',round(avg(rating),1)) into result from public.sommni_wine_reviews where wine_id=w and status='published';
 return result||jsonb_build_object('reviews',coalesce((select jsonb_agg(to_jsonb(x)) from (
 select r.id,r.rating,r.comment,r.vintage_key,r.created_at,r.updated_at,
 case when m.handle is null or m.handle like 'Cellar-%' then 'Wine explorer' else m.handle end as author,
 coalesce(r.user_id=auth.uid(),false) as mine
 from public.sommni_wine_reviews r left join public.sommni_members m on m.user_id=r.user_id
 where r.wine_id=w and r.status='published' order by r.created_at desc,r.id limit 20 offset page*20)x),'[]'::jsonb),
 'mine',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'vintage_key',r.vintage_key,'status',r.status)) from public.sommni_wine_reviews r where r.wine_id=w and r.user_id=auth.uid() and r.status<>'withdrawn'),'[]'::jsonb));
end $$;
create function sommni_private.review_save(wine_ref text,n text,p text,v text,stars integer,body text,publish boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w uuid; existing public.sommni_wine_reviews; clean text:=trim(coalesce(body,''));
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Link a free account to share a rating' using errcode='42501'; end if;
 if publish is distinct from true then raise exception 'Confirm that this rating and comment will be public'; end if;
 if stars is null or stars not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
 if v is null or not(v in ('unknown','NV') or (v ~ '^[12][0-9]{3}$' and v between '1800' and (extract(year from now())::int+1)::text)) then raise exception 'Choose a valid vintage'; end if;
 if length(clean)>2000 then raise exception 'Keep your tasting comment within 2,000 characters'; end if;
 w:=sommni_private.review_wine(wine_ref,n,p);if w is null then raise exception 'Save this wine first so its shared catalog record can sync'; end if;
 perform pg_advisory_xact_lock(hashtextextended('review-'||u::text,0));
 select * into existing from public.sommni_wine_reviews where user_id=u and wine_id=w and vintage_key=v;
 if existing.status='hidden' then raise exception 'This review is under moderation. Contact D3 to appeal.'; end if;
 if existing.id is null and (select count(*) from public.sommni_wine_reviews where user_id=u and created_at>now()-interval '1 day')>=20 then raise exception 'You have shared 20 new wine reviews today. You can still edit your existing reviews.'; end if;
 insert into public.sommni_wine_reviews(user_id,wine_id,vintage_key,rating,comment) values(u,w,v,stars,clean)
 on conflict(user_id,wine_id,vintage_key) do update set rating=excluded.rating,comment=excluded.comment,status='published',updated_at=now();
 return jsonb_build_object('saved',true,'points',1+case when length(clean)>=40 then 2 else 0 end);
end $$;
create function sommni_private.review_remove(review uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
 update public.sommni_wine_reviews set status='withdrawn',updated_at=now() where id=review and user_id=auth.uid() and status<>'hidden';
 if not found then raise exception 'Your published review was not found' using errcode='42501'; end if;
 return jsonb_build_object('removed',true);
end $$;
create function sommni_private.review_report(review uuid,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
 if length(trim(coalesce(reason,''))) not between 3 and 300 then raise exception 'Please give a short reason'; end if;
 if not exists(select 1 from public.sommni_wine_reviews where id=review and status='published' and user_id<>auth.uid()) then raise exception 'Review not found'; end if;
 insert into public.sommni_review_reports values(review,auth.uid(),trim(reason),now()) on conflict(review_id,user_id) do update set reason=excluded.reason;
 return jsonb_build_object('reported',true);
end $$;
create function sommni_private.initiative_state() returns jsonb language sql stable security definer set search_path='' as $$
 with scores as (
 select user_id,sum(points)::int points,sum(wines)::int wines,sum(reviews)::int reviews from (
 select user_id,count(*)::int*10 points,count(*)::int wines,0 reviews from public.sommni_contribution_awards group by user_id
 union all select user_id,sum(1+case when length(comment)>=40 then 2 else 0 end)::int,0,count(*)::int from public.sommni_wine_reviews where status='published' group by user_id
 ) efforts group by user_id
 ), leaders as (
 select m.handle,s.points,s.wines,s.reviews from scores s join public.sommni_members m on m.user_id=s.user_id where m.leaderboard_visible and s.points>0 order by s.points desc,m.created_at,m.user_id limit 50
 ) select jsonb_build_object('points',coalesce((select points from scores where user_id=auth.uid()),0),
 'leaderboard',coalesce((select jsonb_agg(to_jsonb(l)) from leaders l),'[]'::jsonb),
 'wine_count',(select count(*) from public.sommni_wines),'review_count',(select count(*) from public.sommni_wine_reviews where status='published'),
 'rules',jsonb_build_object('verified_wine',10,'rating',1,'tasting_comment',2,'comment_min_chars',40));
$$;

-- Narrow public API wrappers. Privileged access stays in the non-exposed schema;
-- only intentionally public review fields are returned, never profile emails.
create function public.sommni_reviews(wine_ref text default '',n text default '',p text default '',page integer default 0) returns jsonb language sql set search_path='' as $$select sommni_private.reviews_read(wine_ref,n,p,page)$$;
create function public.sommni_review_save(wine_ref text,n text,p text,v text,stars integer,body text,publish boolean) returns jsonb language sql set search_path='' as $$select sommni_private.review_save(wine_ref,n,p,v,stars,body,publish)$$;
create function public.sommni_review_remove(review uuid) returns jsonb language sql set search_path='' as $$select sommni_private.review_remove(review)$$;
create function public.sommni_review_report(review uuid,reason text) returns jsonb language sql set search_path='' as $$select sommni_private.review_report(review,reason)$$;
create function public.sommni_initiative_state() returns jsonb language sql set search_path='' as $$select sommni_private.initiative_state()$$;
revoke all on function sommni_private.review_wine(text,text,text),sommni_private.reviews_read(text,text,text,integer),sommni_private.review_save(text,text,text,text,integer,text,boolean),sommni_private.review_remove(uuid),sommni_private.review_report(uuid,text),sommni_private.initiative_state() from public,anon,authenticated;
revoke all on function public.sommni_reviews(text,text,text,integer),public.sommni_review_save(text,text,text,text,integer,text,boolean),public.sommni_review_remove(uuid),public.sommni_review_report(uuid,text),public.sommni_initiative_state() from public,anon,authenticated;
grant usage on schema sommni_private to anon,authenticated;
grant execute on function sommni_private.reviews_read(text,text,text,integer),sommni_private.initiative_state(),public.sommni_reviews(text,text,text,integer),public.sommni_initiative_state() to anon,authenticated;
grant execute on function sommni_private.review_save(text,text,text,text,integer,text,boolean),sommni_private.review_remove(uuid),sommni_private.review_report(uuid,text),public.sommni_review_save(text,text,text,text,integer,text,boolean),public.sommni_review_remove(uuid),public.sommni_review_report(uuid,text) to authenticated;
