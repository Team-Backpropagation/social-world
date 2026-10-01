-- =====================================================================
-- 04_coco.sql — 코코(활동 추천 NPC) v1
-- 전제: 01_socialworld_base.sql, 02_loop_schema.sql, 03_world_update.sql 적용 후 실행
--       (profiles.interests, missions.stage 칸을 03이 만든다)
-- 여러 번 실행해도 안전하다.
--
-- 만드는 것
--   A. clubs.interest_tags      동아리에 관심사 태그(운동·게임 등)를 단다
--   B. activity_catalog         월드 밖 활동 목록(지역 행사·러닝크루 등) + 시연용 시드
--   C. my_quest_stage()         지금 로그인한 유저의 퀘스트 단계(1~4)
--   D. recommend_activities()   코코 추천. 본인 프로필을 함수 안에서 읽는다
--
-- 설계 근거: docs/planning/소셜월드_게임흐름_NPC_설계.md 3-4, 6절
-- 코코는 위험 등급·cohort_feedback을 읽지 않는다(환류는 마을이장만 받는다).
-- LLM을 쓰지 않는다. 점수와 추천 이유 문장 모두 규칙으로 만든다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. 동아리 관심사 태그
-- 튜토리얼 관심사 8종과 같은 이름을 쓴다. 비어 있으면 관심사 점수만 0이 된다.
-- ---------------------------------------------------------------------
alter table public.clubs add column if not exists interest_tags text[];

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clubs_interest_tags_chk') then
    alter table public.clubs add constraint clubs_interest_tags_chk
      check (interest_tags is null
             or interest_tags <@ array['운동','게임','음악','독서','요리','취업','공부','휴식']);
  end if;
end $$;

-- 기존 동아리의 category로 한 번 채운다(이미 채워진 행은 건드리지 않음)
update public.clubs
   set interest_tags = case category
         when '체육' then array['운동']
         when '운동' then array['운동']
         when '공연' then array['음악']
         when '음악' then array['음악']
         when '게임' then array['게임']
         when '독서' then array['독서']
         when '요리' then array['요리']
         when '스터디' then array['공부']
         when '공부' then array['공부']
         when '취업' then array['취업']
         else null
       end
 where interest_tags is null;


-- ---------------------------------------------------------------------
-- B. 활동 목록 (월드 밖 활동)
-- 오프라인 항목은 sgg_code가 있어야 한다. 온라인 항목은 지역과 상관없이 추천된다.
-- 신청은 게임이 대신 하지 않는다: apply_url을 새 탭으로 열고, 유저가 "신청했어요"로 자기보고.
-- ---------------------------------------------------------------------
create table if not exists public.activity_catalog (
  id            bigint generated always as identity primary key,
  title         text not null,
  summary       text not null,
  interest_tags text[] not null default '{}',
  sgg_code      text,                         -- 11680 강남구 / 51110 춘천시. 온라인이면 null
  is_online     boolean not null default false,
  place_label   text,                         -- 화면에 보일 장소 설명
  weekdays      smallint[],                   -- 열리는 요일 0=일 ~ 6=토. null이면 상시
  time_label    text,                         -- 화면에 보일 시간 설명
  stage         smallint not null default 3,  -- 가장 잘 맞는 퀘스트 단계
  apply_url     text,                         -- 실제 신청 페이지. 시연용 항목은 비워 둔다
  source        text not null default 'demo', -- demo = 시연용 가상 항목 / official = 실제 공고
  source_note   text,                         -- 출처 메모(기관명·확인 날짜 등)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint activity_catalog_tags_chk
    check (interest_tags <@ array['운동','게임','음악','독서','요리','취업','공부','휴식']),
  constraint activity_catalog_stage_chk   check (stage between 1 and 4),
  constraint activity_catalog_place_chk   check (is_online or sgg_code is not null),
  constraint activity_catalog_url_chk     check (apply_url is null or apply_url ~ '^https://'),
  constraint activity_catalog_source_chk  check (source in ('demo', 'official')),
  constraint activity_catalog_weekday_chk check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint activity_catalog_title_uq    unique nulls not distinct (title, sgg_code)
);

alter table public.activity_catalog enable row level security;
drop policy if exists "활동 목록 조회" on public.activity_catalog;
create policy "활동 목록 조회" on public.activity_catalog
  for select to authenticated using (is_active);
grant select on public.activity_catalog to authenticated;
-- 쓰기 정책은 만들지 않는다 → 목록 관리는 service_role(관리자 스크립트)만

