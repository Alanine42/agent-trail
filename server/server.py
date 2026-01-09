#!/usr/bin/env python3
"""
Trailmark local bridge server.
Sits between the Chrome extension and the SQLite database.
Also used by the PostToolUse hook script.

Run: python3 server.py
Listens on http://localhost:3773
"""

import json
import sqlite3
import hashlib
import uuid
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

DB_PATH = Path.home() / ".agent-trail" / "annotations.db"
PORT = 3773


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            refreshed_at TEXT,

            author_type TEXT NOT NULL DEFAULT 'human',
            agent_id TEXT,
            display_name TEXT DEFAULT 'You',

            url TEXT NOT NULL,
            url_hash TEXT NOT NULL,
            page_title TEXT,
            anchor_exact TEXT NOT NULL,
            anchor_prefix TEXT,
            anchor_suffix TEXT,

            annotation_type TEXT NOT NULL DEFAULT 'highlight',
            comment TEXT,

            session_id TEXT,
            task_description TEXT,
            micro_intent TEXT,
            webfetch_summary TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_url_hash ON annotations(url_hash)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_created ON annotations(created_at)")
    conn.commit()
    return conn


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    hostname = hostname.lower().removeprefix("www.")

    tracking_params = {
        "utm_source", "utm_medium", "utm_campaign",
        "utm_content", "utm_term", "fbclid", "gclid",
        "ref", "source",
    }
    params = parse_qs(parsed.query, keep_blank_values=True)
    filtered = {k: v for k, v in params.items() if k not in tracking_params}
    sorted_query = urlencode(filtered, doseq=True)

    path = parsed.path.rstrip("/") if parsed.path != "/" else "/"

    return urlunparse((
        parsed.scheme, hostname, path,
        parsed.params, sorted_query, ""
    ))


def hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def row_to_dict(row):
    return dict(row)


class TrailmarkHandler(BaseHTTPRequestHandler):

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_OPTIONS(self):
        self._send_json({})

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/annotations":
            conn = init_db()
            try:
                if "url" in params:
                    # Get annotations for a specific page
                    url = params["url"][0]
                    canonical = canonicalize_url(url)
                    url_hash_val = hash_url(canonical)
                    rows = conn.execute(
                        "SELECT * FROM annotations WHERE url_hash = ? ORDER BY created_at DESC",
                        (url_hash_val,)
                    ).fetchall()
                else:
                    # List all annotations
                    limit = int(params.get("limit", [100])[0])
                    rows = conn.execute(
                        "SELECT * FROM annotations ORDER BY created_at DESC LIMIT ?",
                        (limit,)
                    ).fetchall()
                self._send_json([row_to_dict(r) for r in rows])
            finally:
                conn.close()

        elif parsed.path == "/health":
            self._send_json({"status": "ok", "db": str(DB_PATH)})

        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/annotations":
            body = self._read_body()

            url = body.get("url", "")
            canonical = canonicalize_url(url)
            url_hash_val = hash_url(canonical)
            now = datetime.now(timezone.utc).isoformat()

            annotation = {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "updated_at": now,
                "refreshed_at": None,
                "author_type": body.get("author_type", "human"),
                "agent_id": body.get("agent_id"),
                "display_name": body.get("display_name", "You"),
                "url": canonical,
                "url_hash": url_hash_val,
                "page_title": body.get("page_title"),
                "anchor_exact": body["anchor_exact"],
                "anchor_prefix": body.get("anchor_prefix", ""),
                "anchor_suffix": body.get("anchor_suffix", ""),
                "annotation_type": body.get("annotation_type", "highlight"),
                "comment": body.get("comment"),
                "session_id": body.get("session_id"),
                "task_description": body.get("task_description"),
                "micro_intent": body.get("micro_intent"),
                "webfetch_summary": body.get("webfetch_summary"),
            }

            conn = init_db()
            try:
                conn.execute(
                    """INSERT INTO annotations (
                        id, created_at, updated_at, refreshed_at,
                        author_type, agent_id, display_name,
                        url, url_hash, page_title,
                        anchor_exact, anchor_prefix, anchor_suffix,
                        annotation_type, comment,
                        session_id, task_description, micro_intent, webfetch_summary
                    ) VALUES (
                        :id, :created_at, :updated_at, :refreshed_at,
                        :author_type, :agent_id, :display_name,
                        :url, :url_hash, :page_title,
                        :anchor_exact, :anchor_prefix, :anchor_suffix,
                        :annotation_type, :comment,
                        :session_id, :task_description, :micro_intent, :webfetch_summary
                    )""",
                    annotation,
                )
                conn.commit()
                self._send_json(annotation, 201)
            finally:
                conn.close()

        elif parsed.path == "/annotations/refresh":
            body = self._read_body()
            annotation_id = body.get("id")
            now = datetime.now(timezone.utc).isoformat()

            conn = init_db()
            try:
                conn.execute(
                    "UPDATE annotations SET refreshed_at = ?, updated_at = ? WHERE id = ?",
                    (now, now, annotation_id),
                )
                conn.commit()
                self._send_json({"refreshed": annotation_id})
            finally:
                conn.close()

        else:
            self._send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)

        # DELETE /annotations/abc-123
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "annotations":
            annotation_id = parts[1]
            conn = init_db()
            try:
                conn.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
                conn.commit()
                self._send_json({"deleted": annotation_id})
            finally:
                conn.close()
        else:
            self._send_json({"error": "not found"}, 404)

    def log_message(self, format, *args):
        # Quiet logging — just method and path
        print(f"[Trailmark] {args[0]}")


if __name__ == "__main__":
    print(f"[Trailmark] Server starting on http://localhost:{PORT}")
    print(f"[Trailmark] Database: {DB_PATH}")
    server = HTTPServer(("127.0.0.1", PORT), TrailmarkHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Trailmark] Shutting down")
        server.server_close()
