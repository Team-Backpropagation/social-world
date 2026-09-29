-- ============================================================
-- [3단계] 소셜 월드 새 맵 · NPC 캐릭터 · 월드 리포트 반영 (2026-09-29)
--   앞 단계: 01_socialworld_base.sql → 02_loop_schema.sql
--   설계 근거: docs/planning/소셜월드_게임흐름_NPC_설계.md
--
-- 바뀌는 것
--   A. 기존 테이블 수정
--      - npc_type / npc_emphasis 허용값에 'coco'(코코), 'chief'(마을이장) 추가
--        내부 코드는 그대로 둔다: psych=루미, policy·job·civil=하루(화면 이름만 바뀜)
--      - cohort_feedback.event_theme 추가 (마을이장이 받는 환류)
--      - missions.stage 추가 (퀘스트 1~4단계) + 단계별 퀘스트 시드
--      - profiles.avatar · interests · join_goal 추가 (튜토리얼 사전 설문·캐릭터)
--   B. 새 테이블
--      - club_cheers          동아리 응원 스티커 (게시판 대체)
--      - world_events         마을이장이 연 이벤트 (대상 코호트·근거는 관리자만)
--      - event_participation  이벤트 참여 (개인, 본인만)
--      - npc_demand_logs      하루·코코 수요 로그 (개인, 본인만)
--      - world_activity_metrics / npc_demand_metrics  코호트×주 집계 (user_id 없음) = "이장의 장부"
--      - world_reports        마을이장 월드 리포트 (관리자 대시보드 해설)
--   C. 집계 함수 (에이전트 secret key만 호출)
--      - aggregate_world_activity()   퀘스트·이벤트·스티커 → world_activity_metrics
--      - aggregate_npc_demand()       하루·코코 수요 → npc_demand_metrics
--
-- 원칙 (02와 같음)
--   - 개인 행은 본인만 읽고 쓴다. 집계 테이블에는 user_id가 없고 브라우저는 접근할 수 없다.
--   - k-익명성(5명 미만 코호트 숨김)은 02와 같이 user_count를 저장해 두고 에이전트가 판단한다
--     (risk_agent/config.py K_ANONYMITY_MIN).
--   - 위험 등급·점수는 시민이 읽을 수 있는 어떤 테이블·뷰에도 넣지 않는다.
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
--       여러 번 실행해도 안전하다.
-- ============================================================


-- ------------------------------------------------------------
-- A-1. NPC 종류 허용값 확장 — 이름을 가진 제약으로 다시 만든다
--      (02에서 컬럼 옆에 쓴 check는 이름이 자동으로 붙어서, 정의에 npc_type/npc_emphasis가 들어간 것을 찾아 지운다)
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.npc_sessions'::regclass, 'public.npc_chat_metrics'::regclass, 'public.cohort_feedback'::regclass)
      and (pg_get_constraintdef(c.oid) like '%npc_type%' or pg_get_constraintdef(c.oid) like '%npc_emphasis%')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.npc_sessions add constraint npc_sessions_npc_type_chk
  check (npc_type in ('policy','job','psych','civil','coco','chief'));
alter table public.npc_chat_metrics add constraint npc_chat_metrics_npc_type_chk
  check (npc_type in ('policy','job','psych','civil','coco','chief'));
alter table public.cohort_feedback add constraint cohort_feedback_npc_emphasis_chk
  check (npc_emphasis in ('policy','job','psych','civil','coco','chief'));

comment on column public.npc_sessions.npc_type is
  '내부 코드. 화면 이름: psych=루미 / policy·job·civil=하루 / coco=코코 / chief=마을이장';


-- ------------------------------------------------------------
-- A-2. cohort_feedback — 마을이장이 받는 환류. 이벤트 주제만 담는다(등급·점수 없음)
-- ------------------------------------------------------------
alter table public.cohort_feedback add column if not exists event_theme text;
comment on column public.cohort_feedback.event_theme is
  '마을이장이 이 코호트에 먼저 보여줄 이벤트 주제(예: 저부담 야외 산책). 위험 등급은 넣지 않는다';


-- ------------------------------------------------------------
-- A-3. missions.stage — 퀘스트 1~4단계. null이면 단계와 무관한 일반 미션
-- ------------------------------------------------------------
alter table public.missions add column if not exists stage smallint;
do $$ begin
  alter table public.missions add constraint missions_stage_range check (stage between 1 and 4);
exception when duplicate_object then null; end $$;

-- 기존 미션에 단계 붙이기 (제목은 risk_agent가 priority_missions 키로 쓰므로 바꾸지 않는다)
update public.missions set stage = 1 where stage is null and title in
  ('광장 한 바퀴 돌아보기','심리상담 NPC와 대화하기','취업상담 NPC와 대화하기','정책추천 NPC와 대화하기');