-- 시연용 가상 항목. 실제 기관·공고가 아니다(source='demo', 신청 링크 없음).
-- 실제 공고로 바꿀 때는 source='official', apply_url, source_note를 채운다.
insert into public.activity_catalog
  (title, summary, interest_tags, sgg_code, is_online, place_label, weekdays, time_label, stage, source)
values
  ('호숫가 저녁 러닝',       '처음 오는 사람도 뒤처지지 않게 천천히 5km를 달려요.',
   array['운동'],        '51110', false, '춘천 호숫가 산책로', array[4]::smallint[], '목요일 저녁 7시', 3, 'demo'),
  ('주말 보드게임 모임',     '규칙을 몰라도 옆에서 알려줘요. 2시간이면 끝나요.',
   array['게임'],        '51110', false, '춘천 시내 보드게임 카페', array[6]::smallint[], '토요일 오후 2시', 3, 'demo'),
  ('동네 책 한 권 모임',     '한 달에 한 권, 읽은 만큼만 이야기해요.',
   array['독서'],        '51110', false, '춘천 동네 작은도서관', array[3]::smallint[], '수요일 저녁 7시 30분', 3, 'demo'),
  ('청년 요리 클래스',       '혼자 먹을 한 끼를 같이 만들어요. 재료는 준비돼 있어요.',
   array['요리'],        '51110', false, '춘천 청년 공간 공용 부엌', array[5]::smallint[], '금요일 저녁 6시 30분', 4, 'demo'),
  ('한강 아침 걷기',         '말 없이 걸어도 괜찮은 1시간 걷기 모임이에요.',
   array['운동','휴식'], '11680', false, '강남 한강 산책로', array[0]::smallint[], '일요일 아침 8시', 3, 'demo'),
  ('퇴근 후 밴드 합주',      '악기를 못 해도 탬버린부터 시작할 수 있어요.',
   array['음악'],        '11680', false, '강남 합주실', array[2]::smallint[], '화요일 저녁 8시', 3, 'demo'),
  ('이력서 같이 쓰는 밤',    '각자 쓰고, 마지막 30분만 서로 봐줘요.',
   array['취업','공부'], '11680', false, '강남 청년 공간 스터디룸', array[1]::smallint[], '월요일 저녁 7시', 4, 'demo'),
  ('온라인 캠스터디',        '카메라만 켜고 각자 공부해요. 말하지 않아도 돼요.',
   array['공부'],        null,    true,  '온라인', null, '매일 오전 10시~12시', 2, 'demo'),
  ('온라인 협동 퍼즐 게임',  '세 명이서 30분 동안 퍼즐 하나를 풀어요.',
   array['게임'],        null,    true,  '온라인', array[5,6]::smallint[], '금·토 저녁 9시', 2, 'demo'),
  ('오늘의 음악 한 곡 나누기', '들은 노래 한 곡만 남기면 끝이에요.',
   array['음악','휴식'], null,    true,  '온라인', null, '아무 때나', 1, 'demo')
on conflict on constraint activity_catalog_title_uq do nothing;


-- ---------------------------------------------------------------------
-- C. 지금 유저의 퀘스트 단계
-- 규칙: 완료한 퀘스트 중 가장 높은 단계 + 1 (최대 4). 완료한 게 없으면 1.
-- ---------------------------------------------------------------------
create or replace function public.my_quest_stage()
returns smallint
language sql
stable
security invoker
set search_path = public
as $$
  select least(4, coalesce(max(m.stage), 0) + 1)::smallint
    from public.mission_progress mp
    join public.missions m on m.id = mp.mission_id
   where mp.user_id = auth.uid()
     and mp.status = 'done'
     and m.stage is not null
$$;

revoke all on function public.my_quest_stage() from public, anon;
grant execute on function public.my_quest_stage() to authenticated;


