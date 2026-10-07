\set ON_ERROR_STOP on
-- 하루 06 테스트 데이터 (관리자 권한으로 넣음). 정책 행은 haru_sync.py가 만드는 모양 그대로
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1'),   -- 강남 20대
  ('00000000-0000-0000-0000-0000000000a2'),   -- 춘천 30대
  ('00000000-0000-0000-0000-0000000000a3'),   -- 다른 지역 · 그 외 나이
  ('00000000-0000-0000-0000-0000000000a4');   -- 프로필 없음
insert into public.profiles (id, nickname, sgg_code, age_group, gender) values
  ('00000000-0000-0000-0000-0000000000a1', '강남20', '11680', '20대', 'F'),
  ('00000000-0000-0000-0000-0000000000a2', '춘천30', '51110', '30대', 'M'),
  ('00000000-0000-0000-0000-0000000000a3', '기타', 'OTHER', '기타', null);

insert into public.welfare_programs
  (serv_id, source, name, sgg_code, region_label, life_stages, themes, menus, target_groups, online_apply, age_min, age_max, popularity, contacts, detail_url, is_active)
values
  ('C_HOUSE',  'central', '청년 월세 지원',       null,    '전국',              '{청년}',            '{주거}',         '{housing}', '{}',       true,  19, 34, 900, '[{"name":"보건복지상담센터","value":"129"}]', 'https://www.bokjiro.go.kr/x?wlfareInfoId=C_HOUSE', true),
  ('C_HOUSE2', 'central', '전세 대출 이자 지원',   null,    '전국',              '{청년,중장년}',      '{주거}',         '{housing}', '{}',       false, null, null, 50, '[]', null, true),
  ('L_GN_HOUSE','local',  '강남 청년 주거 지원',   '11680', '서울특별시 강남구', '{청년}',            '{주거}',         '{housing}', '{}',       true,  19, 39, 10, '[]', null, true),
  ('L_CC_HOUSE','local',  '춘천 청년 주거 지원',   '51110', '강원특별자치도 춘천시','{청년}',          '{주거}',         '{housing}', '{}',       true,  19, 39, 10, '[]', null, true),
  ('L_GN_BUS', 'local',   '강남구 교통비 지원',    '11680', '서울특별시 강남구', '{아동,청소년,청년,노년}','{서민금융}',   '{living}',  '{}',       true,  19, 24, 300, '[]', null, true),
  ('C_DISAB',  'central', '장애인 자립 자금',      null,    '전국',              '{청년,중장년,노년}', '{생활지원}',     '{living}',  '{장애인,저소득}', true, null, null, 800, '[]', null, true),
  ('C_SENIOR', 'central', '어르신 일자리',         null,    '전국',              '{노년}',            '{일자리}',       '{job}',     '{}',       true,  65, null, 999, '[]', null, true),
  ('C_JOB',    'central', '청년 취업 지원',        null,    '전국',              '{청년}',            '{일자리}',       '{job}',     '{}',       true,  18, 34, 500, '[]', null, true),
  ('C_OLD',    'central', '끝난 사업',            null,    '전국',              '{청년}',            '{주거}',         '{housing}', '{}',       true,  null, null, 1, '[]', null, false),
  ('C_MIND',   'central', '청년 마음건강',         null,    '전국',              '{}',                '{정신건강}',     '{mind}',    '{}',       false, null, null, 70, '[]', null, true);
