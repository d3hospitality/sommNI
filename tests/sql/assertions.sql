create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','one@example.test'),('22222222-2222-4222-8222-222222222222','two@example.test');
insert into auth.sessions(id,user_id) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
do $$declare u uuid:='11111111-1111-4111-8111-111111111111'; r jsonb; code uuid; d uuid; sid uuid; i integer; begin
 perform test_assert(exists(select 1 from profiles where id=u),'profile created');
 r:=wl_issue_code(u,repeat('a',64)); code:=(r->>'id')::uuid;
 perform test_assert(r->>'status'='pending','issue');
 r:=wl_claim_code(repeat('a',64),repeat('1',64)); d:=(r->>'id')::uuid;
 perform test_assert(r->>'status'='claimed','claim');
 perform test_assert(wl_claim_code(repeat('a',64),repeat('1',64))->>'status'='invalid','single use');
 perform test_assert(wl_finish_link(d,'33333333-3333-4333-8333-333333333333')->>'status'='linked','finish');
 perform test_assert(wl_code_status(u,code)->>'status'='linked','status');
 perform test_assert(wl_device_status(u,'33333333-3333-4333-8333-333333333333')->>'status'='linked','device');
 insert into auth.refresh_tokens(session_id) values('33333333-3333-4333-8333-333333333333');
 perform wl_revoke_device(u,d,null);
 perform test_assert(not exists(select 1 from auth.refresh_tokens),'refresh chain revoked');
 perform test_assert(wl_check_session(u,'33333333-3333-4333-8333-333333333333')->>'status'='revoked','session revoked');
 r:=wl_issue_code(u,repeat('c',64)); update wl_link_codes set expires_at=now()-interval '1 second' where id=(r->>'id')::uuid;
 perform test_assert(wl_claim_code(repeat('c',64),repeat('1',64))->>'status'='expired','expiry');
 for i in 1..5 loop
 r:=wl_issue_code(u,md5(i::text)||md5(i::text)); r:=wl_claim_code(md5(i::text)||md5(i::text),repeat('2',64));
 perform test_assert(r->>'status'='claimed','five devices');
 sid:=gen_random_uuid(); insert into auth.sessions(id,user_id) values(sid,u);
 perform wl_finish_link((r->>'id')::uuid,sid);
 end loop;
 perform wl_issue_code(u,repeat('d',64));
 perform test_assert(wl_claim_code(repeat('d',64),repeat('2',64))->>'status'='limit_reached','sixth blocked');
 for i in 1..5 loop r:=wl_issue_code(u,md5((100+i)::text)||md5((100+i)::text)); end loop;
 perform test_assert(r->>'status'='rate_limited','issue rate');
 for i in 1..21 loop r:=wl_claim_code(repeat('f',64),repeat('3',64)); end loop;
 perform test_assert(r->>'status'='rate_limited','redeem rate');
