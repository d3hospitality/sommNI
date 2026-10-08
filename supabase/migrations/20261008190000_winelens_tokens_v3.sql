-- wineLENS tokens v3: the app is free, and tokens unlock it. Everyone starts with 3 welcome tokens
-- (one time per account). Any token pack ($5 to $50, no subscription) unlocks the larger monthly
-- allowances for life. 1 token = 1 wine card (3D bottle image + tasting notes + year + map pin),
-- charged every time, including when the bottle image or notes are reused from an earlier card.
-- Tokens are prepaid, so anyone holding tokens may spend them (with consent).
-- Additive: v1/v2 rate cards stay immutable for history. Run once in the Supabase SQL editor.
begin;

-- 1. Rate card v3 (kept identical to shared/rate-card.json; test:sql verifies parity).
insert into public.winelens_rate_cards(version, card) values (3, '{"version":3,"currency":"usd","welcome":{"tokens":3},"features":{"wine_card":{"label":"Wine cards","free":0,"pro":0,"tokens":1},"studio_render":{"label":"New bottle images","free":0,"pro":0,"tokens":1},"tasting_notes":{"label":"Tasting notes","free":5,"pro":60,"tokens":1},"label_scan":{"label":"Label scans","free":5,"pro":60,"tokens":1},"wine_list_page":{"label":"Wine-list photo pages","free":1,"pro":20,"tokens":1},"wine_list_text":{"label":"Wine-list text pages","free":20,"pro":100,"tokens":1},"sommelier":{"label":"Sommelier picks","free":3,"pro":30,"tokens":1}},"packs":{"t5":{"amount":500,"units":20},"t10":{"amount":1000,"units":45},"t15":{"amount":1500,"units":70},"t20":{"amount":2000,"units":100},"t50":{"amount":5000,"units":275}}}')
on conflict (version) do nothing;

-- 2. Token packs: a grant must match a pack (name + units) on a published rate card (newest first),
--    so v1 sessions and v3 packs both reconcile. Any pack also unlocks wineLENS for life
--    (plan 'pro' with no end: the larger monthly allowances). Otherwise as in 20260930182315.
create or replace function public.winelens_grant_tokens(p_user uuid,p_stripe_session text,p_pack text,p_units integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v integer; prior public.winelens_token_ledger;
begin
 select version into v from public.winelens_rate_cards where (card->'packs'->p_pack->>'units')::integer=p_units order by version desc limit 1;
 if v is null or p_units is null or p_units<=0 or p_stripe_session is null or p_stripe_session not like 'cs_%' then raise exception 'invalid pack grant'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-grant:'||p_stripe_session,0));
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into prior from public.winelens_token_ledger where key='stripe:'||p_stripe_session;
 if found then
 if prior.user_id<>p_user or prior.units<>p_units or prior.feature<>p_pack then raise exception 'grant mismatch'; end if;
 return jsonb_build_object('replayed',true); end if;
 insert into public.winelens_entitlements(user_id,plan,status,period_start,period_end)
 values(p_user,'pro','active',now(),'infinity')
 on conflict(user_id) do update set plan=case when public.winelens_entitlements.plan='owner' then 'owner' else 'pro' end,status='active',
   period_start=case when public.winelens_entitlements.period_end='infinity' and public.winelens_entitlements.status='active' then public.winelens_entitlements.period_start else now() end,
   period_end='infinity',cancel_at_period_end=false;
 insert into public.winelens_token_wallets(user_id,units) values(p_user,p_units) on conflict(user_id) do update set units=winelens_token_wallets.units+excluded.units;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,rate_version) values(p_user,'stripe:'||p_stripe_session,'grant',p_units,p_pack,1,v);
 return jsonb_build_object('granted',p_units,'unlocked',true);
end $$;

