# 하루 화면 흐름 테스트 (가짜 supabase 미리보기 페이지 사용)
# 실행: python social_world/haru/tests/ui_test.py   (Playwright 필요)
import json, pathlib, re, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
url = HERE.parent.joinpath('haru-preview.html').as_uri()
fails = []
def check(cond, name):
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond: fails.append(name)

def logs(pg):
    rows = []
    for line in pg.locator('#log').inner_text().splitlines():
        if line.startswith('{'):
            rows.append(json.loads(line))
    return rows

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1100, 820, 'desktop'), (390, 780, 'mobile')]:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto(url)
        pg.evaluate('window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null; }; 0')   # 새 탭 대신 기록 (끝의 0: 함수를 돌려주면 Playwright가 실행해 버림)
        pg.click('#open-ok')
        check(pg.get_by_role('dialog').is_visible(), f'[{tag}] 창이 열림')
        check(pg.locator('.haru-menu').count() == 5, f'[{tag}] 메뉴 5개')
        check(pg.evaluate('document.activeElement.dataset.menu') == 'housing', f'[{tag}] 첫 메뉴에 포커스')
        check(pg.locator('.haru-note').count() == 0, f'[{tag}] 지원 지역이면 지역 안내 없음')

        # 생활비 — 카드 3장 + 더 보기 1
        pg.locator('[data-menu="living"]').click()
        pg.wait_for_selector('.haru-item')
        check(pg.locator('.haru-list > .haru-item').count() == 3, f'[{tag}] 카드 3장')
        rows = logs(pg)
        check(sum(r['action'] == 'recommend' for r in rows) == 3, f'[{tag}] 추천 3건 기록')
        check(all(r['npc_type'] == 'policy' and r['category'] == '생활비' for r in rows), f'[{tag}] 생활비는 npc_type policy · category 생활비')
        check(any(r['action'] == 'ineligible' and r['item_id'] == 'count:3' for r in rows), f'[{tag}] 자격 미달 3건을 1줄로 기록')
        check('뺀 정책이 3개' in pg.locator('.haru-panel').inner_text(), f'[{tag}] 자격 미달 수 안내')
        first = pg.locator('.haru-item').first
        check(first.locator('.haru-age').count() == 1, f'[{tag}] 나이 일부만 맞는 사업에 나이 조건 확인')
        check(first.locator('.haru-tags .local').inner_text() == '강남구', f'[{tag}] 지역 꼬리표(시군구만)')
        pg.screenshot(path=str(HERE / f'shot_{tag}.png'), full_page=True)

        more = pg.get_by_role('button', name=re.compile('더 보기'))
        more.click()
        check(pg.locator('.haru-list > .haru-item').count() == 4, f'[{tag}] 더 보기로 4장')
        check(sum(r['action'] == 'recommend' for r in logs(pg)) == 4, f'[{tag}] 더 보기한 카드도 추천 기록')

        # 자세히
        first.get_by_role('button', name='자세히').click()
        d = first.locator('.haru-detail')
        check(d.is_visible() and '지원 대상' in d.inner_text() and '19~24세' in d.inner_text(), f'[{tag}] 자세히: 대상 원문')
        check(d.locator('a[href^="tel:"]').count() == 1, f'[{tag}] 문의 전화 바로 걸기 링크')
        check('최종 자격은' in d.inner_text(), f'[{tag}] 최종 확인 안내')
        check(any(r['action'] == 'view' for r in logs(pg)), f'[{tag}] 자세히 열람 기록(view)')
        first.get_by_role('button', name='접기').click()
        check(first.locator('.haru-detail').count() == 0, f'[{tag}] 접기')

        # 복지로 링크 → 신청했어요
        done = first.get_by_role('button', name='신청했어요')
        check(done.is_disabled(), f'[{tag}] 링크 열기 전 "신청했어요" 비활성')
        first.get_by_role('button', name='복지로에서 보기').click()
        opened = pg.evaluate('window.__opened')
        check(len(opened) == 1 and opened[0][0].startswith('https://www.bokjiro.go.kr/') and opened[0][1] == '_blank' and 'noopener' in opened[0][2],
              f'[{tag}] 복지로 상세를 새 탭(noopener)으로')
        check(not done.is_disabled(), f'[{tag}] 링크 연 뒤 "신청했어요" 활성')
        done.click()
        rows = logs(pg)
        check(any(r['action'] == 'apply_click' for r in rows) and any(r['action'] == 'self_reported' for r in rows), f'[{tag}] 링크 열기·신청 기록')
        check(first.get_by_role('button', name='신청했다고 기록했어요').is_disabled(), f'[{tag}] 중복 신고 막힘')

        # 특정 대상 정책 — 펼쳐도 기록 없음
        before = len(logs(pg))
        sp = pg.get_by_role('button', name=re.compile('특정 대상 정책 2개'))
        check(sp.get_attribute('aria-expanded') == 'false', f'[{tag}] 특정 대상은 접혀 있음')
        sp.click()
        pg.wait_for_selector('.haru-item[data-special="1"]')
        sitems = pg.locator('.haru-item[data-special="1"]')
        check(sitems.count() == 2, f'[{tag}] 펼치면 특정 대상 2개')
        check('대상: 장애인 · 저소득' in sitems.first.inner_text(), f'[{tag}] 대상 꼬리표')
        check(sitems.first.get_by_role('button', name='정보가 달라요').count() == 0 and sitems.first.get_by_role('button', name='신청했어요').count() == 0,
              f'[{tag}] 특정 대상 카드엔 신고·신청했어요 없음')
        sitems.first.get_by_role('button', name='자세히').click()
        sitems.first.get_by_role('button', name='복지로에서 보기').click()
        check(len(logs(pg)) == before, f'[{tag}] 특정 대상 펼치기·자세히·링크는 기록 안 함')
        pg.get_by_role('button', name=re.compile('특정 대상 정책 접기')).click()
        check(pg.locator('.haru-item[data-special="1"]').count() == 0, f'[{tag}] 특정 대상 접기')

        # 정보가 달라요 — 저장 / 위기 / 제한
        card2 = pg.locator('.haru-list > .haru-item').nth(1)
        card2.get_by_role('button', name='정보가 달라요').click()
        check(pg.evaluate('document.activeElement.tagName') == 'TEXTAREA', f'[{tag}] 신고 창 열리면 입력칸 포커스')
        card2.get_by_role('button', name='보내기').click()
        check('한 줄만' in card2.locator('.haru-report').inner_text(), f'[{tag}] 빈 글은 안 보냄')
        card2.locator('textarea').fill('신청 기간이 끝났어요')
        card2.get_by_role('button', name='보내기').click()
        pg.wait_for_function('document.querySelectorAll(".haru-list > .haru-item")[1].innerText.indexOf("내 의견함") >= 0')
        sent = [l for l in pg.locator('#log').inner_text().splitlines() if l.startswith('의견 보내기')]
        check(len(sent) == 1 and '"p_channel":"haru"' in sent[0] and '"p_kind":"info"' in sent[0] and '"p_serv_id":"WLF00005414"' in sent[0],
              f'[{tag}] 하루 채널·정보 오류·정책 id로 보냄')
        card3 = pg.locator('.haru-list > .haru-item').nth(2)
        card3.get_by_role('button', name='정보가 달라요').click()
        card3.locator('textarea').fill('요즘 다 그만두고 사라지고 싶어요')
        card3.get_by_role('button', name='보내기').click()
        pg.wait_for_selector('.haru-crisis')
        check('109' in pg.locator('.haru-crisis').inner_text() and '1577-0199' in pg.locator('.haru-crisis').inner_text(), f'[{tag}] 위기 표현 → 위기 안내')
        card4 = pg.locator('.haru-list > .haru-item').nth(3)
        card4.get_by_role('button', name='정보가 달라요').click()
        card4.locator('textarea').fill('도배 테스트')
        card4.get_by_role('button', name='보내기').click()
        pg.wait_for_function('document.querySelectorAll(".haru-list > .haru-item")[3].innerText.indexOf("내일 다시") >= 0')
        check(card4.get_by_role('button', name='보내기').is_disabled(), f'[{tag}] 하루 제한 → 보내기 막힘')
        check(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'[{tag}] 가로 넘침 없음')
        check(pg.evaluate('(() => { const p = document.querySelector(".haru-panel"); return p.scrollWidth <= p.clientWidth; })()'), f'[{tag}] 창 안 가로 넘침 없음')

        # 일·취업 → npc_type job
        pg.get_by_role('button', name='다른 지원 보기').click()
        pg.locator('[data-menu="job"]').click()
        pg.wait_for_selector('.haru-item')
        check(any(r['npc_type'] == 'job' and r['category'] == '일·취업' for r in logs(pg)), f'[{tag}] 일·취업은 npc_type job')
        check(pg.get_by_role('button', name=re.compile('더 보기')).count() == 0, f'[{tag}] 3장 이하면 더 보기 없음')

        # 결과 없음
        pg.get_by_role('button', name='다른 지원 보기').click()
        pg.locator('[data-menu="mind"]').click()
        pg.wait_for_function('document.querySelector(".haru-bubble").innerText.indexOf("찾아보는 중") < 0')
        check('129' in pg.locator('.haru-bubble').inner_text() and pg.locator('.haru-item').count() == 0, f'[{tag}] 결과 없음 → 129 안내')
        pg.get_by_role('button', name='대화 마치기').click()
        check(pg.locator('.haru-backdrop').count() == 0, f'[{tag}] 대화 마치기로 닫힘')

        # 다른 지역 · 오류
        pg.click('#open-other')
        check(pg.locator('.haru-note').count() == 1 and '전국 정책만' in pg.locator('.haru-note').inner_text(), f'[{tag}] 지원 지역 밖 안내')
        pg.keyboard.press('Escape')
        check(pg.locator('.haru-backdrop').count() == 0, f'[{tag}] Esc로 닫힘')
        for btn, text, name in [('#open-noprofile', '설문을 마치면', '프로필 없음 안내'),
                                ('#open-fail', '못 불러왔어요', '네트워크 실패 안내')]:
            pg.click(btn)
            pg.locator('[data-menu="housing"]').click()
            pg.wait_for_function('document.querySelector(".haru-bubble").innerText.indexOf("찾아보는 중") < 0')
            check(text in pg.locator('.haru-bubble').inner_text(), f'[{tag}] {name}')
            pg.keyboard.press('Escape')
        # Tab이 창 밖으로 나가지 않음
        pg.click('#open-ok')
        for _ in range(12): pg.keyboard.press('Tab')
        check(pg.evaluate('!!document.activeElement.closest(".haru-panel")'), f'[{tag}] Tab 포커스가 창 안에 머묾')
        pg.keyboard.press('Escape')
        pg.close()
    b.close()
print('모두 통과' if not fails else f'실패 {len(fails)}건'); sys.exit(1 if fails else 0)
