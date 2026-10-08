-- ============================================================
-- 06_haru.sql — 하루 v1: 복지 정책 안내 + 월드 소통 창구
--
-- 먼저 01·02·03이 적용돼 있어야 한다(profiles, report_crisis, npc_demand_logs).
-- 여러 번 실행해도 안전하다.
--
-- 흐름
--   risk_agent/haru_sync.py ─(secret key)─► welfare_programs   복지로 API 3종을 주 1회 받아 정리
--   시민 → 지원센터 하루 → recommend_programs(메뉴)             내 지역·나이대로 거른 정책 카드
--                         program_counts(메뉴)                 맞는 수 · 특정 대상 수 · 자격이 안 맞아 빠진 수
--                         npc_demand_logs (03)                  추천·링크 열기·신청했어요·자격 미달 (수요 신호)
--   시민 → 하루 → submit_world_feedback(종류, 장소, 글)        의견함(90일). 위기 표현이면 저장하지 않고 report_crisis('civil')
--
--   A. welfare_programs        정책 목록(공공 정보, 개인 정보 없음). 브라우저는 함수로만 읽는다
--   B. recommend_programs()    정책 카드 / program_counts()  개수
--   C. world_feedback          의견함 + submit_world_feedback() + purge_world_feedback()
--
-- 원칙
--   - 하루는 위험 등급을 읽지 않는다. 하루의 기록은 위험 신호가 아니라 수요 신호다.
--   - 특정 대상 정책(장애인·저소득·한부모 등)은 사용자가 펼칠 때만 보여 주고, 무엇을 펼쳤는지 저장하지 않는다.
--   - 의견 본문은 위기 검사 후 저장하고, 전화번호·이메일은 가린다. 90일 뒤 지운다.
-- 설계: docs/planning/사회적고립_AI에이전트_통합기획서.md 6-3, docs/planning/소셜월드_게임흐름_NPC_설계.md 3-4·6절
-- ============================================================


-- ------------------------------------------------------------
-- A. 정책 목록 — haru_sync.py가 채운다(secret key). 브라우저 직접 접근은 막는다(정책 없음)
-- ------------------------------------------------------------
create table if not exists public.welfare_programs (
  serv_id         text primary key,                 -- 복지로 서비스 ID (WLF…)
  source          text not null check (source in ('central','local')),   -- 중앙부처 / 지자체
  name            text not null,
  summary         text,
  org             text,                             -- 소관부처·담당 부서
  sgg_code        text,                             -- 지자체 사업만: 11680 강남구 / 51110 춘천시. 중앙은 null(전국)
  region_label    text,                             -- '전국' / '서울특별시 강남구'
  life_stages     text[] not null default '{}',     -- 생애주기: 청년·중장년 …
  themes          text[] not null default '{}',     -- 관심주제(복지로 원문): 주거·생활지원 …
  menus           text[] not null default '{}',     -- 하루 메뉴: housing·living·mind·social·job
  target_groups   text[] not null default '{}',     -- 대상 특성: 장애인·저소득·한부모·조손 … (있으면 특정 대상 정책)
  online_apply    boolean,
  support_cycle   text,                             -- 1회성·월·분기 …
  provision_type  text,                             -- 현금지급·프로그램/서비스 …
  target_text     text,                             -- 지원 대상 (상세 원문)
  criteria_text   text,                             -- 선정 기준
  benefit_text    text,                             -- 지원 내용
  apply_text      text,                             -- 신청 방법
  apply_steps     jsonb not null default '[]',      -- [{stage, text}] 신청→조사→결정→지급
  contacts        jsonb not null default '[]',      -- [{name, value}] 문의처
  homepage        text,
  laws            text[] not null default '{}',     -- 근거 법령·조례
  age_min         smallint,                         -- 대상 문장에서 뽑은 나이(확실할 때만). 없으면 '나이 조건 확인'
  age_max         smallint,
  detail_url      text,                             -- 복지로 상세 페이지
  popularity      integer,                          -- 복지로 조회수(동점 정렬용)
  period_end      date,                             -- 시행 종료일(지자체)
  source_modified date,                             -- 복지로 최종수정일(지자체)
  fetched_at      timestamptz not null default now(),
  is_active       boolean not null default true,    -- 목록에서 사라지거나 끝난 사업은 false(지우지 않음 — 지난 기록이 가리킬 수 있음)
  check (menus <@ array['housing','living','mind','social','job'])
);
create index if not exists idx_welfare_programs_menus on public.welfare_programs using gin (menus);
alter table public.welfare_programs enable row level security;            -- 정책 없음 = 브라우저 차단

