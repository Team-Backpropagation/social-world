-- 테스트 전용. 팀 Supabase에는 실행하지 않는다.
-- Supabase의 auth 스키마·역할만 흉내 낸다. 그 위에 실제 01→02→03→05… 마이그레이션을 그대로 올려 검증한다.
-- (00_supabase_stub.sql은 코코 테스트용으로 01·03 칸 일부만 흉내 낸 버전)
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
-- Supabase 기본 권한 흉내: public 스키마 새 테이블·함수는 세 역할에 권한이 열려 있고, RLS·revoke로 막는다
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
