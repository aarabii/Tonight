-- supabase/tests/rls.test.sql
-- pgTAP tests for Row Level Security policies, user isolation, and social visibility.

begin;
select plan(12);

-- 1. Setup test fixture data in auth.users, profiles, movies, user_movies
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'user_a@test.com', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'user_b@test.com', '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.profiles (user_id, username, display_name, visibility, discovery_dial, region)
values
  ('11111111-1111-1111-1111-111111111111', 'user_a', 'User A', 'friends', 0.4, 'IN'),
  ('22222222-2222-2222-2222-222222222222', 'user_b', 'User B', 'private', 0.4, 'IN');

insert into public.movies (id, wikidata_qid, tmdb_id, title, year, popularity_pct, has_story, source)
overriding system value
values
  (999901, 'Q1001', 501, 'Test Movie 1', 2020, 0.8, true, 'wikidata');

insert into public.user_movies (user_id, movie_id, status, reaction, is_favourite)
values
  ('22222222-2222-2222-2222-222222222222', 999901, 'watched', 'loved', true);

insert into public.tmdb_cache (tmdb_id, details)
values
  (501, '{"title":"Test Movie 1"}');

-- 2. Test anon access restrictions
set local role anon;
set local "request.jwt.claim.sub" to '';

select is_empty(
  'select * from public.profiles',
  'anon cannot read profiles'
);

select is_empty(
  'select * from public.user_movies',
  'anon cannot read user_movies'
);

select throws_ok(
  'select * from public.tmdb_cache',
  '42501',
  null,
  'anon has no permission to read tmdb_cache'
);

select is_empty(
  'select * from public.movie_embeddings',
  'anon cannot read movie_embeddings'
);

-- 3. Test User A cannot insert/update/delete User B data
set local role authenticated;
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$insert into public.user_movies (user_id, movie_id, status) values ('22222222-2222-2222-2222-222222222222', 999901, 'watchlist')$$,
  '42501',
  null,
  'User A cannot insert into User B user_movies'
);

select is(
  (
    with upd as (
      update public.user_movies set note = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222' returning 1
    ) select count(*)::int from upd
  ),
  0,
  'User A cannot update User B user_movies'
);

select is(
  (
    with del as (
      delete from public.user_movies where user_id = '22222222-2222-2222-2222-222222222222' returning 1
    ) select count(*)::int from del
  ),
  0,
  'User A cannot delete User B user_movies'
);

select throws_ok(
  $$insert into public.follows (follower_id, followee_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')$$,
  '42501',
  null,
  'User A cannot insert a follow pretending to be follower User B'
);

-- 4. Test visibility: Private profile
-- B is private: A cannot read B's user_movies
select is_empty(
  $$select * from public.user_movies where user_id = '22222222-2222-2222-2222-222222222222'$$,
  'User A cannot read User B user_movies when B is private'
);

-- 5. Test visibility: Friends profile without mutual follow
-- Change B to friends visibility
set local role postgres;
update public.profiles set visibility = 'friends' where user_id = '22222222-2222-2222-2222-222222222222';

-- A follows B, but B does not follow A (not mutual)
insert into public.follows (follower_id, followee_id)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

set local role authenticated;
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111';

select is_empty(
  $$select * from public.user_movies where user_id = '22222222-2222-2222-2222-222222222222'$$,
  'User A cannot read User B user_movies when B is friends-only and not mutual'
);

-- 6. Test visibility: Friends profile with mutual follow
set local role postgres;
-- B follows A back (now mutual)
insert into public.follows (follower_id, followee_id)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111';

select isnt_empty(
  $$select * from public.user_movies where user_id = '22222222-2222-2222-2222-222222222222'$$,
  'User A CAN read User B user_movies once A and B are mutual friends'
);

select is(
  (select count(*)::int from public.user_movies where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'User A reads exactly 1 movie from mutual friend User B'
);

select * from finish();
rollback;
