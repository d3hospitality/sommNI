-- Saving a researched discovery in the Even app also queues account credit.
-- Missing provenance never blocks a local/account save; it can be added later.
create function sommni_private.record_saved_discovery_credit() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid; unit uuid; year_key text; source text; country_name text; label_status text;
begin
 if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Account changed' using errcode='42501'; end if;
 w:=sommni_private.review_wine(coalesce(new.wine_id,''),new.wine_name,coalesce(new.producer,''));
 if w is null then return new; end if;
 year_key:=case when new.vintage is not null then new.vintage::text when new.metadata->>'vintage_state' in ('non_vintage','NV') then 'NV' else 'unknown' end;
 select id,status into unit,label_status from public.sommni_vintages where wine_id=w and vintage_key=year_key and merged_into is null;
 if unit is null or label_status in ('existing','accepted','merged') then return new; end if;
 source:=coalesce(new.metadata->'research_sources'->'sources'->0->>'url','');country_name:=coalesce(new.metadata->>'country','');
 if source!~'^https://' then select coalesce(reference_url,'') into source from public.wl_community_wines where canonical_vintage_id=unit and reference_url like 'https://%' order by created_at limit 1;end if;
 if length(country_name)<2 then select country into country_name from public.sommni_wines where id=w;end if;
 if coalesce(source,'')!~'^https://' or coalesce(length(country_name),0)<2 or length(coalesce(new.producer,''))<2 then return new;end if;
 insert into public.sommni_members(user_id,handle) values(new.user_id,'Cellar-'||left(replace(new.user_id::text,'-',''),20)) on conflict(user_id) do nothing;
 insert into public.sommni_contributions(user_id,vintage_id,wine_name,producer,country,reference_url,details)
 values(new.user_id,unit,left(new.wine_name,200),left(new.producer,160),left(country_name,100),left(source,600),'')
 on conflict(user_id,vintage_id) do update set reference_url=case when sommni_contributions.reference_url='' then excluded.reference_url else sommni_contributions.reference_url end;
 return new;
end $$;
revoke all on function sommni_private.record_saved_discovery_credit() from public,anon,authenticated;
create trigger sommni_record_discovery_credit after insert or update of wine_name,producer,vintage,region,metadata on public.user_collection for each row execute function sommni_private.record_saved_discovery_credit();
update public.user_collection set metadata=metadata;
-- Align existing submission receipts with the Initiative points scale.
do $$declare definition text;begin
 select pg_get_functiondef('sommni_private.submit_wine(text,text,text,text,text,text,boolean)'::regprocedure) into definition;
 execute replace(definition,'One validated wine and vintage earns one contribution point','One verified new wine and vintage earns 10 Initiative points');
end $$;
