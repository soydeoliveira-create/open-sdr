"""Serve a plataforma no computador com o banco de mentira (dev/mock-supabase.js)."""
import http.server
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SDK = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'


class Servidor(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(RAIZ), **k)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            html = (RAIZ / "index.html").read_text(encoding="utf-8")
            corpo = html.replace(SDK, '<script src="dev/mock-supabase.js"></script>').encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()


porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8560
http.server.ThreadingHTTPServer(("127.0.0.1", porta), Servidor).serve_forever()
