-- Master Winebrary receives unreviewed evidence; submissions never overwrite the published wines.
create table public.wl_community_artwork (
 wine_id uuid not null references public.wl_community_wines(id) on delete cascade,
 asset_hash text not null check (asset_hash ~ '^[a-f0-9]{64}$'),
 photo_path text not null,
 sprite_path text not null,
 source text not null check (source in ('photograph','generated')),
 provenance jsonb not null default '{}',
 created_at timestamptz not null default now(),
 primary key (wine_id,asset_hash)
);
alter table public.wl_community_artwork enable row level security;
revoke all on public.wl_community_artwork from public,anon,authenticated;
grant all on public.wl_community_artwork to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('sommni-master-bottles','sommni-master-bottles',false,2097152,array['image/png']);
comment on table public.wl_community_artwork is 'Private, unverified bottle photos and G2 sprites for master Winebrary editorial review.';
