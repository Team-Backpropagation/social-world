#!/bin/bash
# 하루 06 마이그레이션 로컬 테스트 (팀 Supabase가 아니라 로컬 PostgreSQL에서 돈다)
# 실제 01→02→03→04→05→06을 그대로 적용해 본다. 필요: PostgreSQL 15+ 와 psql. 실행: bash database/tests/run_haru.sh
set -e
cd "$(dirname "$0")/../.."
DB=haru_test
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
psql -X -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PSQL -f database/tests/01_auth_stub.sql
for f in 01_socialworld_base 02_loop_schema 03_world_update 04_coco 05_chief 06_haru; do $PSQL -f database/$f.sql >/dev/null 2>&1; done
if ! $PSQL -f database/06_haru.sql >/tmp/rerun06.log 2>&1; then echo "FAIL  06 두 번째 실행 오류"; tail -3 /tmp/rerun06.log; exit 1; fi
echo "PASS  01→06 적용, 06 재실행 오류 없음"
for i in 1 2; do if ! $PSQL -f database/09_haru_rules.sql >/tmp/run09.log 2>&1; then echo "FAIL  09 실행 오류($i)"; tail -3 /tmp/run09.log; exit 1; fi; done
echo "PASS  09(규칙 보정) 적용, 재실행 오류 없음"
$PSQL -f database/tests/30_haru_test.sql >/dev/null

