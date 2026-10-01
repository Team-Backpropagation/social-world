#!/bin/bash
# 마을이장 05 마이그레이션 로컬 테스트 (팀 Supabase가 아니라 로컬 PostgreSQL에서 돈다)
# 실제 01→02→03→04→05를 그대로 적용해 본다. 필요: PostgreSQL 15+ 와 psql. 실행: bash database/tests/run_chief.sh
set -e
cd "$(dirname "$0")/../.."
DB=chief_test
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
psql -X -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PSQL -f database/tests/01_auth_stub.sql
for f in 01_socialworld_base 02_loop_schema 03_world_update 04_coco 05_chief; do $PSQL -f database/$f.sql >/dev/null 2>&1; done
$PSQL -f database/05_chief.sql >/dev/null 2>&1   # 두 번 실행해도 안전한지
$PSQL -f database/03_world_update.sql >/dev/null 2>&1 && $PSQL -f database/05_chief.sql >/dev/null 2>&1   # 03을 다시 돌린 뒤 05를 다시 돌려도 되는지
echo "PASS  01→02→03→04→05 적용, 05 재실행, 03→05 재적용 모두 오류 없음"
$PSQL -f database/tests/20_chief_test.sql >/dev/null

U1=00000000-0000-0000-0000-000000000001
U7=00000000-0000-0000-0000-000000000007
q(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\nrollback;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
qc(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\ncommit;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
admin(){ psql -X -A -t -d $DB -c "$1" 2>&1; }
fails=0
check(){ if echo "$1" | grep -q -- "$2"; then echo "PASS  $3"; else echo "FAIL  $3"; echo "$1" | tail -3; fails=$((fails+1)); fi; }
id_of(){ admin "select id from world_events where title='$1'"; }
PARK=$(id_of '금요일 저녁 공원 산책'); CAFE=$(id_of '카페 수다 한 잔'); OLD=$(id_of '지난 이벤트'); REJ=$(id_of '반려된 이벤트')

# 시민 화면
check "$(q $U1 "select string_agg(title, '/') from (select title from world_events_public order by starts_at) t;")" "^금요일 저녁 공원 산책/광장 플레이리스트 나눔$" "시민에겐 공개·진행 중 이벤트만 보임(초안·반려·종료 제외)"
check "$(q $U1 "select featured from world_events_public where title='금요일 저녁 공원 산책';")" "^t$" "내 코호트 대상 이벤트는 featured"
check "$(q $U1 "select featured from world_events_public where title='광장 플레이리스트 나눔';")" "^f$" "다른 코호트 대상은 featured 아님"
check "$(q $U1 'select target_sgg_code from world_events_public;')" "does not exist" "뷰에 대상 코호트 칸 없음"
check "$(q $U1 'select reason_note from world_events_public;')" "does not exist" "뷰에 근거 칸 없음"
check "$(q $U1 'select count(*) from world_events;')" "permission denied\|^0$" "원본 표는 시민이 못 읽음"
check "$(psql -X -d $DB -c 'set role anon; select * from world_events_public;' 2>&1)" "permission denied" "비로그인은 뷰도 못 읽음"

# 참여
check "$(q $U1 "select join_world_event($PARK);")" "^t$" "공개 이벤트 참여 → true"
check "$(q $U1 "select join_world_event($PARK); select join_world_event($PARK);" | tr '\n' ' ')" "t f" "같은 이벤트 두 번째는 false(중복 없음)"
check "$(q $U1 "select join_world_event($CAFE);")" "event_not_open" "초안 이벤트 참여 차단"
check "$(q $U1 "select join_world_event($OLD);")" "event_not_open" "끝난 이벤트 참여 차단"
check "$(q $U1 "select join_world_event($REJ);")" "event_not_open" "반려 이벤트 참여 차단"
check "$(q '' "select join_world_event($PARK);")" "login_required" "로그인 안 하면 거절"
check "$(q $U1 "insert into event_participation(event_id) values ($CAFE);")" "row-level security" "표에 직접 넣어 초안 참여 우회 불가"
qc $U1 "select join_world_event($PARK);" >/dev/null
check "$(q $U1 "select joined from world_events_public where id=$PARK;")" "^t$" "참여 후 joined=true"
check "$(q $U7 "select joined from world_events_public where id=$PARK;")" "^f$" "남의 참여는 joined에 안 섞임"
check "$(q $U7 'select count(*) from event_participation;')" "^0$" "남의 참여 기록은 안 보임"
check "$(admin "select aggregate_world_activity(); select event_participants from world_activity_metrics where sgg_code='51110' and age_group='20대' and gender='F';" | tail -1)" "^1$" "참여가 이장의 장부(world_activity_metrics)에 집계됨"

# 관심사 분포
R=$(admin "select sgg_code||'|'||age_group||'|'||gender||'|'||user_count||'|'||(interests->>'운동') from chief_interest_counts();")
check "$R" "^51110|20대|F|6|4$" "관심사 분포: 관심사 고른 6명 코호트만, 운동 4"
check "$(echo "$R" | wc -l)" "^1$" "k=5 미달·다른 지역·관심사 없음은 제외"
check "$(admin "select count(*) from chief_interest_counts(3);")" "^2$" "k를 낮추면 강남 30대 남성도 나옴"
check "$(q $U1 'select * from chief_interest_counts();')" "permission denied" "시민은 관심사 분포 함수 실행 불가"
check "$(admin "select count(*) from information_schema.columns where table_name='chief_interest_counts'")" "^0$" "(참고) 함수 결과에 user_id 없음"
check "$(admin "select pg_get_function_result('chief_interest_counts(integer)'::regprocedure)")" "sgg_code text, age_group text, gender text, user_count integer, interests jsonb" "반환 칸: 코호트·인원·관심사만"

# 상태 값
check "$(admin "update world_events set status='open' where id=$PARK")" "world_events_status_chk" "모르는 상태 값 차단"
check "$(admin "insert into world_events(title, place, starts_at) values ('t','plaza',now()) returning status")" "^draft" "새 이벤트 기본값은 draft"

[ $fails -eq 0 ] && echo "모두 통과" || { echo "실패 $fails건"; exit 1; }
