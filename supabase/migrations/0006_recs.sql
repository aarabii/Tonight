-- 0006_recs.sql
-- Recommendations cache, automatic invalidation triggers, and recommendation RPCs.

create table public.rec_cache (
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  key         text not null,                   -- 'home', 'tonight:{hash(filters)}', 'blend:{other_uid}', 'similar:{movie_id}'
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, key)
);

create index rec_cache_user on public.rec_cache (user_id);

-- Automatic rec_cache invalidation
create or replace function public.invalidate_user_rec_cache()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid;
begin
  if tg_op = 'DELETE' then
    uid := old.user_id;
  else
    uid := new.user_id;
  end if;

  if uid is not null then
    delete from public.rec_cache where user_id = uid or key = ('blend:' || uid::text);
  end if;

  return null;
end;
$$;

create or replace function public.invalidate_profile_rec_cache()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.discovery_dial is distinct from new.discovery_dial then
    delete from public.rec_cache where user_id = new.user_id or key = ('blend:' || new.user_id::text);
  end if;
  return null;
end;
$$;

create trigger user_movies_invalidate_rec_cache
after insert or update or delete on public.user_movies
for each row execute function public.invalidate_user_rec_cache();

create trigger favourite_people_invalidate_rec_cache
after insert or delete on public.favourite_people
for each row execute function public.invalidate_user_rec_cache();

create trigger rec_feedback_invalidate_rec_cache
after insert or update or delete on public.rec_feedback
for each row execute function public.invalidate_user_rec_cache();

create trigger profiles_invalidate_rec_cache
after update on public.profiles
for each row execute function public.invalidate_profile_rec_cache();

-- Signed user taste anchors
create or replace function public.user_anchors(uid uuid, max_n int default 40)
returns table (movie_id bigint, weight real, has_story boolean)
language sql stable security definer set search_path = public, extensions as $$
  with base as (
    select um.movie_id,
      (case when um.is_favourite then 1.5 else 0 end
       + case um.reaction when 'loved' then 1.0 when 'liked' then 0.6
                          when 'meh' then -0.3 when 'disliked' then -1.0 else 0 end
       + case when um.status = 'watchlist' then 0.25 else 0 end)
      * case when um.is_favourite then 1
             else greatest(0.4, power(0.8, extract(epoch from now() - um.updated_at) / 31557600.0)) end
      as weight
    from public.user_movies um where um.user_id = uid
    union all
    select rf.movie_id, case rf.kind when 'more_like_this' then 0.8 when 'not_interested' then -0.6 end
    from public.rec_feedback rf where rf.user_id = uid and rf.kind in ('more_like_this', 'not_interested')
  )
  select b.movie_id, sum(b.weight)::real as weight, m.has_story
  from base b join public.movies m on m.id = b.movie_id
  group by b.movie_id, m.has_story
  having sum(b.weight) <> 0
  order by abs(sum(b.weight)) desc
  limit max_n;
$$;

-- ANN candidates per anchor
create or replace function public.rec_candidates(anchor_ids bigint[], per_anchor int default 40)
returns table (movie_id bigint, anchor_id bigint, sim real)
language sql stable set search_path = public, extensions as $$
  select n.movie_id, a.id as anchor_id, n.sim
  from unnest(anchor_ids) as a(id)
  join public.movie_embeddings ae on ae.movie_id = a.id
  cross join lateral (
    select e.movie_id, (1 - (e.embedding <=> ae.embedding))::real as sim
    from public.movie_embeddings e
    where e.movie_id <> a.id
    order by e.embedding <=> ae.embedding
    limit per_anchor
  ) n;
$$;

-- Centroid / vector ANN query
create or replace function public.candidates_near_vector(q extensions.halfvec(384), k int default 60)
returns table (movie_id bigint, sim real)
language sql stable set search_path = public, extensions as $$
  select movie_id, (1 - (embedding <=> q))::real as sim
  from public.movie_embeddings
  order by embedding <=> q
  limit k;
$$;

-- Exact similarity matrix between candidates and anchors
create or replace function public.sim_matrix(candidate_ids bigint[], anchor_ids bigint[])
returns table (movie_id bigint, anchor_id bigint, sim real)
language sql stable set search_path = public, extensions as $$
  select c.movie_id, a.movie_id as anchor_id, (1 - (c.embedding <=> a.embedding))::real as sim
  from public.movie_embeddings c, public.movie_embeddings a
  where c.movie_id = any(candidate_ids) and a.movie_id = any(anchor_ids);
$$;

-- Similar movies to a single movie
create or replace function public.similar_movies(mid bigint, k int default 20)
returns table (movie_id bigint, sim real)
language sql stable set search_path = public, extensions as $$
  select e.movie_id, (1 - (e.embedding <=> s.embedding))::real as sim
  from public.movie_embeddings s, lateral (
    select movie_id, embedding from public.movie_embeddings
    where movie_id <> mid
    order by embedding <=> s.embedding
    limit k
  ) e
  where s.movie_id = mid;
$$;

-- Movies credited to favourite people
create or replace function public.movies_by_people(person_ids bigint[], max_n int default 60)
returns table (movie_id bigint, person_id bigint)
language sql stable set search_path = public, extensions as $$
  select mp.movie_id, mp.person_id
  from public.movie_people mp
  join public.movies m on m.id = mp.movie_id
  where mp.person_id = any(person_ids)
  order by m.popularity_pct desc nulls last
  limit max_n;
$$;