update public.missions set stage = 2 where stage is null and title = '일주일 연속 출석하기';
update public.missions set stage = 3 where stage is null and title = '첫 동아리 가입하기';

-- 단계별 퀘스트 시드 (설계 문서 4절)
insert into public.missions (title, description, reward_point, is_active, stage)
select v.title, v.description, v.reward_point, true, v.stage
from (values
  ('광장 방문하기',               '광장에 들러 마을이장에게 인사해 보세요.', 5, 1),
  ('관심 동아리 둘러보기',        '동아리센터에서 마음에 드는 동아리를 하나 찾아보세요.', 5, 1),
  ('다른 주민에게 이모지 보내기', '광장에서 만난 주민에게 이모지로 인사해 보세요.', 10, 2),
  ('동아리에 응원 스티커 남기기', '동아리센터에서 동아리 하나에 응원 스티커를 남겨보세요.', 10, 2),
  ('루미와 오늘 있었던 일 이야기하기', '카페에서 루미에게 오늘 하루를 들려주세요.', 10, 2),
  ('온라인 소모임 참여하기',      '동아리 모임에 한 번 참여해 보세요.', 20, 3),
  ('러닝 챌린지 참여하기',        '공원 러닝·산책 챌린지에 참여해 보세요.', 20, 3),
  ('취미 동아리 가입하기',        '취미 동아리에 가입해 보세요.', 20, 3),
  ('지역 프로그램 신청하기',      '하루가 알려준 지역 프로그램을 직접 신청하고 "신청했어요"를 눌러주세요.', 30, 4),
  ('청년센터 프로그램 신청하기',  '청년센터 프로그램을 직접 신청하고 "신청했어요"를 눌러주세요.', 30, 4),
  ('상담·복지 서비스 알아보기',   '하루에게 상담·복지 서비스를 물어보고 신청 방법을 확인해 보세요.', 30, 4)
) as v(title, description, reward_point, stage)
where not exists (select 1 from public.missions m where m.title = v.title);


-- ------------------------------------------------------------
-- A-4. profiles — 튜토리얼 사전 설문·캐릭터 (설계 문서 13절)
--      "요즘 하루는 어때요?" 답은 루미 첫 인사 말투에만 쓰고 저장하지 않는다.
--      지역 'OTHER'(다른 지역)·나이대 '기타'(그 외)는 이용은 되지만 에이전트가 집계에서 뺀다.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists avatar    jsonb;          -- {vibe, color, hair, hairColor, skin, outfit, acc, face}
alter table public.profiles add column if not exists interests text[] not null default '{}';
alter table public.profiles add column if not exists join_goal text;           -- rest | talk | meet | info
do $$ begin
  alter table public.profiles add constraint profiles_join_goal_chk check (join_goal in ('rest','talk','meet','info'));
exception when duplicate_object then null; end $$;
comment on column public.profiles.sgg_code  is '11680 강남구 / 51110 춘천시 / OTHER 다른 지역(집계 제외)';
comment on column public.profiles.age_group is '20대 / 30대 / 기타(그 외, 집계 제외)';


-- ------------------------------------------------------------
-- B-1. club_cheers — 동아리 응원 스티커. 자유 텍스트 없음, 같은 동아리에 하루 1회
-- ------------------------------------------------------------
create table if not exists public.club_cheers (
  id           bigint generated always as identity primary key,
  club_id      bigint not null references public.clubs(id) on delete cascade,
  user_id      uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  sticker_type text   not null check (sticker_type in ('clap','want','cheer','slow')),
                      -- clap 👏 멋져요 / want 🙌 나도 해보고 싶어 / cheer 💪 응원해 / slow 🌱 천천히 해도 돼
  cheered_on   date   not null default current_date,
  created_at   timestamptz not null default now(),
  unique (club_id, user_id, cheered_on)
);
create index if not exists idx_club_cheers_club on public.club_cheers (club_id);
alter table public.club_cheers enable row level security;

drop policy if exists "본인 응원 조회" on public.club_cheers;
create policy "본인 응원 조회" on public.club_cheers
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "본인 응원 생성" on public.club_cheers;
create policy "본인 응원 생성" on public.club_cheers
  for insert to authenticated with check (auth.uid() = user_id);

-- 동아리 카드에 보여줄 스티커 개수 — 누가 남겼는지는 드러나지 않는다
create or replace view public.club_cheer_counts as
  select club_id, sticker_type, count(*)::int as cnt
  from public.club_cheers
  group by club_id, sticker_type;
revoke all on public.club_cheer_counts from anon;
grant select on public.club_cheer_counts to authenticated;


