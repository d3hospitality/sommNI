-- wineLENS tokens v3: buy the app once ($9.99, 10 tokens included), then token packs with no
-- subscription. 1 token = 1 wine card (3D bottle image + tasting notes + year + map pin), charged
-- every time, including when the bottle image or notes are reused from an earlier card.
-- Additive: v1/v2 rate cards stay immutable for history. Run once in the Supabase SQL editor.
begin;

-- 1. Rate card v3 (kept identical to shared/rate-card.json; test:sql verifies parity).
insert into public.winelens_rate_cards(version, card) values (3, '{"version":3,"currency":"usd","app":{"amount":999,"tokens":10},"features":{"wine_card":{"label":"Wine cards","free":0,"pro":0,"tokens":1},"studio_render":{"label":"New bottle images","free":0,"pro":0,"tokens":1},"tasting_notes":{"label":"Tasting notes","free":5,"pro":60,"tokens":1},"label_scan":{"label":"Label scans","free":5,"pro":60,"tokens":1},"wine_list_page":{"label":"Wine-list photo pages","free":1,"pro":20,"tokens":1},"wine_list_text":{"label":"Wine-list text pages","free":20,"pro":100,"tokens":1},"sommelier":{"label":"Sommelier picks","free":3,"pro":30,"tokens":1}},"packs":{"t5":{"amount":500,"units":20},"t10":{"amount":1000,"units":45},"t15":{"amount":1500,"units":70},"t20":{"amount":2000,"units":100},"t50":{"amount":5000,"units":275}}}')
on conflict (version) do nothing;

-- 2. Token packs: a grant must match a pack (name + units) on a published rate card (newest first),
--    so v1 sessions and v3 packs both reconcile. Body otherwise as in 20260930182315.
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
 insert into public.winelens_token_wallets(user_id,units) values(p_user,p_units) on conflict(user_id) do update set units=winelens_token_wallets.units+excluded.units;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,rate_version) values(p_user,'stripe:'||p_stripe_session,'grant',p_units,p_pack,1,v);
 return jsonb_build_object('granted',p_units);
end $$;

-- 3. The app: one payment, owned for life (plan 'pro' with no end), plus its starter tokens.
--    One grant per Stripe session; the amount and tokens must match a published card.
create or replace function public.winelens_grant_app(p_user uuid,p_stripe_session text,p_amount integer,p_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v integer; prior public.winelens_token_ledger;
begin
 select version into v from public.winelens_rate_cards where card ? 'app' and (card->'app'->>'amount')::integer=p_amount and (card->'app'->>'tokens')::integer=p_tokens order by version desc limit 1;
 if v is null or p_user is null or p_stripe_session is null or p_stripe_session not like 'cs_%' then raise exception 'invalid app grant'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-grant:'||p_stripe_session,0));
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into prior from public.winelens_token_ledger where key='stripe:'||p_stripe_session;
 if found then
   if prior.user_id<>p_user or prior.feature<>'app' or prior.units<>p_tokens then raise exception 'grant mismatch'; end if;
   return jsonb_build_object('replayed',true);
 end if;
 insert into public.winelens_entitlements(user_id,plan,status,period_start,period_end)
 values(p_user,'pro','active',now(),'infinity')
 on conflict(user_id) do update set plan=case when public.winelens_entitlements.plan='owner' then 'owner' else 'pro' end,status='active',
   period_start=case when public.winelens_entitlements.period_end='infinity' then public.winelens_entitlements.period_start else now() end,
   period_end='infinity',cancel_at_period_end=false;
 insert into public.winelens_token_wallets(user_id,units) values(p_user,p_tokens) on conflict(user_id) do update set units=winelens_token_wallets.units+excluded.units;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,rate_version) values(p_user,'stripe:'||p_stripe_session,'grant',p_tokens,'app',1,v);
 return jsonb_build_object('granted',p_tokens,'owned',true);
end $$;
revoke all on function public.winelens_grant_app(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.winelens_grant_app(uuid,text,integer,integer) to service_role;

-- 4. Checkouts: the app or a pack (the retired monthly/annual plans stay valid only for history).
create or replace function public.winelens_reserve_checkout(p_user uuid,p_choice text) returns public.winelens_checkout_attempts language plpgsql security definer set search_path='' as $$
declare r public.winelens_checkout_attempts;
begin
 if p_choice not in ('app','t5','t10','t15','t20','t50') then raise exception 'invalid checkout'; end if;
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
commit;
