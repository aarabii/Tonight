-- 0001_extensions.sql
-- Required Postgres extensions for Tonight catalog, search, and vector embeddings

create schema if not exists extensions;

create extension if not exists vector with schema extensions;
create extension if not exists citext;
create extension if not exists pg_trgm;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
exception
  when others then
    raise notice 'pg_cron not enabled: %', sqlerrm;
end
$$;
