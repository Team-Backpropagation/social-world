-- ============================================================================
-- 사회적 고립 대응 및 예방 AI 에이전트 — 데이터베이스 스키마
--   대상 DBMS : PostgreSQL 15+ (Supabase 기준)
--   작성일    : 2026-09-22
--   연관 문서 : 기능 정의서 v2.1, 화면 기획서 v2.1, DB_연결_단계별_실행가이드.md
--
-- 실행 방법 : Supabase 대시보드 → SQL Editor → New query에 전체 붙여넣기 → Run
--             (모듈 단위로 나눠 실행해도 되지만 위에서부터 순서대로 실행해야 한다.
--              외래키가 앞 모듈의 테이블을 참조하기 때문이다.)
--
-- MVP 최소 실행 범위 : 모듈 0,1,6,8,9,11  (소셜 월드 프로토타입만 띄울 경우)
-- 전체 실행          : 모듈 0~11          (관제 대시보드까지 함께 구현할 경우)
--
-- ※ auth.users 는 Supabase가 자동 생성·관리하는 계정 테이블이다.
--    Supabase가 아닌 일반 PostgreSQL에서 실행할 경우 auth.users 참조를 제거하고
--    자체 users 테이블로 대체해야 한다.
-- ============================================================================


-- ============================================================================
-- 모듈 0. 공통 함수
-- ============================================================================

-- updated_at 자동 갱신용 트리거 함수
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- 모듈 1. 기준정보 (Dimension)
--   분석·위험도·서비스 전반이 공유하는 기준 테이블
-- ============================================================================

-- 지역 (행정표준코드 기준)
create table public.regions (
  sgg_code   text primary key,                    -- 시군구 코드 (예: 11680)
  sido_name  text    not null,                    -- 시도명   (예: 서울특별시)
  sgg_name   text    not null,                    -- 시군구명 (예: 강남구)
  is_target  boolean not null default false       -- 대회 대상 지역 여부(강남구·춘천시)
);
comment on table public.regions is '지역 기준정보. 통신·카드 데이터와 소셜월드 프로필의 공통 지역 키';

-- 코호트 : 지역 × 성별 × 연령대. 분석과 위험도 산출의 기본 단위
create table public.cohorts (
  id        bigint generated always as identity primary key,
  sgg_code  text not null references public.regions(sgg_code),
  gender    text not null check (gender in ('M', 'F')),
  age_group text not null check (age_group in ('10대','20대','30대','40대','50대','60대이상')),
  unique (sgg_code, gender, age_group)
);
comment on table public.cohorts is '지역×성별×연령대 코호트. 개인이 아닌 이 단위로만 위험도를 산출한다';

-- 카드 업종 마스터
create table public.industries (
  industry_cd   text primary key,                 -- 업종 코드
  industry_name text    not null,                 -- 업종명
  group_name    text,                             -- 상위 카테고리
  is_fixed_cost boolean not null default false    -- 고정지출 여부(세금공과금·보험·통신요금·학교등록금·결제대행)
);
comment on table public.industries is '카드 업종 마스터. is_fixed_cost = 사회적 활동과 무관한 자동이체성 지출로, 이벤트 탐지 시 제외 대상';


-- ============================================================================
-- 모듈 2. 거시 분석 데이터 (통신·카드 파이프라인 산출물 적재)
--   preprocessing/clean/ 산출물을 그대로 적재하는 영역
-- ============================================================================

-- 통신 유동인구 : 월별 배경지표(baseline)
create table public.flow_cohort_monthly (
  cohort_id bigint  not null references public.cohorts(id) on delete cascade,
  std_ym    char(6) not null check (std_ym ~ '^[0-9]{6}$'),   -- 기준년월 (예: 202507)
  flow_pop  bigint  not null,                                 -- 일평균 유동인구
  primary key (cohort_id, std_ym)
);
comment on table public.flow_cohort_monthly is '통신 유동인구 월별 집계. 코호트의 평상시 활동 수준(배경지표)';

