-- Additive wineLENS migration: immutable study review events (PRD S-08).
-- One row per (user, event_id). Clients retry with the same event_id, so duplicate
-- taps, offline replays and network retries are stored once. Rows are never
-- updated or deleted by users; card state is a deterministic replay of this log.
-- Safe to re-run.
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
-- No UPDATE/DELETE grants or policies: history stays auditable. Account deletion cascades.
