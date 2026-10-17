-- 0005_display_cache.sql
-- Display caches for TMDB responses (movies, people, search queries) and maintenance purge job.
-- Strictly display-only; no foreign keys to movies/people to maintain the ML/Display wall.

create table public.tmdb_cache (
  tmdb_id               int primary key,
  details               jsonb not null,
  details_fetched_at    timestamptz not null default now(),
  providers             jsonb,
  providers_fetched_at  timestamptz
);

create table public.tmdb_person_cache (
  tmdb_person_id int primary key,
  details        jsonb not null,
  fetched_at     timestamptz not null default now()
);

create table public.tmdb_search_cache (
  query_key   text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

create or replace function public.purge_expired_caches()
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.tmdb_search_cache where fetched_at < now() - interval '3 days';
  delete from public.tmdb_cache where details_fetched_at < now() - interval '180 days';
  delete from public.tmdb_person_cache where fetched_at < now() - interval '180 days';
  delete from public.rec_feedback where kind = 'not_tonight' and created_at < now() - interval '14 days';
end;
$$;