-- 3. Welcome tokens: once per account, ever (the ledger is kept after account deletion).
create or replace function public.winelens_grant_welcome(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v integer; n integer;
begin
 if p_user is null then raise exception 'invalid welcome'; end if;
 if exists(select 1 from public.winelens_token_ledger where key='welcome:'||p_user::text) then return jsonb_build_object('replayed',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 if exists(select 1 from public.winelens_token_ledger where key='welcome:'||p_user::text) then return jsonb_build_object('replayed',true); end if;
 if exists(select 1 from public.wl_account_deletions where user_id=p_user) then return jsonb_build_object('granted',0); end if;
 select version,(card->'welcome'->>'tokens')::integer into v,n from public.winelens_rate_cards where effective_at<=now() order by version desc limit 1;
 if coalesce(n,0)<=0 then return jsonb_build_object('granted',0); end if;
 insert into public.winelens_token_wallets(user_id,units) values(p_user,n) on conflict(user_id) do update set units=winelens_token_wallets.units+excluded.units;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,rate_version) values(p_user,'welcome:'||p_user::text,'grant',n,'welcome',1,v);
 return jsonb_build_object('granted',n);
end $$;
revoke all on function public.winelens_grant_welcome(uuid) from public, anon, authenticated;
grant execute on function public.winelens_grant_welcome(uuid) to service_role;

-- 4. Checkouts: token packs only (the retired monthly/annual plans stay valid only for history).
create or replace function public.winelens_reserve_checkout(p_user uuid,p_choice text) returns public.winelens_checkout_attempts language plpgsql security definer set search_path='' as $$
declare r public.winelens_checkout_attempts;
begin
 if p_choice not in ('t5','t10','t15','t20','t50') then raise exception 'invalid checkout'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into r from public.winelens_checkout_attempts where user_id=p_user;
 if found and r.expires_at>now() then return r; end if;
 insert into public.winelens_checkout_attempts(user_id,choice,expires_at) values(p_user,p_choice,date_trunc('second',now())+interval '1 hour')
 on conflict(user_id) do update set choice=excluded.choice,id=gen_random_uuid(),expires_at=excluded.expires_at,session_id=null,url=null returning * into r;
 return r;
end $$;

-- 5. Wine cards are a paid AI job like notes and renderings.
alter table public.winelens_ai_jobs drop constraint if exists winelens_ai_jobs_feature_check;
alter table public.winelens_ai_jobs add constraint winelens_ai_jobs_feature_check check (feature in ('tasting_notes','studio_render','wine_list_page','wine_list_text','wine_card','sommelier'));
create or replace function public.winelens_begin_job(p_user uuid,p_feature text,p_request_id uuid,p_fingerprint text,p_consent boolean,p_quantity integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.winelens_ai_jobs; r jsonb;
begin
 if p_feature not in ('tasting_notes','studio_render','wine_list_page','wine_list_text','wine_card','sommelier') or p_request_id is null or p_fingerprint is null or p_quantity is null or p_quantity not between 1 and 20 then raise exception 'invalid job'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into previous from public.winelens_ai_jobs where user_id=p_user and request_id=p_request_id;
 if found then
   if previous.feature<>p_feature or previous.fingerprint<>p_fingerprint then return jsonb_build_object('allowed',false,'reason','request_mismatch'); end if;
   return jsonb_build_object('replayed',true,'result',previous.result,
     'status',(select status from public.winelens_token_reservations where id=previous.reservation_id));
 end if;
 r:=public.winelens_reserve_usage(p_user,'job:'||p_feature||':'||p_request_id::text,p_feature,p_quantity,p_consent);
 if (r->>'allowed')::boolean then
   insert into public.winelens_ai_jobs(user_id,request_id,feature,fingerprint,reservation_id)
   values(p_user,p_request_id,p_feature,p_fingerprint,(r->>'reservation_id')::uuid);
 end if;
 return r;
end $$;

-- 6. Shared bottle images: one generated image per bottle + vintage (from the wine's details, never
--    from anyone's photo), stored once at winelens-bottles/shared/<key>.png and copied into each
--    owner's folder. Reuse saves the provider cost; the card is still charged (rate card v3).
create table if not exists public.winelens_shared_bottles (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending','ready')),
  path text,
  model text,
  wine jsonb not null default '{}'::jsonb,
  owner_user uuid references auth.users(id) on delete set null,
  owner_request uuid,
  claimed_at timestamptz not null default now(),
  ready_at timestamptz,
  served integer not null default 0,
  check ((status = 'ready') = (path is not null))
);
alter table public.winelens_shared_bottles enable row level security;
revoke all on public.winelens_shared_bottles from public, anon, authenticated;
grant all on public.winelens_shared_bottles to service_role;

create or replace function public.winelens_bottle_claim(p_key text,p_user uuid,p_request_id uuid,p_wine jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.winelens_shared_bottles;
begin
 if p_key is null or p_key !~ '^[0-9a-f]{64}$' or p_user is null or p_request_id is null then raise exception 'invalid bottle'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-bottle:'||p_key,0));
 select * into s from public.winelens_shared_bottles where key=p_key for update;
 if found and s.status='ready' then
   update public.winelens_shared_bottles set served=served+1 where key=p_key;
   return jsonb_build_object('status','ready','path',s.path,'model',s.model);
 end if;
 if found and (s.owner_user is distinct from p_user or s.owner_request is distinct from p_request_id) and s.claimed_at>now()-interval '5 minutes' then
   return jsonb_build_object('status','busy');
 end if;
 insert into public.winelens_shared_bottles(key,status,wine,owner_user,owner_request,claimed_at)
 values(p_key,'pending',coalesce(p_wine,'{}'::jsonb),p_user,p_request_id,now())
 on conflict(key) do update set owner_user=excluded.owner_user,owner_request=excluded.owner_request,claimed_at=excluded.claimed_at,
   wine=coalesce(nullif(excluded.wine,'{}'::jsonb),public.winelens_shared_bottles.wine);
 return jsonb_build_object('status','claimed');
end $$;
create or replace function public.winelens_bottle_fill(p_key text,p_user uuid,p_request_id uuid,p_path text,p_model text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_path is null or p_path !~ '^shared/[0-9a-f]{64}\.png$' then raise exception 'invalid shared path'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-bottle:'||p_key,0));
 update public.winelens_shared_bottles set status='ready',path=p_path,model=p_model,ready_at=now()
 where key=p_key and status='pending' and owner_user=p_user and owner_request=p_request_id;
 return jsonb_build_object('filled',found);
end $$;
create or replace function public.winelens_bottle_release(p_key text,p_user uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens-bottle:'||p_key,0));
 delete from public.winelens_shared_bottles where key=p_key and status='pending' and owner_user=p_user and owner_request=p_request_id;
 return jsonb_build_object('released',found);
end $$;
revoke all on function public.winelens_bottle_claim(text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.winelens_bottle_fill(text,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.winelens_bottle_release(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.winelens_bottle_claim(text,uuid,uuid,jsonb) to service_role;
grant execute on function public.winelens_bottle_fill(text,uuid,uuid,text,text) to service_role;
grant execute on function public.winelens_bottle_release(text,uuid,uuid) to service_role;
-- 7. Tokens are prepaid, so spending them no longer needs a purchase first: welcome tokens work
--    from day one. Body otherwise identical to 20261007190000 (the pro_required refusal is gone).
create or replace function public.winelens_reserve_usage(p_user uuid,p_key text,p_feature text,p_quantity integer,p_spend_consent boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.winelens_token_wallets; r public.winelens_token_reservations; rate public.winelens_rate_cards; period jsonb;
 cap integer; left_count integer; included integer; cost integer; spent integer; pending integer;
begin
 if p_user is null or p_key is null or length(p_key) not between 1 and 200 or p_feature is null or p_feature !~ '^[a-z_]{1,40}$' or p_quantity is null or p_quantity not between 1 and 100 then raise exception 'invalid usage'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 if exists(select 1 from public.wl_account_deletions where user_id=p_user) then return jsonb_build_object('allowed',false,'reason','deleting'); end if;
 perform public.winelens_sweep_reservations(p_user);
 insert into public.winelens_token_wallets(user_id) values(p_user) on conflict do nothing;
 select * into w from public.winelens_token_wallets where user_id=p_user;
 select * into r from public.winelens_token_reservations where user_id=p_user and key=p_key;
 if found then
 if r.feature<>p_feature or r.quantity<>p_quantity then raise exception 'request mismatch'; end if;
 return jsonb_build_object('allowed',false,'replayed',true,'status',r.status,'reservation_id',r.id,'tokens',w.units);
 end if;
 select * into rate from public.winelens_rate_cards where effective_at<=now() order by version desc limit 1;
 if not ((rate.card->'features') ? p_feature) then raise exception 'invalid usage'; end if;
 period:=public.winelens_period(p_user);
 cap:=(rate.card->'features'->p_feature->>case when (period->>'pro')::boolean then 'pro' else 'free' end)::integer;
 insert into public.winelens_usage(user_id,feature,period_start) values(p_user,p_feature,(period->>'start')::timestamptz) on conflict do nothing;
 select greatest(0,cap-used-reserved) into left_count from public.winelens_usage where user_id=p_user and feature=p_feature and period_start=(period->>'start')::timestamptz;
 included:=least(left_count,p_quantity); cost:=(p_quantity-included)*(rate.card->'features'->p_feature->>'tokens')::integer;
 if cost>0 then
 if not (w.auto_spend or coalesce(p_spend_consent,false)) then return jsonb_build_object('allowed',false,'reason','consent_required','tokens',w.units,'remaining_allowance',left_count,'cost',cost); end if;
 select coalesce(-sum(units),0) into spent from public.winelens_token_ledger where user_id=p_user and event='commit' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(units),0) into pending from public.winelens_token_reservations where user_id=p_user and status='reserved';
 if w.units<cost or (w.monthly_limit_units is not null and spent+pending+cost>w.monthly_limit_units) then return jsonb_build_object('allowed',false,'reason','token_limit','tokens',w.units,'remaining_allowance',left_count,'cost',cost); end if;
 end if;
 insert into public.winelens_token_reservations(user_id,key,feature,quantity,allowance,units,period_start,rate_version)
 values(p_user,p_key,p_feature,p_quantity,included,cost,(period->>'start')::timestamptz,rate.version) returning * into r;
 update public.winelens_usage set reserved=reserved+included where user_id=p_user and feature=p_feature and period_start=r.period_start;
 update public.winelens_token_wallets set units=units-cost where user_id=p_user;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,allowance,reservation_id,rate_version)
 values(p_user,r.id::text||':reserve','reserve',-cost,p_feature,p_quantity,included,r.id,rate.version);
 return jsonb_build_object('allowed',true,'source',case when cost>0 then 'tokens' else 'allowance' end,'reservation_id',r.id,'remaining_allowance',left_count-included,'tokens',w.units-cost);
end $$;
create or replace function public.winelens_auto_spend(p_user uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 insert into public.winelens_token_wallets(user_id,auto_spend) values(p_user,p_enabled) on conflict(user_id) do update set auto_spend=excluded.auto_spend;
end $$;
commit;