-- ---------------------------------------------------------------------
-- D. 코코 추천
-- p_mode: 'interest' 관심사로 찾기 / 'today' 오늘 해볼 만한 것 / 'nearby' 가까운 모임
-- 브라우저는 모드와 개수만 보낸다. 관심사·지역·단계는 함수가 본인 프로필에서 읽는다.
--
-- 점수 (정수, 클수록 먼저)
--   관심사  겹치는 태그 1개당 3점, 최대 6점
--   단계    지금 단계와 같음 3 / 한 단계 위 2 / 이미 지난 단계 1 / 두 단계 이상 위 0
--   오늘    (today 모드만) 오늘 열림 3 / 상시 1
-- 거르기
--   이미 가입한 동아리, 다른 지역의 오프라인 활동은 뺀다
--   today 모드: 다른 요일에만 열리는 활동을 뺀다
--   nearby 모드: 내 지역 오프라인 활동만 남긴다
-- ---------------------------------------------------------------------
create or replace function public.recommend_activities(
  p_mode  text default 'interest',
  p_limit int  default 3
)
returns table (
  item_key    text,      -- 'club:12' / 'activity:5' — 수요 로그에 그대로 쓴다
  kind        text,      -- club(월드 동아리) / activity(월드 밖 활동)
  title       text,
  summary     text,
  place_label text,
  time_label  text,
  is_online   boolean,
  apply_url   text,
  is_demo     boolean,
  stage       smallint,
  score       int,
  reason      text       -- 카드에 보일 추천 이유 한 줄(코코 말투)
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid       uuid := auth.uid();
  v_sgg       text;
  v_interests text[];
  v_stage     smallint;
  v_dow       smallint := extract(dow from (now() at time zone 'Asia/Seoul'))::smallint;
  v_limit     int := least(greatest(coalesce(p_limit, 3), 1), 6);
begin
  if v_uid is null then
    raise exception 'login_required' using errcode = '28000';
  end if;
  if p_mode not in ('interest', 'today', 'nearby') then
    raise exception 'unknown_mode: %', p_mode using errcode = '22023';
  end if;

  select p.sgg_code, coalesce(p.interests, '{}')
    into v_sgg, v_interests
    from public.profiles p
   where p.id = v_uid;
  if not found then
    raise exception 'profile_required' using errcode = 'P0002';
  end if;

  v_stage := public.my_quest_stage();

  return query
  with candidates as (
    -- 월드 동아리: 온라인 취급, 3단계 퀘스트("취미 동아리 가입")에 해당
    select 'club:' || c.id            as item_key,
           'club'::text               as kind,
           c.name                     as title,
           coalesce(c.description, '') as summary,
           '동아리센터'::text          as place_label,
           null::text                 as time_label,
           true                       as is_online,
           null::text                 as apply_url,
           false                      as is_demo,
           3::smallint                as stage,
           coalesce(c.interest_tags, '{}') as tags,
           null::smallint[]           as weekdays,
           c.id                       as sort_id
      from public.clubs c
     where p_mode <> 'nearby'
       and not exists (select 1 from public.club_members cm
                        where cm.club_id = c.id and cm.user_id = v_uid)
    union all
    select 'activity:' || a.id,
           'activity',
           a.title,
           a.summary,
           a.place_label,
           a.time_label,
           a.is_online,
           a.apply_url,
           a.source = 'demo',
           a.stage,
           a.interest_tags,
           a.weekdays,
           a.id + 1000000              -- 동점이면 동아리가 먼저
      from public.activity_catalog a
     where a.is_active
       and (a.is_online or a.sgg_code = v_sgg)
       and (p_mode <> 'nearby' or (not a.is_online and a.sgg_code = v_sgg))
  ),
  scored as (
    select c.*,
           array(select unnest(c.tags) intersect select unnest(v_interests)) as hits,
           (c.weekdays is not null and v_dow = any(c.weekdays))              as open_today,
           case
             when c.stage = v_stage     then 3
             when c.stage = v_stage + 1 then 2
             when c.stage <  v_stage    then 1
             else 0
           end as s_stage
      from candidates c
     where p_mode <> 'today' or c.weekdays is null or v_dow = any(c.weekdays)
  )
  select s.item_key,
         s.kind,
         s.title,
         s.summary,
         s.place_label,
         s.time_label,
         s.is_online,
         s.apply_url,
         s.is_demo,
         s.stage,
         ( least(cardinality(s.hits), 2) * 3
           + s.s_stage
           + case when p_mode = 'today' then (case when s.open_today then 3 else 1 end) else 0 end
         )::int as score,
         case
           when p_mode = 'today' and s.open_today then '오늘 열리는 거야. 가볍게 들러 봐'
           when cardinality(s.hits) > 0           then '관심사 ''' || s.hits[1] || '''에 맞춰 골랐어'
           when p_mode = 'nearby'                 then '우리 동네에서 열리는 모임이야'
           when s.s_stage >= 2                    then '지금 단계에서 해보기 딱 좋아'
           else '새로운 걸 한번 해보는 것도 좋아'
         end as reason
    from scored s
   order by score desc, s.sort_id
   limit v_limit;
end;
$$;

revoke all on function public.recommend_activities(text, int) from public, anon;
grant execute on function public.recommend_activities(text, int) to authenticated;
