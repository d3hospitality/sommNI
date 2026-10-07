-- Winebrary storage/study on wineLENS, rate card v2 and paid AI jobs (20261007190000).
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
insert into auth.users(id,email) values ('66666666-6666-4666-8666-666666666666','notes@example.test'),('77777777-7777-4777-8777-777777777777','other@example.test');
do $$begin
 perform test_assert((select max(version)=2 from winelens_rate_cards),'rate card v2 current');
 perform test_assert((select card->'features' ? 'tasting_notes' and not (card->'features' ? 'wine_list_page') from winelens_rate_cards where version=2),'v2 features');
 perform test_assert((select (a.card->'packs')=(b.card->'packs') from winelens_rate_cards a, winelens_rate_cards b where a.version=1 and b.version=2),'pack grants unchanged');
 perform test_assert(exists(select 1 from storage.buckets where id='winelens-bottles' and public=false),'private bottle bucket');
 perform test_assert((select count(*)=3 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'winelens_bottle_%'),'bottle read/insert/delete policies');
 perform test_assert(to_regclass('public.study_review_events') is not null,'study table');
 perform test_assert(has_table_privilege('authenticated','public.user_collection','insert'),'collection grants');
 perform test_assert(not has_table_privilege('authenticated','public.winelens_ai_jobs','select'),'jobs hidden from users');
 perform test_assert(not has_function_privilege('authenticated','public.winelens_begin_job(uuid,text,uuid,text,boolean)','execute'),'begin_job service only');
 perform test_assert(not has_function_privilege('anon','public.winelens_finish_job(uuid,uuid,uuid,jsonb)','execute'),'finish_job service only');
end$$;
set role service_role;
do $$declare u uuid:='66666666-6666-4666-8666-666666666666'; v uuid:='77777777-7777-4777-8777-777777777777'; r jsonb; rid uuid; i int; begin
 -- Retired v1 feature is refused; unknown features too.
 begin perform winelens_reserve_usage(u,'old','wine_list_page',1,true); raise exception 'FAIL retired feature'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 begin perform winelens_begin_job(u,'label_scan',gen_random_uuid(),repeat('a',64),false); raise exception 'FAIL scan as job'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 -- Free: five tasting notes, then Pro is required; no Studio at all.
 for i in 1..5 loop
   r:=winelens_begin_job(u,'tasting_notes',md5('n'||i)::uuid,repeat('f',64),false);
   perform test_assert(r->>'allowed'='true' and r->>'source'='allowance','free note '||i);
   perform test_assert(winelens_finish_job(u,md5('n'||i)::uuid,(r->>'reservation_id')::uuid,'{"nose":"Cherry."}')->>'status'='committed','note commit '||i);
 end loop;
 perform test_assert(winelens_begin_job(u,'tasting_notes',md5('n6')::uuid,repeat('f',64),true)->>'reason'='pro_required','sixth free note needs Pro');
 perform test_assert(winelens_begin_job(u,'studio_render',md5('s1')::uuid,repeat('f',64),true)->>'reason'='pro_required','free has no Studio');
 perform test_assert(winelens_billing_status(u)->'allowances'->'tasting_notes'->>'remaining'='0','status shows notes used');
 -- Replay returns the stored result and never charges again; a changed input is refused.
 r:=winelens_begin_job(u,'tasting_notes',md5('n1')::uuid,repeat('f',64),false);
 perform test_assert(r->>'replayed'='true' and r->'result'->>'nose'='Cherry.' and r->>'status'='committed','job replay');
 perform test_assert(winelens_begin_job(u,'tasting_notes',md5('n1')::uuid,repeat('e',64),false)->>'reason'='request_mismatch','fingerprint binding');
 perform test_assert(winelens_begin_job(u,'studio_render',md5('n1')::uuid,repeat('f',64),false)->>'reason'='request_mismatch','feature binding');
 -- Pro: Studio allowance first, then consent-gated tokens; failures refund.
 insert into winelens_entitlements(user_id,plan,status,period_start,period_end) values(u,'pro','active',now()-interval '1 day',now()+interval '1 month');
 perform winelens_grant_tokens(u,'cs_ai_pack','t5',100);
 for i in 1..10 loop
   r:=winelens_begin_job(u,'studio_render',md5('s'||i)::uuid,repeat('a',64),false);
   perform winelens_finish_job(u,md5('s'||i)::uuid,(r->>'reservation_id')::uuid,'{"path":"x.png"}');
 end loop;
 r:=winelens_begin_job(u,'studio_render',md5('s11')::uuid,repeat('a',64),false);
 perform test_assert(r->>'reason'='consent_required' and r->>'cost'='8','render consent with cost');
 r:=winelens_begin_job(u,'studio_render',md5('s11')::uuid,repeat('a',64),true); rid:=(r->>'reservation_id')::uuid;
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='92','render charged 8');
 perform test_assert(winelens_finish_job(u,md5('s11')::uuid,rid,null)->>'status'='released','provider failure releases');
 perform test_assert((select units=100 from winelens_token_wallets where user_id=u),'render tokens refunded');
 perform test_assert((select result is null from winelens_ai_jobs where user_id=u and request_id=md5('s11')::uuid),'no result stored on failure');
 perform test_assert(winelens_begin_job(u,'studio_render',md5('s11')::uuid,repeat('a',64),true)->>'status'='released','failed job replay reports release');
 -- A job belongs to its owner.
 begin perform winelens_finish_job(v,md5('n1')::uuid,gen_random_uuid(),'{}'); raise exception 'FAIL foreign finish'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 -- Paid notes after the Pro allowance (60) use one token with consent.
 insert into winelens_usage(user_id,feature,period_start,used) values(u,'tasting_notes',(winelens_period(u)->>'start')::timestamptz,60)
 on conflict (user_id,feature,period_start) do update set used=60;
 r:=winelens_begin_job(u,'tasting_notes',md5('paid-note')::uuid,repeat('b',64),true);
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='99','paid note one token');
end$$;
reset role;
do $$begin
 delete from auth.users where id='66666666-6666-4666-8666-666666666666';
 perform test_assert(not exists(select 1 from winelens_ai_jobs where user_id='66666666-6666-4666-8666-666666666666'),'jobs cascade on account deletion');
end$$;
drop function public.test_assert(boolean,text);