-- 카드 결제 : 일별 트리거 신호
create table public.card_cohort_daily (
  cohort_id     bigint not null references public.cohorts(id) on delete cascade,
  ta_ymd        date   not null,                              -- 결제일자
  resident_type text   not null check (resident_type in ('resident','visitor','unknown')),
  pay_count     bigint not null,                              -- 결제건수
  pay_amount    bigint not null,                              -- 결제금액
  primary key (cohort_id, ta_ymd, resident_type)
);
comment on table public.card_cohort_daily is '카드 결제 일별 집계. 변화 신호(trigger)의 원천. resident_type은 CLN_SGG_CD 기반 거주자/외지인 구분';

-- 카드 결제 : 업종별 (업종 구성·엔트로피 계산용)
create table public.card_industry_daily (
  cohort_id   bigint not null references public.cohorts(id) on delete cascade,
  ta_ymd      date   not null,
  industry_cd text   not null references public.industries(industry_cd),
  pay_count   bigint not null,
  pay_amount  bigint not null,
  primary key (cohort_id, ta_ymd, industry_cd)
);
comment on table public.card_industry_daily is '카드 업종별 일별 집계. 업종 구성 엔트로피와 이벤트 반응도 산출의 입력';

-- 이벤트 구간 (명절·공휴일 등)
create table public.event_periods (
  id         bigint generated always as identity primary key,
  label      text not null,                                   -- 추석연휴, 성탄절 등
  start_date date not null,
  end_date   date not null,
  event_type text not null check (event_type in ('mobility','nationwide','regional')),
  sgg_code   text references public.regions(sgg_code),        -- null이면 전 지역 공통
  check (end_date >= start_date)
);
comment on table public.event_periods is '이벤트 구간. mobility=지역 간 이동 이벤트(명절·공휴일), nationwide=전국 공통 외부요인, regional=지역 사정';

-- 일자별 구간 라벨 (baseline / event / eval 3분할)
create table public.date_splits (
  ta_ymd      date primary key,
  split_label text not null check (split_label in ('baseline','event','eval'))
);
comment on table public.date_splits is 'baseline(평상시 프로파일 산정) / event(반응도 측정) / eval(추세 이탈 검증) 3분할 라벨';


-- ============================================================================
-- 모듈 3. 위험도 산출 결과
-- ============================================================================

create table public.risk_scores (
  id            bigint generated always as identity primary key,
  cohort_id     bigint  not null references public.cohorts(id) on delete cascade,
  scored_on     date    not null,                              -- 산출 기준일
  score         numeric(5,2) not null check (score between 0 and 100),
  risk_level    smallint not null check (risk_level between 1 and 5),
  prev_risk_level smallint check (prev_risk_level between 1 and 5),
  baseline_z    numeric(6,3),                                  -- 거시: 통신 배경지표
  trigger_z     numeric(6,3),                                  -- 거시: 카드 트리거
  event_response numeric(6,3),                                 -- 거시: 이벤트 반응도
  micro_signal  numeric(6,3),                                  -- 미시: 소셜월드 신호(표본 부족 시 null)
  model_version text not null default 'v1',
  created_at    timestamptz not null default now(),
  unique (cohort_id, scored_on)
);
comment on table public.risk_scores is '코호트별 5단계 위험도 산출 결과. 1=안심 2=관찰 3=주의 4=경계 5=위험';

-- 위험 요인 기여도 (S-05 원인분석 화면이 읽는 표)
create table public.risk_factors (
  id            bigint generated always as identity primary key,
  risk_score_id bigint not null references public.risk_scores(id) on delete cascade,
  factor_code   text   not null check (factor_code in
                  ('activity_drop','industry_concentration','event_no_response','micro_keyword','structural')),
  factor_name   text   not null,
  contribution  numeric(5,2) not null,                          -- 기여도(%)
  description   text                                            -- LLM 생성 자연어 설명
);
comment on table public.risk_factors is '위험도를 끌어올린 요인별 기여도 분해 결과(F-08)';


