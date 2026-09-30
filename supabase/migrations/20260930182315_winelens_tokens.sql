-- Applied to mcmtasetompygfktzhpr on 2026-09-30 with Romario's approval.
begin;
create table public.winelens_rate_cards(version integer primary key, card jsonb not null, effective_at timestamptz not null default now());
-- Kept identical to shared/rate-card.json; test:sql verifies this contract.
insert into public.winelens_rate_cards(version,card) values(1,'{"version":1,"currency":"usd","plans":{"monthly":{"amount":499,"interval":"month"},"annual":{"amount":3999,"interval":"year"}},"features":{"label_scan":{"label":"Label scans","free":5,"pro":60,"tokens":1},"studio_render":{"label":"Studio renderings","free":0,"pro":10,"tokens":8},"wine_list_page":{"label":"Wine-list pages","free":0,"pro":5,"tokens":3}},"packs":{"t5":{"amount":500,"units":100},"t10":{"amount":1000,"units":220},"t15":{"amount":1500,"units":350},"t20":{"amount":2000,"units":500}}}');
create table public.winelens_entitlements (
 user_id uuid primary key references auth.users(id) on delete cascade,
 plan text not null default 'free' check(plan in ('free','pro','owner')), status text not null default 'free',
 price_id text, customer_id text unique, subscription_id text unique,
 period_start timestamptz, period_end timestamptz, cancel_at_period_end boolean not null default false,
 subscription_created bigint not null default 0, event_created bigint not null default 0, event_id text
);
create table public.winelens_token_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade, units integer not null default 0 check(units>=0),
 auto_spend boolean not null default false, monthly_limit_units integer check(monthly_limit_units>=0)
);
create table public.winelens_usage (
 user_id uuid not null references auth.users(id) on delete cascade, feature text not null,
 period_start timestamptz not null, used integer not null default 0 check(used>=0), reserved integer not null default 0 check(reserved>=0),
 primary key(user_id,feature,period_start)
);
create table public.winelens_token_reservations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 key text not null, feature text not null, quantity integer not null check(quantity>0),
 allowance integer not null check(allowance>=0), units integer not null check(units>=0), period_start timestamptz not null,
 rate_version integer not null references public.winelens_rate_cards(version), receipt uuid not null default gen_random_uuid(),
 status text not null default 'reserved' check(status in ('reserved','committed','released')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '5 minutes',
 unique(user_id,key)
);
-- Financial audit survives account deletion; no email/photo/JWT and no FK cascade.
create table public.winelens_token_ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, key text not null unique,
 event text not null check(event in ('grant','reserve','commit','release')), units integer not null,
 feature text not null, quantity integer not null, allowance integer not null default 0,
 reservation_id uuid, rate_version integer not null references public.winelens_rate_cards(version),
 created_at timestamptz not null default now()
);
comment on table public.winelens_token_ledger is 'Append-only audit. grant + commit are financial movements; reserve/release are holds, never sum both. Retained on account deletion.';
create index on public.winelens_token_ledger(user_id,created_at desc);
create index on public.winelens_token_reservations(user_id,expires_at) where status='reserved';
create table public.winelens_checkout_attempts (
 user_id uuid primary key references auth.users(id) on delete cascade, choice text not null,
 id uuid not null default gen_random_uuid(), expires_at timestamptz not null, session_id text, url text
);
create table public.winelens_scan_results (
 user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 fingerprint text not null, result jsonb, primary key(user_id,request_id)
);
create function public.winelens_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'append-only record'; end $$;
create trigger winelens_ledger_immutable before update or delete or truncate on public.winelens_token_ledger for each statement execute function public.winelens_immutable();
create trigger winelens_rates_immutable before update or delete or truncate on public.winelens_rate_cards for each statement execute function public.winelens_immutable();

