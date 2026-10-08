-- Winebrary storage/study on wineLENS, rate cards v2/v3, paid AI jobs, the app purchase and wine cards.
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
insert into auth.users(id,email) values ('66666666-6666-4666-8666-666666666666','notes@example.test'),('77777777-7777-4777-8777-777777777777','other@example.test');
do $$begin
 perform test_assert((select max(version)=3 from winelens_rate_cards),'rate card v3 current');
 perform test_assert((select card->'features' ?& array['label_scan','tasting_notes','studio_render','wine_list_page','wine_list_text'] from winelens_rate_cards where version=2),'v2 features');
 perform test_assert((select card->'features' ?& array['wine_card','label_scan','tasting_notes','studio_render','wine_list_page','wine_list_text','sommelier'] and (card->'features'->'sommelier'->>'free')::int=3 and (card->'features'->'wine_card'->>'tokens')::int=1 and (card->'welcome'->>'tokens')::int=3 and not card ? 'app' from winelens_rate_cards where version=3),'v3: wine cards, welcome tokens, no app fee');
 perform test_assert(not has_function_privilege('authenticated','public.winelens_grant_welcome(uuid)','execute') and to_regprocedure('public.winelens_grant_app(uuid,text,integer,integer)') is null,'welcome grant service only; no app purchase');
 perform test_assert(not has_function_privilege('authenticated','public.winelens_bottle_claim(text,uuid,uuid,jsonb)','execute') and not has_table_privilege('authenticated','public.winelens_shared_bottles','select'),'shared bottles service only');
 perform test_assert(not has_table_privilege('authenticated','public.winelens_list_entries','select') and not has_table_privilege('anon','public.winelens_catalog_proposals','select'),'list tables API-only');
 perform test_assert((select (a.card->'packs')=(b.card->'packs') from winelens_rate_cards a, winelens_rate_cards b where a.version=1 and b.version=2),'pack grants unchanged');
 perform test_assert(exists(select 1 from storage.buckets where id='winelens-bottles' and public=false),'private bottle bucket');
 perform test_assert((select count(*)=3 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'winelens_bottle_%'),'bottle read/insert/delete policies');
 perform test_assert(to_regclass('public.study_review_events') is not null,'study table');
 perform test_assert(has_table_privilege('authenticated','public.user_collection','insert'),'collection grants');
 perform test_assert(not has_table_privilege('authenticated','public.winelens_ai_jobs','select'),'jobs hidden from users');
 perform test_assert(not has_function_privilege('authenticated','public.winelens_begin_job(uuid,text,uuid,text,boolean,integer)','execute'),'begin_job service only');
 perform test_assert(not has_function_privilege('anon','public.winelens_finish_job(uuid,uuid,uuid,jsonb)','execute'),'finish_job service only');
 perform test_assert(not has_function_privilege('authenticated','public.winelens_share_claim(text,uuid,uuid,jsonb)','execute'),'share claim service only');
 perform test_assert(not has_table_privilege('authenticated','public.winelens_shared_notes','select'),'shared notes hidden from direct access');
