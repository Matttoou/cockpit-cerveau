#!/usr/bin/env python3
"""Mode local du cockpit : sert l'app sur http://localhost:8765 et imite les 3 appels GitHub
à partir de la copie Mac ~/Cerveau (dernier commit, lecture seule). Aucun jeton. Stdlib uniquement.

  python3 serve.py [port]
"""
import json, os, subprocess, sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote, urlparse, parse_qs

REPO = os.path.expanduser(os.environ.get("CERVEAU_REPO", "~/Cerveau"))
ICI = os.path.dirname(os.path.abspath(__file__))
APP = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/logic.js": "logic.js", "/style.css": "style.css",
       "/manifest.webmanifest": "manifest.webmanifest", "/icon.svg": "icon.svg", "/icon-180.png": "icon-180.png"}
API = "/api/repos/Matttoou/cerveau/"


def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], check=True, capture_output=True).stdout


def chemins():
    return git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines()


def commits(n):
    sortie = git("log", f"-{n}", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e").decode()
    return [{"sha": h, "commit": {"author": {"name": a, "date": d}, "message": m}}
            for h, a, d, m in (c.strip().split("\x1f") for c in sortie.split("\x1e") if c.strip())]


class Cockpit(SimpleHTTPRequestHandler):
    def envoie(self, code, corps, type_):
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path in APP:
            fichier = os.path.join(ICI, APP[url.path])
            if not os.path.exists(fichier):
                return self.envoie(404, b"", "text/plain")
            return self.envoie(200, open(fichier, "rb").read(), self.guess_type(fichier))
        if not url.path.startswith(API):
            return self.envoie(404, b"", "text/plain")
        route = url.path[len(API):]
        if route == "git/trees/main":
            return self.envoie(200, json.dumps({"tree": [{"path": p, "type": "blob"} for p in chemins()]}).encode(), "application/json")
        if route == "commits":
            n = min(int(parse_qs(url.query).get("per_page", ["30"])[0]), 100)
            return self.envoie(200, json.dumps(commits(n)).encode(), "application/json")
        if route.startswith("contents/"):
            p = unquote(route[len("contents/"):])
            if p not in chemins():  # seuls les fichiers suivis par Git, jamais le reste du disque
                return self.envoie(404, b"", "text/plain")
            return self.envoie(200, git("show", f"HEAD:{p}"), "text/plain; charset=utf-8")
        self.envoie(404, b"", "text/plain")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Cockpit local : http://localhost:{port}  (source : {REPO})")
    HTTPServer(("127.0.0.1", port), Cockpit).serve_forever()
