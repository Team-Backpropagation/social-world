"""소셜 월드 배포용 한 파일 만들기

  python social_world/app/bundle.py            → social_world/socialworld-demo.html
  python social_world/app/bundle.py out.html   → 원하는 경로

index.html 이 부르는 로컬 CSS·JS(../coco, ../chief 포함)를 안에 넣고, sounds.js 의
효과음 파일(assets/*.mp3 등)은 data: 주소로 바꿔 넣는다. CDN(https://)은 그대로 둔다.
원작: PR #13 social-world-ui-v2 의 bundle.py (UI 담당 팀원).
"""
from pathlib import Path
import base64
import mimetypes
import re
import sys

APP = Path(__file__).resolve().parent            # social_world/app
SW = APP.parent                                   # social_world
DEFAULT_OUT = SW / 'socialworld-demo.html'

HEADER = ('<!-- 자동 생성 파일 — 직접 고치지 마세요. 원본: social_world/app/ '
          '(index.html·app.js·ui.js·world-engine.js·*.css). 다시 만들기: python social_world/app/bundle.py -->\n')


def read(rel):
    path = (APP / rel).resolve()
    if SW not in path.parents:
        raise ValueError('social_world 밖의 파일은 넣지 않습니다: ' + rel)
    return path.read_text(encoding='utf-8-sig')


def embed_audio(source):
    def repl(m):
        path = (APP / m[2]).resolve()
        if APP not in path.parents:
            raise ValueError('효과음 파일은 social_world/app 안에 있어야 합니다: ' + m[2])
        mime = mimetypes.guess_type(path.name)[0] or 'audio/mpeg'
        data = base64.b64encode(path.read_bytes()).decode('ascii')
        return m[1] + 'data:' + mime + ';base64,' + data + m[1]
    return re.sub(r'''(['"])(assets/[^'"\r\n]+\.(?:mp3|wav|ogg|m4a))\1''', repl, source)


def build():
    html = read('index.html')
    html = re.sub(r'<!--\s*\n\s*소셜 월드 \(개발용 원본\).*?-->\n', '', html, count=1, flags=re.S)   # 개발용 안내 주석은 뺀다

    def style(m):
        return '<style>\n' + read(m[1]) + '\n</style>'
    html = re.sub(r'<link rel="stylesheet" href="(?!https?:)([^"]+)">', style, html)

    def script(m):
        src = m[1]
        body = read(src)
        if src.endswith('sounds.js'):
            body = embed_audio(body)
        return '<!-- ' + src + ' -->\n<script>\n' + body.replace('</script', '<\\/script') + '\n</script>'
    html = re.sub(r'<script src="(?!https?:)([^"]+)"></script>', script, html)

    return html.replace('<!doctype html>\n', '<!doctype html>\n' + HEADER, 1)


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUT
    html = build()
    out.write_text(html, encoding='utf-8', newline='\n')
    print(out, f'({len(html.encode("utf-8")) // 1024} KB)')
