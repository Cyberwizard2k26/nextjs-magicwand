"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LifeBuoy, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AuthHeader, FormError, OtpInput } from "@/components/auth/auth-ui";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { safeNext } from "@/lib/client/safe-next";

export default function MfaPage() {
  return (
    <React.Suspense>
      <MfaForm />
    </React.Suspense>
  );
}

function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = React.useState<"totp" | "recovery">("totp");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function verify(value: string) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/mfa", { method: "POST", json: { code: value.trim() } });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Verification failed");
      if (mode === "totp") setCode("");
      setLoading(false);
    }
  }

  // The half-authenticated session must be dropped first, otherwise /login bounces straight back here.
  async function backToLogin() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const switchMode = () => {
    setMode((m) => (m === "totp" ? "recovery" : "totp"));
    setCode("");
    setError(null);
  };

  return (
    <>
      <AuthHeader
        icon={<ShieldCheck />}
        title="Two-factor verification"
        description={mode === "totp" ? "Enter the 6-digit code from your authenticator app." : "Enter one of the recovery codes you saved when you enabled two-factor authentication."}
      />
      <form onSubmit={(e) => { e.preventDefault(); verify(code); }} className="space-y-5">
        {mode === "totp" ? (
          <OtpInput value={code} onChange={(v) => { setCode(v); if (error) setError(null); }} onComplete={verify} disabled={loading} invalid={!!error} />
        ) : (
          <Field label="Recovery code">
            <Input autoFocus required autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className="mono h-10 tracking-widest" placeholder="xxxxx-xxxxx" />
          </Field>
        )}
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" size="lg" loading={loading} disabled={mode === "totp" ? code.length < 6 : !code.trim()}>
          Verify and continue
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-3 text-sm">
        <button type="button" onClick={switchMode} className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-fg focus-ring rounded-md px-1">
          {mode === "totp" ? <><LifeBuoy className="h-4 w-4" /> Use a recovery code instead</> : <><Smartphone className="h-4 w-4" /> Use your authenticator app</>}
        </button>
        <button type="button" onClick={backToLogin} className="inline-flex items-center gap-1.5 rounded-md px-1 text-xs text-fg-subtle transition-colors hover:text-fg focus-ring">
          <ArrowLeft className="h-3.5 w-3.5" /> Sign in as someone else
        </button>
      </div>
    </>
  );
}
