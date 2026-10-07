-- wineLENS: one backend for Winebrary, study and paid AI help.
-- 1. Winebrary photos and study reviews move onto the wineLENS project (they were only ever
--    written for the separate sommni-api, which still pointed at d3-shared).
-- 2. Rate card v2: tasting notes become a metered feature; wine-list reading is split into photo
--    pages and text pages (v1 stays immutable for history/pack grants).
-- 3. AI jobs: one row per paid request. Replays return the stored result and never charge twice.
-- 4. Shared tasting notes: the first paid draft for a bottle + vintage is reused for free by everyone after.
-- 5. Wine-list uploads → review → Winebrary, and catalog proposals that Romario approves.
-- Additive. Safe if sommni-api's bottle/study migrations were already applied.
begin;

-- ── 1a. Winebrary rows (table from 0001). Explicit grants for projects without auto-exposure.
alter table public.user_collection enable row level security;
grant select, insert, update, delete on public.user_collection to authenticated;
create index if not exists user_collection_user_idx on public.user_collection (user_id, created_at desc);

-- ── 1b. Private bottle photos: <user>/<collection row>/<random>.<ext>, immutable paths.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('winelens-bottles', 'winelens-bottles', false, 8388608, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "winelens_bottle_read_own" on storage.objects;
create policy "winelens_bottle_read_own" on storage.objects for select to authenticated
using (bucket_id = 'winelens-bottles' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "winelens_bottle_insert_own" on storage.objects;
create policy "winelens_bottle_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'winelens-bottles' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.user_collection c where c.id::text = (storage.foldername(name))[2] and c.user_id = (select auth.uid())));
-- Removing a wine removes its photos (the API deletes the row's folder with the caller's JWT).
drop policy if exists "winelens_bottle_delete_own" on storage.objects;
create policy "winelens_bottle_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'winelens-bottles' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 1c. Study review events (immutable log; identical contract to sommni-api 20260930090000).
create table if not exists public.study_review_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  card_id text not null check (char_length(card_id) between 1 and 120),
  card_version integer not null check (card_version >= 1),
  mode text not null check (mode in ('recall', 'recognition')),
  rating text check (rating in ('again', 'hard', 'good', 'easy')),
  correct boolean,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  tz_offset_min smallint not null check (tz_offset_min between -840 and 840),
  duration_ms integer not null default 0 check (duration_ms between 0 and 86400000),
  device text not null check (device in ('phone', 'g2')),
  scheduler_version text not null check (char_length(scheduler_version) between 1 and 40),
  primary key (user_id, event_id),
  constraint study_review_rating_matches_mode check (
    (mode = 'recall' and rating is not null) or (mode = 'recognition' and rating is null)
  )
);
create index if not exists study_review_events_user_time on public.study_review_events (user_id, occurred_at);
alter table public.study_review_events enable row level security;
revoke all on public.study_review_events from anon, authenticated;
grant select, insert on public.study_review_events to authenticated;
drop policy if exists "study_review_read_own" on public.study_review_events;
create policy "study_review_read_own" on public.study_review_events for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "study_review_insert_own" on public.study_review_events;
create policy "study_review_insert_own" on public.study_review_events for insert to authenticated
with check (user_id = (select auth.uid()));

-- ── 2a. Rate card v2 (kept identical to shared/rate-card.json; test:sql verifies parity).
insert into public.winelens_rate_cards(version, card) values (2, '{"version":2,"currency":"usd","plans":{"monthly":{"amount":499,"interval":"month"},"annual":{"amount":3999,"interval":"year"}},"features":{"label_scan":{"label":"Label scans","free":5,"pro":60,"tokens":1},"tasting_notes":{"label":"Tasting notes","free":5,"pro":60,"tokens":1},"studio_render":{"label":"Studio renderings","free":0,"pro":10,"tokens":8},"wine_list_page":{"label":"Wine-list photo pages","free":1,"pro":5,"tokens":3},"wine_list_text":{"label":"Wine-list text pages","free":20,"pro":100,"tokens":1}},"packs":{"t5":{"amount":500,"units":100},"t10":{"amount":1000,"units":220},"t15":{"amount":1500,"units":350},"t20":{"amount":2000,"units":500}}}')
on conflict (version) do nothing;

-- ── 2b. Reservations accept exactly the features on the current card (was a hard-coded list).
-- Body otherwise identical to 20260930182315; CREATE OR REPLACE keeps its service-only grants.
create or replace function public.winelens_reserve_usage(p_user uuid,p_key text,p_feature text,p_quantity integer,p_spend_consent boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.winelens_token_wallets; r public.winelens_token_reservations; rate public.winelens_rate_cards; period jsonb;
 cap integer; left_count integer; included integer; cost integer; spent integer; pending integer;
begin
 if p_user is null or p_key is null or length(p_key) not between 1 and 200 or p_feature is null or p_feature !~ '^[a-z_]{1,40}$' or p_quantity is null or p_quantity not between 1 and 100 then raise exception 'invalid usage'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 if exists(select 1 from public.wl_account_deletions where user_id=p_user) then return jsonb_build_object('allowed',false,'reason','deleting'); end if;
 perform public.winelens_sweep_reservations(p_user);
 insert into public.winelens_token_wallets(user_id) values(p_user) on conflict do nothing;
 select * into w from public.winelens_token_wallets where user_id=p_user;
 select * into r from public.winelens_token_reservations where user_id=p_user and key=p_key;
 if found then
 if r.feature<>p_feature or r.quantity<>p_quantity then raise exception 'request mismatch'; end if;
 return jsonb_build_object('allowed',false,'replayed',true,'status',r.status,'reservation_id',r.id,'tokens',w.units);
 end if;
 select * into rate from public.winelens_rate_cards where effective_at<=now() order by version desc limit 1;
 if not ((rate.card->'features') ? p_feature) then raise exception 'invalid usage'; end if;
 period:=public.winelens_period(p_user);
 cap:=(rate.card->'features'->p_feature->>case when (period->>'pro')::boolean then 'pro' else 'free' end)::integer;
 insert into public.winelens_usage(user_id,feature,period_start) values(p_user,p_feature,(period->>'start')::timestamptz) on conflict do nothing;
 select greatest(0,cap-used-reserved) into left_count from public.winelens_usage where user_id=p_user and feature=p_feature and period_start=(period->>'start')::timestamptz;
 included:=least(left_count,p_quantity); cost:=(p_quantity-included)*(rate.card->'features'->p_feature->>'tokens')::integer;
 if cost>0 then
 if not (period->>'pro')::boolean then return jsonb_build_object('allowed',false,'reason','pro_required','tokens',w.units,'remaining_allowance',left_count); end if;
 if not (w.auto_spend or coalesce(p_spend_consent,false)) then return jsonb_build_object('allowed',false,'reason','consent_required','tokens',w.units,'remaining_allowance',left_count,'cost',cost); end if;
 select coalesce(-sum(units),0) into spent from public.winelens_token_ledger where user_id=p_user and event='commit' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(units),0) into pending from public.winelens_token_reservations where user_id=p_user and status='reserved';
 if w.units<cost or (w.monthly_limit_units is not null and spent+pending+cost>w.monthly_limit_units) then return jsonb_build_object('allowed',false,'reason','token_limit','tokens',w.units,'remaining_allowance',left_count,'cost',cost); end if;
 end if;
 insert into public.winelens_token_reservations(user_id,key,feature,quantity,allowance,units,period_start,rate_version)
 values(p_user,p_key,p_feature,p_quantity,included,cost,(period->>'start')::timestamptz,rate.version) returning * into r;
 update public.winelens_usage set reserved=reserved+included where user_id=p_user and feature=p_feature and period_start=r.period_start;
 update public.winelens_token_wallets set units=units-cost where user_id=p_user;
 insert into public.winelens_token_ledger(user_id,key,event,units,feature,quantity,allowance,reservation_id,rate_version)
 values(p_user,r.id::text||':reserve','reserve',-cost,p_feature,p_quantity,included,r.id,rate.version);
 return jsonb_build_object('allowed',true,'source',case when cost>0 then 'tokens' else 'allowance' end,'reservation_id',r.id,'remaining_allowance',left_count-included,'tokens',w.units-cost);
end $$;

-- ── 3. Paid AI jobs (tasting notes, Studio renderings). Service role only.
-- The fingerprint binds a request ID to its input (wine identity / reference photo):
-- a replay returns the stored result, a changed input under the same ID is refused.
create table if not exists public.winelens_ai_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  feature text not null check (feature in ('tasting_notes','studio_render','wine_list_page','wine_list_text')),
  fingerprint text not null check (char_length(fingerprint) between 16 and 128),
  reservation_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.winelens_ai_jobs enable row level security;
revoke all on public.winelens_ai_jobs from public, anon, authenticated;
grant all on public.winelens_ai_jobs to service_role;

create or replace function public.winelens_begin_job(p_user uuid,p_feature text,p_request_id uuid,p_fingerprint text,p_consent boolean,p_quantity integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.winelens_ai_jobs; r jsonb;
begin
 if p_feature not in ('tasting_notes','studio_render','wine_list_page','wine_list_text') or p_request_id is null or p_fingerprint is null or p_quantity is null or p_quantity not between 1 and 20 then raise exception 'invalid job'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into previous from public.winelens_ai_jobs where user_id=p_user and request_id=p_request_id;
 if found then
   if previous.feature<>p_feature or previous.fingerprint<>p_fingerprint then return jsonb_build_object('allowed',false,'reason','request_mismatch'); end if;
   return jsonb_build_object('replayed',true,'result',previous.result,
     'status',(select status from public.winelens_token_reservations where id=previous.reservation_id));
 end if;
 r:=public.winelens_reserve_usage(p_user,'job:'||p_feature||':'||p_request_id::text,p_feature,p_quantity,p_consent);
 if (r->>'allowed')::boolean then
   insert into public.winelens_ai_jobs(user_id,request_id,feature,fingerprint,reservation_id)
   values(p_user,p_request_id,p_feature,p_fingerprint,(r->>'reservation_id')::uuid);
 end if;
 return r;
end $$;

-- Charge and stored result commit together. A null result releases the allowance/tokens.
create or replace function public.winelens_finish_job(p_user uuid,p_request_id uuid,p_reservation_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.winelens_ai_jobs; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens:'||p_user::text,0));
 select * into j from public.winelens_ai_jobs where user_id=p_user and request_id=p_request_id for update;
 if not found or j.reservation_id<>p_reservation_id then raise exception 'job mismatch'; end if;
 r:=public.winelens_settle_usage(p_user,p_reservation_id,p_result is not null);
 if r->>'status'='committed' then
   update public.winelens_ai_jobs set result=coalesce(result,p_result) where user_id=p_user and request_id=p_request_id;
 end if;
 return r;
end $$;

revoke all on function public.winelens_begin_job(uuid,text,uuid,text,boolean,integer) from public, anon, authenticated;
revoke all on function public.winelens_finish_job(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.winelens_begin_job(uuid,text,uuid,text,boolean,integer) to service_role;
grant execute on function public.winelens_finish_job(uuid,uuid,uuid,jsonb) to service_role;
-- ── 4. Shared tasting notes: one paid draft per bottle + vintage, reused by everyone after.
-- Key = sha256 of normalised producer | wine name | vintage (computed by the API).
-- The first request claims the key and is charged; later requests get the stored notes free.
-- A second request while the first is still drafting is told to wait (never charged twice).
-- Notes describe a wine, never a person: user edits stay in user_collection, not here.
create table if not exists public.winelens_shared_notes (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending','ready')),
  notes jsonb,
  wine jsonb not null default '{}'::jsonb,
  owner_user uuid references auth.users(id) on delete set null,
  owner_request uuid,
  claimed_at timestamptz not null default now(),
  ready_at timestamptz,
  served integer not null default 0,
  check ((status = 'ready') = (notes is not null))
);
alter table public.winelens_shared_notes enable row level security;
revoke all on public.winelens_shared_notes from public, anon, authenticated;
grant all on public.winelens_shared_notes to service_role;

create or replace function public.winelens_share_claim(p_key text,p_user uuid,p_request_id uuid,p_wine jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.winelens_shared_notes;
begin
 if p_key is null or p_key !~ '^[0-9a-f]{64}$' or p_user is null or p_request_id is null then raise exception 'invalid share'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-share:'||p_key,0));
 select * into s from public.winelens_shared_notes where key=p_key for update;
 if found and s.status='ready' then
   update public.winelens_shared_notes set served=served+1 where key=p_key;
   return jsonb_build_object('status','ready','notes',s.notes);
 end if;
 -- Someone else is drafting this bottle right now (claims older than 5 minutes are abandoned).
 if found and (s.owner_user is distinct from p_user or s.owner_request is distinct from p_request_id) and s.claimed_at>now()-interval '5 minutes' then
   return jsonb_build_object('status','busy');
 end if;
 insert into public.winelens_shared_notes(key,status,wine,owner_user,owner_request,claimed_at)
 values(p_key,'pending',coalesce(p_wine,'{}'::jsonb),p_user,p_request_id,now())
 on conflict(key) do update set owner_user=excluded.owner_user,owner_request=excluded.owner_request,claimed_at=excluded.claimed_at,
   wine=coalesce(nullif(excluded.wine,'{}'::jsonb),public.winelens_shared_notes.wine);
 return jsonb_build_object('status','claimed');
end $$;

create or replace function public.winelens_share_fill(p_key text,p_user uuid,p_request_id uuid,p_notes jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_notes is null then raise exception 'notes required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('winelens-share:'||p_key,0));
 update public.winelens_shared_notes set status='ready',notes=p_notes,ready_at=now()
 where key=p_key and status='pending' and owner_user=p_user and owner_request=p_request_id;
 return jsonb_build_object('filled',found);
end $$;

-- A refused or failed draft frees the bottle for the next person.
create or replace function public.winelens_share_release(p_key text,p_user uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('winelens-share:'||p_key,0));
 delete from public.winelens_shared_notes where key=p_key and status='pending' and owner_user=p_user and owner_request=p_request_id;
 return jsonb_build_object('released',found);
end $$;

revoke all on function public.winelens_share_claim(text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.winelens_share_fill(text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.winelens_share_release(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.winelens_share_claim(text,uuid,uuid,jsonb) to service_role;
grant execute on function public.winelens_share_fill(text,uuid,uuid,jsonb) to service_role;
grant execute on function public.winelens_share_release(text,uuid,uuid) to service_role;
-- ── 5. Wine-list uploads → review → Winebrary, and catalog proposals.
-- Photos/scans are billed per page (wine_list_page); text (PDF text layer, paste) per 6,000-character
-- page (wine_list_text); spreadsheets are parsed without AI and are free. Users reach these rows only
-- through the API (service role); RLS denies direct access.
create table if not exists public.winelens_list_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  source text not null check (source in ('photos','pdf','text','csv')),
  pages integer not null default 0 check (pages >= 0),
  entry_count integer not null default 0 check (entry_count >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create table if not exists public.winelens_list_entries (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.winelens_list_uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position >= 0),
  raw jsonb not null,
  resolved jsonb not null,
  decision text not null default 'pending' check (decision in ('pending','saved','skipped')),
  collection_id uuid,
  created_at timestamptz not null default now(),
  unique (upload_id, position)
);
-- New wines (producer + wine, no vintage) proposed to the shared catalog. Wine facts only; Romario
-- approves before anything becomes a public catalog wine.
create table if not exists public.winelens_catalog_proposals (
  wine_key text primary key check (wine_key ~ '^[0-9a-f]{64}$'),
  wine jsonb not null,
  place jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  seen integer not null default 1 check (seen >= 1),
  first_user uuid references auth.users(id) on delete set null,
  catalog_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists winelens_catalog_proposals_pending on public.winelens_catalog_proposals (status, seen desc);
do $$ declare t text; begin
 foreach t in array array['winelens_list_uploads','winelens_list_entries','winelens_catalog_proposals'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant all on public.%I to service_role', t);
 end loop;
end $$;

-- One proposal per wine; every further save of the same wine raises its "seen" count.
create or replace function public.winelens_propose_wine(p_key text,p_wine jsonb,p_place jsonb,p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s text;
begin
 if p_key is null or p_key !~ '^[0-9a-f]{64}$' or p_wine is null then raise exception 'invalid proposal'; end if;
 insert into public.winelens_catalog_proposals(wine_key,wine,place,first_user) values(p_key,p_wine,coalesce(p_place,'{}'::jsonb),p_user)
 on conflict(wine_key) do update set seen=public.winelens_catalog_proposals.seen+1
 returning status into s;
 return jsonb_build_object('status',s);
end $$;

-- Approve (adds the wine to the public catalog table) or reject. Caller must be the owner; the API checks.
-- Every decision is recorded in the truth funnel (ingest_batches / ingest_wines_raw), like any other ingest.
create or replace function public.winelens_decide_proposal(p_key text,p_decision text,p_row jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare pr public.winelens_catalog_proposals; batch uuid; wine_id text;
begin
 if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
 select * into pr from public.winelens_catalog_proposals where wine_key=p_key for update;
 if not found then raise exception 'unknown proposal'; end if;
 if pr.status<>'pending' then return jsonb_build_object('status',pr.status,'catalog_id',pr.catalog_id,'replayed',true); end if;
 if p_decision='approved' then
   if p_row is null or coalesce(p_row->>'id','')='' or coalesce(p_row->>'name','')='' then raise exception 'catalog row required'; end if;
   wine_id:=p_row->>'id';
   insert into public.wines(id,name,producer,region,country,grape,color,metadata)
   values(wine_id,p_row->>'name',nullif(p_row->>'producer',''),nullif(p_row->>'region',''),nullif(p_row->>'country',''),nullif(p_row->>'grape',''),nullif(p_row->>'color',''),
     coalesce(p_row->'metadata','{}'::jsonb)||jsonb_build_object('source','wine-list proposal','wine_key',p_key))
   on conflict(id) do nothing;
 end if;
 insert into public.ingest_batches(source,label,wine_count,metadata)
 values('wine-list proposal',concat_ws(' · ',pr.wine->>'producer',pr.wine->>'wine_name'),1,jsonb_build_object('wine_key',p_key,'seen',pr.seen,'decision',p_decision))
 returning id into batch;
 insert into public.ingest_wines_raw(batch_id,wine_id,accepted,raw)
 values(batch,wine_id,p_decision='approved',jsonb_build_object('suggested',pr.wine,'place',pr.place,'catalog_row',p_row));
 update public.winelens_catalog_proposals set status=p_decision,decided_at=now(),catalog_id=wine_id where wine_key=p_key;
 return jsonb_build_object('status',p_decision,'catalog_id',wine_id);
end $$;
revoke all on function public.winelens_propose_wine(text,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.winelens_decide_proposal(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.winelens_propose_wine(text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.winelens_decide_proposal(text,text,jsonb) to service_role;
commit;