GN=00000000-0000-0000-0000-0000000000a1; CC=00000000-0000-0000-0000-0000000000a2; OT=00000000-0000-0000-0000-0000000000a3; NP=00000000-0000-0000-0000-0000000000a4
q(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\nrollback;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
qc(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\ncommit;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
admin(){ psql -X -A -t -d $DB -c "$1" 2>&1; }
fails=0
check(){ if echo "$1" | grep -q -- "$2"; then echo "PASS  $3"; else echo "FAIL  $3"; echo "$1" | tail -3; fails=$((fails+1)); fi; }

# 정책 고르기
check "$(q $GN "select string_agg(serv_id, ',') from recommend_programs('housing', 5);")" "^L_GN_HOUSE,C_HOUSE,C_HOUSE2$" "강남 20대 주거: 동점이면 지자체 먼저 → 온라인·청년전용 점수 순, 춘천 사업·끝난 사업 제외"
check "$(q $CC "select string_agg(serv_id, ',') from recommend_programs('housing', 5);")" "^L_CC_HOUSE,C_HOUSE,C_HOUSE2$" "춘천 30대: 내 시군구 사업 + 전국 (청년·중장년 모두 허용)"
check "$(q $GN "select age_note from recommend_programs('housing', 5) where serv_id='C_HOUSE2';")" "^t$" "나이 범위가 없으면 '나이 조건 확인'"
check "$(q $GN "select age_note from recommend_programs('housing', 5) where serv_id='L_GN_HOUSE';")" "^f$" "20~29가 범위 안에 다 들어가면 age_note 없음"
check "$(q $GN "select age_note, reason from recommend_programs('living', 5) where serv_id='L_GN_BUS';")" "^t|.*나이 조건이 일부만" "19~24세 사업은 20대에게 '일부만 맞음' 표시"
check "$(q $CC "select count(*) from recommend_programs('living', 5) where serv_id='L_GN_BUS';")" "^0$" "다른 시군구 지자체 사업은 안 보임"
check "$(q $GN "select count(*) from recommend_programs('living', 5) where serv_id='C_DISAB';")" "^0$" "특정 대상 정책은 기본 카드에 안 나옴"
check "$(q $GN "select string_agg(serv_id, ',') from recommend_programs('living', 5, true);")" "^C_DISAB$" "펼치면(p_special) 특정 대상 정책만"
check "$(q $GN "select string_agg(serv_id, ',') from recommend_programs('job', 5);")" "^C_JOB$" "노년 대상(65세 이상)은 20대에게 빠짐"
check "$(q $GN "select count(*) from recommend_programs('mind', 5);")" "^1$" "생애주기가 비어 있으면 거르지 않음"
check "$(q $OT "select string_agg(serv_id, ',' order by serv_id) from recommend_programs('job', 5);")" "^C_JOB,C_SENIOR$" "다른 지역·그 외 나이: 전국 사업만, 나이로 거르지 않음"
check "$(q $GN "select reason from recommend_programs('housing', 1);")" "강남구에서 하는 사업이에요 · 청년만을 위한 사업이에요 · 온라인으로" "추천 이유 문장"
check "$(q $GN "select contact from recommend_programs('housing', 5) where serv_id='C_HOUSE';")" "보건복지상담센터 129" "대표 문의처"

# 개수
check "$(q $GN "select eligible||'/'||special||'/'||ineligible from program_counts('job');")" "^1/0/1$" "일·취업: 맞음 1 · 특정 대상 0 · 자격 미달 1(노년)"
check "$(q $GN "select eligible||'/'||special||'/'||ineligible from program_counts('living');")" "^1/1/0$" "생활비: 맞음 1 · 특정 대상 1"
check "$(q $CC "select ineligible from program_counts('living');")" "^0$" "다른 시군구 사업은 자격 미달로 세지 않음"

# 09 — 저소득만 붙은 사업은 기본 카드(소득 기준 안내), 다른 대상이 같이 있으면 특정 대상
admin "insert into welfare_programs (serv_id, source, name, region_label, life_stages, themes, menus, target_groups, online_apply, age_min, age_max, popularity, contacts, is_active)
       values ('C_LOWINC', 'central', '청년 월세 한시 지원', '전국', '{청년}', '{주거}', '{housing}', '{저소득}', true, 19, 34, 5, '[]', true)" >/dev/null
check "$(q $GN "select string_agg(serv_id, ',') from recommend_programs('housing', 5);")" "^L_GN_HOUSE,C_HOUSE,C_LOWINC,C_HOUSE2$" "09: 저소득만 있는 사업은 기본 카드에 나옴(같은 점수면 조회수 순)"
check "$(q $GN "select reason from recommend_programs('housing', 5) where serv_id='C_LOWINC';")" "소득 기준이 있어요" "09: 추천 이유에 '소득 기준이 있어요'"
check "$(q $GN "select count(*) from recommend_programs('housing', 10, true) where serv_id='C_LOWINC';")" "^0$" "09: 특정 대상 목록에는 없음"
check "$(q $GN "select eligible||'/'||special from program_counts('housing');")" "^4/0$" "09: 개수도 같은 기준(맞음 4 · 특정 대상 0)"
check "$(q $GN "select eligible||'/'||special from program_counts('living');")" "^1/1$" "09: 장애인·저소득은 여전히 특정 대상"
admin "delete from welfare_programs where serv_id='C_LOWINC'" >/dev/null

# 권한
check "$(q $GN 'select count(*) from welfare_programs;')" "permission denied\|^0$" "정책 표는 브라우저가 직접 못 읽음"
check "$(q '' "select * from recommend_programs('housing');")" "login_required" "로그인 안 하면 거절"
check "$(q $NP "select * from recommend_programs('housing');")" "profile_required" "프로필 없으면 거절"
check "$(psql -X -d $DB -c "set role anon; select * from recommend_programs('housing');" 2>&1)" "permission denied" "비로그인 역할은 함수 실행 불가"
check "$(q $GN "select * from _haru_scope();")" "permission denied" "내부 함수는 시민이 직접 못 부름"

# 소통 창구
check "$(qc $GN "select submit_world_feedback('bug', '광장', '분수 앞에서 캐릭터가 멈춰요. 연락은 010-1234-5678 / me@test.com');")" "^saved$" "의견 저장"
check "$(admin "select body from world_feedback order by id desc limit 1")" "\[전화번호\] / \[이메일\]" "전화번호·이메일은 가려서 저장"
check "$(admin "select count(*) from world_feedback where body like '%010-1234%'")" "^0$" "원래 번호는 어디에도 없음"
check "$(qc $GN "select submit_world_feedback('inconvenience', null, '요즘 너무 힘들어서 사라지고 싶어요');")" "^crisis$" "위기 표현 → crisis"
check "$(admin "select count(*) from world_feedback where body like '%사라지고%'")" "^0$" "위기 표현 글은 저장하지 않음"
check "$(admin "select npc_type||'/'||sgg_code from escalations order by id desc limit 1")" "^civil/11680$" "위기 기록은 지역·NPC 종류만(report_crisis civil)"
check "$(q $GN "select submit_world_feedback('praise', null, '좋아요');")" "invalid_kind" "모르는 종류는 거절"
check "$(q $GN "select submit_world_feedback('bug', null, '   ');")" "invalid_body" "빈 글 거절"
check "$(q $GN "select submit_world_feedback('bug', null, repeat('가', 301));")" "invalid_body" "300자 넘으면 거절"
for i in 1 2 3 4; do qc $GN "select submit_world_feedback('feature', null, '기능 요청 $i');" >/dev/null; done
check "$(q $GN "select submit_world_feedback('feature', null, '여섯 번째');")" "^too_many$" "하루 5건까지"
check "$(q $GN "select count(*) from world_feedback;")" "^5$" "본인 의견만 보임(5건)"
check "$(q $CC "select count(*) from world_feedback;")" "^0$" "남의 의견은 안 보임"
check "$(q $GN "insert into world_feedback (kind, body) values ('bug','직접');")" "row-level security\|permission denied" "표에 직접 넣기 불가"
check "$(q $GN "update world_feedback set status='done';" ; q $GN "select count(*) from world_feedback where status='done';")" "^0$" "상태는 시민이 못 바꿈"
check "$(q $GN "select purge_world_feedback(0);")" "permission denied" "삭제 함수는 운영(secret key)만"
admin "update world_feedback set created_at = now() - interval '91 days' where body = '기능 요청 1'" >/dev/null
check "$(psql -X -A -t -d $DB -c "set role service_role; select purge_world_feedback(90);" 2>&1 | tail -1)" "^1$" "90일 지난 의견 1건 삭제"

echo
if [ $fails -eq 0 ]; then echo "모두 통과"; else echo "실패 $fails건"; exit 1; fi
