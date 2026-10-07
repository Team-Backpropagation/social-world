-- ============================================================
-- 07_feedback_chat.sql — 마을 의견함을 '대화'로: 시민 ⇄ 운영팀(사람)
--
-- 먼저 01·02·03·06이 적용돼 있어야 한다(report_crisis, world_feedback, welfare_programs).
-- 여러 번 실행해도 안전하다.
--
-- 흐름
--   시민 → 이장 [마을에 건의하기] ─┐
--   시민 → 하루 카드 [정보가 달라요] ┴─► submit_feedback(창구, 종류, 장소, 글, 정책id) ─► world_feedback
--   운영팀 화면(social_world/admin) ─로그인─► staff_* 함수 ─► 답장(feedback_messages, author='staff')
--   시민 휴대폰 '내 의견함' ─► my_feedback() · reply_my_feedback() · delete_my_feedback()
--
--   A. world_feedback 확장   channel(chief|haru) · serv_id · 마지막 활동 · 시민이 읽은 시각
--   B. feedback_messages     의견 하나에 달리는 메시지(시민/운영팀)
--   C. staff_members         운영팀 명단 — SQL Editor에서 직접 넣는다(아래 '운영팀 등록')
--   D. 시민 함수 · E. 운영팀 함수 · F. 90일 삭제
--   G. 정책추천·취업상담 창구 → 지원센터 하루 (미션 교체)
--
-- 원칙
--   - 운영팀 답장은 운영팀 명단에 있는 사람이 로그인해서만 쓴다. NPC·LLM·브라우저 일반 사용자는 못 쓴다.
--   - 운영팀에게 시민의 계정·닉네임을 보여 주지 않는다. '주민 #7F3A' 같은 가명 번호만.
--   - 운영팀 화면은 의견함만 다룬다. 위험 점수·대화 기록은 이 함수들로 읽을 수 없다.
--   - 시민 글은 위기 검사 후 저장(위기면 저장하지 않고 report_crisis('civil')), 전화번호·이메일은 가린다.
--   - 하루 횟수 제한(한국 날짜 기준): 새 의견 5건, 답장 20건. 지운 의견도 그날 횟수에서 빠지지 않는다.
--
-- 운영팀 등록 (SQL Editor, 한 번):
--   insert into public.staff_members (user_id, label)
--   select id, '운영팀' from auth.users where email = '팀원@메일' on conflict do nothing;
-- ============================================================


-- ------------------------------------------------------------
-- A. world_feedback 확장
-- ------------------------------------------------------------
alter table public.world_feedback add column if not exists channel text not null default 'chief';
alter table public.world_feedback add column if not exists serv_id text;
alter table public.world_feedback add column if not exists updated_at timestamptz;
update public.world_feedback set updated_at = created_at where updated_at is null;     -- 06에서 받은 의견은 보낸 시각으로
alter table public.world_feedback alter column updated_at set default now();
alter table public.world_feedback alter column updated_at set not null;
alter table public.world_feedback add column if not exists citizen_read_at timestamptz;

do $$ begin
  alter table public.world_feedback add constraint world_feedback_channel_check check (channel in ('chief','haru'));
exception when duplicate_object then null; end $$;
alter table public.world_feedback drop constraint if exists world_feedback_kind_check;
alter table public.world_feedback add constraint world_feedback_kind_check
  check (kind in ('feature','inconvenience','bug','info'));
do $$ begin
  alter table public.world_feedback add constraint world_feedback_info_haru check (kind <> 'info' or channel = 'haru');
exception when duplicate_object then null; end $$;

comment on column public.world_feedback.channel is 'chief 이장(마을 전체 의견) / haru 하루(정책 카드 정보 오류)';
comment on column public.world_feedback.serv_id is '하루 [정보가 달라요]로 보낸 정책의 복지로 id';
comment on column public.world_feedback.kind is 'feature 기능 요청 / inconvenience 불편 / bug 오류 / info 정책 정보가 달라요(하루)';


