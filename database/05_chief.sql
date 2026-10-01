-- ============================================================
-- 05_chief.sql — 마을이장 v1: 이벤트 승인·공개, 참여, 관심사 분포 집계
--
-- 먼저 03_world_update.sql이 적용돼 있어야 한다(world_events·event_participation·profiles.interests).
-- 여러 번 실행해도 안전하다.
--
-- 흐름
--   risk_agent/chief.py  ─(secret key)─►  world_events  status='draft'  (대상 코호트·근거는 관리자 전용)
--   담당자 승인          python chief.py approve <id>  →  status='published'
--   시민                 world_events_public 뷰(공개 상태만) → 광장 이장 대화 → join_world_event(id)
--   이장의 장부          aggregate_world_activity() (03) 가 참여 인원을 코호트×주로 집계
--
--   A-1. world_events  status·template_key·theme·approved_at·closed_at
--   A-2. world_events_public  공개 상태만 + 내가 참여했는지(joined)
--   B-1. join_world_event(id)  참여는 이 함수로만(초안·종료 이벤트 참여 차단)
--   C-1. chief_interest_counts(k)  코호트별 관심사 분포 — k명 미만 코호트 제외, user_id 없음
-- ============================================================


-- ------------------------------------------------------------
-- A-1. world_events — 승인 단계
--   draft     이장이 만든 초안. 시민에게 안 보임
--   published 담당자가 승인해 광장에 공개
--   rejected  담당자가 반려(기록용으로 남김)
--   closed    끝남(ends_at이 지나도 뷰에서는 자동으로 빠진다)
-- ------------------------------------------------------------
alter table public.world_events add column if not exists status       text not null default 'draft';
alter table public.world_events add column if not exists template_key text;          -- chief.py 이벤트 템플릿 키
alter table public.world_events add column if not exists theme        text;          -- 환류 이벤트 주제(outdoor_walk 등) 또는 'world'
alter table public.world_events add column if not exists approved_at  timestamptz;
alter table public.world_events add column if not exists closed_at    timestamptz;
do $$ begin
  alter table public.world_events add constraint world_events_status_chk
    check (status in ('draft','published','rejected','closed'));
exception when duplicate_object then null; end $$;
create index if not exists idx_world_events_status on public.world_events (status, starts_at);

comment on column public.world_events.status is
  'draft 초안(비공개) → published 승인·공개 → closed 종료 / rejected 반려. 시민은 published만 본다';


-- ------------------------------------------------------------
-- A-2. 시민용 뷰 — 공개(published)이고 끝나지 않은 이벤트만.
--      featured(내 코호트에 먼저 보여줄지)는 정렬용 불린만 나가고, 대상 코호트·근거는 나가지 않는다.
--      joined: 내가 이미 참여했는지
--      (뷰는 소유자 권한으로 world_events를 읽는다 — 테이블 자체는 정책이 없어 브라우저 차단)
-- ------------------------------------------------------------
create or replace view public.world_events_public as
  select e.id, e.title, e.description, e.place, e.starts_at, e.ends_at,
         exists (
           select 1 from public.profiles p
           where p.id = auth.uid()
             and p.sgg_code = e.target_sgg_code
             and p.age_group = e.target_age_group
             and coalesce(p.gender,'U') = coalesce(e.target_gender, coalesce(p.gender,'U'))
         ) as featured,
         exists (
           select 1 from public.event_participation ep
           where ep.event_id = e.id and ep.user_id = auth.uid()
         ) as joined
  from public.world_events e
  where e.status = 'published'
    and (e.ends_at is null or e.ends_at > now());
revoke all on public.world_events_public from anon;
grant select on public.world_events_public to authenticated;


-- ------------------------------------------------------------
-- B-1. 참여 — 브라우저는 이 함수만 부른다.
--      03의 "본인 참여 생성" 정책을 없애서, 초안·반려·종료 이벤트 id를 알아내도 참여 기록을 못 남기게 한다.
--      반환: true 새로 참여 / false 이미 참여 중
-- ------------------------------------------------------------
drop policy if exists "본인 참여 생성" on public.event_participation;

create or replace function public.join_world_event(p_event_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); n integer;
begin
  if v_uid is null then
    raise exception 'login_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.world_events e
    where e.id = p_event_id and e.status = 'published'
      and (e.ends_at is null or e.ends_at > now())
  ) then
    raise exception 'event_not_open' using errcode = 'P0002';
  end if;
  insert into public.event_participation (event_id, user_id)
  values (p_event_id, v_uid)
  on conflict (event_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.join_world_event(bigint) from public, anon;
grant execute on function public.join_world_event(bigint) to authenticated;


-- ------------------------------------------------------------
-- C-1. 관심사 분포 — 이장이 이벤트 주제를 고를 때 쓰는 코호트 집계
--      튜토리얼 6번 문항(profiles.interests) 기준. 관심사를 하나라도 고른 사람만 센다.
--      p_k명 미만 코호트는 행 자체를 돌려주지 않는다(k-익명성). 다른 지역·기타 나이대 제외.
--      service_role 전용(risk_agent/chief.py가 secret key로 호출)
-- ------------------------------------------------------------
create or replace function public.chief_interest_counts(p_k integer default 5)
returns table (sgg_code text, age_group text, gender text, user_count integer, interests jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id, p.sgg_code, p.age_group, coalesce(p.gender,'U') as g, p.interests
    from public.profiles p
    where p.sgg_code in ('11680','51110') and p.age_group in ('20대','30대')
      and coalesce(array_length(p.interests, 1), 0) > 0
  ),
  cohorts as (
    select b.sgg_code, b.age_group, b.g, count(*)::int as users
    from base b group by 1, 2, 3
    having count(*) >= greatest(p_k, 1)
  ),
  tags as (
    select b.sgg_code, b.age_group, b.g, t.tag, count(*)::int as cnt
    from base b cross join lateral unnest(b.interests) as t(tag)
    group by 1, 2, 3, 4
  )
  select c.sgg_code, c.age_group, c.g, c.users,
         coalesce((select jsonb_object_agg(t.tag, t.cnt) from tags t
                   where t.sgg_code = c.sgg_code and t.age_group = c.age_group and t.g = c.g), '{}'::jsonb)
  from cohorts c
  order by 1, 2, 3;
$$;
revoke all on function public.chief_interest_counts(integer) from public, anon, authenticated;
grant execute on function public.chief_interest_counts(integer) to service_role;


-- ------------------------------------------------------------
-- D-1. cohort_feedback.event_theme — 값은 주제 코드(risk_agent/pipeline.py EVENT_THEME_FROM_FACTOR)
-- ------------------------------------------------------------
comment on column public.cohort_feedback.event_theme is
  '마을이장이 이 코호트에 먼저 보여줄 이벤트 주제 코드: outdoor_walk 부담 없는 야외 활동 / free_activity 돈 안 드는 활동 / info_support 생활 정보·지원 안내 / small_talk 가벼운 대화 모임. 위험 등급은 넣지 않는다';
