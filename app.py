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
MIGRATION_TOKEN_HASH = "e8b243fc96410e7a20cdc63967c7224b93ca9d41bc3040425684c8fcacfdbc23"


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


def camel(name):
    parts = name.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def decode_record(row):
    value = dict(row["payload"])
    for key in list(value):
        if key.endswith("_json") and value[key]:
            try:
                value[camel(key[:-5])] = json.loads(value[key])
            except (TypeError, ValueError):
                pass
    return {camel(key): val for key, val in value.items() if not key.endswith("_json")}


def records_by_type(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT record_type,payload FROM hr_records ORDER BY record_type,id")
        grouped = {}
        for row in cur.fetchall():
            grouped.setdefault(row["record_type"], []).append(decode_record(row))
        return grouped


def empty_hr(user):
    today = date.today().isoformat()
    start = request.args.get("from", today)
    end = request.args.get("to", today)
    with db() as conn:
        rows = records_by_type(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT username,display_name AS \"displayName\",email,department,role,active,must_change_password AS \"mustChangePassword\" FROM users ORDER BY display_name")
            users = cur.fetchall()
    goals = [item.get("data") or item for item in rows.get("requisitions", [])]
    candidates = {item.get("id"): item.get("data") or item for item in rows.get("candidates", [])}
    applications = rows.get("applications", [])
    interviews = rows.get("interviews", [])
    interviews_by_app = {}
    for item in interviews:
        interviews_by_app.setdefault(item.get("applicationId"), []).append(item.get("data") or item)
    pipeline = []
    for row in applications:
        app_data = row.get("data") or row
        candidate = candidates.get(row.get("candidateId"), {})
        pipeline.append({**candidate, **app_data, "candidateId": row.get("candidateId"), "applicationId": row.get("id"), "interviews": interviews_by_app.get(row.get("id"), [])})
    activities = rows.get("recruiting_activities", [])
    checkpoints = rows.get("goal_checkpoints", [])
    snapshots = [item.get("summary") or item for item in rows.get("report_snapshots", [])]
    postings = rows.get("job_postings", [])
    workforce_plans = rows.get("workforce_plans", [])
    meetings = rows.get("hr_meetings", [])
    action_items = rows.get("action_items", [])
    audit = rows.get("activity_logs", [])[-40:][::-1]
    return {
        "actor": user, "access": "registered", "today": today,
        "period": {"from": start, "to": end},
        "report": {"totals": {}, "executive": {}}, "goals": goals,
        "recruitingActivities": activities, "checkpoints": checkpoints, "snapshots": snapshots,
        "recentAudit": audit, "users": users if user.get("role") == "admin" else [],
        "assignees": [{"username": u["username"], "displayName": u["displayName"], "department": u["department"]} for u in users if u["active"]],
        "jobPostings": postings,
        "saramin": {"connected": bool(os.getenv("SARAMIN_ACCESS_KEY"))},
        "candidatePipeline": pipeline, "candidateSummary": {"total": len(pipeline)}, "workforcePlans": workforce_plans,
        "workforce": {}, "meetings": meetings, "actionItems": action_items, "myWork": None,
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


@app.post("/api/logout")
def logout():
    token = request.cookies.get("hr_session")
    if token:
        with db() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token_hash=%s", (token_hash(token),))
    response = jsonify(ok=True)
    response.delete_cookie("hr_session")
    return response


@app.post("/api/internal/migrate-records")
def migrate_records():
    body = request.get_json(silent=True) or {}
    supplied = str(body.get("migrationToken", ""))
    if not secrets.compare_digest(hashlib.sha256(supplied.encode()).hexdigest(), MIGRATION_TOKEN_HASH):
        return jsonify(error="유효하지 않은 이관 토큰입니다."), 403
    records = body.get("records")
    if not isinstance(records, list):
        return jsonify(error="레코드 형식이 올바르지 않습니다."), 400
    with db() as conn, conn.cursor() as cur:
        for item in records:
            record_type = str(item["recordType"])
            record_id = str(item["id"])
            cur.execute("""INSERT INTO hr_records(id,record_type,payload,updated_at)
                           VALUES(%s,%s,%s::jsonb,NOW())
                           ON CONFLICT(id) DO UPDATE SET record_type=excluded.record_type,payload=excluded.payload,updated_at=NOW()""",
                        (f"{record_type}:{record_id}", record_type, json.dumps(item["payload"], ensure_ascii=False)))
    return jsonify(ok=True, migrated=len(records)), 201


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
