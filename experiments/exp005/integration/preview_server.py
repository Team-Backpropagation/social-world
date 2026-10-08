"""기존 3D 마을 + EXP-005 로컬 점검 서버. 원본 마을 파일은 수정하지 않습니다.

마을 HTML/JS는 제공 시점에만 연결 지점을 삽입합니다. 기존 테스트의 메모리 DB
대역을 사용하고 외부 연결을 CSP로 차단합니다. API는 loopback 서버로만 전달합니다.
"""
import argparse
import http.client
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
EXP = HERE.parent


def inside(root, relative):
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()):
        raise ValueError("invalid_path")
    return candidate


def create_handler(project, backend_port):
    world = project / "social_world"
    fixture_source = (world / "app/tests/ui_test.py").read_text(encoding="utf-8-sig")
    fixture = re.search(r'FAKE_SUPABASE = r"""([\s\S]*?)"""', fixture_source)
    if not fixture:
        raise RuntimeError("마을의 메모리 DB 테스트 대역을 찾지 못했습니다.")
    mock_js = fixture.group(1).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            # 메시지·토큰을 파일이나 콘솔 access log에 적재하지 않습니다.
            pass

        def send_bytes(self, body, mime, status=200):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "connect-src 'self'; frame-ancestors 'self'")
            self.end_headers()
            self.wfile.write(body)

        def proxy(self):
            # 전달 경로와 목적지는 고정합니다. 임의 URL 프록시가 아닙니다.
            if self.path not in {"/api/health", "/api/sessions", "/api/chat"}:
                return self.send_bytes(b'{"code":"not_found"}', "application/json", 404)
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 16384:
                return self.send_bytes(b'{"code":"request_too_large"}', "application/json", 413)
            body = self.rfile.read(length) if length else None
            headers = {"Content-Type": "application/json"}
            if self.headers.get("Authorization"):
                headers["Authorization"] = self.headers["Authorization"]
            connection = http.client.HTTPConnection("127.0.0.1", backend_port, timeout=65)
            try:
                connection.request(self.command, self.path, body, headers)
                response = connection.getresponse()
                payload = response.read()
                self.send_bytes(payload, "application/json; charset=utf-8", response.status)
            except (OSError, http.client.HTTPException):
                self.send_bytes(b'{"code":"backend_unavailable"}', "application/json", 503)
            finally:
                connection.close()

        def do_POST(self):
            self.proxy()

        def do_DELETE(self):
            self.proxy()

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path.startswith("/api/"):
                return self.proxy()
            if path == "/":
                self.send_response(302)
                self.send_header("Location", "/world/app/")
                self.end_headers()
                return
            try:
                if path == "/integration/mock-db.js":
                    return self.send_bytes(mock_js, "application/javascript; charset=utf-8")
                if path == "/integration/world-bridge.js":
                    return self.send_bytes((HERE / "world-bridge.js").read_bytes(), "application/javascript; charset=utf-8")
                if path.startswith("/agent/"):
                    relative = path.removeprefix("/agent/") or "index.html"
                    file = inside(EXP / "frontend/dist", relative)
                elif path.startswith("/world/"):
                    relative = path.removeprefix("/world/")
                    if relative.endswith("/"):
                        relative += "index.html"
                    file = inside(world, relative)
                else:
                    return self.send_bytes(b"Not found", "text/plain", 404)
                # 테스트 화면에서 HTML 진입은 변환된 app/index.html 하나만 허용합니다.
                if file.suffix == ".html" and file not in {world / "app/index.html", EXP / "frontend/dist/index.html"}:
                    return self.send_bytes(b"Not found", "text/plain", 404)
                if file.suffix.lower() not in {".html", ".js", ".css", ".mp3", ".wav", ".ogg", ".m4a", ".png", ".jpg", ".svg", ".webp", ".woff", ".woff2"}:
                    return self.send_bytes(b"Not found", "text/plain", 404)
                payload = file.read_bytes()
                if file == world / "app/index.html":
                    html = payload.decode("utf-8-sig")
                    html, count = re.subn(r'<script src="https://[^"\n]*supabase-js[^"\n]*"></script>', '<script src="/integration/mock-db.js"></script>', html, count=1)
                    if count != 1:
                        raise ValueError("mock_injection_failed")
                    html = re.sub(r'<div id="banner">[\s\S]*?</div>', '<div id="banner">🌱 EXP-005 에이전트 점검 · 가상 주민 · 메모리 DB · 고정 응답 시연</div>', html, count=1)
                    html = html.replace('</body>', '<script src="/integration/world-bridge.js"></script></body>')
                    payload = html.encode("utf-8")
                elif file == world / "app/app.js":
                    js = payload.decode("utf-8-sig")
                    marker = '    if(id === "coco"){ openCoco(); return; }'
                    if js.count(marker) != 1:
                        raise ValueError("npc_hook_failed")
                    js = js.replace(marker, '    if(window.Exp005World && window.Exp005World.open(id)) return;\n' + marker, 1)
                    js = js.replace('.modal-backdrop, .coco-backdrop, .chief-backdrop, .haru-backdrop', '.exp005-backdrop:not([hidden]), .modal-backdrop, .coco-backdrop, .chief-backdrop, .haru-backdrop')
                    payload = js.encode("utf-8")
                mime = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
                if file.suffix in {".html", ".js", ".css"}:
                    mime += "; charset=utf-8"
                self.send_bytes(payload, mime)
            except (OSError, ValueError):
                self.send_bytes(b"Preview source unavailable", "text/plain", 404)

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=EXP.parents[1])
    parser.add_argument("--port", type=int, default=8015)
    parser.add_argument("--backend-port", type=int, default=8005)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), create_handler(args.project.resolve(), args.backend_port))
    print(f"EXP-005 world check: http://127.0.0.1:{args.port}/world/app/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
