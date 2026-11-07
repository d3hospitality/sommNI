-- Personal photos are private, account-owned objects; they never become wine catalog assets.
alter table public.sommni_members add column avatar_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sommni-profiles','sommni-profiles',false,1048576,array['image/jpeg'])
on conflict(id) do nothing;
create policy sommni_profile_read on storage.objects for select to authenticated
using(bucket_id='sommni-profiles' and (select sommni_private.session_allowed()) and name=(select auth.uid())::text||'/avatar.jpg');
create policy sommni_profile_insert on storage.objects for insert to authenticated
with check(bucket_id='sommni-profiles' and (select sommni_private.session_allowed()) and name=(select auth.uid())::text||'/avatar.jpg');
create policy sommni_profile_update on storage.objects for update to authenticated
using(bucket_id='sommni-profiles' and (select sommni_private.session_allowed()) and name=(select auth.uid())::text||'/avatar.jpg')
with check(bucket_id='sommni-profiles' and (select sommni_private.session_allowed()) and name=(select auth.uid())::text||'/avatar.jpg');
create function sommni_private.save_personal_profile(name text,visible boolean,bio text,based_in text,photo_path text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null or not sommni_private.session_allowed() then raise exception 'Link your account first' using errcode='42501';end if;
 if photo_path is not null and (photo_path<>u::text||'/avatar.jpg' or not exists(select 1 from storage.objects where bucket_id='sommni-profiles' and storage.objects.name=photo_path)) then raise exception 'Upload your own profile photo first' using errcode='42501';end if;
 perform sommni_private.save_profile(name,visible,bio,based_in);
 update public.sommni_members set avatar_path=photo_path where user_id=u;
 return sommni_private.community_state();
end $$;
create function public.sommni_save_personal_profile(name text,visible boolean,bio text,based_in text,photo_path text) returns jsonb
language sql security invoker set search_path='' as $$select sommni_private.save_personal_profile(name,visible,bio,based_in,photo_path)$$;
revoke all on function sommni_private.save_personal_profile(text,boolean,text,text,text),public.sommni_save_personal_profile(text,boolean,text,text,text) from public,anon,authenticated;
grant execute on function sommni_private.save_personal_profile(text,boolean,text,text,text),public.sommni_save_personal_profile(text,boolean,text,text,text) to authenticated;
-- Only published, canonical additions count. Repeated submissions and photo updates do not.
create function sommni_atlas_api.weekly_progress() returns jsonb language sql stable security definer set search_path='' as $$
 with period as(select date_trunc('week',now() at time zone 'America/New_York') at time zone 'America/New_York' start_at),
 additions as materialized(select a.* from sommni_private.atlas_activity() a,period where a.added_at>=period.start_at and a.added_at<=now()),
 countries as(select c.name,count(distinct a.wine_id)::int wines from additions a join sommni_private.atlas_countries c on c.code=a.country_code group by c.name)
 select jsonb_build_object('wines',(select count(distinct wine_id) from additions),'bottles',(select count(distinct id) from additions),
 'week_start',(select start_at from period),'updated_at',now(),'leaders',coalesce((select jsonb_agg(to_jsonb(c)) from (select * from countries order by wines desc,name limit 3)c),'[]'::jsonb))
$$;
create function public.sommni_weekly_progress() returns jsonb language sql stable security invoker set search_path='' as $$select sommni_atlas_api.weekly_progress()$$;
revoke all on function sommni_atlas_api.weekly_progress(),public.sommni_weekly_progress() from public;
grant execute on function sommni_atlas_api.weekly_progress(),public.sommni_weekly_progress() to anon,authenticated,service_role;
notify pgrst,'reload schema';
