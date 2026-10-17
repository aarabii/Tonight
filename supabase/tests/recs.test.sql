-- supabase/tests/recs.test.sql
-- pgTAP tests for user_anchors weights, rec_cache auto-invalidation, and ML/Display wall separation.

begin;
select plan(10);

-- 1. Setup test fixture
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'tester@test.com', '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.profiles (user_id, username, display_name, visibility, discovery_dial, region)
values
  ('33333333-3333-3333-3333-333333333333', 'test_anchors_user', 'Tester', 'public', 0.4, 'IN');

insert into public.movies (id, wikidata_qid, tmdb_id, title, year, popularity_pct, has_story, source)
overriding system value
values
  (99991, 'Q9001', 9001, 'Loved Fav Movie', 2020, 0.9, true, 'wikidata'),
  (99992, 'Q9002', 9002, 'Liked Movie', 2021, 0.8, true, 'wikidata'),
  (99993, 'Q9003', 9003, 'Watchlist Movie', 2022, 0.7, true, 'wikidata'),
  (99994, 'Q9004', 9004, 'Disliked Movie', 2019, 0.5, true, 'wikidata'),
  (99995, 'Q9005', 9005, 'Meh Movie', 2018, 0.6, true, 'wikidata');

-- Insert user tracking rows
insert into public.user_movies (user_id, movie_id, status, reaction, is_favourite, updated_at)
values
  ('33333333-3333-3333-3333-333333333333', 99991, 'watched', 'loved', true, now()),
  ('33333333-3333-3333-3333-333333333333', 99992, 'watched', 'liked', false, now()),
  ('33333333-3333-3333-3333-333333333333', 99993, 'watchlist', null, false, now()),
  ('33333333-3333-3333-3333-333333333333', 99994, 'watched', 'disliked', false, now()),
  ('33333333-3333-3333-3333-333333333333', 99995, 'watched', 'meh', false, now());

-- 2. Verify user_anchors weights
-- 99991: favourite (1.5) + loved (1.0) = 2.5
select is(
  (select weight from public.user_anchors('33333333-3333-3333-3333-333333333333') where movie_id = 99991),
  2.5::real,
  'user_anchors: favourite + loved yields weight 2.5'
);

-- 99992: liked (0.6)
select is(
  (select weight from public.user_anchors('33333333-3333-3333-3333-333333333333') where movie_id = 99992),
  0.6::real,
  'user_anchors: liked yields weight 0.6'
);

-- 99993: watchlist (0.25)
select is(
  (select weight from public.user_anchors('33333333-3333-3333-3333-333333333333') where movie_id = 99993),
  0.25::real,
  'user_anchors: watchlist yields weight 0.25'
);

-- 99994: disliked (-1.0)
select is(
  (select weight from public.user_anchors('33333333-3333-3333-3333-333333333333') where movie_id = 99994),
  (-1.0)::real,
  'user_anchors: disliked yields weight -1.0'
);

-- 99995: meh (-0.3)
select is(
  (select weight from public.user_anchors('33333333-3333-3333-3333-333333333333') where movie_id = 99995),
  (-0.3)::real,
  'user_anchors: meh yields weight -0.3'
);

-- 3. Test rec_cache invalidation trigger
insert into public.rec_cache (user_id, key, payload)
values ('33333333-3333-3333-3333-333333333333', 'home', '{"rows":[]}');

select is(
  (select count(*)::int from public.rec_cache where user_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'rec_cache holds 1 cached entry'
);

-- Update user_movies (trigger must clear rec_cache)
update public.user_movies
set reaction = 'loved'
where user_id = '33333333-3333-3333-3333-333333333333' and movie_id = 99992;

select is(
  (select count(*)::int from public.rec_cache where user_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'updating user_movies invalidates rec_cache automatically'
);

-- Insert rec_cache entry again
insert into public.rec_cache (user_id, key, payload)
values ('33333333-3333-3333-3333-333333333333', 'home', '{"rows":[]}');

-- Updating profiles.discovery_dial must also invalidate rec_cache
update public.profiles
set discovery_dial = 0.8
where user_id = '33333333-3333-3333-3333-333333333333';

select is(
  (select count(*)::int from public.rec_cache where user_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'updating profiles.discovery_dial invalidates rec_cache automatically'
);

-- 4. ML/Display wall separation check
-- Verify that tmdb_cache, tmdb_person_cache, tmdb_search_cache have ZERO foreign keys pointing to catalog tables
select is(
  (
    select count(*)::int
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name in ('tmdb_cache', 'tmdb_person_cache', 'tmdb_search_cache')
      and constraint_type = 'FOREIGN KEY'
  ),
  0,
  'Data wall: tmdb display caches have zero foreign key constraints pointing to movies/catalog'
);

-- Verify movies has no foreign key pointing to tmdb_cache
select is(
  (
    select count(*)::int
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc on rc.constraint_name = tc.constraint_name
    where tc.table_schema = 'public'
      and tc.table_name = 'movies'
  ),
  0,
  'Data wall: movies has zero foreign key constraints pointing to tmdb_cache'
);

select * from finish();
rollback;
