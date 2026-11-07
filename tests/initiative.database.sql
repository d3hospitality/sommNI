-- Run within a transaction; fixtures and all reviews roll back.
insert into auth.users(id) values('00000000-0000-4000-a000-000000003715'),('00000000-0000-4000-b000-000000003715');
insert into public.sommni_members(user_id,handle,leaderboard_visible) values('00000000-0000-4000-a000-000000003715','Initiative test A',true),('00000000-0000-4000-b000-000000003715','Initiative test B',true);
select set_config('test.wine',(select catalog_id from public.sommni_wines where catalog_id is not null limit 1),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000003715","role":"authenticated"}',true);
set local role authenticated;
do $$declare result jsonb;begin
 begin perform public.sommni_review_save(current_setting('test.wine'),'','','2022',5,'',false);raise exception 'Consent bypass';exception when raise_exception then if sqlerrm='Consent bypass' then raise;end if;end;
 begin perform public.sommni_review_save(current_setting('test.wine'),'','','2022',6,'',true);raise exception 'Invalid stars accepted';exception when raise_exception then if sqlerrm='Invalid stars accepted' then raise;end if;end;
 perform public.sommni_review_save(current_setting('test.wine'),'','','2022',4,'Black cherry, balanced acidity and a long dry finish. This is a test note.',true);
 perform public.sommni_review_save(current_setting('test.wine'),'','','2022',5,'Black cherry, balanced acidity and a long dry finish. Updated test note.',true);
 result:=public.sommni_reviews(current_setting('test.wine'));
 if (result->>'count')::int<>1 or (result->>'average')::numeric<>5 or jsonb_array_length(result->'mine')<>1 then raise exception 'Duplicate or summary failure: %',result;end if;
 if (public.sommni_initiative_state()->>'points')::int<>3 then raise exception 'Points inflated by editing';end if;
 perform set_config('test.review',result->'mine'->0->>'id',true);
 begin perform count(*) from public.sommni_wine_reviews;raise exception 'Direct table accessible';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-b000-000000003715","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.sommni_review_remove(current_setting('test.review')::uuid);raise exception 'Other user removed review';exception when insufficient_privilege then null;end;
 if jsonb_array_length(public.sommni_reviews(current_setting('test.wine'))->'mine')<>0 then raise exception 'Other user received owner data';end if;
 perform public.sommni_review_report(current_setting('test.review')::uuid,'Test: incorrect vintage');
 perform public.sommni_review_report(current_setting('test.review')::uuid,'Test: updated report');
 perform public.sommni_review_save(current_setting('test.wine'),'','','2022',3,'',true);
 if (public.sommni_reviews(current_setting('test.wine'))->>'average')::numeric<>4 then raise exception 'Incorrect rating average';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$declare result jsonb;begin
 result:=public.sommni_reviews(current_setting('test.wine'));
 if (result->>'count')::int<>2 or result::text like '%user_id%' or result::text like '%email%' or jsonb_array_length(result->'mine')<>0 then raise exception 'Public feed privacy failure';end if;
 begin perform public.sommni_review_save(current_setting('test.wine'),'','','2022',5,'',true);raise exception 'Guest wrote review';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000003715","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 perform public.sommni_review_remove(current_setting('test.review')::uuid);
 if (public.sommni_initiative_state()->>'points')::int<>0 then raise exception 'Withdrawn review still earns points';end if;
 perform public.sommni_review_save(current_setting('test.wine'),'','','2022',4,'',true);
 if (public.sommni_initiative_state()->>'points')::int<>1 then raise exception 'Reposting inflated points';end if;
end $$;
reset role;
do $$begin if (select count(*) from public.sommni_review_reports where user_id='00000000-0000-4000-b000-000000003715')<>1 then raise exception 'Report duplication';end if;end $$;
select 'PASS: permissions, explicit publishing, owner isolation, unique vintages, points, reporting and withdrawal' result;
