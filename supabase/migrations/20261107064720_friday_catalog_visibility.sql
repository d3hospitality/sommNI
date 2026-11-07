-- Snapshot already-public vintages; future updates become visible only in a Friday release.
update public.wines m set metadata=m.metadata||jsonb_build_object('published_at',now(),'published_vintage_ids',(
 select coalesce(jsonb_agg(v.id::text),'[]'::jsonb) from public.sommni_vintages v where v.wine_id::text=m.metadata->>'canonical_wine_id' and v.merged_into is null
)) where id like 'community-%' and not (metadata ? 'published_vintage_ids');
create or replace function sommni_private.publish_community_wine(candidate public.wl_community_wines) returns void
language plpgsql security invoker set search_path='' as $$
declare label public.sommni_wines; master_id text;
begin
 select w.* into label from public.sommni_wines w join public.sommni_vintages v on v.wine_id=w.id where v.id=candidate.canonical_vintage_id;
 if label.id is null or label.catalog_id is not null then return; end if;
 master_id:='community-'||label.id::text;
 insert into public.wines(id,name,producer,region,country,grape,color,tasting_notes,metadata)
 values(master_id,candidate.wine_name,candidate.producer,candidate.region,candidate.country,candidate.grape,lower(candidate.color),candidate.tasting_notes,
 jsonb_build_object('source','community','canonical_wine_id',label.id,'community_wine_id',candidate.id,'verification','Community supplied · details may need confirmation','reference_url',candidate.reference_url,'hidden',candidate.status='declined')||candidate.beverage_metadata)
 on conflict(id) do update set
 region=case when wines.region is null or wines.region='' then excluded.region else wines.region end,
 country=case when wines.country is null or wines.country='' then excluded.country else wines.country end,
 grape=case when wines.grape is null or wines.grape='' then excluded.grape else wines.grape end,
 color=case when wines.color is null or wines.color='' then excluded.color else wines.color end,
 tasting_notes=case when wines.tasting_notes is null or wines.tasting_notes='' then excluded.tasting_notes else wines.tasting_notes end,
 metadata=wines.metadata||jsonb_strip_nulls(candidate.beverage_metadata)||jsonb_build_object('hidden',candidate.status='declined'),updated_at=now();
 update public.wines m set metadata=m.metadata||jsonb_build_object('published_at',now(),'published_vintage_ids',(
 select coalesce(jsonb_agg(distinct id),'[]'::jsonb) from (
 select jsonb_array_elements_text(coalesce(m.metadata->'published_vintage_ids','[]'::jsonb)) id
 union select id::text from public.sommni_vintages where wine_id=label.id and status='accepted' and merged_into is null
 ) released)) where m.id=master_id;
 return;
end $$;

