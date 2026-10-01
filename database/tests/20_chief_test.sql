-- 마을이장 테스트 데이터 (관리자 권한으로 넣음). 01→02→03→05 적용 뒤에 실행
insert into auth.users
select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 12) i;

-- 춘천 20대 여성 6명(k=5 충족), 강남 30대 남성 3명(k 미달), 다른 지역 1명, 관심사 없음 1명, 프로필 없음 1명
insert into public.profiles (id, nickname, sgg_code, age_group, gender, interests)
select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'u' || i, s, a, g, it
from (values
  (1,'51110','20대','F', array['운동','게임']), (2,'51110','20대','F', array['운동']),
  (3,'51110','20대','F', array['운동','음악']), (4,'51110','20대','F', array['독서']),
  (5,'51110','20대','F', array['게임','운동']), (6,'51110','20대','F', array['요리']),
  (7,'11680','30대','M', array['게임']), (8,'11680','30대','M', array['게임']), (9,'11680','30대','M', array['운동']),
  (10,'OTHER','20대','F', array['운동']),
  (11,'51110','20대','F', array[]::text[])
) v(i, s, a, g, it);

insert into public.world_events (title, description, place, starts_at, ends_at, status, target_sgg_code, target_age_group, target_gender, reason_note) values
  ('금요일 저녁 공원 산책', '같이 걸어요', 'park',  now() + interval '1 day', now() + interval '1 day 2 hours', 'published', '51110', '20대', 'F', '근거: 비공개'),
  ('카페 수다 한 잔',       '편하게 와요', 'cafe',  now() + interval '2 day', now() + interval '2 day 2 hours', 'draft',     null, null, null, '초안'),
  ('지난 이벤트',           '끝났어요',   'plaza', now() - interval '3 day', now() - interval '2 day',          'published', null, null, null, null),
  ('반려된 이벤트',         '-',          'plaza', now() + interval '1 day', null,                              'rejected',  null, null, null, null),
  ('광장 플레이리스트 나눔', '음악 나눠요', 'plaza', now() + interval '3 day', null,                             'published', '11680', '30대', 'M', '근거2');
