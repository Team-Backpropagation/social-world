\set ON_ERROR_STOP on
-- 테스트 데이터 (관리자 권한으로 넣음)
insert into auth.users values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-000000000003');

insert into public.profiles (id, nickname, sgg_code, age_group, gender, interests) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '지수', '51110', '20대', 'F', array['운동','게임']),
  ('bbbbbbbb-0000-0000-0000-000000000002', '민호', '11680', '30대', 'M', null);
-- C는 프로필 없음(튜토리얼 미완료)

insert into public.missions (title, stage) values ('NPC에게 말 걸기', 1), ('광장 방문', 1), ('취미 동아리 가입', 3);
insert into public.mission_progress (user_id, mission_id, status, completed_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'done', now());

insert into public.clubs (name, category, description, owner_id) values
  ('러닝 동아리',     '체육', '같이 달려요',     'aaaaaaaa-0000-0000-0000-000000000001'),
  ('보드게임 동아리', '게임', '주말마다 한 판',   'bbbbbbbb-0000-0000-0000-000000000002'),
  ('사진 동아리',     '문화', '동네 사진 찍기', 'bbbbbbbb-0000-0000-0000-000000000002');
insert into public.club_members values (1, 'aaaaaaaa-0000-0000-0000-000000000001', now());
