#!/bin/bash
# 코코 04 마이그레이션 로컬 테스트 (팀 Supabase가 아니라 로컬 PostgreSQL에서 돈다)
# 필요: PostgreSQL 15+ 와 psql, postgres 계정. 실행: bash database/tests/run_coco.sh
set -e
cd "$(dirname "$0")/../.."
DB=coco_test
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
psql -X -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -f database/tests/00_supabase_stub.sql
$PSQL -f database/tests/10_coco_test.sql
$PSQL -f database/04_coco.sql 2>/dev/null
$PSQL -f database/04_coco.sql 2>/dev/null   # 두 번 실행해도 안전한지
echo "PASS  04를 두 번 적용해도 오류 없음"

A=aaaaaaaa-0000-0000-0000-000000000001
C=cccccccc-0000-0000-0000-000000000003
q(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\nrollback;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
admin(){ psql -X -q -d $DB -c "$1" 2>&1; }
fails=0
check(){ if echo "$1" | grep -q -- "$2"; then echo "PASS  $3"; else echo "FAIL  $3"; echo "$1" | tail -3; fails=$((fails+1)); fi; }

check "$(admin "select interest_tags from clubs where name='보드게임 동아리'")" "{게임}" "동아리 category → 관심사 태그 채움"
check "$(q $A 'select my_quest_stage();')" "^2$" "1단계 완료 → 지금 2단계"
check "$(q $A "select string_agg(item_key, ',') from recommend_activities('interest', 6);")" "activity:9,club:2" "관심사 일치·단계 순으로 정렬"
check "$(q $A "select count(*) from recommend_activities('interest',6) where item_key='club:1';")" "^0$" "이미 가입한 동아리 제외"
check "$(q $A "select count(*) from recommend_activities('interest',6) r join activity_catalog a on r.item_key='activity:'||a.id where a.sgg_code='11680';")" "^0$" "다른 지역 오프라인 활동 제외"
check "$(q $A "select bool_and(not is_online) from recommend_activities('nearby',6);")" "^t$" "가까운 모임은 내 동네 오프라인만"
check "$(q $A "select count(*) from recommend_activities('today',6) r join activity_catalog a on r.item_key='activity:'||a.id where a.weekdays is not null and not (extract(dow from now() at time zone 'Asia/Seoul')::smallint = any(a.weekdays));")" "^0$" "오늘은 다른 요일 활동 제외"
check "$(q '' 'select * from recommend_activities();')" "login_required" "로그인 안 하면 거절"
check "$(q $C 'select * from recommend_activities();')" "profile_required" "프로필 없으면 거절"
check "$(q $A "select * from recommend_activities('random');")" "unknown_mode" "모르는 모드 거절"
check "$(q $A "select count(*) from recommend_activities('interest', 100);")" "^6$" "최대 6개"
check "$(q $A "select count(*) from recommend_activities('interest', 0);")" "^1$" "최소 1개"
check "$(q $A "insert into activity_catalog(title,summary,sgg_code) values('x','y','51110');")" "denied\|security" "유저는 활동 목록에 쓰지 못함"
check "$(psql -X -d $DB -c 'set role anon; select * from recommend_activities();' 2>&1)" "permission denied" "비로그인 역할은 함수 실행 불가"
check "$(admin "insert into activity_catalog(title,summary,sgg_code,interest_tags) values('t','s','51110','{등산}')")" "tags_chk" "없는 관심사 태그 차단"
check "$(admin "insert into activity_catalog(title,summary,sgg_code,apply_url) values('t','s','51110','http://x')")" "url_chk" "https가 아닌 신청 링크 차단"
check "$(admin "insert into activity_catalog(title,summary) values('t','s')")" "place_chk" "지역 없는 오프라인 활동 차단"

# 수요 로그 — coco.js가 넣는 칸(npc_type, action, category, item_id)이 03의 npc_demand_logs와 맞는지
awk '/^-- B-4\. npc_demand_logs/{f=1} /^-- B-5\./{f=0} f' database/03_world_update.sql | psql -X -q -d $DB >/dev/null 2>&1
admin "grant select, insert on npc_demand_logs to authenticated" >/dev/null   # Supabase 기본 권한 흉내
LOG="insert into npc_demand_logs(npc_type, action, category, item_id) values ('coco','recommend','club','club:2') returning item_id;"
check "$(q $A "$LOG")" "club:2" "수요 로그가 03 칸 이름(item_id)으로 들어감"
check "$(q $A "insert into npc_demand_logs(user_id, npc_type, action, category) values ('$C','coco','recommend','club');")" "row-level security" "다른 사람 이름으로 수요 로그를 쓸 수 없음"

[ $fails -eq 0 ] && echo "모두 통과" || { echo "실패 $fails건"; exit 1; }