-- One lock namespace for every wallet/usage/subscription/checkout mutation.
create function public.winelens_period(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.winelens_entitlements; start_at timestamptz; end_at timestamptz; pro boolean; anchor timestamp; n integer;
begin
 select * into e from public.winelens_entitlements where user_id=p_user;
 pro:=coalesce(e.plan='owner' or (e.plan='pro' and e.status in ('active','trialing') and e.period_start<=now() and e.period_end>now()),false);
 start_at:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'; end_at:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
 if pro and e.plan<>'owner' then
   -- Annual plans still receive monthly allowances, anchored to their billing date.
   anchor:=e.period_start at time zone 'UTC'; n:=0;
   while (anchor+make_interval(months=>n+1)) at time zone 'UTC'<=now() loop n:=n+1; end loop;
   start_at:=(anchor+make_interval(months=>n)) at time zone 'UTC';
   end_at:=least((anchor+make_interval(months=>n+1)) at time zone 'UTC',e.period_end);
 end if;
 return jsonb_build_object('plan',case when pro then coalesce(e.plan,'pro') else 'free' end,'pro',pro,'start',start_at,'end',end_at);
end $$;

create function public.winelens_settle_usage(p_user uuid,p_reservation_id uuid,p_success boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.winelens_token_reservations; ok boolean;
begin
 if p_success is null then raise exception 'success required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into r from public.winelens_token_reservations where id=p_reservation_id and user_id=p_user for update;
 if not found then raise exception 'unknown reservation'; end if;
 if r.status<>'reserved' then return jsonb_build_object('status',r.status,'replayed',true); end if;
 ok:=p_success and r.expires_at>now();
 update public.winelens_usage set reserved=reserved-r.allowance,used=used+case when ok then r.allowance else 0 end
 where user_id=p_user and feature=r.feature and period_start=r.period_start;
 if not ok then update public.winelens_token_wallets set units=units+r.units where user_id=p_user; end if;
 update public.winelens_token_reservations set status=case when ok then 'committed' else 'released' end where id=r.id;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,allowance,reservation_id,rate_version)
 values(p_user,r.id::text||case when ok then ':commit' else ':release' end,case when ok then 'commit' else 'release' end,
 case when ok then -r.units else r.units end,r.feature,r.quantity,r.allowance,r.id,r.rate_version);
 return jsonb_build_object('status',case when ok then 'committed' else 'released' end);
end $$;
create function public.winelens_sweep_reservations(p_user uuid default null) returns integer language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0;
begin
 for r in select user_id,id from public.winelens_token_reservations where status='reserved' and expires_at<=now() and (p_user is null or user_id=p_user) order by user_id,id loop
 perform public.winelens_settle_usage(r.user_id,r.id,false); n:=n+1;
 end loop; return n;
end $$;
create function public.winelens_reserve_usage(p_user uuid,p_key text,p_feature text,p_quantity integer,p_spend_consent boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.winelens_token_wallets; r public.winelens_token_reservations; rate public.winelens_rate_cards; period jsonb;
 cap integer; left_count integer; included integer; cost integer; spent integer; pending integer;
begin
 if p_user is null or p_key is null or length(p_key) not between 1 and 200 or p_feature is null or p_feature not in ('label_scan','studio_render','wine_list_page') or p_quantity is null or p_quantity not between 1 and 100 then raise exception 'invalid usage'; end if;
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
 period:=public.winelens_period(p_user);
 cap:=(rate.card->'features'->p_feature->>case when (period->>'pro')::boolean then 'pro' else 'free' end)::integer;
 insert into public.winelens_usage(user_id,feature,period_start) values(p_user,p_feature,(period->>'start')::timestamptz) on conflict do nothing;
 select greatest(0,cap-used-reserved) into left_count from public.winelens_usage where user_id=p_user and feature=p_feature and period_start=(period->>'start')::timestamptz;
 included:=least(left_count,p_quantity); cost:=(p_quantity-included)*(rate.card->'features'->p_feature->>'tokens')::integer;
 if cost>0 then
 if not (period->>'pro')::boolean then return jsonb_build_object('allowed',false,'reason','pro_required','tokens',w.units,'remaining_allowance',left_count); end if;
 if not (w.auto_spend or coalesce(p_spend_consent,false)) then return jsonb_build_object('allowed',false,'reason','consent_required','tokens',w.units,'remaining_allowance',left_count); end if;
 select coalesce(-sum(units),0) into spent from public.winelens_token_ledger where user_id=p_user and event='commit' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(units),0) into pending from public.winelens_token_reservations where user_id=p_user and status='reserved';
 if w.units<cost or (w.monthly_limit_units is not null and spent+pending+cost>w.monthly_limit_units) then return jsonb_build_object('allowed',false,'reason','token_limit','tokens',w.units,'remaining_allowance',left_count); end if;
 end if;
 insert into public.winelens_token_reservations(user_id,key,feature,quantity,allowance,units,period_start,rate_version)
 values(p_user,p_key,p_feature,p_quantity,included,cost,(period->>'start')::timestamptz,rate.version) returning * into r;
 update public.winelens_usage set reserved=reserved+included where user_id=p_user and feature=p_feature and period_start=r.period_start;
 update public.winelens_token_wallets set units=units-cost where user_id=p_user;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,allowance,reservation_id,rate_version)
 values(p_user,r.id::text||':reserve','reserve',-cost,p_feature,p_quantity,included,r.id,rate.version);
 return jsonb_build_object('allowed',true,'source',case when cost>0 then 'tokens' else 'allowance' end,'reservation_id',r.id,'remaining_allowance',left_count-included,'tokens',w.units-cost);
