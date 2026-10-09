"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Fingerprint, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AuthHeader, Divider, FormError, PasswordInput } from "@/components/auth/auth-ui";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { safeNext } from "@/lib/client/safe-next";
import { startAuthentication } from "@simplewebauthn/browser";

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<"password" | "passkey" | null>(null);
  const [sso, setSso] = React.useState<{ id: string; name: string }[]>([]);

  React.useEffect(() => {
    try { const last = localStorage.getItem("mw.lastEmail"); if (last) setEmail(last); } catch { /* ignore */ }
    apiFetch<{ providers: { id: string; name: string }[] }>("/api/auth/providers").then((r) => setSso(r.providers)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading("password");
    setError(null);
    try {
      const r = await apiFetch<{ mfaRequired: boolean }>("/api/auth/login", { method: "POST", json: { email, password } });
      try { localStorage.setItem("mw.lastEmail", email); } catch { /* ignore */ }
      router.push(r.mfaRequired ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Sign-in failed. Check your connection and try again.");
      setLoading(null);
    }
  }

  async function passkey() {
    setError(null);
    setLoading("passkey");
    try {
      const opts = await apiFetch<Record<string, unknown>>("/api/auth/webauthn/login/options", { method: "POST", json: { email: email || undefined } });
      const cred = await startAuthentication({ optionsJSON: opts as never });
      await apiFetch("/api/auth/webauthn/login/verify", { method: "POST", json: cred });
      router.push(next);
      router.refresh();
    } catch (err) {
      const cancelled = err instanceof Error && err.name === "NotAllowedError";
      if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Passkey sign-in failed");
      setLoading(null);
    }
  }

  return (
    <>
      <AuthHeader title="Welcome back" description="Sign in to your MagicWand console." />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email">
          <Input type="email" autoComplete="username email" required value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail />} placeholder="you@company.com" autoFocus={!email} className="h-10" />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoFocus={!!email} />
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" size="lg" loading={loading === "password"} disabled={!!loading} rightIcon={<ArrowRight className="h-4 w-4" />}>
          Sign in
        </Button>
      </form>

      <Divider>or continue with</Divider>

      <div className="space-y-2.5">
        <Button type="button" variant="secondary" size="lg" className="w-full text-sm" onClick={passkey} loading={loading === "passkey"} disabled={!!loading} leftIcon={<Fingerprint className="h-4 w-4" />}>
          Passkey
        </Button>
        {sso.map((p) => (
          <a key={p.id} href={`/api/auth/sso/${p.id}/start?next=${encodeURIComponent(next)}`} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border-strong text-sm font-medium transition-colors hover:bg-surface-hover focus-ring">
            Continue with {p.name}
          </a>
        ))}
      </div>

      <p className="mt-8 text-center text-xs leading-relaxed text-fg-subtle">
        Forgot your password or lost your authenticator? Ask an organization administrator to reset your access.
      </p>
    </>
  );
}