end$$;
-- Service-only calls really run as service_role, not the test superuser.
set role service_role;
do $$declare u uuid:='11111111-1111-4111-8111-111111111111'; v uuid:='22222222-2222-4222-8222-222222222222'; r jsonb; rid uuid; i int; begin
 r:=winelens_reserve_usage(u,'free1','label_scan',1,false); rid:=(r->>'reservation_id')::uuid;
 perform test_assert(r->>'source'='allowance' and r->>'remaining_allowance'='4','allowance first');
 perform test_assert(winelens_reserve_usage(u,'free1','label_scan',1,false)->>'replayed'='true','reserve replay');
 perform test_assert(winelens_settle_usage(u,rid,false)->>'status'='released','failure release');
 perform test_assert(winelens_billing_status(u)->'allowances'->'label_scan'->>'remaining'='5','failure returned allowance');
 r:=winelens_reserve_usage(u,'free-five','label_scan',5,false); perform winelens_settle_usage(u,(r->>'reservation_id')::uuid,true);
 -- The app is free and tokens are prepaid: without tokens nothing past the allowance runs.
 perform test_assert(winelens_reserve_usage(u,'free-over','label_scan',1,true)->>'reason'='token_limit','free without tokens cannot spend');
 perform test_assert(winelens_reserve_usage(u,'free-render','studio_render',1,true)->>'reason'='token_limit','free without tokens cannot render');
 -- Welcome tokens: once per account; spendable before any purchase (with consent).
 perform test_assert(winelens_grant_welcome(v)->>'granted'='3','welcome tokens');
 perform test_assert(winelens_grant_welcome(v)->>'replayed'='true','welcome once');
 perform test_assert(winelens_reserve_usage(v,'welcome-ask','studio_render',1,false)->>'reason'='consent_required','welcome tokens need consent');
 r:=winelens_reserve_usage(v,'welcome-render','studio_render',1,true);
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='2' and not (winelens_period(v)->>'pro')::boolean,'free spends welcome tokens');
 perform winelens_settle_usage(v,(r->>'reservation_id')::uuid,true);
 perform winelens_auto_spend(v,true); perform winelens_auto_spend(v,false);
 perform public.test_assert(winelens_grant_tokens(u,'cs_pack','t5',100)->>'granted'='100','grant');
 perform public.test_assert(winelens_grant_tokens(u,'cs_pack','t5',100)->>'replayed'='true','grant replay');
 begin perform winelens_grant_tokens(v,'cs_pack','t5',100); raise exception 'FAIL grant mismatch accepted'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 begin perform winelens_grant_tokens(u,'cs_wrong','t5',500); raise exception 'FAIL wrong units accepted'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 -- The first pack unlocks wineLENS for life: larger allowances, no end date.
 perform test_assert((winelens_period(u)->>'pro')::boolean and (select plan='pro' and status='active' and period_end='infinity' from winelens_entitlements where user_id=u),'first pack unlocks for life');
 r:=winelens_reserve_usage(u,'pro-sixty','label_scan',60,false); perform winelens_settle_usage(u,(r->>'reservation_id')::uuid,true);
 perform test_assert(winelens_reserve_usage(u,'need-consent','label_scan',1,false)->>'reason'='consent_required','consent');
 r:=winelens_reserve_usage(u,'paid','label_scan',1,true); rid:=(r->>'reservation_id')::uuid;
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='99','tokens charged hold');
 perform winelens_settle_usage(u,rid,true); perform winelens_settle_usage(u,rid,true);
 perform test_assert((select count(*)=1 from winelens_token_ledger where reservation_id=rid and event='commit'),'settle replay');
 perform winelens_auto_spend(u,true);
 r:=winelens_reserve_usage(u,'auto','label_scan',1,false); perform test_assert(r->>'allowed'='true','auto spend');
 perform winelens_settle_usage(u,(r->>'reservation_id')::uuid,false);
 r:=winelens_reserve_usage(u,'expire','label_scan',1,false);
 update winelens_token_reservations set expires_at=now()-interval '1 second' where id=(r->>'reservation_id')::uuid;
 perform test_assert(winelens_sweep_reservations(u)=1,'sweep');
 perform test_assert((select units=99 from winelens_token_wallets where user_id=u),'token release');
 update winelens_token_wallets set monthly_limit_units=1 where user_id=u;
 perform test_assert(winelens_reserve_usage(u,'limit','label_scan',1,true)->>'reason'='token_limit','monthly limit');
 update winelens_token_wallets set monthly_limit_units=null where user_id=u;
 -- Rate card v3: wine-list photo pages are included up to 20 a month, then 1 token each.
 r:=winelens_reserve_usage(u,'mixed','wine_list_page',22,true);
 perform test_assert(r->>'tokens'='97' and r->>'remaining_allowance'='0','allowance then tokens multi-quantity');
 perform winelens_settle_usage(u,(r->>'reservation_id')::uuid,false);
 r:=winelens_reserve_usage(u,'page-fail','wine_list_page',1,false);
 update winelens_token_reservations set expires_at=now()-interval '1 second' where id=(r->>'reservation_id')::uuid;
 perform winelens_sweep_reservations(u);
 perform test_assert(winelens_billing_status(u)->'allowances'->'wine_list_page'->>'remaining'='20','swept allowance');
 -- New bottle images have no allowance: 1 token each, with consent.
 perform test_assert(winelens_reserve_usage(u,'render-consent','studio_render',1,false)->>'reason' is null,'auto spend covers renders');
 begin update winelens_token_ledger set units=0; raise exception 'FAIL mutable ledger'; exception when insufficient_privilege then null; end;
 begin delete from winelens_token_ledger; raise exception 'FAIL deletable ledger'; exception when insufficient_privilege then null; end;
 perform winelens_grant_tokens(v,'cs_other','t10',220);
end$$;
reset role;
do $$begin
 begin update winelens_token_ledger set units=0; raise exception 'FAIL ledger trigger'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 begin delete from winelens_token_ledger; raise exception 'FAIL ledger delete trigger'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 begin update winelens_rate_cards set card='{}'; raise exception 'FAIL rate mutation'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
