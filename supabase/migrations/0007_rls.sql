-- 0007_rls.sql
-- Row Level Security policies for all public tables.
-- Strict user isolation, social visibility boundaries, and client denial on display caches.

-- 1. Profiles & Public Profiles
alter table public.profiles enable row level security;

create or replace view public.public_profiles
with (security_invoker = false) as
  select user_id, username, display_name, avatar_url
  from public.profiles;

create policy "profiles_select_viewable"
  on public.profiles for select
  to authenticated
  using (public.can_view_profile(user_id));

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using (user_id = auth.uid());

-- 2. User Movies
alter table public.user_movies enable row level security;

create policy "user_movies_select"
  on public.user_movies for select
  to authenticated
  using (user_id = auth.uid() or public.can_view_profile(user_id));

create policy "user_movies_insert_own"
  on public.user_movies for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_movies_update_own"
  on public.user_movies for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_movies_delete_own"
  on public.user_movies for delete
  to authenticated
  using (user_id = auth.uid());

-- 3. Favourite People
alter table public.favourite_people enable row level security;

create policy "favourite_people_select"
  on public.favourite_people for select
  to authenticated
  using (user_id = auth.uid() or public.can_view_profile(user_id));

create policy "favourite_people_insert_own"
  on public.favourite_people for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "favourite_people_delete_own"
  on public.favourite_people for delete
  to authenticated
  using (user_id = auth.uid());

-- 4. Recommendation Feedback
alter table public.rec_feedback enable row level security;

create policy "rec_feedback_select_own"
  on public.rec_feedback for select
  to authenticated
  using (user_id = auth.uid());

create policy "rec_feedback_insert_own"
  on public.rec_feedback for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "rec_feedback_update_own"
  on public.rec_feedback for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "rec_feedback_delete_own"
  on public.rec_feedback for delete
  to authenticated
  using (user_id = auth.uid());

-- 5. User Providers
alter table public.user_providers enable row level security;

create policy "user_providers_select_own"
  on public.user_providers for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_providers_insert_own"
  on public.user_providers for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_providers_delete_own"
  on public.user_providers for delete
  to authenticated
  using (user_id = auth.uid());

-- 6. Follows
alter table public.follows enable row level security;

create policy "follows_select"
  on public.follows for select
  to authenticated
  using (
    follower_id = auth.uid()
    or followee_id = auth.uid()
    or public.can_view_profile(follower_id)
    or public.can_view_profile(followee_id)
  );

create policy "follows_insert_own"
  on public.follows for insert
  to authenticated
  with check (follower_id = auth.uid());

create policy "follows_delete_own"
  on public.follows for delete
  to authenticated
  using (follower_id = auth.uid());

-- 7. Recommendations Cache (service-role writes, client read own)
alter table public.rec_cache enable row level security;

create policy "rec_cache_select_own"
  on public.rec_cache for select
  to authenticated
  using (user_id = auth.uid());

create policy "rec_cache_delete_own"
  on public.rec_cache for delete
  to authenticated
  using (user_id = auth.uid());

-- 8. TMDB Display Caches (Client access strictly forbidden; service role only)
alter table public.tmdb_cache enable row level security;
alter table public.tmdb_person_cache enable row level security;
alter table public.tmdb_search_cache enable row level security;

-- Revoke all direct permissions from anon
revoke all on public.profiles from anon;
revoke all on public.user_movies from anon;
revoke all on public.favourite_people from anon;
revoke all on public.rec_feedback from anon;
revoke all on public.user_providers from anon;
revoke all on public.follows from anon;
revoke all on public.rec_cache from anon;
revoke all on public.tmdb_cache from anon;
revoke all on public.tmdb_person_cache from anon;
revoke all on public.tmdb_search_cache from anon;
revoke all on public.public_profiles from anon;

-- Grant authenticated permissions
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.user_movies to authenticated;
grant select, insert, delete on public.favourite_people to authenticated;
grant select, insert, update, delete on public.rec_feedback to authenticated;
grant select, insert, delete on public.user_providers to authenticated;
grant select, insert, delete on public.follows to authenticated;
grant select, delete on public.rec_cache to authenticated;
grant select on public.public_profiles to authenticated;
grant execute on function public.is_mutual(uuid, uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.user_anchors(uuid, int) to authenticated;
grant execute on function public.rec_candidates(bigint[], int) to authenticated;
grant execute on function public.candidates_near_vector(extensions.halfvec, int) to authenticated;
grant execute on function public.sim_matrix(bigint[], bigint[]) to authenticated;
grant execute on function public.similar_movies(bigint, int) to authenticated;
grant execute on function public.movies_by_people(bigint[], int) to authenticated;
