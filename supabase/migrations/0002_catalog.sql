-- 0002_catalog.sql
-- ML-side catalog tables written only by the pipeline / service role.
-- Strictly adheres to the ML/Display wall (no TMDB text/content stored here).

create table public.movies (
  id              bigint generated always as identity primary key,
  wikidata_qid    text unique,
  tmdb_id         int unique,                  -- from Wikidata P4947 (or stub key)
  imdb_id         text unique,
  title           text,                        -- null only for stubs
  original_title  text,
  year            smallint,
  runtime_min     smallint,
  genres          text[] not null default '{}',
  subjects        text[] not null default '{}',
  settings        text[] not null default '{}',
  languages       text[] not null default '{}',
  countries       text[] not null default '{}',
  series_qid      text,
  sitelinks       smallint,
  imdb_rating     real,
  imdb_votes      int,
  popularity_pct  real,                        -- 0..1
  has_story       boolean not null default false,  -- true when an embedding exists
  source          text not null default 'wikidata' check (source in ('wikidata','tmdb_stub')),
  plot_hash       text,
  enwiki_title    text,
  updated_at      timestamptz not null default now(),
  check (source = 'tmdb_stub' or title is not null),
  check (source = 'wikidata' or tmdb_id is not null)
);

create index movies_title_trgm on public.movies using gin (title gin_trgm_ops);
create index movies_popularity on public.movies (popularity_pct);
create index movies_genres on public.movies using gin (genres);
create index movies_subjects on public.movies using gin (subjects);

create table public.movie_embeddings (
  movie_id   bigint primary key references public.movies(id) on delete cascade,
  embedding  extensions.halfvec(384) not null,
  model      text not null default 'gte-small',
  chunks     smallint not null,
  updated_at timestamptz not null default now()
);

create index movie_embeddings_hnsw on public.movie_embeddings
  using hnsw (embedding extensions.halfvec_cosine_ops) with (m = 16, ef_construction = 64);

create table public.people (
  id              bigint generated always as identity primary key,
  wikidata_qid    text unique,
  tmdb_person_id  int unique,                  -- from Wikidata P4985
  name            text not null
);

create index people_name_trgm on public.people using gin (name gin_trgm_ops);

create table public.movie_people (
  movie_id   bigint not null references public.movies(id) on delete cascade,
  person_id  bigint not null references public.people(id) on delete cascade,
  role       text not null check (role in ('director','cast','writer','composer')),
  billing    smallint,
  primary key (movie_id, person_id, role)
);

create index movie_people_person on public.movie_people (person_id);

create table public.moods (
  id          text primary key,                -- 'mind-bending', 'feel-good', …
  label       text not null,
  description text not null,                   -- rich text that was embedded
  embedding   extensions.halfvec(384) not null,
  sort        smallint not null
);

create table public.pipeline_state (
  key        text primary key,                 -- 'last_wikidata_sync', 'last_imdb_sync', …
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security on all catalog tables
alter table public.movies enable row level security;
alter table public.movie_embeddings enable row level security;
alter table public.people enable row level security;
alter table public.movie_people enable row level security;
alter table public.moods enable row level security;
alter table public.pipeline_state enable row level security;

-- Catalog read policies for authenticated users (writes are service_role only;
-- movie_embeddings and pipeline_state have no client policies)
create policy "movies_authenticated_select"
  on public.movies for select
  to authenticated
  using (true);

create policy "people_authenticated_select"
  on public.people for select
  to authenticated
  using (true);

create policy "movie_people_authenticated_select"
  on public.movie_people for select
  to authenticated
  using (true);

create policy "moods_authenticated_select"
  on public.moods for select
  to authenticated
  using (true);
