#!/bin/bash
# 07 의견 대화(시민 ⇄ 운영팀) 로컬 테스트 — 팀 Supabase가 아니라 로컬 PostgreSQL에서 돈다
# 실제 01→06을 적용하고 06 방식으로 의견 1건을 넣은 뒤 07을 올려 옮겨 가는 것까지 본다.
# 필요: PostgreSQL 15+ 와 psql. 실행: bash database/tests/run_feedback.sh
set -e
cd "$(dirname "$0")/../.."
DB=feedback_test
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
psql -X -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PSQL -f database/tests/01_auth_stub.sql
for f in 01_socialworld_base 02_loop_schema 03_world_update 04_coco 05_chief 06_haru; do $PSQL -f database/$f.sql >/dev/null 2>&1; done

GN=00000000-0000-0000-0000-0000000000b1; CC=00000000-0000-0000-0000-0000000000b2; ST=00000000-0000-0000-0000-0000000000b9
psql -X -q -d $DB >/dev/null <<SQL
insert into auth.users values ('$GN'), ('$CC'), ('$ST');
insert into public.profiles (id, nickname, sgg_code, age_group, gender) values
  ('$GN', '강남20', '11680', '20대', 'F'), ('$CC', '춘천30', '51110', '30대', 'M');
insert into public.welfare_programs (serv_id, source, name, menus) values ('WLF_T', 'central', '청년 월세 지원', '{housing}');
SQL
q(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\nrollback;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
qc(){ printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\ncommit;\n" "$1" "$2" | psql -X -A -t -d $DB 2>&1; }
admin(){ psql -X -A -t -d $DB -c "$1" 2>&1; }
fails=0
check(){ if echo "$1" | grep -q -- "$2"; then echo "PASS  $3"; else echo "FAIL  $3"; echo "$1" | tail -3; fails=$((fails+1)); fi; }

# 06 시절 의견 1건 → 07 적용
qc $GN "select submit_world_feedback('bug', '광장', '06 때 보낸 의견');" >/dev/null
admin "update world_feedback set created_at = now() - interval '3 days'" >/dev/null
$PSQL -f database/07_feedback_chat.sql >/dev/null 2>&1
if ! $PSQL -f database/07_feedback_chat.sql >/tmp/rerun07.log 2>&1; then echo "FAIL  07 두 번째 실행 오류"; tail -3 /tmp/rerun07.log; exit 1; fi
echo "PASS  01→07 적용, 07 재실행 오류 없음"
check "$(admin "select channel||'/'||(updated_at = created_at) from world_feedback")" "^chief/true$" "06 의견은 이장 창구로, 마지막 활동 = 보낸 시각"
admin "insert into staff_members (user_id) values ('$ST')" >/dev/null

# 보내기
check "$(qc $GN "select submit_feedback('haru', 'info', '지원센터', '신청 기간이 끝났어요. 010-1111-2222', 'WLF_T');")" "^saved$" "하루 [정보가 달라요] 저장"
check "$(admin "select channel||'/'||kind||'/'||serv_id||'/'||body from world_feedback order by id desc limit 1")" "^haru/info/WLF_T/신청 기간이 끝났어요. \[전화번호\]$" "하루 창구·정책 id·전화번호 가림"
check "$(q $GN "select submit_feedback('chief', 'info', null, '정보');")" "invalid_kind" "정보 오류 신고는 하루 창구만"
check "$(q $GN "select submit_feedback('haru', 'info', null, '정보', 'WLF_NONE');")" "invalid_program" "없는 정책 id 거절"
check "$(q $GN "select submit_feedback('lumi', 'bug', null, '버그');")" "invalid_channel" "모르는 창구 거절"
check "$(qc $GN "select submit_feedback('chief', 'feature', '광장', '분수 앞에 벤치가 있으면 좋겠어요', 'WLF_T');")" "^saved$" "이장 창구 저장"
check "$(admin "select coalesce(serv_id,'없음') from world_feedback where channel='chief' order by id desc limit 1")" "^없음$" "이장 창구는 정책 id를 남기지 않음"
check "$(qc $GN "select submit_feedback('chief', 'inconvenience', null, '요즘 다 사라지고 싶어요');")" "^crisis$" "위기 표현 → crisis"
check "$(admin "select count(*) from world_feedback where body like '%사라지고%'")" "^0$" "위기 글은 저장하지 않음"
check "$(admin "select npc_type||'/'||sgg_code from escalations order by id desc limit 1")" "^civil/11680$" "위기 기록은 지역·NPC 종류만"

# 시민: 내 의견함
check "$(q $GN "select count(*) from my_feedback();")" "^3$" "내 의견함 3건(06 것 포함)"
check "$(q $GN "select program_name from my_feedback() where channel='haru';")" "^청년 월세 지원$" "하루 의견엔 정책 이름"
check "$(q $CC "select count(*) from my_feedback();")" "^0$" "남의 의견은 안 보임"
check "$(q $GN "select count(*) from feedback_messages;")" "permission denied\|^0$" "메시지 표 직접 읽기 불가"
check "$(q $GN "select count(*) from staff_members;")" "permission denied\|^0$" "운영팀 명단 직접 읽기 불가"
check "$(q $GN "insert into feedback_messages (feedback_id, author, staff_id, body) select id, 'staff', '$GN', '가짜 답' from world_feedback limit 1;")" "row-level security\|permission denied" "운영팀 답장 직접 넣기 불가"

# 운영팀
check "$(q $GN "select * from staff_feedback_list();")" "staff_only" "시민은 운영팀 목록 못 봄"
check "$(q $GN "select staff_reply(1, '답');")" "staff_only" "시민은 운영팀 답장 못 씀"
check "$(q $GN "select am_i_staff();")" "^f$" "am_i_staff 시민 false"
check "$(q $ST "select am_i_staff();")" "^t$" "am_i_staff 운영팀 true"
check "$(q $ST "select count(*) from staff_feedback_list();")" "^3$" "운영팀은 전체 의견"
cols=$(q $ST "select string_agg(column_name::text, ',') from (select (jsonb_each(to_jsonb(t))).key as column_name from staff_feedback_list() t limit 1) x;")
if echo "$cols" | grep -q "user_id"; then echo "FAIL  운영팀 목록에 계정 id가 없음"; fails=$((fails+1)); else echo "PASS  운영팀 목록에 계정 id가 없음"; fi
check "$(q $ST "select count(distinct alias)||'/'||min(alias) from staff_feedback_list();")" "^1/주민 #[0-9A-F]\{4\}$" "같은 시민은 같은 가명 번호"
check "$(q $ST "select string_agg(channel, ',' order by channel) from staff_feedback_list(null, 'haru');")" "^haru$" "창구로 거르기"
HID=$(admin "select id from world_feedback where channel='haru'")
check "$(q $ST "select waiting from staff_feedback_list() where id=$HID;")" "^t$" "새 의견은 '답 필요'"
check "$(qc $ST "select staff_reply($HID, '확인해 볼게요. 어느 화면에서 보셨나요?');")" "^saved$" "운영팀 답장"
check "$(admin "select status from world_feedback where id=$HID")" "^seen$" "답장하면 new → seen"
check "$(q $ST "select waiting from staff_feedback_list() where id=$HID;")" "^f$" "운영팀이 답하면 '답 필요' 꺼짐"
check "$(q $ST "select staff_reply(999999, 'x');")" "^not_found$" "없는 의견"

# 시민: 답 읽기·답장
check "$(q $GN "select unread from my_feedback() where id=$HID;")" "^t$" "새 답 표시"
check "$(q $GN "select my_feedback_unread();")" "^1$" "안 읽은 답 1"
check "$(q $GN "select messages->0->>'who' from my_feedback() where id=$HID;")" "^staff$" "답장은 '운영팀'으로 보임"
check "$(q $GN "select messages::text from my_feedback() where id=$HID;")" "^\[{\"at\"" "메시지 모양"
if q $GN "select messages::text from my_feedback() where id=$HID;" | grep -q "$ST\|staff_id"; then echo "FAIL  시민에게 운영팀 계정 안 보임"; fails=$((fails+1)); else echo "PASS  시민에게 운영팀 계정 안 보임"; fi
qc $GN "select read_my_feedback($HID);" >/dev/null
check "$(q $GN "select my_feedback_unread();")" "^0$" "읽으면 0"
check "$(q $CC "select read_my_feedback($HID);")" "^f$" "남의 의견은 읽음 처리 못 함"
check "$(qc $GN "select reply_my_feedback($HID, '하루 카드에서요. me@test.com');")" "^saved$" "시민 답장"
check "$(q $ST "select messages->1->>'body' from staff_feedback_list() where id=$HID;")" "^하루 카드에서요. \[이메일\]$" "시민 답장도 이메일 가림"
check "$(q $ST "select waiting from staff_feedback_list() where id=$HID;")" "^t$" "시민이 다시 쓰면 '답 필요'"
check "$(qc $GN "select reply_my_feedback($HID, '사실 죽고 싶어요');")" "^crisis$" "답장 위기 표현 → crisis"
check "$(admin "select count(*) from feedback_messages where body like '%죽고%'")" "^0$" "위기 답장은 저장 안 함"
check "$(q $CC "select reply_my_feedback($HID, '끼어들기');")" "^not_found$" "남의 의견엔 답장 못 함"
qc $ST "select staff_set_status($HID, 'done');" >/dev/null
check "$(q $ST "select waiting from staff_feedback_list() where id=$HID;")" "^f$" "완료하면 '답 필요' 아님"
qc $GN "select reply_my_feedback($HID, '한 가지 더요');" >/dev/null
check "$(admin "select status from world_feedback where id=$HID")" "^seen$" "완료된 의견에 다시 쓰면 다시 열림"
check "$(q $ST "select staff_set_status($HID, 'closed');")" "invalid_status" "모르는 상태 거절"

# 횟수 제한 — 새 의견 5건(07에서 오늘 2건 씀, 위기 글·06 때 글은 세지 않음), 지워도 돌려받지 않음
qc $GN "select submit_feedback('chief', 'feature', null, '세 번째');" >/dev/null
qc $GN "select submit_feedback('chief', 'feature', null, '네 번째');" >/dev/null
check "$(qc $GN "select submit_feedback('chief', 'feature', null, '다섯 번째');")" "^saved$" "오늘 5번째까지 저장"
LAST=$(admin "select max(id) from world_feedback")
check "$(qc $GN "select delete_my_feedback($LAST);")" "^t$" "내 의견 지우기"
check "$(q $GN "select submit_feedback('chief', 'feature', null, '여섯 번째');")" "^too_many$" "지워도 오늘 횟수는 그대로"
check "$(q $CC "select delete_my_feedback($HID);")" "^f$" "남의 의견은 못 지움"
check "$(qc $GN "select delete_my_feedback($HID);")" "^t$" "대화 있는 의견 지우기"
check "$(admin "select count(*) from feedback_messages where feedback_id=$HID")" "^0$" "지우면 메시지도 같이 지워짐"
check "$(psql -X -d $DB -c "set role anon; select submit_feedback('chief','bug',null,'x');" 2>&1)" "permission denied" "비로그인 역할은 보낼 수 없음"

# 90일 삭제
OLD=$(admin "select min(id) from world_feedback")
qc $ST "select staff_reply($OLD, '오래된 답');" >/dev/null
admin "update world_feedback set created_at = now() - interval '91 days' where id = $OLD" >/dev/null
check "$(psql -X -A -t -d $DB -c "set role service_role; select purge_world_feedback(90);" 2>&1 | tail -1)" "^1$" "90일 지난 의견 삭제"
check "$(admin "select count(*) from feedback_messages fm where not exists (select 1 from world_feedback f where f.id = fm.feedback_id)")" "^0$" "그 대화도 같이 삭제"
check "$(q $GN "select purge_world_feedback(0);")" "permission denied" "삭제 함수는 운영(secret key)만"

# 미션 교체
check "$(admin "select string_agg(title||':'||is_active, ',' order by convert_to(title, 'UTF8')) from missions where title in ('지원센터 하루 만나기','정책추천 NPC와 대화하기','취업상담 NPC와 대화하기')")" \
  "^정책추천 NPC와 대화하기:false,지원센터 하루 만나기:true,취업상담 NPC와 대화하기:false$" "정책·취업 창구 미션 끄고 하루 미션 추가"
$PSQL -f database/02_loop_schema.sql >/dev/null 2>&1
check "$(admin "select count(*) from missions where title like '%NPC와 대화하기' and title <> '심리상담 NPC와 대화하기' and is_active")" "^0$" "02를 다시 실행해도 옛 미션이 살아나지 않음"

echo
if [ $fails -eq 0 ]; then echo "모두 통과"; else echo "실패 $fails건"; exit 1; fi