end$$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into auth.sessions(id,user_id) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
select set_config('request.jwt.claims','{"session_id":"33333333-3333-4333-8333-333333333333"}',false);
set role authenticated;
select test_assert((select count(*)=1 from winelens_token_wallets),'wallet RLS');
select test_assert((select count(*)=0 from winelens_token_ledger where user_id<>'11111111-1111-4111-8111-111111111111'),'ledger RLS');
select test_assert((select count(*)=0 from winelens_usage where user_id<>'11111111-1111-4111-8111-111111111111'),'usage RLS');
do $$declare r jsonb; again jsonb; begin
 begin insert into winelens_token_wallets(user_id,units) values(auth.uid(),999); raise exception 'FAIL user write'; exception when insufficient_privilege then null; end;
 begin perform winelens_grant_tokens(auth.uid(),'cs_hack','t5',100); raise exception 'FAIL user grant'; exception when insufficient_privilege then null; end;
 begin perform winelens_reserve_usage(auth.uid(),'hack','label_scan',1,true); raise exception 'FAIL general RPC'; exception when insufficient_privilege then null; end;
 r:=winelens_reserve_studio('44444444-4444-4444-8444-444444444444');
 again:=winelens_reserve_studio('44444444-4444-4444-8444-444444444444');
 perform test_assert(r->>'allowed'='true' and not (again ? 'receipt'),'receipt first reserve only');
 begin perform winelens_settle_studio((r->>'reservation_id')::uuid,false,gen_random_uuid()); raise exception 'FAIL wrong receipt'; exception when insufficient_privilege then null; end;
 perform test_assert(winelens_settle_studio((r->>'reservation_id')::uuid,true,(r->>'receipt')::uuid)->>'status'='committed','JWT settle');
end$$;
reset role;
-- Subscription ordering: older subscription events never replace a newer one.
do $$declare u uuid:='22222222-2222-4222-8222-222222222222'; sub jsonb; r jsonb; begin
 sub:=jsonb_build_object('id','sub_new','status','active','price','price_monthly','customer','cus_two','created',200,'start',now()-interval '1 day','end',now()+interval '1 month','cancel_at_period_end',false);
 perform winelens_sync_subscription(u,sub,300,'evt_new');
 r:=winelens_sync_subscription(u,sub||'{"id":"sub_old","created":100,"status":"canceled"}',400,'evt_old_delete');
 perform test_assert(r->>'ignored'='true','older subscription deletion');
 r:=winelens_sync_subscription(u,sub||'{"id":"sub_old","created":100}',500,'evt_old_active');
 perform test_assert(r->>'ignored'='true','older active subscription');
 r:=winelens_sync_subscription(u,sub||'{"status":"past_due"}',299,'evt_old_update');
 perform test_assert(r->>'ignored'='true','older same-sub update');
 perform test_assert((select plan='pro' and subscription_id='sub_new' from winelens_entitlements where user_id=u),'mirror intact');
 -- Annual plan monthly anniversary, not calendar month and not once a year.
 update winelens_entitlements set period_start=now()-interval '2 months 5 days',period_end=now()+interval '10 months' where user_id=u;
 r:=winelens_period(u);
 perform test_assert((r->>'start')::timestamptz>now()-interval '1 month' and (r->>'end')::timestamptz<=now()+interval '1 month','annual monthly reset');
 -- Cached scan response and charge commit together; changed-photo replays fail.
 r:=winelens_begin_scan(u,'55555555-5555-4555-8555-555555555555','photo-a',false);
 perform winelens_finish_scan(u,'55555555-5555-4555-8555-555555555555',(r->>'reservation_id')::uuid,'{"wine_name":"Cached"}');
 r:=winelens_begin_scan(u,'55555555-5555-4555-8555-555555555555','photo-a',false);
 perform test_assert(r->>'replayed'='true' and r->'result'->>'wine_name'='Cached','cached scan');
 perform test_assert(winelens_begin_scan(u,'55555555-5555-4555-8555-555555555555','photo-b',false)->>'reason'='request_mismatch','fingerprint binding');
end$$;
-- A JWT cannot settle another user's Studio reservation or use a revoked session.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
do $$begin
 begin perform winelens_reserve_studio(gen_random_uuid(),true); raise exception 'FAIL wrong session owner'; exception when insufficient_privilege then null; end;
end$$;
reset role;
-- Deletion with billing data retains the immutable ledger, removes private data.
do $$declare u uuid:='11111111-1111-4111-8111-111111111111'; begin
 perform wl_prepare_deletion(u,'33333333-3333-4333-8333-333333333333');
 perform test_assert(wl_issue_code(u,repeat('e',64))->>'status'='deleting','deletion blocks linking');
 perform test_assert(winelens_reserve_usage(u,'deleted','label_scan',1,true)->>'reason'='deleting','deletion blocks spend');
 delete from auth.users where id=u;
 perform test_assert(not exists(select 1 from profiles where id=u) and not exists(select 1 from winelens_token_wallets where user_id=u) and not exists(select 1 from wl_linked_devices where user_id=u),'delete cascades');
 perform test_assert(exists(select 1 from winelens_token_ledger where user_id=u),'financial audit retained');
end$$;
drop function public.test_assert(boolean,text);
