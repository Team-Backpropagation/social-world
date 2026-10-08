-- ============================================================
-- 전체 순환 연결 — 소셜 월드 ↔ 위험 탐지 에이전트
--
--  [소셜 월드]  NPC 대화 선택지 ─► npc_sessions (개인, 본인만)
--                                        │  aggregate_npc_sessions()  ← 에이전트가 호출
--                                        ▼
--  [DB 내부]                    npc_chat_metrics (코호트 집계, user_id 없음, 클라이언트 차단)
--                                        │  에이전트가 읽음(secret key)
--                                        ▼
--  [위험 탐지 에이전트]  ①~⑩ 실행 ─► cohort_feedback (코호트별 개인화 지시)
--                                        │  본인 코호트 행만 읽기 가능(RLS)
--                                        ▼
--  [소셜 월드]  추천 NPC 표시 · 미션 순서 변경
--
-- 테이블 모양은 DB_테이블_정의서.md / schema.sql을 따르되, 현재 DB에 regions·cohorts 테이블이
-- 아직 없어서 그 외래키만 뺐다. 전체 schema.sql로 옮길 때 외래키를 다시 붙이면 된다.
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
--       여러 번 실행해도 안전하다(if not exists / or replace / drop policy if exists).
-- ============================================================

-- ------------------------------------------------------------
-- 1. npc_sessions — 대화 1회 = 1행. 원문 대신 신호 수치만 저장한다
--    (정의서의 npc_sessions에 신호 컬럼 3개를 추가. 대본형 NPC라 npc_messages 원문 테이블은 불필요)
-- ------------------------------------------------------------
create table if not exists public.npc_sessions (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  npc_type           text not null check (npc_type in ('policy','job','psych','civil')),
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);
alter table public.npc_sessions add column if not exists risk_keyword_count int not null default 0;
alter table public.npc_sessions add column if not exists severity_score numeric(4,2);
alter table public.npc_sessions add column if not exists keyword_tags text[] not null default '{}';

do $$ begin
  alter table public.npc_sessions add constraint npc_sessions_severity_range check (severity_score between 0 and 1);
exception when duplicate_object then null; end $$;

create index if not exists idx_npc_sessions_user on public.npc_sessions (user_id, started_at desc);
alter table public.npc_sessions enable row level security;

drop policy if exists "본인 대화세션 조회" on public.npc_sessions;
create policy "본인 대화세션 조회" on public.npc_sessions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "본인 대화세션 생성" on public.npc_sessions;
create policy "본인 대화세션 생성" on public.npc_sessions
  for insert to authenticated with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. npc_chat_metrics — 코호트 집계. user_id 컬럼이 없다(설계 원칙 2)