-- ------------------------------------------------------------
-- B. 메시지 — 의견 원문은 world_feedback.body, 그 뒤 주고받는 말은 여기
-- ------------------------------------------------------------
create table if not exists public.feedback_messages (
  id          bigint generated always as identity primary key,
  feedback_id bigint not null references public.world_feedback(id) on delete cascade,
  author      text not null check (author in ('citizen','staff')),
  staff_id    uuid references auth.users(id) on delete set null,   -- 누가 답했는지(운영 기록용, 시민에게 안 보임)
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now(),
  check (author = 'staff' or staff_id is null)                    -- 시민 메시지에는 운영팀 id가 없다
);
create index if not exists idx_feedback_messages_fb on public.feedback_messages (feedback_id, created_at);
alter table public.feedback_messages enable row level security;          -- 정책 없음 = 함수로만


-- ------------------------------------------------------------
-- C. 운영팀 명단 · 하루 횟수
-- ------------------------------------------------------------
create table if not exists public.staff_members (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  label    text not null default '운영팀',
  added_at timestamptz not null default now()
);
alter table public.staff_members enable row level security;              -- 정책 없음

create table if not exists public.feedback_rate (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  kind    text not null check (kind in ('new','reply')),
  n       int  not null default 0,
  primary key (user_id, day, kind)
);
alter table public.feedback_rate enable row level security;              -- 정책 없음

create or replace function public._is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.staff_members where user_id = auth.uid())
$$;
revoke all on function public._is_staff() from public, anon, authenticated;

-- 운영팀 화면이 "권한 없음"을 보여 줄 때만 쓴다
create or replace function public.am_i_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public._is_staff()
$$;
revoke all on function public.am_i_staff() from public, anon;
grant execute on function public.am_i_staff() to authenticated;

create or replace function public._feedback_mask(p text)
returns text language sql immutable as $$
  select regexp_replace(regexp_replace(btrim(coalesce(p, '')),
           '0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}', '[전화번호]', 'g'),
           '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[이메일]', 'g')
$$;