end $$;
create function public.winelens_grant_tokens(p_user uuid,p_stripe_session text,p_pack text,p_units integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare expected integer; v integer; prior public.winelens_token_ledger;
begin
 -- Grants use the immutable launch pack mapping, never client-supplied units.
 select (card->'packs'->p_pack->>'units')::integer,version into expected,v from public.winelens_rate_cards where version=1;
 if expected is null or p_units is distinct from expected or p_stripe_session is null or p_stripe_session not like 'cs_%' then raise exception 'invalid pack grant'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-grant:'||p_stripe_session,0));
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into prior from public.winelens_token_ledger where key='stripe:'||p_stripe_session;
 if found then
 if prior.user_id<>p_user or prior.units<>p_units or prior.feature<>p_pack then raise exception 'grant mismatch'; end if;
 return jsonb_build_object('replayed',true); end if;
 -- If account was deleted before the webhook, fail for operator refund/reconciliation.
 insert into public.winelens_token_wallets(user_id,units) values(p_user,p_units) on conflict(user_id) do update set units=winelens_token_wallets.units+excluded.units;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,rate_version) values(p_user,'stripe:'||p_stripe_session,'grant',p_units,p_pack,1,v);
 return jsonb_build_object('granted',p_units);
end $$;
create function public.winelens_billing_status(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare period jsonb; rate jsonb; w public.winelens_token_wallets; e public.winelens_entitlements; allowances jsonb:='{}'; f text; cap integer; used_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0)); perform public.winelens_sweep_reservations(p_user);
 period:=public.winelens_period(p_user);
 select card into rate from public.winelens_rate_cards where effective_at<=now() order by version desc limit 1;
 select * into w from public.winelens_token_wallets where user_id=p_user;
 select * into e from public.winelens_entitlements where user_id=p_user;
 for f in select jsonb_object_keys(rate->'features') loop
 cap:=(rate->'features'->f->>case when (period->>'pro')::boolean then 'pro' else 'free' end)::integer;
 select used+reserved into used_count from public.winelens_usage where user_id=p_user and feature=f and period_start=(period->>'start')::timestamptz;
 allowances:=allowances||jsonb_build_object(f,jsonb_build_object('limit',cap,'remaining',greatest(0,cap-coalesce(used_count,0))));
 end loop;
 return period||jsonb_build_object('allowances',allowances,'tokens',coalesce(w.units,0),'auto_spend',coalesce(w.auto_spend,false),'monthly_limit_units',w.monthly_limit_units,
 'rate_card',rate,'packs',rate->'packs','can_manage',e.customer_id is not null,'subscription_id',e.subscription_id,'subscription_status',e.status,'period_end',e.period_end,'cancel_at_period_end',e.cancel_at_period_end,
 'ledger',coalesce((select jsonb_agg(x) from (select event,units,feature,quantity,allowance,created_at from public.winelens_token_ledger where user_id=p_user order by created_at desc,id limit 20)x),'[]'::jsonb));