end$$;
set role service_role;
do $$declare u uuid:='66666666-6666-4666-8666-666666666666'; v uuid:='77777777-7777-4777-8777-777777777777'; r jsonb; rid uuid; i int; begin
 -- Features not on the current card are refused.
 begin perform winelens_reserve_usage(u,'old','made_up_feature',1,true); raise exception 'FAIL unknown feature'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 -- Wine-list photo pages: Free has one page a month, so a 3-page list needs Pro.
 perform test_assert(winelens_begin_job(u,'wine_list_page',md5('list-free')::uuid,repeat('9',64),true,3)->>'reason'='token_limit','free without tokens: 3 photo pages need tokens');
 r:=winelens_begin_job(u,'wine_list_page',md5('list-one')::uuid,repeat('8',64),false,1);
 perform test_assert(r->>'source'='allowance','free: one photo page');
 perform winelens_finish_job(u,md5('list-one')::uuid,(r->>'reservation_id')::uuid,'{"entries":[]}');
 r:=winelens_begin_job(u,'wine_list_text',md5('list-text')::uuid,repeat('7',64),false,4);
 perform test_assert(r->>'source'='allowance' and r->>'remaining_allowance'='16','free: text pages from the larger allowance');
 perform winelens_finish_job(u,md5('list-text')::uuid,(r->>'reservation_id')::uuid,null);
 begin perform winelens_begin_job(u,'wine_list_page',gen_random_uuid(),repeat('6',64),true,21); raise exception 'FAIL 21 pages'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 begin perform winelens_begin_job(u,'label_scan',gen_random_uuid(),repeat('a',64),false); raise exception 'FAIL scan as job'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 -- Free: five tasting notes, then Pro is required; no Studio at all.
 for i in 1..5 loop
   r:=winelens_begin_job(u,'tasting_notes',md5('n'||i)::uuid,repeat('f',64),false);
   perform test_assert(r->>'allowed'='true' and r->>'source'='allowance','free note '||i);
   perform test_assert(winelens_finish_job(u,md5('n'||i)::uuid,(r->>'reservation_id')::uuid,'{"nose":"Cherry."}')->>'status'='committed','note commit '||i);
 end loop;
 perform test_assert(winelens_begin_job(u,'tasting_notes',md5('n6')::uuid,repeat('f',64),true)->>'reason'='token_limit','sixth free note needs tokens');
 perform test_assert(winelens_begin_job(u,'studio_render',md5('s1')::uuid,repeat('f',64),true)->>'reason'='token_limit','free without tokens has no Studio');
 perform test_assert(winelens_billing_status(u)->'allowances'->'tasting_notes'->>'remaining'='0','status shows notes used');
 -- Replay returns the stored result and never charges again; a changed input is refused.
 r:=winelens_begin_job(u,'tasting_notes',md5('n1')::uuid,repeat('f',64),false);
 perform test_assert(r->>'replayed'='true' and r->'result'->>'nose'='Cherry.' and r->>'status'='committed','job replay');
 perform test_assert(winelens_begin_job(u,'tasting_notes',md5('n1')::uuid,repeat('e',64),false)->>'reason'='request_mismatch','fingerprint binding');
 perform test_assert(winelens_begin_job(u,'studio_render',md5('n1')::uuid,repeat('f',64),false)->>'reason'='request_mismatch','feature binding');
 -- Sommelier picks: a free monthly allowance, no consent needed while it lasts.
 r:=winelens_begin_job(u,'sommelier',md5('som1')::uuid,repeat('s',64),false);
 perform test_assert(r->>'allowed'='true' and r->>'source'='allowance','sommelier from the allowance');
 perform test_assert(winelens_finish_job(u,md5('som1')::uuid,(r->>'reservation_id')::uuid,'{"wines":[]}')->>'status'='committed','sommelier commit');
 -- Free: wine cards are tokens only; the 3 welcome tokens make the first cards without a purchase.
 perform test_assert(winelens_begin_job(u,'wine_card',md5('card-free')::uuid,repeat('c',64),true)->>'reason'='token_limit','free without tokens: no cards');
 perform test_assert(winelens_grant_welcome(u)->>'granted'='3','welcome tokens');
 r:=winelens_begin_job(u,'wine_card',md5('card-welcome')::uuid,repeat('c',64),true);
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='2','welcome card charged 1');
 perform test_assert(winelens_finish_job(u,md5('card-welcome')::uuid,(r->>'reservation_id')::uuid,'{"path":"w.png"}')->>'status'='committed','welcome card commit');
 perform test_assert(not (winelens_period(u)->>'pro')::boolean,'still free');
 -- The first pack unlocks for life (one grant per Stripe session) and adds its tokens.
 perform test_assert(winelens_grant_tokens(u,'cs_first','t5',20)->>'unlocked'='true','first pack');
 perform test_assert(winelens_grant_tokens(u,'cs_first','t5',20)->>'replayed'='true','first pack replay');
 perform test_assert((winelens_period(u)->>'pro')::boolean and (select period_end='infinity' and status='active' from winelens_entitlements where user_id=u),'unlocked for life');
 perform test_assert((select units=22 from winelens_token_wallets where user_id=u),'welcome + pack tokens');
 perform test_assert(winelens_billing_status(u)->'allowances'->'tasting_notes'->>'remaining'='60','unlocked allowances');
 -- v3 packs grant their v3 units (the v1 mapping still reconciles old sessions).
 perform test_assert(winelens_grant_tokens(u,'cs_v3_pack','t20',100)->>'granted'='100','v3 pack');
 perform test_assert(winelens_grant_tokens(u,'cs_v3_big','t50',275)->>'granted'='275','v3 big pack');
 perform winelens_grant_tokens(u,'cs_ai_pack','t5',100);
 update winelens_token_wallets set units=100 where user_id=u;
 -- A wine card: 1 token with consent, every time; failures refund.
 r:=winelens_begin_job(u,'wine_card',md5('card1')::uuid,repeat('c',64),false);
 perform test_assert(r->>'reason'='consent_required' and r->>'cost'='1','card consent with cost');
 r:=winelens_begin_job(u,'wine_card',md5('card1')::uuid,repeat('c',64),true);
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='99','card charged 1');
 perform test_assert(winelens_finish_job(u,md5('card1')::uuid,(r->>'reservation_id')::uuid,'{"path":"x.png"}')->>'status'='committed','card commit');
 r:=winelens_begin_job(u,'wine_card',md5('card2')::uuid,repeat('c',64),true);
 perform test_assert(r->>'tokens'='98','same bottle again is charged again');
 perform test_assert(winelens_finish_job(u,md5('card2')::uuid,(r->>'reservation_id')::uuid,null)->>'status'='released','failed card releases');
 perform test_assert((select units=99 from winelens_token_wallets where user_id=u),'card token refunded');
 -- New bottle images: no allowance, 1 token with consent.
 r:=winelens_begin_job(u,'studio_render',md5('s11')::uuid,repeat('a',64),false);
 perform test_assert(r->>'reason'='consent_required' and r->>'cost'='1','render consent with cost');
 r:=winelens_begin_job(u,'studio_render',md5('s11')::uuid,repeat('a',64),true); rid:=(r->>'reservation_id')::uuid;
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='98','render charged 1');
 perform test_assert(winelens_finish_job(u,md5('s11')::uuid,rid,null)->>'status'='released','provider failure releases');
 perform test_assert((select units=99 from winelens_token_wallets where user_id=u),'render tokens refunded');
 perform test_assert((select result is null from winelens_ai_jobs where user_id=u and request_id=md5('s11')::uuid),'no result stored on failure');
 perform test_assert(winelens_begin_job(u,'studio_render',md5('s11')::uuid,repeat('a',64),true)->>'status'='released','failed job replay reports release');
 -- A job belongs to its owner.
 begin perform winelens_finish_job(v,md5('n1')::uuid,gen_random_uuid(),'{}'); raise exception 'FAIL foreign finish'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 -- Paid notes after the Pro allowance (60) use one token with consent.
 insert into winelens_usage(user_id,feature,period_start,used) values(u,'tasting_notes',(winelens_period(u)->>'start')::timestamptz,60)
 on conflict (user_id,feature,period_start) do update set used=60;
 r:=winelens_begin_job(u,'tasting_notes',md5('paid-note')::uuid,repeat('b',64),true);
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='98','paid note one token');
 -- Photo pages: 20 included, then 1 token a page (a 22-page list = 2 tokens).
 r:=winelens_begin_job(u,'wine_list_page',md5('pro-list')::uuid,repeat('c',64),true,20);
 perform winelens_finish_job(u,md5('pro-list')::uuid,(r->>'reservation_id')::uuid,'{"entries":[]}');
 r:=winelens_begin_job(u,'wine_list_page',md5('pro-list2')::uuid,repeat('c',64),true,2);
 perform test_assert(r->>'source'='tokens' and r->>'tokens'='96' and r->>'remaining_allowance'='0','list: allowance then tokens per page');
