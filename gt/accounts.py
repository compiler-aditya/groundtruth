"""Accounts for the studio: sign up with an email and a password, stay signed in with a session cookie, and keep
designs in the account so they follow you to another browser.

Storage is Postgres when DATABASE_URL (or POSTGRES_URL) is set, as on Vercel with Neon, and SQLite otherwise (local
development and tests; GT_ACCOUNTS_DB names the file). On a serverless host without a database, accounts are off:
a SQLite file there would vanish between requests.

Passwords are hashed with scrypt and a random salt. The session cookie holds a random token; only its SHA-256 is
stored, so a copy of the database does not give working sessions.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

SESSION_DAYS = 30
MAX_DESIGNS = 200
MAX_DESIGN_BYTES = 2_000_000
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SCRYPT = {"n": 2**14, "r": 8, "p": 1}
SCHEMA = [
    "CREATE TABLE IF NOT EXISTS gt_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, "
    "pw TEXT NOT NULL, created DOUBLE PRECISION NOT NULL)",
    "CREATE TABLE IF NOT EXISTS gt_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL)",
    "CREATE TABLE IF NOT EXISTS gt_designs (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, "
    "updated DOUBLE PRECISION NOT NULL, PRIMARY KEY (user_id, id))",
]


class AccountError(ValueError):
    """A request the account rules refuse; the message is safe to show."""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **SCRYPT)
    return "scrypt${n}${r}${p}${salt}${digest}".format(**SCRYPT, salt=base64.b64encode(salt).decode(), digest=base64.b64encode(digest).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    """The three tables, behind one lock: Postgres if a URL is given, else a SQLite file."""

    def __init__(self, url: str | None = None, path: str | Path | None = None):
        self.url, self.lock = url, threading.Lock()
        self.conn = None
        if not url:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        with self.lock:
            for sql in SCHEMA:
                self._run(sql)

    def _connect(self):
        if self.url and (self.conn is None or self.conn.closed):
            import psycopg  # only needed where a database URL is set

            # prepare_threshold=None: Neon's pooled endpoint (PgBouncer) does not keep prepared statements
            self.conn = psycopg.connect(self.url, autocommit=True, prepare_threshold=None, connect_timeout=10)
        return self.conn

    def _run(self, sql: str, args: tuple = ()):
        if not self.url:
            return self.conn.execute(sql.replace("%s", "?"), args).fetchall()
        for attempt in (0, 1):  # a serverless instance may find its connection closed after idling
            try:
                cur = self._connect().execute(sql, args)
                return cur.fetchall() if cur.description else []
            except Exception as err:  # noqa: BLE001 - reconnect once on a dropped connection
                import psycopg

                if attempt or not isinstance(err, psycopg.OperationalError):
                    raise
                self.conn = None

    def q(self, sql: str, *args) -> list[tuple]:
        with self.lock:
            return self._run(sql, args)


_store: Store | None = None
_store_lock = threading.Lock()
_failures: dict[str, deque] = defaultdict(deque)


def database_url() -> str:
    return os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or ""


def available() -> bool:
    return bool(database_url()) or not os.environ.get("VERCEL")


def store() -> Store:
    global _store
    with _store_lock:
        if _store is None:
            if not available():
                raise AccountError("Accounts aren't set up on this deployment yet.")
            default = Path(__file__).resolve().parent.parent / "out" / "web" / "accounts.db"
            _store = Store(url=database_url() or None, path=os.environ.get("GT_ACCOUNTS_DB") or default)
        return _store


def _public(row: tuple) -> dict:
    return {"id": row[0], "email": row[1], "name": row[2]}


def _throttle(key: str, failed: bool | None = None) -> None:
    """At most 8 failed sign-ins per email and per address in 15 minutes (per instance)."""
    now, recent = time.time(), _failures[key]
    while recent and now - recent[0] > 900:
        recent.popleft()
    if failed is None and len(recent) >= 8:
        raise AccountError("Too many attempts. Wait a few minutes and try again.")
    if failed:
        recent.append(now)


def sign_up(email: str, password: str, name: str) -> dict:
    email, name = (email or "").strip().lower(), re.sub(r"\s+", " ", name or "").strip()[:60]
    if not EMAIL.match(email) or len(email) > 254:
        raise AccountError("Enter a valid email address.")
    if not 8 <= len(password or "") <= 200:
        raise AccountError("Use a password of at least 8 characters.")
    name = name or email.split("@")[0]
    s = store()
    if s.q("SELECT id FROM gt_users WHERE email = %s", email):
        raise AccountError("An account with this email already exists. Sign in instead.")
    user = ("u" + secrets.token_hex(8), email, name)
    try:
        s.q("INSERT INTO gt_users (id, email, name, pw, created) VALUES (%s, %s, %s, %s, %s)", *user, hash_password(password), time.time())
    except Exception as err:  # noqa: BLE001 - two sign-ups racing for one email
        if "unique" in str(err).lower():
            raise AccountError("An account with this email already exists. Sign in instead.") from None
        raise
    return _public(user)


def sign_in(email: str, password: str, client: str = "") -> dict:
    email = (email or "").strip().lower()
    for key in (f"e:{email}", f"c:{client}"):
        _throttle(key)
    rows = store().q("SELECT id, email, name, pw FROM gt_users WHERE email = %s", email)
    if not rows or not verify_password(password or "", rows[0][3]):
        for key in (f"e:{email}", f"c:{client}"):
            _throttle(key, failed=True)
        raise AccountError("That email and password don't match an account.")
    return _public(rows[0])


def new_session(user_id: str) -> str:
    token, s = secrets.token_urlsafe(32), store()
    s.q("DELETE FROM gt_sessions WHERE expires < %s", time.time())
    s.q("INSERT INTO gt_sessions (token, user_id, expires) VALUES (%s, %s, %s)", _token_hash(token), user_id, time.time() + SESSION_DAYS * 86400)
    return token


def session_user(token: str | None) -> dict | None:
    if not token or not available():
        return None
    rows = store().q("SELECT u.id, u.email, u.name FROM gt_sessions s JOIN gt_users u ON u.id = s.user_id "
                     "WHERE s.token = %s AND s.expires > %s", _token_hash(token), time.time())
    return _public(rows[0]) if rows else None


def end_session(token: str | None) -> None:
    if token and available():
        store().q("DELETE FROM gt_sessions WHERE token = %s", _token_hash(token))


def list_designs(user_id: str) -> list[dict]:
    rows = store().q("SELECT id, name, data, updated FROM gt_designs WHERE user_id = %s ORDER BY updated DESC", user_id)
    return [{"id": r[0], "name": r[1], "data": r[2], "updated": r[3]} for r in rows]


def save_design(user_id: str, design_id: str, name: str, data: str, updated: float) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", design_id or ""):
        raise AccountError("Bad design id.")
    if len(data.encode()) > MAX_DESIGN_BYTES:
        raise AccountError("This design is too large to save to your account (over 2 MB).")
    s = store()
    exists = s.q("SELECT 1 FROM gt_designs WHERE user_id = %s AND id = %s", user_id, design_id)
    if not exists and s.q("SELECT COUNT(*) FROM gt_designs WHERE user_id = %s", user_id)[0][0] >= MAX_DESIGNS:
        raise AccountError(f"An account holds up to {MAX_DESIGNS} designs. Delete some to save new ones.")
    s.q("INSERT INTO gt_designs (user_id, id, name, data, updated) VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, data = excluded.data, updated = excluded.updated",
        user_id, design_id, (name or "Untitled design")[:80], data, float(updated))


def delete_design(user_id: str, design_id: str) -> None:
    store().q("DELETE FROM gt_designs WHERE user_id = %s AND id = %s", user_id, design_id)