end $$;
create function public.winelens_auto_spend(p_user uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 if p_enabled and not (public.winelens_period(p_user)->>'pro')::boolean then raise exception 'Pro required'; end if;
 insert into public.winelens_token_wallets(user_id,auto_spend) values(p_user,p_enabled) on conflict(user_id) do update set auto_spend=excluded.auto_spend;
end $$;
create function public.winelens_reserve_checkout(p_user uuid,p_choice text) returns public.winelens_checkout_attempts language plpgsql security definer set search_path='' as $$
declare r public.winelens_checkout_attempts;
begin
 if p_choice not in ('monthly','annual','t5','t10','t15','t20') then raise exception 'invalid checkout'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into r from public.winelens_checkout_attempts where user_id=p_user;
 if found and r.expires_at>now() then return r; end if;
 insert into public.winelens_checkout_attempts(user_id,choice,expires_at) values(p_user,p_choice,date_trunc('second',now())+interval '1 hour')
 on conflict(user_id) do update set choice=excluded.choice,id=gen_random_uuid(),expires_at=excluded.expires_at,session_id=null,url=null returning * into r;
 return r;
end $$;
create function public.winelens_sync_subscription(p_user uuid,p_subscription jsonb,p_event_created bigint,p_event_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.winelens_entitlements;
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into e from public.winelens_entitlements where user_id=p_user;
 if found then
 if e.subscription_id=p_subscription->>'id' and (e.event_created>p_event_created or e.event_id=p_event_id or (e.status='canceled' and p_subscription->>'status'<>'canceled')) then return jsonb_build_object('ignored',true); end if;
 if e.subscription_id is not null and e.subscription_id<>p_subscription->>'id' and (coalesce((p_subscription->>'created')::bigint,0)<=e.subscription_created or p_subscription->>'status' not in ('active','trialing')) then return jsonb_build_object('ignored',true); end if;
 if e.customer_id is not null and e.customer_id<>p_subscription->>'customer' then raise exception 'customer mismatch'; end if;
 end if;
 insert into public.winelens_entitlements(user_id,plan,status,price_id,customer_id,subscription_id,period_start,period_end,cancel_at_period_end,subscription_created,event_created,event_id)
 values(p_user,case when e.plan='owner' then 'owner' when p_subscription->>'status' in ('active','trialing') then 'pro' else 'free' end,p_subscription->>'status',p_subscription->>'price',p_subscription->>'customer',p_subscription->>'id',
 (p_subscription->>'start')::timestamptz,(p_subscription->>'end')::timestamptz,(p_subscription->>'cancel_at_period_end')::boolean,(p_subscription->>'created')::bigint,p_event_created,p_event_id)
 on conflict(user_id) do update set plan=excluded.plan,status=excluded.status,price_id=excluded.price_id,customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,period_start=excluded.period_start,period_end=excluded.period_end,cancel_at_period_end=excluded.cancel_at_period_end,subscription_created=excluded.subscription_created,event_created=excluded.event_created,event_id=excluded.event_id;
 return jsonb_build_object('synced',true);
end $$;

-- Scan ownership, fingerprint, provider lease and result settlement are atomic.
create function public.winelens_begin_scan(p_user uuid,p_request_id uuid,p_fingerprint text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.winelens_scan_results; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into previous from public.winelens_scan_results where user_id=p_user and request_id=p_request_id;
 if found then
 if previous.fingerprint<>p_fingerprint then return jsonb_build_object('allowed',false,'reason','request_mismatch'); end if;
 return jsonb_build_object('replayed',true,'result',previous.result);
 end if;
 r:=public.winelens_reserve_usage(p_user,'scan:'||p_request_id::text,'label_scan',1,p_consent);
 if (r->>'allowed')::boolean then
 insert into public.winelens_scan_results(user_id,request_id,fingerprint) values(p_user,p_request_id,p_fingerprint);
 end if;
 return r;
end $$;
create function public.winelens_finish_scan(p_user uuid,p_request_id uuid,p_reservation_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 if not exists(select 1 from public.winelens_token_reservations where id=p_reservation_id and user_id=p_user and key='scan:'||p_request_id::text) then raise exception 'scan mismatch'; end if;
 r:=public.winelens_settle_usage(p_user,p_reservation_id,p_result is not null);
 if r->>'status'='committed' then
 update public.winelens_scan_results set result=coalesce(result,p_result) where user_id=p_user and request_id=p_request_id;
 end if;
 return r;
end $$;

-- JWT-only Bottle Studio surface. No user id or arbitrary feature accepted.
create function public.winelens_studio_user() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); sid uuid;
begin
 sid:=((current_setting('request.jwt.claims',true)::jsonb)->>'session_id')::uuid;
 if u is null or public.wl_check_session(u,sid)->>'status'<>'active' then raise exception 'active session required' using errcode='42501'; end if;
 return u;
end $$;
create function public.winelens_reserve_studio(p_key uuid,p_spend_consent boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; receipt_value uuid;
begin
 r:=public.winelens_reserve_usage(public.winelens_studio_user(),'studio:'||p_key::text,'studio_render',1,p_spend_consent);
 if (r->>'allowed')::boolean then
 select receipt into receipt_value from public.winelens_token_reservations where id=(r->>'reservation_id')::uuid;
 r:=r||jsonb_build_object('receipt',receipt_value);
 end if; return r;
end $$;
create function public.winelens_settle_studio(p_reservation_id uuid,p_success boolean,p_receipt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.winelens_studio_user();
begin
 if not exists(select 1 from public.winelens_token_reservations where id=p_reservation_id and user_id=u and feature='studio_render' and key like 'studio:%' and receipt=p_receipt) then raise exception 'unknown studio reservation' using errcode='42501'; end if;
 return public.winelens_settle_usage(u,p_reservation_id,p_success);
end $$;

-- Default deny everything. Public rate data has only a SELECT policy.
do $$ declare t text; f record; begin
 foreach t in array array['winelens_rate_cards','winelens_entitlements','winelens_token_wallets','winelens_usage','winelens_token_reservations','winelens_token_ledger','winelens_checkout_attempts','winelens_scan_results'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t in ('winelens_entitlements','winelens_token_wallets','winelens_usage','winelens_token_ledger') then
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy read_own on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
 end if;
 end loop;
 -- Only this migration's functions: the pre-existing ingest RPCs (0004) keep their own grants.
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'winelens\_%' escape '\'
   and proname not in ('winelens_import_wines','winelens_update_wine_notes','winelens_verify_ingest') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
revoke update,delete,truncate on public.winelens_token_ledger,public.winelens_rate_cards from service_role;
grant select on public.winelens_rate_cards to anon,authenticated;
create policy read_rates on public.winelens_rate_cards for select to anon,authenticated using(true);
grant execute on function public.winelens_reserve_studio(uuid,boolean),public.winelens_settle_studio(uuid,boolean,uuid) to authenticated;
commit;
