-- Expand the existing service-only cache; no user grants or collection access.
alter table public.wl_beta_content drop constraint wl_beta_content_kind_check;
alter table public.wl_beta_content add constraint wl_beta_content_kind_check check(kind in ('daily','translation','research'));
create or replace function public.wl_beta_claim_content(p_key text,p_kind text,p_locale text,p_lease uuid)
returns boolean language plpgsql set search_path='' as $$
declare affected integer;
begin
 if p_kind not in ('daily','translation','research') or length(p_key)>160 then raise exception 'Invalid cache key'; end if;
 insert into public.wl_beta_content(cache_key,kind,locale,lease_id,lease_until)
 values(p_key,p_kind,p_locale,p_lease,now()+interval '3 minutes')
 on conflict(cache_key) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until
 where public.wl_beta_content.payload is null and public.wl_beta_content.lease_until<now();
 get diagnostics affected=row_count; return affected=1;
end $$;
revoke all on function public.wl_beta_claim_content(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.wl_beta_claim_content(text,text,text,uuid) to service_role;
