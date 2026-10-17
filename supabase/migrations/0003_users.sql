-- 0003_users.sql
-- User enums, profiles, watch tracking, favorites, recommendation feedback, and providers.

create type public.reaction as enum ('loved', 'liked', 'meh', 'disliked');
create type public.track_status as enum ('watchlist', 'watched');
create type public.visibility as enum ('public', 'friends', 'private');

create table public.profiles (
  user_id         uuid primary key references auth.users on delete cascade,
  username        citext unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name    text check (char_length(display_name) <= 40),
  avatar_url      text,
  visibility      public.visibility not null default 'friends',
  discovery_dial  real not null default 0.4 check (discovery_dial between 0 and 1),
  region          char(2) not null default 'IN',
  onboarded_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table public.user_movies (
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  movie_id      bigint not null references public.movies(id) on delete cascade,
  status        public.track_status not null,
  reaction      public.reaction,
  is_favourite  boolean not null default false,
  watched_on    date,
  note          text check (char_length(note) <= 500),
  source        text not null default 'app' check (source in ('app', 'letterboxd', 'imdb')),
  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, movie_id),
  check (reaction is null or status = 'watched')
);

create index user_movies_user_status on public.user_movies (user_id, status);
create index user_movies_movie on public.user_movies (movie_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_movies_set_updated_at
before update on public.user_movies
for each row execute function public.set_updated_at();

create table public.favourite_people (
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  person_id  bigint not null references public.people(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, person_id)
);

create index favourite_people_person on public.favourite_people (person_id);

create table public.rec_feedback (
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  movie_id   bigint not null references public.movies(id) on delete cascade,
  kind       text not null check (kind in ('not_interested', 'more_like_this', 'not_tonight')),
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id, kind)
);

create index rec_feedback_user_kind on public.rec_feedback (user_id, kind);

create table public.user_providers (
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  provider_id  int not null,                   -- TMDB/JustWatch provider id (display-side filter only)
  primary key (user_id, provider_id)
);
