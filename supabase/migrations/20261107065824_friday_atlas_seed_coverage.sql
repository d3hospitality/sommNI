-- Original catalog lives in bundled data; it does not require a community master row.
create or replace function sommni_private.atlas_valid_wines()
returns table(id uuid,catalog_id text,wine_name text,producer text,country_code text,region_id text)
language sql stable set search_path='' as $$
 select w.id,w.catalog_id,w.wine_name,w.producer,
 coalesce(o.country_code,sommni_private.atlas_country(coalesce(nullif(m.country,''),w.country))),
 coalesce(o.region_id,sommni_private.atlas_resolve_region(sommni_private.atlas_country(coalesce(nullif(m.country,''),w.country)),m.region))
 from public.sommni_wines w
 left join sommni_private.atlas_origins o on o.wine_id=w.id
 left join public.wines m on m.id=coalesce(w.catalog_id,'community-'||w.id::text)
 where (w.catalog_id is not null or m.id is not null) and coalesce(m.metadata->>'hidden','false')!='true' and exists(
  select 1 from public.sommni_vintages v where v.wine_id=w.id and v.merged_into is null and
  (v.status in ('existing','accepted') or (m.id is not null and exists(
   select 1 from public.wl_community_wines c where c.canonical_vintage_id=v.id and c.status!='declined'
  )))
 )
$$;