-- ============================================================================
-- 모듈 4. 복지자원 · 케이스 (관제 대시보드 운영)
-- ============================================================================

create table public.welfare_resources (
  id         bigint generated always as identity primary key,
  name       text not null,
  provider   text,                                             -- 제공기관
  category   text check (category in ('돌봄','정신건강','청년지원','경제지원','고용','기타')),
  sgg_code   text references public.regions(sgg_code),          -- null이면 전국 단위 자원
  target_age text,
  contact    text,
  apply_url  text,
  is_active  boolean not null default true
);
comment on table public.welfare_resources is '연계 가능한 공공·복지 자원 목록(F-10 매칭 대상)';

create table public.resource_recommendations (
  id            bigint generated always as identity primary key,
  risk_score_id bigint   not null references public.risk_scores(id) on delete cascade,
  resource_id   bigint   not null references public.welfare_resources(id),
  rank_no       smallint not null,                             -- 추천 순위
  match_reason  text,                                          -- 매칭 근거
  created_at    timestamptz not null default now(),
  unique (risk_score_id, resource_id)
);
comment on table public.resource_recommendations is '위험도 산출 결과에 대한 복지자원 추천 목록(S-06)';

create table public.cases (
  id            bigint generated always as identity primary key,
  case_no       text   not null unique,                        -- CASE-2026-0001
  cohort_id     bigint not null references public.cohorts(id),
  risk_score_id bigint references public.risk_scores(id),
  risk_level    smallint not null check (risk_level between 1 and 5),
  status        text   not null default 'received'
                  check (status in ('received','reviewing','in_progress','on_hold','completed','closed')),
  assignee_id   uuid references auth.users(id),
  close_reason  text check (close_reason in ('risk_resolved','not_target','unreachable')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.cases is 'Lv.3 이상 코호트에 대한 담당자 개입 관리 단위(S-07, S-08)';

create trigger cases_touch_updated_at
  before update on public.cases
  for each row execute function public.touch_updated_at();

-- 케이스 처리 이력 타임라인
create table public.case_events (
  id          bigint generated always as identity primary key,
  case_id     bigint not null references public.cases(id) on delete cascade,
  event_type  text   not null check (event_type in ('status_change','comment','attachment','assign')),
  from_status text,
  to_status   text,
  content     text,
  file_url    text,
  actor_id    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
comment on table public.case_events is '케이스 상태변경·코멘트·첨부 이력(S-08 타임라인, 감사 추적용)';

-- 공무원 행동 제안 (S-12)
create table public.action_suggestions (
  id                bigint generated always as identity primary key,
  case_id           bigint references public.cases(id) on delete cascade,
  cohort_id         bigint not null references public.cohorts(id),
  seq               smallint not null,                         -- 실행 순서
  action_text       text     not null,
  resource_id       bigint references public.welfare_resources(id),
  due_date          date,
  is_checked        boolean not null default false,
  is_low_confidence boolean not null default false,            -- 근거 부족 시 '참고용' 표시
  created_at        timestamptz not null default now()
);
comment on table public.action_suggestions is 'AI가 생성한 담당자 행동 제안. 누구를·어떤 순서로·어떤 자원과(F-23)';

-- 보고서 · 제안서 초안 (S-13)
create table public.reports (
  id         bigint generated always as identity primary key,
  case_id    bigint references public.cases(id) on delete set null,
  cohort_id  bigint references public.cohorts(id),
  title      text not null,
  body       jsonb not null,                                   -- {"현황":..., "근거":..., "제안":...}
  status     text not null default 'draft' check (status in ('draft','final')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
comment on table public.reports is 'LLM이 생성한 보고서·제안서 초안. 섹션 구조를 jsonb로 보관해 섹션별 재생성이 가능(F-24)';


-- ============================================================================
-- 모듈 5. 시스템 (권한 · 알림 · 설정 · 감사)
-- ============================================================================

-- 관제 대시보드 담당자 계정
create table public.admin_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  department text,
  role       text not null default 'worker' check (role in ('worker','manager','viewer')),
  sgg_code   text references public.regions(sgg_code),
  created_at timestamptz not null default now()
);
comment on table public.admin_profiles is '관제 대시보드 사용자. 이 테이블에 행이 있어야 대시보드 데이터에 접근할 수 있다(F-20)';

-- 대시보드 접근 권한 판별 함수 (RLS 정책에서 사용)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

create table public.notifications (
  id           bigint generated always as identity primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('risk_up','new_case','escalation','report_ready')),
  title        text not null,
  body         text,
  link_url     text,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
comment on table public.notifications is '담당자 알림(S-09). escalation 유형은 소셜월드 위기 신호에서 발생';

create table public.threshold_settings (
  id            bigint generated always as identity primary key,
  setting_key   text not null unique,
  setting_value numeric not null,
  description   text,
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now()
);
comment on table public.threshold_settings is '위험도 임계값·가중치 설정(S-11). 코드 수정 없이 조정 가능하도록 DB로 관리';

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id),
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
comment on table public.audit_logs is '임계값 변경·케이스 처리 등 주요 행위 감사 로그(F-21)';


-- ============================================================================
-- 모듈 6. 소셜 월드 (시민 대면 서비스)
-- ============================================================================

-- 사용자 프로필 (SW-02 온보딩 결과)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null,
  sgg_code     text not null references public.regions(sgg_code),   -- 거주 시군구
  age_group    text check (age_group in ('10대','20대','30대','40대','50대','60대이상')),
  gender       text check (gender in ('M','F','U')),
  created_at   timestamptz not null default now(),
  onboarded_at timestamptz                                          -- null이면 온보딩 미완료
);
comment on table public.profiles is '소셜월드 사용자 프로필. sgg_code·age_group·gender 세 칸이 위험 탐지의 코호트 키가 된다';

-- 미션 (SW-06)
create table public.missions (
  id           bigint generated always as identity primary key,
  title        text not null,
  description  text,
  reward_point int  not null default 0,
  due_date     date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.mission_progress (
  id           bigint generated always as identity primary key,
  user_id      uuid   not null references auth.users(id) on delete cascade,
  mission_id   bigint not null references public.missions(id) on delete cascade,
  status       text   not null default 'in_progress' check (status in ('in_progress','done')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, mission_id)
);

-- 동아리 (SW-07, 확장 범위이나 스키마는 선반영)
create table public.clubs (
  id          bigint generated always as identity primary key,
  name        text not null,
  category    text check (category in ('문화','공연','체육','학습','기타')),
  description text,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.club_members (
  club_id   bigint not null references public.clubs(id) on delete cascade,
  user_id   uuid   not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- NPC 대화 세션
create table public.npc_sessions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  npc_type   text not null check (npc_type in ('policy','job','psych','civil')),
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
comment on table public.npc_sessions is 'NPC 대화 세션. 대화 맥락 구성(F-26)에 사용';

-- NPC 대화 원문
--   ※ 보관 여부·보관 기간은 아직 확정되지 않은 정책 항목이다(기획서 9-3 Open Item).
--     현재 스키마는 "본인만 조회 가능"으로 잠가 두었고, 위험 탐지 에이전트에는
--     이 표가 아니라 모듈 7의 집계 지표만 전달한다.
create table public.npc_messages (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references public.npc_sessions(id) on delete cascade,
  sender_role text   not null check (sender_role in ('user','assistant')),
  content     text   not null,
  created_at  timestamptz not null default now()
);
comment on table public.npc_messages is 'NPC 대화 원문. 보관 기간 정책 확정 필요. 위험 탐지에는 절대 원문이 아닌 집계 지표만 전달한다';

-- 위기 에스컬레이션 기록 (F-43)
create table public.escalations (
  id         bigint generated always as identity primary key,
  session_id bigint references public.npc_sessions(id) on delete set null,
  user_id    uuid references auth.users(id) on delete set null,  -- 대응 정책상 식별자 보관 여부는 확정 필요
  sgg_code   text references public.regions(sgg_code),
  severity   text not null check (severity in ('high','critical')),
  handled_by uuid references auth.users(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.escalations is '위기 신호 감지 기록. 전문기관·109 안내와 관리자 즉시 알림의 근거 로그';


-- ============================================================================
-- 모듈 7. 미시 신호 집계 (개인 식별자 없음)
--   위험 탐지 에이전트로 전달되는 유일한 경로. user_id를 의도적으로 두지 않는다.
-- ============================================================================

-- 심리상담 NPC 위험 키워드 지표 (F-35 → F-22)
create table public.npc_chat_metrics (
  id                 bigint generated always as identity primary key,
  measured_on        date not null,
  sgg_code           text not null references public.regions(sgg_code),
  age_group          text not null,
  gender             text not null default 'U' check (gender in ('M','F','U')),
  npc_type           text not null check (npc_type in ('policy','job','psych','civil')),
  session_count      int  not null default 0,
  risk_keyword_count int  not null default 0,
  severity_score     numeric(4,2),
  unique (measured_on, sgg_code, age_group, gender, npc_type)
);
comment on table public.npc_chat_metrics is '대화 기반 미시 신호의 코호트 단위 집계. 개인 식별자를 담지 않는다(F-32)';

-- 정책·취업·민원 NPC 활동 지표 (범주별 수요 분포)
create table public.npc_activity_metrics (
  id           bigint generated always as identity primary key,
  measured_on  date not null,
  sgg_code     text not null references public.regions(sgg_code),
  age_group    text not null,
  gender       text not null default 'U' check (gender in ('M','F','U')),
  npc_type     text not null check (npc_type in ('policy','job','civil')),
  metric_key   text not null check (metric_key in
                 ('policy_view','policy_apply','eligibility_fail','job_field','job_stage','civil_type','benefit_view')),
  metric_value text not null default '',                      -- 정책명·민원유형 등 범주값
  metric_count int  not null default 0,
  unique (measured_on, sgg_code, age_group, gender, npc_type, metric_key, metric_value)
);
comment on table public.npc_activity_metrics is '정책추천·취업상담·민원챗봇의 수요 분포 집계. eligibility_fail은 제도 사각지대의 직접 근거';

-- 게임 활동성 지표 (행동 프록시)
create table public.engagement_metrics (
  measured_on          date not null,
  sgg_code             text not null references public.regions(sgg_code),
  age_group            text not null,
  gender               text not null default 'U' check (gender in ('M','F','U')),
  active_users         int  not null default 0,
  avg_session_minutes  numeric(6,2),
  mission_complete_cnt int  not null default 0,
  club_activity_cnt    int  not null default 0,
  primary key (measured_on, sgg_code, age_group, gender)
);
comment on table public.engagement_metrics is '로그인 빈도·미션 참여 등 활동성 집계. 고립도의 행동 프록시로 활용';


-- ============================================================================
-- 모듈 8. 인덱스
-- ============================================================================

create index idx_card_cohort_daily_date   on public.card_cohort_daily (ta_ymd);
create index idx_card_industry_daily_date on public.card_industry_daily (ta_ymd);
create index idx_risk_scores_scored_on    on public.risk_scores (scored_on desc);
create index idx_risk_scores_level        on public.risk_scores (risk_level) where risk_level >= 3;
create index idx_risk_factors_score       on public.risk_factors (risk_score_id);
create index idx_cases_status             on public.cases (status);
create index idx_cases_assignee           on public.cases (assignee_id);
create index idx_case_events_case         on public.case_events (case_id, created_at desc);
create index idx_notifications_unread     on public.notifications (recipient_id, is_read) where is_read = false;
create index idx_mission_progress_user    on public.mission_progress (user_id);
create index idx_npc_sessions_user        on public.npc_sessions (user_id, started_at desc);
create index idx_npc_messages_session     on public.npc_messages (session_id, created_at);
create index idx_npc_chat_metrics_date    on public.npc_chat_metrics (measured_on desc);


-- ============================================================================
-- 모듈 9. RLS (Row Level Security)
--   원칙 1 : 소셜월드 데이터는 "본인 것만"
--   원칙 2 : 대시보드 데이터는 "admin_profiles에 등록된 담당자만"
--   원칙 3 : 미시 집계·거시 원천 데이터는 클라이언트 쓰기 불가(service_role 전용)
-- ============================================================================

alter table public.regions               enable row level security;
alter table public.cohorts               enable row level security;
alter table public.industries            enable row level security;
alter table public.flow_cohort_monthly   enable row level security;
alter table public.card_cohort_daily     enable row level security;
alter table public.card_industry_daily   enable row level security;
alter table public.event_periods         enable row level security;
alter table public.date_splits           enable row level security;
alter table public.risk_scores           enable row level security;
alter table public.risk_factors          enable row level security;
alter table public.welfare_resources     enable row level security;
alter table public.resource_recommendations enable row level security;
alter table public.cases                 enable row level security;
alter table public.case_events           enable row level security;
alter table public.action_suggestions    enable row level security;
alter table public.reports               enable row level security;
alter table public.admin_profiles        enable row level security;
alter table public.notifications         enable row level security;
alter table public.threshold_settings    enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.profiles              enable row level security;
alter table public.missions              enable row level security;
alter table public.mission_progress      enable row level security;
alter table public.clubs                 enable row level security;
alter table public.club_members          enable row level security;
alter table public.npc_sessions          enable row level security;
alter table public.npc_messages          enable row level security;
alter table public.escalations           enable row level security;
alter table public.npc_chat_metrics      enable row level security;
alter table public.npc_activity_metrics  enable row level security;
alter table public.engagement_metrics    enable row level security;

-- ---- 9-1. 소셜 월드 : 본인 데이터만 ----------------------------------------

create policy "본인 프로필 조회" on public.profiles
  for select using (auth.uid() = id);
create policy "본인 프로필 생성" on public.profiles
  for insert with check (auth.uid() = id);
create policy "본인 프로필 수정" on public.profiles
  for update using (auth.uid() = id);

create policy "미션 목록 조회" on public.missions
  for select to authenticated using (is_active);

create policy "본인 미션기록 조회" on public.mission_progress
  for select using (auth.uid() = user_id);
create policy "본인 미션기록 생성" on public.mission_progress
  for insert with check (auth.uid() = user_id);
create policy "본인 미션기록 수정" on public.mission_progress
  for update using (auth.uid() = user_id);

create policy "동아리 목록 조회" on public.clubs
  for select to authenticated using (true);
create policy "동아리 개설" on public.clubs
  for insert with check (auth.uid() = owner_id);
create policy "동아리 삭제" on public.clubs
  for delete using (auth.uid() = owner_id);

create policy "동아리 멤버 조회" on public.club_members
  for select to authenticated using (true);
create policy "동아리 가입" on public.club_members
  for insert with check (auth.uid() = user_id);
create policy "동아리 탈퇴" on public.club_members
  for delete using (auth.uid() = user_id);

create policy "본인 대화세션 조회" on public.npc_sessions
  for select using (auth.uid() = user_id);
create policy "본인 대화세션 생성" on public.npc_sessions
  for insert with check (auth.uid() = user_id);

create policy "본인 대화내용 조회" on public.npc_messages
  for select using (
    exists (
      select 1 from public.npc_sessions s
      where s.id = npc_messages.session_id and s.user_id = auth.uid()
    )
  );

-- ---- 9-2. 기준정보 : 로그인한 사용자는 읽기만 -------------------------------

create policy "지역 조회" on public.regions
  for select to authenticated using (true);
create policy "코호트 조회" on public.cohorts
  for select to authenticated using (true);
create policy "업종 조회" on public.industries
  for select to authenticated using (true);
create policy "복지자원 조회" on public.welfare_resources
  for select to authenticated using (is_active);

-- ---- 9-3. 관제 대시보드 : 담당자만 -----------------------------------------

create policy "담당자 본인정보 조회" on public.admin_profiles
  for select using (auth.uid() = id or public.is_admin());

create policy "담당자 유동인구 조회" on public.flow_cohort_monthly
  for select using (public.is_admin());
create policy "담당자 카드집계 조회" on public.card_cohort_daily
  for select using (public.is_admin());
create policy "담당자 업종집계 조회" on public.card_industry_daily
  for select using (public.is_admin());
create policy "담당자 이벤트구간 조회" on public.event_periods
  for select using (public.is_admin());
create policy "담당자 구간라벨 조회" on public.date_splits
  for select using (public.is_admin());
create policy "담당자 위험도 조회" on public.risk_scores
  for select using (public.is_admin());
create policy "담당자 위험요인 조회" on public.risk_factors
  for select using (public.is_admin());
create policy "담당자 자원추천 조회" on public.resource_recommendations
  for select using (public.is_admin());

create policy "담당자 케이스 조회" on public.cases
  for select using (public.is_admin());
create policy "담당자 케이스 생성" on public.cases
  for insert with check (public.is_admin());
create policy "담당자 케이스 수정" on public.cases
  for update using (public.is_admin());

create policy "담당자 처리이력 조회" on public.case_events
  for select using (public.is_admin());
create policy "담당자 처리이력 등록" on public.case_events
  for insert with check (public.is_admin() and auth.uid() = actor_id);

create policy "담당자 행동제안 조회" on public.action_suggestions
  for select using (public.is_admin());
create policy "담당자 행동제안 수정" on public.action_suggestions
  for update using (public.is_admin());

create policy "담당자 보고서 조회" on public.reports
  for select using (public.is_admin());
create policy "담당자 보고서 생성" on public.reports
  for insert with check (public.is_admin());
create policy "담당자 보고서 수정" on public.reports
  for update using (public.is_admin());

create policy "본인 알림 조회" on public.notifications
  for select using (auth.uid() = recipient_id);
create policy "본인 알림 읽음처리" on public.notifications
  for update using (auth.uid() = recipient_id);

create policy "담당자 임계값 조회" on public.threshold_settings
  for select using (public.is_admin());
create policy "관리자 임계값 수정" on public.threshold_settings
  for update using (
    exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.role = 'manager')
  );

create policy "담당자 감사로그 조회" on public.audit_logs
  for select using (public.is_admin());

-- ---- 9-4. 정책을 만들지 않는 테이블 (service_role 전용) ---------------------
--   escalations, npc_chat_metrics, npc_activity_metrics, engagement_metrics
--   → RLS는 켜져 있고 정책이 없으므로 클라이언트에서는 읽기·쓰기 모두 차단된다.
--     백엔드(service_role key)만 접근할 수 있으며, 대시보드 노출은 아래 뷰를 통한다.


-- ============================================================================
-- 모듈 10. 뷰
-- ============================================================================

-- 코호트별 최신 위험도 (S-02 대시보드·S-03 지도에서 사용)
create or replace view public.v_cohort_latest_risk
with (security_invoker = on) as
select distinct on (c.id)
  c.id            as cohort_id,
  r.sgg_code,
  r.sgg_name,
  c.gender,
  c.age_group,
  rs.scored_on,
  rs.score,
  rs.risk_level,
  rs.prev_risk_level
from public.cohorts c
join public.regions r on r.sgg_code = c.sgg_code
left join public.risk_scores rs on rs.cohort_id = c.id
order by c.id, rs.scored_on desc nulls last;

-- k-익명성 적용 미시 지표 (F-44) : 표본이 기준 미만인 코호트는 노출하지 않는다
create or replace view public.v_npc_metrics_public
with (security_invoker = on) as
select
  measured_on, sgg_code, age_group, gender, npc_type,
  session_count, risk_keyword_count, severity_score
from public.npc_chat_metrics
where session_count >= 5;   -- k=5 (기준값은 팀 확정 필요)

-- 우선지원 대상 (S-02 Top 10 테이블)
create or replace view public.v_priority_targets
with (security_invoker = on) as
select
  v.cohort_id, v.sgg_name, v.gender, v.age_group,
  v.score, v.risk_level, v.prev_risk_level,
  (v.risk_level - coalesce(v.prev_risk_level, v.risk_level)) as level_delta,
  exists (select 1 from public.cases c where c.cohort_id = v.cohort_id and c.status not in ('completed','closed')) as has_open_case
from public.v_cohort_latest_risk v
where v.risk_level >= 3
order by v.risk_level desc, v.score desc;


-- ============================================================================
-- 모듈 11. 시드 데이터
-- ============================================================================

-- 대상 지역
insert into public.regions (sgg_code, sido_name, sgg_name, is_target) values
  ('11680', '서울특별시',     '강남구', true),
  ('51110', '강원특별자치도', '춘천시', true)
on conflict (sgg_code) do nothing;

-- 코호트 24개 자동 생성 (2지역 × 2성별 × 6연령대)
insert into public.cohorts (sgg_code, gender, age_group)
select r.sgg_code, g.gender, a.age_group
from public.regions r
cross join (values ('M'), ('F')) as g(gender)
cross join (values ('10대'), ('20대'), ('30대'), ('40대'), ('50대'), ('60대이상')) as a(age_group)
where r.is_target
on conflict (sgg_code, gender, age_group) do nothing;

-- 고정지출 업종 (EDA 12-3 결과 : 제외 시 오탐 7일 → 0일)
insert into public.industries (industry_cd, industry_name, is_fixed_cost) values
  ('TAX',  '세금공과금',   true),
  ('INS',  '보험',         true),
  ('TEL',  '통신요금',     true),
  ('TUIT', '학교등록금',   true),
  ('PG',   '결제대행',     true)
on conflict (industry_cd) do nothing;

-- 위험도 가중치·임계값 기본값 (기능 정의서 3-1)
insert into public.threshold_settings (setting_key, setting_value, description) values
  ('weight_baseline',      0.25, '거시 배경지표(통신) 가중치'),
  ('weight_trigger',       0.40, '거시 트리거(카드) 가중치'),
  ('weight_event_response',0.20, '이벤트 반응도 가중치'),
  ('weight_micro_signal',  0.15, '미시 신호(소셜월드) 가중치'),
  ('anomaly_z_threshold',  3.50, '이상탐지 robust z-score 임계값'),
  ('k_anonymity_min',      5.00, '미시 지표 노출 최소 표본 수'),
  ('escalation_hours',    24.00, 'Lv.4 이상 케이스 미확인 시 에스컬레이션 기준 시간')
on conflict (setting_key) do nothing;

-- 이벤트 구간 (EDA 12-7 3분할 기준)
insert into public.event_periods (label, start_date, end_date, event_type) values
  ('전국 공통 요인(원인 미확인)', '2025-07-16', '2025-07-17', 'nationwide'),
  ('광복절',                      '2025-08-15', '2025-08-15', 'mobility'),
  ('추석 연휴',                   '2025-10-03', '2025-10-09', 'mobility'),
  ('연말',                        '2025-12-24', '2025-12-31', 'mobility')
on conflict do nothing;

-- ============================================================================
-- 끝. 실행 후 확인 : Table Editor에 31개 테이블과 3개 뷰가 보이면 정상이다.
-- ============================================================================