end$$;
-- Shared notes: one paid draft per bottle + vintage; later requests reuse it.
do $$declare u uuid:='66666666-6666-4666-8666-666666666666'; v uuid:='77777777-7777-4777-8777-777777777777'; k text:=repeat('a',64); b text:=repeat('b',64); r jsonb; begin
 r:=winelens_share_claim(k,u,md5('share1')::uuid,'{"name":"Grand Malbec","vintage":2017}');
 perform test_assert(r->>'status'='claimed','first request claims the bottle');
 perform test_assert(winelens_share_claim(k,v,md5('share2')::uuid,'{}')->>'status'='busy','second person waits while it is drafting');
 perform test_assert(winelens_share_claim(k,u,md5('share1')::uuid,'{}')->>'status'='claimed','same request retry keeps its claim');
 perform test_assert(winelens_share_fill(k,v,md5('share2')::uuid,'{"nose":"x"}')->>'filled'='false','only the claimer fills');
 perform test_assert(winelens_share_fill(k,u,md5('share1')::uuid,'{"nose":"Plum."}')->>'filled'='true','fill');
 r:=winelens_share_claim(k,v,md5('share3')::uuid,'{}');
 perform test_assert(r->>'status'='ready' and r->'notes'->>'nose'='Plum.','later person gets the stored notes');
 perform test_assert(winelens_share_claim(k,u,md5('share7')::uuid,'{}')->>'status'='ready','the payer asking again is not charged again');
 perform test_assert((select served=2 and wine->>'name'='Grand Malbec' from winelens_shared_notes where key=k),'served counted, identity kept');
 perform winelens_share_claim(b,u,md5('share4')::uuid,'{}');
 perform test_assert(winelens_share_release(b,u,md5('share4')::uuid)->>'released'='true','failed draft releases the bottle');
 perform test_assert(winelens_share_claim(b,v,md5('share5')::uuid,'{}')->>'status'='claimed','next person can claim after a release');
 update winelens_shared_notes set claimed_at=now()-interval '6 minutes' where key=b;
 perform test_assert(winelens_share_claim(b,u,md5('share6')::uuid,'{}')->>'status'='claimed','abandoned claim taken over after 5 minutes');
 perform test_assert(winelens_share_release(k,u,md5('share1')::uuid)->>'released'='false','ready notes are never released');
 begin perform winelens_share_claim('not-a-key',u,gen_random_uuid(),'{}'); raise exception 'FAIL bad key'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
