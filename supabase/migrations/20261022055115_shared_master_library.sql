-- Public facts are shared automatically. Personal observations, ratings and account identity never leave user_collection.
alter table public.wl_community_wines add column if not exists color text not null default '';
alter table public.wl_community_wines add column if not exists tasting_notes text not null default '';

create or replace function sommni_private.publish_saved_wine() returns trigger
language plpgsql security definer set search_path='' as $$
declare label public.sommni_wines; master_id text;
begin
 select w.* into label from public.sommni_wines w join public.sommni_vintages v on v.wine_id=w.id where v.id=new.canonical_vintage_id;
 if label.id is null or label.catalog_id is not null then return new; end if;
 master_id:='community-'||label.id::text;
 insert into public.wines(id,name,producer,region,country,grape,color,tasting_notes,metadata)
 values(master_id,new.wine_name,new.producer,new.region,new.country,new.grape,lower(new.color),new.tasting_notes,
 jsonb_build_object('source','community','canonical_wine_id',label.id,'community_wine_id',new.id,'verification','Community supplied · details may need confirmation','reference_url',new.reference_url,'hidden',new.status='declined'))
 on conflict(id) do update set
 region=case when wines.region is null or wines.region='' then excluded.region else wines.region end,
 country=case when wines.country is null or wines.country='' then excluded.country else wines.country end,
 grape=case when wines.grape is null or wines.grape='' then excluded.grape else wines.grape end,
 color=case when wines.color is null or wines.color='' then excluded.color else wines.color end,
 tasting_notes=case when wines.tasting_notes is null or wines.tasting_notes='' then excluded.tasting_notes else wines.tasting_notes end,
 metadata=wines.metadata||jsonb_build_object('hidden',new.status='declined'),updated_at=now();
 return new;
end $$;
revoke all on function sommni_private.publish_saved_wine() from public,anon,authenticated;
create trigger sommni_publish_saved_wine after insert or update on public.wl_community_wines for each row execute function sommni_private.publish_saved_wine();

create or replace function sommni_private.capture_collection_wine() returns trigger
language plpgsql security definer set search_path='' as $$
declare unit uuid; community_id uuid; vintage_key text; producer_name text; reference text; catalog text;
begin
 if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Collection owner mismatch'; end if;
 producer_name:=coalesce(nullif(trim(new.producer),''),'Unknown producer');
 vintage_key:=case when new.vintage is not null then new.vintage::text when new.metadata->>'vintage_state'='non_vintage' then 'NV' else 'unknown' end;
 select catalog_id into catalog from public.sommni_wines where catalog_id=new.wine_id;
 unit:=sommni_private.resolve_wine(new.wine_name,producer_name,vintage_key,coalesce(new.metadata->>'country',''),catalog);
 select id into community_id from public.wl_community_wines where canonical_vintage_id=unit order by created_at limit 1;
 reference:=coalesce(new.metadata->'research_sources'->'sources'->0->>'url','');
 if reference !~ '^https://' then reference:=''; end if;
 if community_id is null then
  insert into public.wl_community_wines(identity_key,wine_name,producer,vintage,country,region,grape,reference_url,details,status,catalog_match,color,tasting_notes)
  values('saved:'||unit::text,left(new.wine_name,200),left(producer_name,160),vintage_key,left(coalesce(new.metadata->>'country',''),100),left(coalesce(new.region,''),150),left(coalesce(new.metadata->>'grape',''),150),left(reference,600),'','pending',catalog,left(coalesce(new.metadata->>'color',''),30),left(coalesce(new.metadata->>'tasting_notes',''),12000))
  on conflict(identity_key) do nothing;
 else
  update public.wl_community_wines set color=case when color='' then left(coalesce(new.metadata->>'color',''),30) else color end,
   tasting_notes=case when tasting_notes='' then left(coalesce(new.metadata->>'tasting_notes',''),12000) else tasting_notes end where id=community_id;
 end if;
 return new;
end $$;
revoke all on function sommni_private.capture_collection_wine() from public,anon,authenticated;
create trigger sommni_capture_collection_wine after insert or update of wine_name,producer,vintage,region,metadata on public.user_collection for each row execute function sommni_private.capture_collection_wine();

-- Preserve every historical submission and image; the canonical label is inserted once.
update public.wl_community_wines set updated_at=updated_at;
update public.user_collection set metadata=metadata;
