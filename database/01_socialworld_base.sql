-- ============================================================
-- [1단계] 소셜 월드 기본 스키마 — 지금 팀 Supabase에 적용된 구성
--   다음 단계: 02_loop_schema.sql (위험 탐지 에이전트와의 순환 연결)
--   전체 목표 설계(31개 테이블)는 full_schema_reference.sql — 아직 적용하지 않음
--
-- 원래 이름: socialworld/supabase/schema.sql (React 프로토타입 동봉본)
-- 대상: 광장 · 미션방 · 동아리방 (통합기획서 7장 / DB_테이블_정의서 2장 모듈 6 중 일부)
-- 출처: DB_연결_단계별_실행가이드.md 4장을 그대로 실행 가능한 형태로 정리.
-- NPC 대화 신호 테이블(npc_sessions·npc_chat_metrics 등)은 02_loop_schema.sql이 만든다.
-- (원래 주석: NPC 대화는 스크립트 목업이라 npc_chat_metrics 등
-- 모듈 7(미시 신호 집계) 테이블은 포함하지 않았다. 실제 LLM 연동 단계에서
-- DB_테이블_정의서.md 4-5절 정의를 그대로 추가하면 된다.)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
--           여러 번 실행해도 안전하다(if not exists / drop policy if exists / 시드 중복 방지).
-- ============================================================

-- ------------------------------------------------------------
-- 1. 프로필 (SW-02 온보딩)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null,
  sgg_code     text not null,               -- 11680 강남구 / 51110 춘천시
  age_group    text,                        -- '20대' | '30대' 등
  gender       text,                        -- 'M' | 'F' | null
  created_at   timestamptz not null default now(),
  onboarded_at timestamptz                  -- null이면 온보딩 미완료
);

-- ------------------------------------------------------------
-- 2. 미션 (SW-06 미션방)
-- ------------------------------------------------------------
create table if not exists public.missions (
  id           bigint generated always as identity primary key,
  title        text not null,
  description  text,
  reward_point int  not null default 0,
  due_date     date,
  is_active    boolean not null default true
);

create table if not exists public.mission_progress (
  id           bigint generated always as identity primary key,
  user_id      uuid   not null references auth.users(id) on delete cascade,
  mission_id   bigint not null references public.missions(id) on delete cascade,
  status       text   not null default 'in_progress',   -- in_progress | done
  completed_at timestamptz,
  unique (user_id, mission_id)
);

-- ------------------------------------------------------------
-- 3. 동아리 (SW-07)
-- ------------------------------------------------------------
create table if not exists public.clubs (
  id          bigint generated always as identity primary key,
  name        text not null,
  category    text,                        -- 문화 | 공연 | 체육 ...
  description text,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id   bigint not null references public.clubs(id) on delete cascade,
  user_id   uuid   not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- ------------------------------------------------------------
-- 4. RLS 켜기 — DB_연결_단계별_실행가이드.md 4-5절
-- ------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.missions         enable row level security;
alter table public.mission_progress enable row level security;
alter table public.clubs            enable row level security;
alter table public.club_members     enable row level security;

-- 프로필: 본인 것만
drop policy if exists "본인 프로필 조회" on public.profiles;
create policy "본인 프로필 조회" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "본인 프로필 생성" on public.profiles;
create policy "본인 프로필 생성" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "본인 프로필 수정" on public.profiles;
create policy "본인 프로필 수정" on public.profiles
  for update using (auth.uid() = id);

-- 미션 목록: 로그인한 사람 누구나 조회
drop policy if exists "미션 목록 조회" on public.missions;
create policy "미션 목록 조회" on public.missions
  for select to authenticated using (true);

-- 미션 진행상태: 본인 것만
drop policy if exists "본인 미션기록 조회" on public.mission_progress;
create policy "본인 미션기록 조회" on public.mission_progress
  for select using (auth.uid() = user_id);

drop policy if exists "본인 미션기록 생성" on public.mission_progress;
create policy "본인 미션기록 생성" on public.mission_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "본인 미션기록 수정" on public.mission_progress;
create policy "본인 미션기록 수정" on public.mission_progress
  for update using (auth.uid() = user_id);

-- 동아리: 목록은 모두 조회, 개설/가입은 본인 명의로만
drop policy if exists "동아리 목록 조회" on public.clubs;
create policy "동아리 목록 조회" on public.clubs
  for select to authenticated using (true);

drop policy if exists "동아리 개설" on public.clubs;
create policy "동아리 개설" on public.clubs
  for insert with check (auth.uid() = owner_id);

drop policy if exists "동아리 멤버 조회" on public.club_members;
create policy "동아리 멤버 조회" on public.club_members
  for select to authenticated using (true);

drop policy if exists "동아리 가입" on public.club_members;
create policy "동아리 가입" on public.club_members
  for insert with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 5. 시드 데이터 — 프로토타입 시연용 미션/동아리 초기값
-- ------------------------------------------------------------
insert into public.missions (title, description, reward_point, is_active)
select v.title, v.description, v.reward_point, true
from (values
  ('광장 한 바퀴 돌아보기', '광장에 있는 NPC 3명과 모두 한 번씩 대화해 보세요.', 10),
  ('첫 동아리 가입하기', '관심 있는 동아리에 가입하고 인사를 남겨보세요.', 20),
  ('일주일 연속 출석하기', '7일 동안 하루 한 번씩 소셜 월드에 접속해 보세요.', 50),
  ('심리상담 NPC와 대화하기', '광장의 심리상담 NPC와 대화를 나눠보세요. 상담사가 아닌 연결 도구입니다.', 15)
) as v(title, description, reward_point)
where not exists (select 1 from public.missions m where m.title = v.title);   -- 여러 번 실행해도 중복되지 않게