end$$;
-- Shared bottle images: generated once per bottle + vintage, copied for every later card.
do $$declare u uuid:='66666666-6666-4666-8666-666666666666'; v uuid:='77777777-7777-4777-8777-777777777777'; k text:=repeat('c',64); r jsonb; begin
 perform test_assert(winelens_bottle_claim(k,u,md5('b1')::uuid,'{"name":"Barolo"}')->>'status'='claimed','first card claims the image');
 perform test_assert(winelens_bottle_claim(k,v,md5('b2')::uuid,'{}')->>'status'='busy','second waits while it renders');
 begin perform winelens_bottle_fill(k,u,md5('b1')::uuid,'7f/../x.png','gpt-image-2'); raise exception 'FAIL bad path'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 perform test_assert(winelens_bottle_fill(k,u,md5('b1')::uuid,'shared/'||k||'.png','gpt-image-2')->>'filled'='true','fill');
 r:=winelens_bottle_claim(k,v,md5('b3')::uuid,'{}');
 perform test_assert(r->>'status'='ready' and r->>'path'='shared/'||k||'.png','later card reuses the image');
 perform test_assert(winelens_bottle_release(k,u,md5('b1')::uuid)->>'released'='false','ready images are never released');
end$$;
-- Catalog proposals: one per wine, counted; approval adds it to the public catalog table.
do $$declare u uuid:='66666666-6666-4666-8666-666666666666'; k text:=repeat('d',64); r jsonb; begin
 perform test_assert(winelens_propose_wine(k,'{"producer":"Ameztoi","wine_name":"Txakoli Rosé"}','{"country":"ESP"}',u)->>'status'='pending','proposal');
 perform winelens_propose_wine(k,'{"producer":"Ameztoi","wine_name":"Txakoli Rosé"}','{}',u);
 perform test_assert((select seen=2 from winelens_catalog_proposals where wine_key=k),'repeat saves raise seen');
 begin perform winelens_decide_proposal(k,'approved','{}'); raise exception 'FAIL approve without row'; exception when raise_exception then if SQLERRM like 'FAIL%' then raise; end if; end;
 r:=winelens_decide_proposal(k,'approved','{"id":"ameztoi-txakoli-rose-dddddddd","name":"Txakoli Rosé","producer":"Ameztoi","region":"Getariako Txakolina, ES","country":"Spain","color":"rose"}');
 perform test_assert(r->>'catalog_id'='ameztoi-txakoli-rose-dddddddd','approved');
 perform test_assert(winelens_decide_proposal(k,'rejected',null)->>'replayed'='true','decisions are final');
 perform test_assert(winelens_propose_wine(k,'{}','{}',u)->>'status'='approved','an approved wine stays approved');
 perform test_assert(winelens_propose_wine(repeat('e',64),'{"producer":"X","wine_name":"Y"}','{}',u)->>'status'='pending','second proposal');
 perform test_assert(winelens_decide_proposal(repeat('e',64),'rejected',null)->>'status'='rejected','reject');
end$$;
reset role;
do $$begin
 delete from auth.users where id='66666666-6666-4666-8666-666666666666';
 perform test_assert(not exists(select 1 from winelens_ai_jobs where user_id='66666666-6666-4666-8666-666666666666'),'jobs cascade on account deletion');
 perform test_assert(exists(select 1 from winelens_shared_notes where key=repeat('a',64) and status='ready' and owner_user is null),'shared wine notes outlive the account, unowned');
 perform test_assert(exists(select 1 from winelens_catalog_proposals where wine_key=repeat('d',64) and first_user is null),'proposals outlive the account, unowned');
 perform test_assert(exists(select 1 from wines where id='ameztoi-txakoli-rose-dddddddd' and metadata->>'wine_key'=repeat('d',64) and metadata->>'source'='wine-list proposal'),'approved proposal is a public catalog row with provenance');
 perform test_assert((select count(*)=2 from ingest_wines_raw w join ingest_batches b on b.id=w.batch_id where b.source='wine-list proposal'),'every decision is in the truth funnel');
 perform test_assert(exists(select 1 from ingest_wines_raw where wine_id='ameztoi-txakoli-rose-dddddddd' and accepted and raw->'suggested'->>'producer'='Ameztoi'),'approved: raw suggestion linked to its catalog row');
 perform test_assert(exists(select 1 from ingest_wines_raw where wine_id is null and not accepted),'rejected: recorded, not accepted');
end$$;
drop function public.test_assert(boolean,text);
