import hashlib
import hmac
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg
from flask import Flask, jsonify, request, send_from_directory
from psycopg.rows import dict_row
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
app = Flask(__name__, static_folder=None)
app.config.update(MAX_CONTENT_LENGTH=2 * 1024 * 1024)
MIGRATION_TOKEN_HASH = "020ed9c6236ddf3a28937752e5f785112bf941c84ff2ce059c83fc6e5197543b"


def database_url():
    direct = os.getenv("DATABASE_URL")
    if direct:
        return direct
    return (
        f"host={os.environ['DB_HOST']} port={os.getenv('DB_PORT', '5432')} "
        f"dbname={os.environ['DB_NAME']} user={os.environ['DB_USER']} "
        f"password={os.environ['DB_PASSWORD']}"
    )


def db():
    return psycopg.connect(database_url(), row_factory=dict_row)


def init_db():
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
              username TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              email TEXT,
              department TEXT,
              role TEXT NOT NULL DEFAULT 'admin',
              password_hash TEXT NOT NULL,
              password_salt TEXT,
              active BOOLEAN NOT NULL DEFAULT TRUE,
              must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY,
              username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
              expires_at TIMESTAMPTZ NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS app_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS hr_records (
              id TEXT PRIMARY KEY,
              record_type TEXT NOT NULL,
              payload JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE")
        cur.execute("SELECT value FROM app_meta WHERE key='setup_token'")
        if not cur.fetchone():
            token = os.getenv("SETUP_TOKEN") or secrets.token_urlsafe(24)
            cur.execute("INSERT INTO app_meta(key,value) VALUES('setup_token',%s)", (token,))
            print(f"ONE_TIME_SETUP_PATH=/?setup={token}", flush=True)


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def actor():
    token = request.cookies.get("hr_session")
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute("""SELECT u.username,u.display_name AS name,u.email,u.department,u.role,
                              u.must_change_password AS "mustChangePassword"
                       FROM sessions s JOIN users u ON u.username=s.username
                       WHERE s.token_hash=%s AND s.expires_at>NOW() AND u.active=TRUE""", (token_hash(token),))
        return cur.fetchone()


def require_actor():
    user = actor()
    if not user:
        return None, (jsonify(error="로그인이 필요합니다."), 401)
    return user, None


def password_matches(user, password):
    salt = user.get("password_salt")
    if salt:
        actual = hashlib.scrypt(
            password.encode(), salt=salt.encode(), n=2**14, r=8, p=1, dklen=64
        ).hex()
        return hmac.compare_digest(actual, user["password_hash"])
    return check_password_hash(user["password_hash"], password)


def empty_hr(user):
    today = date.today().isoformat()
    start = request.args.get("from", today)
    end = request.args.get("to", today)
    return {
        "actor": user, "access": "registered", "today": today,
        "period": {"from": start, "to": end},
        "report": {"totals": {}, "executive": {}}, "goals": [],
        "recruitingActivities": [], "checkpoints": [], "snapshots": [],
        "recentAudit": [], "users": [], "assignees": [], "jobPostings": [],
        "saramin": {"connected": bool(os.getenv("SARAMIN_ACCESS_KEY"))},
        "candidatePipeline": [], "candidateSummary": {}, "workforcePlans": [],
        "workforce": {}, "meetings": [], "actionItems": [], "myWork": None,
        "legacy": {}
    }


@app.after_request
def secure(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.get("/health")
@app.get("/healthz")
def health():
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1")
    return jsonify(ok=True, service="medpark-hr", runtime="python", database="postgresql")


@app.get("/api/setup/status")
def setup_status():
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS count FROM users")
        count = cur.fetchone()["count"]
    return jsonify(setupNeeded=count == 0)


@app.post("/api/setup")
def setup():
    body = request.get_json(silent=True) or {}
    password = str(body.get("password", ""))
    if len(password) < 10 or not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        return jsonify(error="비밀번호는 영문과 숫자를 포함한 10자 이상이어야 합니다."), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS count FROM users")
        if cur.fetchone()["count"]:
            return jsonify(error="관리자 설정이 이미 완료되었습니다."), 409
        cur.execute("SELECT value FROM app_meta WHERE key='setup_token'")
        row = cur.fetchone()
        if not row or not secrets.compare_digest(str(body.get("token", "")), row["value"]):
            return jsonify(error="유효하지 않은 설정 링크입니다."), 403
        cur.execute("""INSERT INTO users(username,display_name,email,department,role,password_hash)
                       VALUES('admin',%s,%s,%s,'admin',%s)""",
                    (body.get("displayName") or "관리자", body.get("email"), body.get("department") or "인사", generate_password_hash(password)))
        cur.execute("DELETE FROM app_meta WHERE key='setup_token'")
    return jsonify(ok=True, username="admin"), 201


@app.post("/api/login")
def login():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip().lower()
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE username=%s AND active=TRUE", (username,))
        user = cur.fetchone()
        if not user or not password_matches(user, str(body.get("password", ""))):
            return jsonify(error="아이디 또는 비밀번호를 확인하세요."), 401
        token = secrets.token_urlsafe(32)
        cur.execute("INSERT INTO sessions(token_hash,username,expires_at) VALUES(%s,%s,%s)",
                    (token_hash(token), username, datetime.now(timezone.utc) + timedelta(hours=12)))
    response = jsonify(ok=True, actor={"username": username, "name": user["display_name"], "role": user["role"]})
    response.set_cookie("hr_session", token, max_age=43200, secure=True, httponly=True, samesite="Strict")
    return response


@app.post("/api/internal/migrate-users")
def migrate_users():
    body = request.get_json(silent=True) or {}
    supplied = str(body.get("setupToken", ""))
    records = body.get("users")
    if not isinstance(records, list) or not records:
        return jsonify(error="이관할 계정이 없습니다."), 400
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS count FROM users")
        if cur.fetchone()["count"]:
            return jsonify(error="계정 이관은 빈 사용자 DB에서 한 번만 실행할 수 있습니다."), 409
        if not secrets.compare_digest(hashlib.sha256(supplied.encode()).hexdigest(), MIGRATION_TOKEN_HASH):
            return jsonify(error="유효하지 않은 일회성 이관 토큰입니다."), 403
        for item in records:
            cur.execute("""INSERT INTO users
                (username,display_name,email,department,role,password_hash,password_salt,
                 active,must_change_password,created_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", (
                str(item["username"]).lower(), item["displayName"], item.get("email"),
                item.get("department"), item["role"], item["passwordHash"],
                item["passwordSalt"], bool(item.get("active", True)),
                bool(item.get("mustChangePassword", False)), item.get("createdAt") or datetime.now(timezone.utc)
            ))
        cur.execute("DELETE FROM app_meta WHERE key='setup_token'")
    return jsonify(ok=True, migrated=len(records)), 201


@app.post("/api/logout")
def logout():
    token = request.cookies.get("hr_session")
    if token:
        with db() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token_hash=%s", (token_hash(token),))
    response = jsonify(ok=True)
    response.delete_cookie("hr_session")
    return response


@app.get("/api/me")
def me():
    return jsonify(actor=actor())


@app.get("/api/hr")
def hr():
    user, error = require_actor()
    if error:
        return error
    return jsonify(empty_hr(user))


@app.route("/api/<path:path>", methods=["GET", "POST", "PATCH", "DELETE"])
def pending_api(path):
    user, error = require_actor()
    if error:
        return error
    return jsonify(error="이 기능은 PostgreSQL 전환 검증 버전에서 아직 이관되지 않았습니다.", endpoint=path), 501


@app.get("/")
def index():
    return send_from_directory(PUBLIC, "index.html")


@app.get("/<path:path>")
def static_files(path):
    target = PUBLIC / path
    if target.is_file():
        return send_from_directory(PUBLIC, path)
    return send_from_directory(PUBLIC, "index.html")


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
else:
    init_db()
