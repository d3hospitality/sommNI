-- One shared daily bottle allowance across research, photo lookup and collection writes.
-- Public reference facts continue through the existing mandatory capture triggers.
create table sommni_private.bottle_unlimited_users(user_id uuid primary key references auth.users(id));
alter table sommni_private.bottle_unlimited_users enable row level security;
insert into sommni_private.bottle_unlimited_users(user_id)
select id from auth.users where lower(email)='ops@d3hospitality.com' and email_confirmed_at is not null;
create table sommni_private.daily_bottles(
 subject text not null,day date not null,item_key text not null,aliases text[] not null,
 created_at timestamptz not null default now(),primary key(subject,day,item_key)
);
alter table sommni_private.daily_bottles enable row level security;
revoke all on sommni_private.bottle_unlimited_users,sommni_private.daily_bottles from public,anon,authenticated;

create function sommni_private.bottle_key(name text,producer text,vintage text) returns text
language sql immutable set search_path='' as $$
 select 'wine:'||trim(regexp_replace(lower(coalesce(name,'')),'[[:space:]]+',' ','g'))||'|'||
 trim(regexp_replace(lower(coalesce(nullif(trim(producer),''),'Unknown producer')),'[[:space:]]+',' ','g'))||'|'||
 case when lower(coalesce(vintage,'')) in ('nv','non_vintage','non-vintage') then 'nv' else coalesce(nullif(lower(vintage),''),'unknown') end
$$;
create function sommni_private.bottle_allow(p_subject text,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'America/New_York')::date; n int; owner uuid; exempt boolean:=false; resets timestamptz;
begin
 if p_subject is null or length(p_subject)>160 or p_subject !~ '^(user:[0-9a-f-]{36}|guest:[0-9a-f]{64})$' then raise exception 'Invalid quota identity';end if;
 if auth.uid() is not null and p_subject<>'user:'||auth.uid()::text then raise exception 'Quota owner mismatch';end if;
 if p_key is not null and (length(p_key)>1000 or length(p_key)<2) then raise exception 'Invalid bottle identity';end if;
 if p_subject like 'user:%' then
  owner:=substring(p_subject from 6)::uuid;
  exempt:=exists(select 1 from sommni_private.bottle_unlimited_users where user_id=owner)
   or exists(select 1 from public.winelens_entitlements where user_id=owner and plan='pro' and status in ('active','trialing') and period_end>now());
 end if;
 resets:=(d+1)::timestamp at time zone 'America/New_York';
 if exempt then return jsonb_build_object('allowed',true,'unlimited',true,'limit',null,'remaining',null,'resets_at',resets);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_subject||':'||d::text,0));
 select count(*) into n from sommni_private.daily_bottles where subject=p_subject and day=d;
 if p_key is not null and not exists(select 1 from sommni_private.daily_bottles where subject=p_subject and day=d and p_key=any(aliases)) then
  if n>=10 then return jsonb_build_object('allowed',false,'unlimited',false,'limit',10,'used',n,'remaining',0,'resets_at',resets);end if;
  insert into sommni_private.daily_bottles(subject,day,item_key,aliases) values(p_subject,d,p_key,array[p_key]);n:=n+1;
 end if;
 return jsonb_build_object('allowed',true,'unlimited',false,'limit',10,'used',n,'remaining',greatest(0,10-n),'resets_at',resets);
end $$;
create function public.sommni_bottle_allow(p_subject text,p_key text default null) returns jsonb
language sql security definer set search_path='' as $$select sommni_private.bottle_allow(p_subject,p_key)$$;
revoke all on function public.sommni_bottle_allow(text,text) from public,anon,authenticated;
grant execute on function public.sommni_bottle_allow(text,text) to service_role;
create function public.sommni_bottle_bind(p_subject text,p_key text,p_alias text) returns void
language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'America/New_York')::date;
begin
 if auth.uid() is not null and p_subject<>'user:'||auth.uid()::text then raise exception 'Quota owner mismatch';end if;
 if length(p_alias)>1000 then raise exception 'Invalid bottle identity';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_subject||':'||d::text,0));
 update sommni_private.daily_bottles set aliases=array_append(aliases,p_alias)
 where subject=p_subject and day=d and item_key=p_key and not p_alias=any(aliases);
end $$;
revoke all on function public.sommni_bottle_bind(text,text,text) from public,anon,authenticated;
grant execute on function public.sommni_bottle_bind(text,text,text) to service_role;
create function sommni_private.limit_collection_bottles() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; old_k text; allowance jsonb;
begin
 if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Collection owner mismatch';end if;
 k:=sommni_private.bottle_key(new.wine_name,new.producer,coalesce(new.vintage::text,new.metadata->>'vintage_state'));
 if tg_op='UPDATE' then
  old_k:=sommni_private.bottle_key(old.wine_name,old.producer,coalesce(old.vintage::text,old.metadata->>'vintage_state'));
  if k=old_k and new.user_id=old.user_id then return new;end if;
 end if;
 allowance:=sommni_private.bottle_allow('user:'||new.user_id::text,k);
 if not (allowance->>'allowed')::boolean then raise exception using errcode='P0001',message='Daily limit reached: free accounts can search or add 10 bottles per day. Resets at midnight New York time.';end if;
 return new;
end $$;
revoke all on function sommni_private.bottle_allow(text,text),sommni_private.bottle_key(text,text,text),sommni_private.limit_collection_bottles() from public,anon,authenticated;
create trigger sommni_limit_collection_bottles before insert or update of wine_name,producer,vintage,metadata,user_id on public.user_collection for each row execute function sommni_private.limit_collection_bottles();