-- 오늘(한국 날짜) 횟수를 하나 쓴다. 한도를 넘으면 false
create or replace function public._feedback_take(p_kind text, p_limit int)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare got int;
begin
  insert into public.feedback_rate as r (user_id, day, kind, n)
  values (auth.uid(), (now() at time zone 'Asia/Seoul')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set n = r.n + 1 where r.n < p_limit
  returning n into got;
  return got is not null;
end $$;
revoke all on function public._feedback_take(text, int) from public, anon, authenticated;

create or replace function public._feedback_alias(p_user uuid)
returns text language sql immutable as $$
  select '주민 #' || upper(left(md5(p_user::text || ':eum-feedback'), 4))
$$;
revoke all on function public._feedback_alias(uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
-- D. 시민 함수
-- ------------------------------------------------------------
create or replace function public.submit_feedback(
  p_channel text, p_kind text, p_place text, p_body text, p_serv_id text default null)
returns text            -- 'saved' | 'crisis' | 'too_many'
language plpgsql volatile security definer set search_path = public
as $$
declare b text := btrim(coalesce(p_body, ''));
        sid text := nullif(btrim(coalesce(p_serv_id, '')), '');
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if p_channel not in ('chief','haru') then raise exception 'invalid_channel'; end if;
  if p_kind not in ('feature','inconvenience','bug','info') or (p_kind = 'info' and p_channel <> 'haru') then
    raise exception 'invalid_kind';
  end if;
  if b = '' or char_length(b) > 300 then raise exception 'invalid_body'; end if;
  if p_channel <> 'haru' then sid := null; end if;
  if sid is not null and not exists (select 1 from public.welfare_programs where serv_id = sid) then
    raise exception 'invalid_program';
  end if;
  if public._haru_crisis(b) or public._haru_crisis(p_place) then
    perform public.report_crisis('civil');              -- 지역·시각·NPC 종류만. 본문은 어디에도 남기지 않는다
    return 'crisis';
  end if;
  if not public._feedback_take('new', 5) then return 'too_many'; end if;
  insert into public.world_feedback (user_id, channel, kind, place, body, serv_id)
  values (auth.uid(), p_channel, p_kind,
          nullif(left(public._feedback_mask(p_place), 40), ''), public._feedback_mask(b), sid);
  return 'saved';
end $$;
revoke all on function public.submit_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text) to authenticated;

-- 06의 옛 이름은 이장 창구로 그대로 둔다(호환)
create or replace function public.submit_world_feedback(p_kind text, p_place text, p_body text)
returns text language sql volatile security definer set search_path = public as $$
  select public.submit_feedback('chief', p_kind, p_place, p_body, null)
$$;
revoke all on function public.submit_world_feedback(text, text, text) from public, anon;
grant execute on function public.submit_world_feedback(text, text, text) to authenticated;

-- 내 의견함 — 운영팀이 누구인지(staff_id)는 돌려주지 않는다
create or replace function public.my_feedback()
returns table (id bigint, channel text, kind text, place text, serv_id text, program_name text,
               body text, status text, created_at timestamptz, updated_at timestamptz,
               unread boolean, messages jsonb)
language sql stable security definer set search_path = public
as $$
  select f.id, f.channel, f.kind, f.place, f.serv_id, w.name, f.body, f.status, f.created_at, f.updated_at,
         exists (select 1 from public.feedback_messages m where m.feedback_id = f.id and m.author = 'staff'
                   and m.created_at > coalesce(f.citizen_read_at, '-infinity')),
         coalesce((select jsonb_agg(jsonb_build_object('who', case m.author when 'staff' then 'staff' else 'me' end,
                                                       'body', m.body, 'at', m.created_at) order by m.created_at, m.id)
                   from public.feedback_messages m where m.feedback_id = f.id), '[]'::jsonb)
  from public.world_feedback f
  left join public.welfare_programs w on w.serv_id = f.serv_id
  where auth.uid() is not null and f.user_id = auth.uid()
  order by f.updated_at desc, f.id desc
$$;
revoke all on function public.my_feedback() from public, anon;
grant execute on function public.my_feedback() to authenticated;

-- 휴대폰 알림 배지용 — 안 읽은 운영팀 답이 달린 의견 수
create or replace function public.my_feedback_unread()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.world_feedback f
  where auth.uid() is not null and f.user_id = auth.uid()
    and exists (select 1 from public.feedback_messages m where m.feedback_id = f.id and m.author = 'staff'
                  and m.created_at > coalesce(f.citizen_read_at, '-infinity'))
$$;
revoke all on function public.my_feedback_unread() from public, anon;
grant execute on function public.my_feedback_unread() to authenticated;

create or replace function public.read_my_feedback(p_id bigint)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  update public.world_feedback set citizen_read_at = now() where id = p_id and user_id = auth.uid();
  return found;
end $$;
revoke all on function public.read_my_feedback(bigint) from public, anon;
grant execute on function public.read_my_feedback(bigint) to authenticated;

create or replace function public.reply_my_feedback(p_id bigint, p_body text)
returns text            -- 'saved' | 'crisis' | 'too_many' | 'not_found'
language plpgsql volatile security definer set search_path = public
as $$
declare b text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if b = '' or char_length(b) > 300 then raise exception 'invalid_body'; end if;
  if not exists (select 1 from public.world_feedback where id = p_id and user_id = auth.uid()) then
    return 'not_found';
  end if;
  if public._haru_crisis(b) then
    perform public.report_crisis('civil');
    return 'crisis';
  end if;
  if not public._feedback_take('reply', 20) then return 'too_many'; end if;
  insert into public.feedback_messages (feedback_id, author, body) values (p_id, 'citizen', public._feedback_mask(b));
  update public.world_feedback
     set updated_at = now(), citizen_read_at = now(),
         status = case when status = 'done' then 'seen' else status end      -- 끝난 의견에 다시 쓰면 다시 열림
   where id = p_id;
  return 'saved';
end $$;
revoke all on function public.reply_my_feedback(bigint, text) from public, anon;
grant execute on function public.reply_my_feedback(bigint, text) to authenticated;

create or replace function public.delete_my_feedback(p_id bigint)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.world_feedback where id = p_id and user_id = auth.uid();     -- 메시지도 같이 지워짐(cascade)
  return found;
end $$;
revoke all on function public.delete_my_feedback(bigint) from public, anon;
grant execute on function public.delete_my_feedback(bigint) to authenticated;


-- ------------------------------------------------------------
-- E. 운영팀 함수 — 명단에 없으면 'staff_only'로 거절. 시민 계정은 가명 번호로만
-- ------------------------------------------------------------
create or replace function public.staff_feedback_list(
  p_status text default null, p_channel text default null, p_limit int default 200)
returns table (id bigint, alias text, channel text, kind text, place text, serv_id text, program_name text,
               body text, status text, created_at timestamptz, updated_at timestamptz,
               waiting boolean, messages jsonb)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not public._is_staff() then raise exception 'staff_only'; end if;
  return query
  select f.id, public._feedback_alias(f.user_id), f.channel, f.kind, f.place, f.serv_id, w.name,
         f.body, f.status, f.created_at, f.updated_at,
         coalesce((select m.author = 'citizen' from public.feedback_messages m
                   where m.feedback_id = f.id order by m.created_at desc, m.id desc limit 1), true) and f.status <> 'done',
         coalesce((select jsonb_agg(jsonb_build_object('who', m.author, 'body', m.body, 'at', m.created_at)
                                    order by m.created_at, m.id)
                   from public.feedback_messages m where m.feedback_id = f.id), '[]'::jsonb)
  from public.world_feedback f
  left join public.welfare_programs w on w.serv_id = f.serv_id
  where (p_status is null or f.status = p_status)
    and (p_channel is null or f.channel = p_channel)
  order by (f.status = 'done'), f.updated_at desc, f.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;
revoke all on function public.staff_feedback_list(text, text, int) from public, anon;
grant execute on function public.staff_feedback_list(text, text, int) to authenticated;

create or replace function public.staff_reply(p_id bigint, p_body text)
returns text            -- 'saved' | 'not_found'
language plpgsql volatile security definer set search_path = public
as $$
declare b text := btrim(coalesce(p_body, ''));
begin
  if not public._is_staff() then raise exception 'staff_only'; end if;
  if b = '' or char_length(b) > 500 then raise exception 'invalid_body'; end if;
  if not exists (select 1 from public.world_feedback where id = p_id) then return 'not_found'; end if;
  insert into public.feedback_messages (feedback_id, author, staff_id, body) values (p_id, 'staff', auth.uid(), b);
  update public.world_feedback
     set updated_at = now(), status = case when status = 'new' then 'seen' else status end
   where id = p_id;
  return 'saved';
end $$;
revoke all on function public.staff_reply(bigint, text) from public, anon;
grant execute on function public.staff_reply(bigint, text) to authenticated;

create or replace function public.staff_set_status(p_id bigint, p_status text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not public._is_staff() then raise exception 'staff_only'; end if;
  if p_status not in ('new','seen','done') then raise exception 'invalid_status'; end if;
  update public.world_feedback set status = p_status, updated_at = now() where id = p_id;
  return found;
end $$;
revoke all on function public.staff_set_status(bigint, text) from public, anon;
grant execute on function public.staff_set_status(bigint, text) to authenticated;


-- ------------------------------------------------------------
-- F. 90일 삭제 — 보낸 날 기준. 메시지도 같이, 지난 횟수 기록도 정리
-- ------------------------------------------------------------
create or replace function public.purge_world_feedback(p_days int default 90)
returns integer language plpgsql volatile security definer set search_path = public
as $$
declare n integer;
begin
  delete from public.world_feedback where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  delete from public.feedback_rate where day < (now() at time zone 'Asia/Seoul')::date - 7;
  return n;
end $$;
revoke all on function public.purge_world_feedback(int) from public, anon, authenticated;
grant execute on function public.purge_world_feedback(int) to service_role;


-- ------------------------------------------------------------
-- G. 정책추천·취업상담 창구 → 지원센터 하루
--    옛 미션은 지우지 않고 끈다(지난 참여 기록이 가리킴). 02를 다시 실행해도 제목이 있으니 다시 생기지 않는다.
--    risk_agent/pipeline.py의 우선 미션 제목도 함께 바꿨다.
-- ------------------------------------------------------------
insert into public.missions (title, description, reward_point, is_active, stage)
select '지원센터 하루 만나기', '지원센터에 들러 하루에게 받을 수 있는 지원을 물어보세요.', 15, true, 1
where not exists (select 1 from public.missions where title = '지원센터 하루 만나기');
update public.missions set is_active = false
 where title in ('정책추천 NPC와 대화하기', '취업상담 NPC와 대화하기') and is_active;
