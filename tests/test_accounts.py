"""Offline checks of accounts: sign-up, sign-in, sessions and designs per account (SQLite in a temporary folder)."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["GT_ACCOUNTS_DB"] = str(Path(tempfile.mkdtemp()) / "accounts.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("POSTGRES_URL", None)
from fastapi.testclient import TestClient  # noqa: E402

import app  # noqa: E402
from gt import accounts  # noqa: E402

# passwords are salted scrypt hashes
h = accounts.hash_password("correct horse")
assert h.startswith("scrypt$") and accounts.verify_password("correct horse", h) and not accounts.verify_password("wrong", h)
assert h != accounts.hash_password("correct horse")

web = TestClient(app.app)
assert web.get("/api/auth/me").json() == {"accounts": True, "user": None}
assert web.get("/api/designs").status_code == 401

# sign-up checks the email and the password, and signs you in
assert "valid email" in web.post("/api/auth/signup", json={"email": "nope", "password": "longenough"}).json()["detail"]
assert "8 characters" in web.post("/api/auth/signup", json={"email": "a@b.co", "password": "short"}).json()["detail"]
res = web.post("/api/auth/signup", json={"email": " Asha@Example.com ", "password": "correct horse", "name": "Asha"})
assert res.status_code == 200 and res.json()["user"]["email"] == "asha@example.com", res.json()
cookie = res.headers["set-cookie"].lower()
assert "httponly" in cookie and "samesite=lax" in cookie and "max-age" in cookie, cookie
assert web.get("/api/auth/me").json()["user"]["name"] == "Asha"
assert "already exists" in web.post("/api/auth/signup", json={"email": "asha@example.com", "password": "another one"}).json()["detail"]

# the database holds a hash of the session token, never the token itself
token = web.cookies.get("gt_session")
assert token and not accounts.store().q("SELECT 1 FROM gt_sessions WHERE token = %s", token)

# designs are saved per account and listed newest first
plan = {"id": "p1", "name": "Home", "rooms": [{"id": "r1", "name": "Living", "type": "living", "x": 0, "y": 0, "w": 4, "h": 3}], "openings": [], "items": []}
assert web.put("/api/designs/p1", json={"name": "Home", "updated": 1000, "data": plan}).json() == {"ok": True}
assert web.put("/api/designs/p2", json={"name": "Office", "updated": 2000, "data": {**plan, "id": "p2", "name": "Office"}}).status_code == 200
assert web.put("/api/designs/p1", json={"name": "Home v2", "updated": 3000, "data": {**plan, "name": "Home v2"}}).status_code == 200
got = web.get("/api/designs").json()["designs"]
assert [(d["id"], d["name"]) for d in got] == [("p1", "Home v2"), ("p2", "Office")] and got[0]["data"]["rooms"][0]["name"] == "Living", got
assert web.put("/api/designs/bad id!", json={"data": plan}).status_code in (400, 404)
assert web.put("/api/designs/p3", json={"data": {"name": "no rooms"}}).status_code == 400
assert "too large" in web.put("/api/designs/p4", json={"data": {**plan, "pad": "x" * 2_100_000}}).json()["detail"]

# changes from another site are refused
assert web.put("/api/designs/p1", json={"data": plan}, headers={"origin": "https://evil.example"}).status_code == 403
assert web.post("/api/auth/logout", headers={"origin": "https://evil.example"}).status_code == 403

# a second account sees none of the first one's designs
other = TestClient(app.app)
assert other.post("/api/auth/signup", json={"email": "ben@example.com", "password": "password123"}).status_code == 200
assert other.get("/api/designs").json()["designs"] == []
other.delete("/api/designs/p1")
assert len(web.get("/api/designs").json()["designs"]) == 2

# sign out ends the session; signing in again needs the right password, and repeated failures are throttled
assert web.post("/api/auth/logout").json() == {"ok": True}
assert web.get("/api/auth/me").json()["user"] is None and web.get("/api/designs").status_code == 401
assert "don't match" in web.post("/api/auth/login", json={"email": "asha@example.com", "password": "wrong pass"}).json()["detail"]
assert web.post("/api/auth/login", json={"email": "ASHA@example.com", "password": "correct horse"}).status_code == 200
assert web.delete("/api/designs/p2").json() == {"ok": True} and [d["id"] for d in web.get("/api/designs").json()["designs"]] == ["p1"]
for _ in range(8):
    web.post("/api/auth/login", json={"email": "ben@example.com", "password": "guessing!"})
assert web.post("/api/auth/login", json={"email": "ben@example.com", "password": "password123"}).status_code == 429

# on a serverless host without a database, accounts are off rather than kept in a file that would vanish
os.environ["VERCEL"] = "1"
assert not accounts.available() and web.get("/api/auth/me").json() == {"accounts": False, "user": None}
del os.environ["VERCEL"]
print("accounts: all checks passed")