--    source: 'live'(실제 대화 집계) / 'synthetic'(시연용 배경 — 가상데이터_생성방식_설명자료.md)
-- ------------------------------------------------------------
create table if not exists public.npc_chat_metrics (
  id                 bigint generated always as identity primary key,
  measured_on        date not null,
  sgg_code           text not null,
  age_group          text not null,
  gender             text not null default 'U' check (gender in ('M','F','U')),
  npc_type           text not null check (npc_type in ('policy','job','psych','civil')),
  session_count      int  not null default 0,
  risk_keyword_count int  not null default 0,
  severity_score     numeric(4,2)
);
alter table public.npc_chat_metrics add column if not exists source text not null default 'live';
do $$ begin
  alter table public.npc_chat_metrics add constraint npc_chat_metrics_source_chk check (source in ('live','synthetic'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.npc_chat_metrics
    add constraint npc_chat_metrics_cohort_uniq unique (measured_on, sgg_code, age_group, gender, npc_type, source);
exception when duplicate_object or duplicate_table then null; end $$;

-- 대시보드용 추가 컬럼 (2026-09-23)
--   user_count   : 대화한 사람 수(중복 제거). k-익명성은 세션 수가 아니라 사람 수로 판단하는 게 맞다
--   keyword_tags : 위험 키워드별 등장 횟수 {"무기력": 3, ...}. 원문이 아니라 대본 선택지에 붙은 태그의 개수
alter table public.npc_chat_metrics add column if not exists user_count int not null default 0;
alter table public.npc_chat_metrics add column if not exists keyword_tags jsonb not null default '{}'::jsonb;

create index if not exists idx_npc_chat_metrics_date on public.npc_chat_metrics (measured_on desc);
-- RLS를 켜고 정책을 만들지 않는다 = 브라우저(anon/authenticated)는 읽기·쓰기 모두 불가.
-- secret key를 쓰는 에이전트만 접근한다.
alter table public.npc_chat_metrics enable row level security;

-- ------------------------------------------------------------
-- 3. escalations — 위기 발화 기록 (8-1 가드레일)
--    user_id는 비워 둔다: 정의서 10장 Open Item("식별자 보관 여부 법률·윤리 검토 필요")이
--    확정되기 전까지는 지역·시각·NPC 종류만 남긴다.
-- ------------------------------------------------------------
create table if not exists public.escalations (
  id         bigint generated always as identity primary key,
  session_id bigint references public.npc_sessions(id) on delete set null,
  user_id    uuid references auth.users(id) on delete set null,
  npc_type   text,
  sgg_code   text,
  severity   text not null check (severity in ('high','critical')),
  handled_by uuid references auth.users(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.escalations add column if not exists npc_type text;
alter table public.escalations enable row level security;   -- 정책 없음 = 클라이언트 차단

-- ------------------------------------------------------------
-- 4. cohort_feedback — ⑩ 환류. 에이전트가 쓰고, 사용자는 "자기 코호트" 행만 읽는다
--    위험 등급·점수는 일부러 넣지 않는다: 시민 화면에 "당신의 집단은 위험"이 노출될 경로를 없앤다.
-- ------------------------------------------------------------
create table if not exists public.cohort_feedback (
  sgg_code          text not null,
  age_group         text not null,
  gender            text not null check (gender in ('M','F','U')),
  npc_emphasis      text check (npc_emphasis in ('policy','job','psych','civil')),
  priority_missions text[] not null default '{}',
  model_version     text,
  updated_at        timestamptz not null default now(),
  primary key (sgg_code, age_group, gender)
);
alter table public.cohort_feedback enable row level security;
drop policy if exists "내 코호트 개인화 조회" on public.cohort_feedback;
create policy "내 코호트 개인화 조회" on public.cohort_feedback
  for select to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.sgg_code = cohort_feedback.sgg_code
        and p.age_group = cohort_feedback.age_group
        and coalesce(p.gender, 'U') = cohort_feedback.gender
    )
  );

-- ------------------------------------------------------------
-- 5. 집계 함수 — 개인 세션을 코호트×월로 묶어 npc_chat_metrics(live)에 쓴다
--    security definer: 함수 안에서만 profiles와 조인할 수 있고, 결과에는 user_id가 남지 않는다.
--    에이전트(secret key = service_role)만 호출할 수 있다.
-- ------------------------------------------------------------
create or replace function public.aggregate_npc_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.npc_chat_metrics where source = 'live';

  with base as (
    select date_trunc('month', s.started_at)::date as m,
           p.sgg_code, p.age_group, coalesce(p.gender, 'U') as g, s.npc_type,
           s.user_id, s.risk_keyword_count, s.severity_score, s.keyword_tags
    from public.npc_sessions s
    join public.profiles p on p.id = s.user_id
    where p.sgg_code is not null and p.age_group is not null
  ),
  agg as (
    select m, sgg_code, age_group, g, npc_type,
           count(*)::int                           as n_sessions,
           count(distinct user_id)::int            as n_users,
           sum(risk_keyword_count)::int            as n_keywords,
           round(avg(coalesce(severity_score, 0)), 2) as sev
    from base group by m, sgg_code, age_group, g, npc_type
  ),
  tag_counts as (
    select m, sgg_code, age_group, g, npc_type, t as tag, count(*)::int as cnt
    from base, unnest(keyword_tags) as t
    group by m, sgg_code, age_group, g, npc_type, t
  ),
  tags as (
    select m, sgg_code, age_group, g, npc_type, jsonb_object_agg(tag, cnt) as tj
    from tag_counts group by m, sgg_code, age_group, g, npc_type
  )
  insert into public.npc_chat_metrics
    (measured_on, sgg_code, age_group, gender, npc_type,
     session_count, user_count, risk_keyword_count, severity_score, keyword_tags, source)
  select a.m, a.sgg_code, a.age_group, a.g, a.npc_type,
         a.n_sessions, a.n_users, a.n_keywords, a.sev, coalesce(t.tj, '{}'::jsonb), 'live'
  from agg a
  left join tags t
    on t.m = a.m and t.sgg_code = a.sgg_code and t.age_group = a.age_group
   and t.g = a.g and t.npc_type = a.npc_type;

  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.aggregate_npc_sessions() from public, anon, authenticated;
grant execute on function public.aggregate_npc_sessions() to service_role;

-- ------------------------------------------------------------
-- 6. 위기 기록 함수 — 브라우저가 호출. 본인 지역만 남기고 user_id는 저장하지 않는다
-- ------------------------------------------------------------
create or replace function public.report_crisis(p_npc_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- REVIEW FIX: 브라우저 RPC가 임의 문자열이나 반복 호출로 관제 기록을 오염시키지 않게 제한한다.
  if p_npc_type not in ('policy', 'job', 'psych', 'civil') then
    raise exception 'invalid npc type';
  end if;

  insert into public.escalations (npc_type, sgg_code, severity)
  select p_npc_type, p.sgg_code, 'critical'
  from public.profiles p
  where p.id = auth.uid()
    and not exists (
      select 1
      from public.escalations e
      where e.sgg_code = p.sgg_code
        and e.npc_type = p_npc_type
        and e.created_at > now() - interval '5 minutes'
    );
end $$;
revoke all on function public.report_crisis(text) from public, anon;
grant execute on function public.report_crisis(text) to authenticated;

-- ------------------------------------------------------------
-- 7. 환류 대상 미션 — 에이전트가 추천하는 미션 제목과 맞춘다
-- ------------------------------------------------------------
insert into public.missions (title, description, reward_point, is_active)
select v.title, v.description, v.reward_point, true
from (values
  ('취업상담 NPC와 대화하기', '광장의 취업상담 NPC에게 지금 준비 단계를 이야기해 보세요.', 15),
  ('정책추천 NPC와 대화하기', '광장의 정책추천 NPC에게 받을 수 있는 지원을 물어보세요.', 15)
) as v(title, description, reward_point)
where not exists (select 1 from public.missions m where m.title = v.title);
