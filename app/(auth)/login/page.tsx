"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fingerprint, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import Link from "next/link";
import { startAuthentication } from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sso, setSso] = React.useState<{ id: string; name: string }[]>([]);

  React.useEffect(() => {
    apiFetch<{ providers: { id: string; name: string }[] }>("/api/auth/providers").then((r) => setSso(r.providers)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<{ mfaRequired: boolean }>("/api/auth/login", { method: "POST", json: { email, password } });
      router.push(r.mfaRequired ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function passkey() {
    setError(null);
    try {
      const opts = await apiFetch<Record<string, unknown>>("/api/auth/webauthn/login/options", { method: "POST", json: { email: email || undefined } });
      const cred = await startAuthentication({ optionsJSON: opts as never });
      await apiFetch("/api/auth/webauthn/login/verify", { method: "POST", json: cred });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Passkey sign-in failed");
    }
  }

  return (
    <div className="card p-6 md:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-fg-muted">Sign in to your console.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail />} placeholder="you@company.com" autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} leftIcon={<KeyRound />} placeholder="••••••••" />
        </Field>
        {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
        <Button type="submit" className="w-full" size="lg" loading={loading}>Sign in</Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-fg-subtle"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
      <div className="space-y-2">
        <Button type="button" variant="secondary" className="w-full" onClick={passkey} leftIcon={<Fingerprint className="h-4 w-4" />}>Sign in with a passkey</Button>
        {sso.map((p) => (
          <a key={p.id} href={`/api/auth/sso/${p.id}/start?next=${encodeURIComponent(next)}`} className="flex h-9 w-full items-center justify-center rounded-lg border border-border-strong text-sm hover:bg-surface-hover">Continue with {p.name}</a>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-fg-subtle">
        <Link href="/reset" className="hover:text-fg">Forgot your password?</Link>
      </p>
    </div>
  );
}
