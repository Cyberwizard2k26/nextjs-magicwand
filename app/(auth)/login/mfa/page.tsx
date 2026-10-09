"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { apiFetch, ApiClientError } from "@/lib/client/api";

export default function MfaPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/mfa", { method: "POST", json: { code } });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="card p-6 md:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Two-factor verification</h1>
      <p className="mt-1 text-sm text-fg-muted">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Code">
          <Input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} className="mono text-center text-lg tracking-[0.4em]" placeholder="000000" />
        </Field>
        {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
        <Button type="submit" className="w-full" size="lg" loading={loading}>Verify</Button>
      </form>
    </div>
  );
}
