-- 0004_social.sql
-- Follow relationships and mutual friendship / profile visibility helper functions.

create table public.follows (
  follower_id uuid not null references public.profiles(user_id) on delete cascade,
  followee_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_followee on public.follows (followee_id);

create or replace function public.is_mutual(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = a and followee_id = b)
     and exists (select 1 from public.follows where follower_id = b and followee_id = a);
$$;

create or replace function public.can_view_profile(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select target = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.user_id = target and (
          p.visibility = 'public'
          or (p.visibility = 'friends' and public.is_mutual(auth.uid(), target))
        )
      );
$$;
