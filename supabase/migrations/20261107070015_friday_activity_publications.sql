-- Preserve activity already visible before this release; future events require publication.
insert into sommni_private.friday_publications(vintage_id,published_at)
select id,added_at from sommni_private.atlas_activity() on conflict do nothing;
create or replace function sommni_private.atlas_activity()
returns table(id uuid,wine_id uuid,wine_name text,producer text,vintage text,country_code text,region_id text,added_at timestamptz)
language sql stable set search_path='' as $$
 select v.id,w.id,w.wine_name,w.producer,v.vintage_key,w.country_code,w.region_id,coalesce(min(pub.published_at),min(c.created_at))
 from public.wl_community_wines c
 join public.sommni_vintages v on v.id=c.canonical_vintage_id
 join sommni_private.friday_publications pub on pub.vintage_id=v.id
 join sommni_private.atlas_valid_wines() w on w.id=v.wine_id
 where c.status!='declined' and v.status not in ('existing','declined','merged') and v.merged_into is null
 group by v.id,w.id,w.wine_name,w.producer,v.vintage_key,w.country_code,w.region_id
$$;

