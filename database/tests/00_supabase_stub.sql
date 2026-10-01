-- 테스트 전용. 팀 Supabase에는 실행하지 않는다.
-- Supabase의 auth.uid()·역할과, 01·03이 만든 테이블 중 코코가 읽는 칸만 흉내 낸다.

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

-- 01_socialworld_base.sql (DB_연결_단계별_실행가이드 4장과 같은 정의)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  sgg_code text not null,
  age_group text,
  gender text,
  created_at timestamptz not null default now(),
  onboarded_at timestamptz,
  -- 03_world_update.sql이 추가하는 칸
  avatar jsonb,
  interests text[],
  join_goal text
);
create table public.missions (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  reward_point int not null default 0,
  due_date date,
  is_active boolean not null default true,
  stage smallint                       -- 03이 추가
);
create table public.mission_progress (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id bigint not null references public.missions(id) on delete cascade,
  status text not null default 'in_progress',
  completed_at timestamptz,
  unique (user_id, mission_id)
);
create table public.clubs (
  id bigint generated always as identity primary key,
  name text not null,
  category text,
  description text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.club_members (
  club_id bigint not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.missions enable row level security;
alter table public.mission_progress enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
create policy "본인 프로필 조회" on public.profiles for select using (auth.uid() = id);
create policy "미션 목록 조회" on public.missions for select to authenticated using (true);
create policy "본인 미션기록 조회" on public.mission_progress for select using (auth.uid() = user_id);
create policy "동아리 목록 조회" on public.clubs for select to authenticated using (true);
create policy "동아리 멤버 조회" on public.club_members for select to authenticated using (true);
grant select on public.profiles, public.missions, public.mission_progress, public.clubs, public.club_members to authenticated;