-- ------------------------------------------------------------
-- B-2. world_events — 마을이장이 연 이벤트
--      대상 코호트(target_*)와 근거(reason_note)는 관리자 전용 → 테이블은 브라우저 차단,
--      시민은 아래 뷰로 공개 컬럼만 본다.
-- ------------------------------------------------------------
create table if not exists public.world_events (
  id               bigint generated always as identity primary key,
  title            text not null,                 -- 중립 문구 (설계 문서 7절)
  description      text,
  place            text not null check (place in
                   ('plaza','park','game_room','cafe','club_center','support_center','mission_room')),
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  target_sgg_code  text,                          -- 관리자 전용: 먼저 노출할 코호트
  target_age_group text,
  target_gender    text check (target_gender in ('M','F','U')),
  reason_note      text,                          -- 관리자 전용: 데이터 근거
  model_version    text,
  created_at       timestamptz not null default now()
);
alter table public.world_events enable row level security;   -- 정책 없음 = 브라우저 차단

-- 시민용 뷰: 공개 컬럼 + "내게 먼저 보여줄지"(정렬용). 근거·대상 코호트는 나가지 않는다
create or replace view public.world_events_public as
  select e.id, e.title, e.description, e.place, e.starts_at, e.ends_at,
         exists (
           select 1 from public.profiles p
           where p.id = auth.uid()
             and p.sgg_code = e.target_sgg_code
             and p.age_group = e.target_age_group
             and coalesce(p.gender,'U') = coalesce(e.target_gender, coalesce(p.gender,'U'))
         ) as featured
  from public.world_events e
  where e.ends_at is null or e.ends_at > now();
revoke all on public.world_events_public from anon;
grant select on public.world_events_public to authenticated;


-- ------------------------------------------------------------
-- B-3. event_participation — 이벤트 참여 (개인, 본인만)
-- ------------------------------------------------------------
create table if not exists public.event_participation (
  event_id  bigint not null references public.world_events(id) on delete cascade,
  user_id   uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.event_participation enable row level security;

drop policy if exists "본인 참여 조회" on public.event_participation;
create policy "본인 참여 조회" on public.event_participation
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "본인 참여 생성" on public.event_participation;
create policy "본인 참여 생성" on public.event_participation
  for insert to authenticated with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- B-4. npc_demand_logs — 하루·코코 수요 로그 (개인, 본인만). 위험 신호가 아니라 수요 신호
--      action: view 조회 / recommend 추천 받음 / apply_click 신청 링크 열기 /
--              self_reported "신청했어요"·"참여했어요" / ineligible 자격 요건으로 걸러짐
-- ------------------------------------------------------------
create table if not exists public.npc_demand_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  npc_type   text not null check (npc_type in ('policy','job','civil','coco')),
  category   text not null,       -- 하루: 주거·생활비·취업지원·상담 … / 코코: 운동·독서·게임·문화 …
  item_id    text,                -- 추천한 자원·프로그램 id (welfare_catalog 등)
  action     text not null check (action in ('view','recommend','apply_click','self_reported','ineligible')),
  created_at timestamptz not null default now()
);
create index if not exists idx_npc_demand_logs_user on public.npc_demand_logs (user_id, created_at desc);
alter table public.npc_demand_logs enable row level security;

drop policy if exists "본인 수요로그 조회" on public.npc_demand_logs;
create policy "본인 수요로그 조회" on public.npc_demand_logs
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "본인 수요로그 생성" on public.npc_demand_logs;
create policy "본인 수요로그 생성" on public.npc_demand_logs
  for insert to authenticated with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- B-5. 집계 테이블 — 코호트×주. user_id 없음, 브라우저 차단 (= "이장의 장부")
-- ------------------------------------------------------------
create table if not exists public.world_activity_metrics (
  week_start        date not null,
  sgg_code          text not null,
  age_group         text not null,
  gender            text not null default 'U' check (gender in ('M','F','U')),
  source            text not null default 'live' check (source in ('live','synthetic')),
  user_count        int  not null default 0,               -- 이번 주 활동한 사람 수(중복 제거) — k 판단용
  quest_done        jsonb not null default '{}'::jsonb,    -- 단계별 완료 수 {"1": 4, "2": 1, ...}
  event_participants int not null default 0,
  cheer_count       int  not null default 0,
  primary key (week_start, sgg_code, age_group, gender, source)
);
alter table public.world_activity_metrics enable row level security;   -- 정책 없음

create table if not exists public.npc_demand_metrics (
  week_start   date not null,
  sgg_code     text not null,
  age_group    text not null,
  gender       text not null default 'U' check (gender in ('M','F','U')),
  npc_type     text not null check (npc_type in ('policy','job','civil','coco')),
  category     text not null,
  source       text not null default 'live' check (source in ('live','synthetic')),
  user_count   int not null default 0,
  views        int not null default 0,
  recommends   int not null default 0,
  apply_clicks int not null default 0,
  self_reported int not null default 0,
  ineligible   int not null default 0,       -- 자격 미달 수요 = 제도 사각지대 근거
  primary key (week_start, sgg_code, age_group, gender, npc_type, category, source)
);
alter table public.npc_demand_metrics enable row level security;       -- 정책 없음


