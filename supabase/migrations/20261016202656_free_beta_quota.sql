-- Only global usage counters; no guest accounts, library rows, photos or prompts.
create table public.wl_beta_usage (period_key text primary key, used integer not null check (used >= 0));
alter table public.wl_beta_usage enable row level security;
revoke all on public.wl_beta_usage from public, anon, authenticated;
grant select, insert, update, delete on public.wl_beta_usage to service_role;
create function public.wl_beta_reserve(p_weight integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare day_key text := 'day:' || to_char(now() at time zone 'UTC','YYYY-MM-DD');
minute_key text := 'minute:' || to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24-MI');
day_used integer; minute_used integer;
begin
 if p_weight not between 1 and 10 then raise exception 'invalid weight'; end if;
 perform pg_advisory_xact_lock(872406162);
 select used into day_used from public.wl_beta_usage where period_key = day_key;
 select used into minute_used from public.wl_beta_usage where period_key = minute_key;
 if coalesce(day_used,0)+p_weight>100 or coalesce(minute_used,0)+p_weight>20 then return false; end if;
 delete from public.wl_beta_usage where period_key not in (day_key,minute_key);
 insert into public.wl_beta_usage values (day_key,p_weight),(minute_key,p_weight)
 on conflict (period_key) do update set used=public.wl_beta_usage.used+excluded.used;
 return true;
end $$;
revoke all on function public.wl_beta_reserve(integer) from public, anon, authenticated;
grant execute on function public.wl_beta_reserve(integer) to service_role;
