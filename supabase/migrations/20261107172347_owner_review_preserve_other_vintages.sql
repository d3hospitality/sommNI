-- A correction request applies to this vintage only. Do not invoke label-wide
-- withdrawal for another vintage already present in the collective catalog.
create or replace function public.sommni_owner_review(vintage uuid,decision text,note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.sommni_vintages; credited uuid; result jsonb;
begin
 if not sommni_private.is_catalog_owner() then raise exception 'Owner access required' using errcode='42501';end if;
 if decision not in ('accepted','declined') or length(trim(coalesce(note,'')))<3 or length(note)>2000 then raise exception 'Choose a decision and record 3–2000 characters of review evidence';end if;
 perform pg_advisory_xact_lock(hashtextextended('sommni-review',0));
 select * into unit from public.sommni_vintages where id=vintage for update;
 if not found or unit.status!='pending' or unit.merged_into is not null then raise exception 'This wine has already been reviewed. Refresh the queue.';end if;
 insert into sommni_private.catalog_reviews(vintage_id,reviewer,decision,note,before_state) values(vintage,auth.uid(),decision,trim(note),to_jsonb(unit));
 if decision='accepted' then
  select c.id into credited from public.sommni_contributions c where c.vintage_id=vintage and c.status='pending' order by c.created_at,c.id limit 1;
  if credited is not null then
   result:=sommni_private.review_contribution(credited,'accepted',trim(note));
   update public.sommni_contributions set status='duplicate',reviewer_note='Already credited to the first verified submission.' where vintage_id=vintage and id<>credited and status='pending';
  end if;
  update public.sommni_vintages set status='accepted' where id=vintage;
 else
  update public.sommni_vintages set status='declined' where id=vintage;
  update public.sommni_contributions set status='declined',reviewer_note=trim(note) where vintage_id=vintage and status='pending';
 end if;
 -- No records are deleted. Accepted records enter the existing Friday queue.
 update public.wl_community_wines set status=case when decision='accepted' then 'accepted' else 'needs_details' end,reviewer_notes=trim(note),updated_at=now() where canonical_vintage_id=vintage;
 return jsonb_build_object('status',decision,'credited',credited is not null,'publication','Friday, 9 p.m. Eastern');
end $$;
