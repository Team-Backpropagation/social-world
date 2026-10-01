# 코코 화면 흐름 테스트 (가짜 supabase 미리보기 페이지 사용)
import pathlib, sys
from playwright.sync_api import sync_playwright
url = pathlib.Path(__file__).resolve().parent.parent.joinpath('coco-preview.html').as_uri()
fails = []
def check(cond, name):
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in [(1100, 800, 'desktop'), (390, 780, 'mobile')]:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto(url)
        pg.click('#open-ok')
        check(pg.get_by_role('dialog').is_visible(), f'[{tag}] 창이 열림')
        check(pg.locator('.coco-choices .coco-btn').count() == 3, f'[{tag}] 선택지 3개')
        check(pg.evaluate('document.activeElement.textContent') == '내 관심사로 찾아줘', f'[{tag}] 첫 선택지에 포커스')
        pg.get_by_role('button', name='내 관심사로 찾아줘').click()
        pg.wait_for_selector('.coco-item')
        check(pg.locator('.coco-item').count() == 3, f'[{tag}] 카드 3장')
        check(pg.locator('#log').inner_text().count('"action":"recommend"') == 3, f'[{tag}] 추천 3건 기록')
        check(pg.locator('.coco-demo').count() == 1, f'[{tag}] 시연용 안내는 링크 없는 활동에만')
        pg.screenshot(path=str(pathlib.Path(__file__).resolve().parent / f'shot_{tag}.png'), full_page=True)
        done = pg.get_by_role('button', name='신청했어요')
        check(done.is_disabled(), f'[{tag}] 링크 열기 전 "신청했어요" 비활성')
        with pg.expect_popup() as pop:
            pg.get_by_role('button', name='신청 페이지 열기').click()
        pop.value.close()
        check(not done.is_disabled(), f'[{tag}] 링크 연 뒤 "신청했어요" 활성')
        done.click()
        check('self_reported' in pg.locator('#log').inner_text(), f'[{tag}] 자기보고 기록')
        check(pg.get_by_role('button', name='신청 완료로 기록했어요').is_disabled(), f'[{tag}] 중복 신고 막힘')
        pg.get_by_role('button', name='동아리 보러 가기').click()
        check('동아리 열기: 2' in pg.locator('#log').inner_text(), f'[{tag}] 동아리 화면으로 연결')
        check(pg.locator('.coco-backdrop').count() == 0, f'[{tag}] 동아리 이동 시 창 닫힘')
        # 오류 상황
        for btn, text, name in [('#open-empty', '다른 방법으로', '결과 없음 안내'),
                                ('#open-noprofile', '설문을 마치면', '프로필 없음 안내'),
                                ('#open-fail', '못 불러왔어', '네트워크 실패 안내')]:
            pg.click(btn)
            pg.get_by_role('button', name='내 관심사로 찾아줘').click()
            pg.wait_for_function('document.querySelector(".coco-bubble").innerText.indexOf("찾아보는 중") < 0')
            check(text in pg.locator('.coco-bubble').inner_text(), f'[{tag}] {name}')
            pg.keyboard.press('Escape')
            check(pg.locator('.coco-backdrop').count() == 0, f'[{tag}] Esc로 닫힘 ({name})')
        # 가로 스크롤 없음
        check(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'[{tag}] 가로 넘침 없음')
        pg.close()
    b.close()
print('모두 통과' if not fails else f'실패 {len(fails)}건'); sys.exit(1 if fails else 0)