-- ------------------------------------------------------------
-- B-6. world_reports — 마을이장 월드 리포트 (관리자 대시보드 해설)
--      숫자는 템플릿이 stats에서 넣고, LLM은 문장만 쓴다. 점수 계산에는 쓰지 않는다.
--      월드 전체 요약은 sgg_code = 'ALL', age_group = 'ALL', gender = 'U'.
-- ------------------------------------------------------------
create table if not exists public.world_reports (
  week_start    date not null,
  sgg_code      text not null,
  age_group     text not null,
  gender        text not null default 'U' check (gender in ('M','F','U')),
  report_text   text not null,
  stats         jsonb not null default '{}'::jsonb,   -- 문장에 들어간 숫자 원본(검증용)
  generated_by  text not null default 'template' check (generated_by in ('template','llm')),
  model_version text,
  created_at    timestamptz not null default now(),
  primary key (week_start, sgg_code, age_group, gender)
);
alter table public.world_reports enable row level security;            -- 정책 없음


-- ------------------------------------------------------------
-- C-1. 월드 활동 집계 — 퀘스트 완료·이벤트 참여·응원 스티커를 코호트×주로
-- ------------------------------------------------------------
create or replace function public.aggregate_world_activity()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.world_activity_metrics where source = 'live';

  with acts as (
    select mp.user_id, date_trunc('week', mp.completed_at)::date as w, 'quest'::text as kind, m.stage
    from public.mission_progress mp
    join public.missions m on m.id = mp.mission_id
    where mp.status = 'done' and mp.completed_at is not null
    union all
    select ep.user_id, date_trunc('week', ep.joined_at)::date, 'event', null
    from public.event_participation ep
    union all
    select cc.user_id, date_trunc('week', cc.created_at)::date, 'cheer', null
    from public.club_cheers cc
  ),
  base as (
    select a.*, p.sgg_code, p.age_group, coalesce(p.gender,'U') as g
    from acts a join public.profiles p on p.id = a.user_id
    where p.sgg_code is not null and p.age_group is not null
  ),
  agg as (
    select w, sgg_code, age_group, g,
           count(distinct user_id)::int                                   as users,
           count(distinct user_id) filter (where kind = 'event')::int     as ev_users,
           count(*) filter (where kind = 'cheer')::int                    as cheers
    from base group by w, sgg_code, age_group, g
  ),
  quests as (
    select w, sgg_code, age_group, g, jsonb_object_agg(stage::text, cnt) as qj
    from (select w, sgg_code, age_group, g, stage, count(*)::int as cnt
          from base where kind = 'quest' and stage is not null
          group by w, sgg_code, age_group, g, stage) q
    group by w, sgg_code, age_group, g
  )
  insert into public.world_activity_metrics
    (week_start, sgg_code, age_group, gender, source, user_count, quest_done, event_participants, cheer_count)
  select a.w, a.sgg_code, a.age_group, a.g, 'live', a.users, coalesce(q.qj, '{}'::jsonb), a.ev_users, a.cheers
  from agg a
  left join quests q on q.w = a.w and q.sgg_code = a.sgg_code and q.age_group = a.age_group and q.g = a.g;

  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.aggregate_world_activity() from public, anon, authenticated;
grant execute on function public.aggregate_world_activity() to service_role;


-- ------------------------------------------------------------
-- C-2. 하루·코코 수요 집계 — 코호트×주×NPC×분야
-- ------------------------------------------------------------
create or replace function public.aggregate_npc_demand()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.npc_demand_metrics where source = 'live';

  insert into public.npc_demand_metrics
    (week_start, sgg_code, age_group, gender, npc_type, category, source,
     user_count, views, recommends, apply_clicks, self_reported, ineligible)
  select date_trunc('week', d.created_at)::date, p.sgg_code, p.age_group, coalesce(p.gender,'U'),
         d.npc_type, d.category, 'live',
         count(distinct d.user_id)::int,
         count(*) filter (where d.action = 'view')::int,
         count(*) filter (where d.action = 'recommend')::int,
         count(*) filter (where d.action = 'apply_click')::int,
         count(*) filter (where d.action = 'self_reported')::int,
         count(*) filter (where d.action = 'ineligible')::int
  from public.npc_demand_logs d
  join public.profiles p on p.id = d.user_id
  where p.sgg_code is not null and p.age_group is not null
  group by 1, 2, 3, 4, 5, 6;

  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.aggregate_npc_demand() from public, anon, authenticated;
grant execute on function public.aggregate_npc_demand() to service_role;