comment on table public.welfare_programs is
  '하루 정책 목록. 복지로 API(중앙부처·지자체 복지서비스)를 risk_agent/haru_sync.py가 받아 정리. 개인 정보 없음. 브라우저는 recommend_programs()로만 읽음';
comment on column public.welfare_programs.menus is
  'housing 주거비 / living 생활비 / mind 마음건강 / social 사람 만나기 / job 일·취업 — 관심주제에서 만든다(haru_sync.MENU_FROM_THEME)';


-- ------------------------------------------------------------
-- B. 정책 고르기  ※ 10/8 검수 후 09_haru_rules.sql이 recommend_programs()·program_counts()를 바꾼다
--                  (저소득만 붙은 사업은 특정 대상이 아님). 지금 규칙은 09를 볼 것
--    자격 판단(v1): 활성 · 메뉴 일치 · (전국 또는 내 시군구) · 생애주기 · 나이 범위
--      20대 → 생애주기에 '청년'이 있어야 함 / 30대 → '청년' 또는 '중장년'
--      나이 범위가 있으면 내 나이대(20~29 / 30~39)와 겹쳐야 함. 일부만 겹치면 age_note
--      생애주기·나이가 비어 있으면 거르지 않는다(모르면 보여 주고 '나이 조건 확인')
--    점수: 온라인 신청 +1, 청년 전용 +1 → 같으면 지자체 먼저 → 조회수
-- ------------------------------------------------------------
create or replace function public._haru_scope(
  out my_sgg text, out age_lo int, out age_hi int, out stages text[])
language plpgsql stable security definer set search_path = public
as $$
declare p record;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  select sgg_code, age_group into p from public.profiles where id = auth.uid();
  if not found then raise exception 'profile_required'; end if;
  my_sgg := p.sgg_code;
  if p.age_group = '20대' then age_lo := 20; age_hi := 29; stages := array['청년'];
  elsif p.age_group = '30대' then age_lo := 30; age_hi := 39; stages := array['청년','중장년'];
  else age_lo := null; age_hi := null; stages := null;             -- 그 외: 나이로 거르지 않음
  end if;
end $$;
revoke all on function public._haru_scope() from public, anon, authenticated;

create or replace function public.recommend_programs(
  p_menu text, p_limit int default 3, p_special boolean default false)
returns table (
  serv_id text, name text, summary text, org text, region_label text, is_local boolean,
  benefit_text text, target_text text, criteria_text text, apply_text text,
  detail_url text, homepage text, contact text, online_apply boolean,
  last_checked date, age_note boolean, target_groups text[], reason text)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare s record;
begin
  select * into s from public._haru_scope();
  return query
  with cand as (
    select w.*,
           (w.source = 'local') as loc,
           (s.age_lo is not null and (w.age_min is null and w.age_max is null)) as age_unknown,
           (s.age_lo is not null and (coalesce(w.age_min, 0) > s.age_lo or coalesce(w.age_max, 200) < s.age_hi)) as age_partial
    from public.welfare_programs w
    where w.is_active
      and p_menu = any(w.menus)
      and (w.source = 'central' or w.sgg_code = s.my_sgg)
      and (s.stages is null or cardinality(w.life_stages) = 0 or w.life_stages && s.stages)
      and (s.age_lo is null or (coalesce(w.age_min, 0) <= s.age_hi and coalesce(w.age_max, 200) >= s.age_lo))
      and (cardinality(w.target_groups) > 0) = p_special
  )
  select c.serv_id, c.name, c.summary, c.org, c.region_label, c.loc,
         c.benefit_text, c.target_text, c.criteria_text, c.apply_text,
         c.detail_url, c.homepage,
         nullif(concat_ws(' ', c.contacts->0->>'name', c.contacts->0->>'value'), ''),
         c.online_apply,
         coalesce(c.source_modified, c.fetched_at::date),
         (c.age_unknown or c.age_partial),
         c.target_groups,
         concat_ws(' · ',
           case when c.loc then c.region_label || '에서 하는 사업이에요' end,
           case when c.life_stages = array['청년'] then '청년만을 위한 사업이에요' end,
           case when c.online_apply then '온라인으로 신청할 수 있어요' end,
           case when c.age_partial then '나이 조건이 일부만 맞을 수 있어요' end)
  from cand c
  order by (coalesce(c.online_apply::int, 0) + (c.life_stages = array['청년'])::int) desc,
           c.loc desc, c.popularity desc nulls last, c.name
  limit greatest(1, least(coalesce(p_limit, 3), 10));
