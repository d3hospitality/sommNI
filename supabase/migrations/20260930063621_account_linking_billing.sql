-- Pairing and Stripe ownership are server-only. No user can mint sessions,
-- edit billing ownership, or grant themselves Pro through PostgREST.
create table public.winelens_link_codes (
  code_hash text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
create table public.winelens_rate_buckets (
  bucket_key text primary key,
  started_at timestamptz not null default now(),
  attempts integer not null default 1
);
create index winelens_rate_buckets_expiry on public.winelens_rate_buckets(started_at);
create table public.winelens_billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id text not null unique check (customer_id like 'cus_%'),
  created_at timestamptz not null default now()
);
create table public.winelens_checkout_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'annual')),
  attempt_id uuid not null default gen_random_uuid(),
  expires_at timestamptz not null
);

alter table public.winelens_link_codes enable row level security;
alter table public.winelens_rate_buckets enable row level security;
alter table public.winelens_billing_customers enable row level security;
alter table public.winelens_checkout_attempts enable row level security;
revoke all on public.winelens_link_codes, public.winelens_rate_buckets,
  public.winelens_billing_customers, public.winelens_checkout_attempts from anon, authenticated;
grant all on public.winelens_link_codes, public.winelens_rate_buckets,
  public.winelens_billing_customers, public.winelens_checkout_attempts to service_role;

-- Atomic across all edge workers. Infrastructure failure must deny the request.
create function public.winelens_take_rate(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_seconds < 1 then return false; end if;
  insert into public.winelens_rate_buckets(bucket_key) values(p_key)
  on conflict(bucket_key) do update set
    attempts = case when public.winelens_rate_buckets.started_at <= now() - make_interval(secs => p_seconds)
      then 1 else public.winelens_rate_buckets.attempts + 1 end,
    started_at = case when public.winelens_rate_buckets.started_at <= now() - make_interval(secs => p_seconds)
      then now() else public.winelens_rate_buckets.started_at end
  returning attempts into n;
  return n <= p_limit;
end $$;

create function public.winelens_mint_link(p_user uuid, p_hash text)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare expiry timestamptz := now() + interval '10 minutes';
begin
  delete from public.winelens_link_codes where expires_at < now();
  delete from public.winelens_rate_buckets where started_at < now() - interval '1 day';
  insert into public.winelens_link_codes(code_hash, user_id, expires_at) values(p_hash, p_user, expiry)
  on conflict(user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  return expiry;
end $$;

create function public.winelens_claim_link(p_hash text)
returns uuid language sql security invoker set search_path = '' as $$
  delete from public.winelens_link_codes where code_hash = p_hash and expires_at > now() returning user_id;
$$;

-- One checkout attempt per account at a time. Its UUID becomes Stripe's
-- idempotency key; repeat taps cannot create parallel subscriptions.
create function public.winelens_reserve_checkout(p_user uuid, p_plan text)
returns public.winelens_checkout_attempts language plpgsql security invoker set search_path = '' as $$
declare attempt public.winelens_checkout_attempts;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into attempt from public.winelens_checkout_attempts where user_id = p_user;
  if found and attempt.expires_at > now() then return attempt; end if;
  insert into public.winelens_checkout_attempts(user_id, plan, expires_at)
  values(p_user, p_plan, date_trunc('second', now()) + interval '31 minutes')
  on conflict(user_id) do update set plan = excluded.plan, attempt_id = gen_random_uuid(), expires_at = excluded.expires_at
  returning * into attempt;
  return attempt;
end $$;

revoke all on function public.winelens_take_rate(text, integer, integer),
  public.winelens_mint_link(uuid, text), public.winelens_claim_link(text),
  public.winelens_reserve_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.winelens_take_rate(text, integer, integer),
  public.winelens_mint_link(uuid, text), public.winelens_claim_link(text),
  public.winelens_reserve_checkout(uuid, text) to service_role;