end $$;
revoke all on function public.recommend_programs(text, int, boolean) from public, anon;
grant execute on function public.recommend_programs(text, int, boolean) to authenticated;

-- 개수 — 화면의 "특정 대상 정책도 있어요 (n개)"와 수요 기록의 '자격 미달 수'에 쓴다
create or replace function public.program_counts(p_menu text)
returns table (eligible int, special int, ineligible int)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare s record;
begin
  select * into s from public._haru_scope();
  return query
  with region as (
    select w.*,
           ((s.stages is null or cardinality(w.life_stages) = 0 or w.life_stages && s.stages)
            and (s.age_lo is null or (coalesce(w.age_min, 0) <= s.age_hi and coalesce(w.age_max, 200) >= s.age_lo))) as fits
    from public.welfare_programs w
    where w.is_active and p_menu = any(w.menus)
      and (w.source = 'central' or w.sgg_code = s.my_sgg)
  )
  select count(*) filter (where fits and cardinality(target_groups) = 0)::int,
         count(*) filter (where fits and cardinality(target_groups) > 0)::int,
         count(*) filter (where not fits)::int
  from region;
end $$;
revoke all on function public.program_counts(text) from public, anon;
grant execute on function public.program_counts(text) to authenticated;


-- ------------------------------------------------------------
-- C. 월드 소통 창구 — 기능 요청·불편한 점·오류 신고 (2026-09-30 결정: 실제 기관 민원 아님)
--    저장은 submit_world_feedback()으로만. 본인은 자기 의견만 읽는다. 운영팀은 secret key(haru.py list)
-- ------------------------------------------------------------
create table if not exists public.world_feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('feature','inconvenience','bug')),
  place      text check (char_length(place) <= 40),
  body       text not null check (char_length(body) between 1 and 300),
  status     text not null default 'new' check (status in ('new','seen','done')),
  created_at timestamptz not null default now()
);
create index if not exists idx_world_feedback_user on public.world_feedback (user_id, created_at desc);
alter table public.world_feedback enable row level security;
drop policy if exists "본인 의견 조회" on public.world_feedback;
create policy "본인 의견 조회" on public.world_feedback
  for select to authenticated using (auth.uid() = user_id);
-- insert·update·delete 정책 없음 → 함수로만 저장

comment on table public.world_feedback is
  '하루 월드 소통 창구. 위기 표현은 저장하지 않음, 전화번호·이메일은 가림, 90일 뒤 purge_world_feedback()로 삭제';

-- 위기 표현(잠정) — 위기 표현 사전(담당 A)이 나오면 이 목록을 사전으로 바꾼다
create or replace function public._haru_crisis(p text)
returns boolean language sql immutable as $$
  select coalesce(p, '') ~ '(죽고\s*싶|죽어\s*버리|자살|극단적\s*(선택|인\s*생각)|목숨을?\s*끊|살기\s*싫|사라지고\s*싶|없어지고\s*싶|살\s*이유가\s*없)'
$$;

create or replace function public.submit_world_feedback(p_kind text, p_place text, p_body text)
returns text            -- 'saved' | 'crisis' | 'too_many'
language plpgsql volatile security definer set search_path = public
as $$
declare b text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if p_kind not in ('feature','inconvenience','bug') then raise exception 'invalid_kind'; end if;
  if b = '' or char_length(b) > 300 then raise exception 'invalid_body'; end if;
  if public._haru_crisis(b) or public._haru_crisis(p_place) then
    perform public.report_crisis('civil');                -- 지역·시각·NPC 종류만. 본문은 어디에도 남기지 않는다
    return 'crisis';
  end if;
  if (select count(*) from public.world_feedback
       where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    return 'too_many';
  end if;
  b := regexp_replace(b, '0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}', '[전화번호]', 'g');
  b := regexp_replace(b, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[이메일]', 'g');
  insert into public.world_feedback (user_id, kind, place, body)
  values (auth.uid(), p_kind, nullif(left(btrim(coalesce(p_place, '')), 40), ''), b);
  return 'saved';
end $$;
revoke all on function public.submit_world_feedback(text, text, text) from public, anon;
grant execute on function public.submit_world_feedback(text, text, text) to authenticated;

-- 90일 지난 의견 삭제 — haru.py가 부른다(secret key)
create or replace function public.purge_world_feedback(p_days int default 90)
returns integer language plpgsql volatile security definer set search_path = public
as $$
declare n integer;
begin
  delete from public.world_feedback where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_world_feedback(int) from public, anon, authenticated;
grant execute on function public.purge_world_feedback(int) to service_role;
