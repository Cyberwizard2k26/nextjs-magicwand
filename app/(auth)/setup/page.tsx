"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, Mail, Rocket, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { AuthHeader, FormError, PasswordInput, PasswordStrength } from "@/components/auth/auth-ui";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/util/cn";

const STEPS = ["Organization", "Administrator"] as const;

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = React.useState({ orgName: "", name: "", email: "", password: "" });
  const [confirm, setConfirm] = React.useState("");
  const [step, setStep] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    apiFetch<{ needsSetup: boolean }>("/api/auth/setup")
      .then((r) => { if (!r.needsSetup) router.replace("/login"); else setReady(true); })
      .catch(() => setReady(true));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 0) { setStep(1); return; }
    if (form.password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/setup", { method: "POST", json: form });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Setup failed");
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-6 h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mismatch = confirm.length > 0 && confirm !== form.password;

  return (
    <>
      <AuthHeader
        icon={<Rocket />}
        title="Set up your console"
        description="Create your organization and the first administrator. You can invite technicians and add clients and sites afterwards."
      />

      <ol className="mb-6 flex items-center gap-2" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors", i < step ? "border-accent bg-accent text-accent-fg" : i === step ? "border-accent text-accent-hover" : "border-border-strong text-fg-subtle")}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("text-xs font-medium", i === step ? "text-fg" : "text-fg-subtle")} aria-current={i === step ? "step" : undefined}>{label}</span>
            {i < STEPS.length - 1 && <span className={cn("h-px flex-1", i < step ? "bg-accent" : "bg-border")} />}
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="space-y-4">
        {step === 0 ? (
          <div key="org" className="space-y-4 animate-in">
            <Field label="Organization name" hint="your company or MSP">
              <Input required value={form.orgName} onChange={set("orgName")} leftIcon={<Building2 />} placeholder="Acme IT Services" autoFocus className="h-10" />
            </Field>
            <Button type="submit" className="w-full" size="lg" disabled={!form.orgName.trim()} rightIcon={<ArrowRight className="h-4 w-4" />}>Continue</Button>
          </div>
        ) : (
          <div key="admin" className="space-y-4 animate-in">
            <Field label="Your name">
              <Input required value={form.name} onChange={set("name")} leftIcon={<User />} placeholder="Jane Doe" autoComplete="name" autoFocus className="h-10" />
            </Field>
            <Field label="Work email">
              <Input type="email" required value={form.email} onChange={set("email")} leftIcon={<Mail />} placeholder="jane@acme.com" autoComplete="email" className="h-10" />
            </Field>
            <Field label="Password">
              <PasswordInput required minLength={12} value={form.password} onChange={set("password")} autoComplete="new-password" />
              <PasswordStrength value={form.password} />
            </Field>
            <Field label="Confirm password" error={mismatch ? "Passwords don't match." : undefined}>
              <PasswordInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch} />
            </Field>
            <FormError>{error}</FormError>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="lg" onClick={() => { setStep(0); setError(null); }} disabled={loading} aria-label="Back" className="px-3.5">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button type="submit" className="flex-1" size="lg" loading={loading} disabled={mismatch || form.password.length < 12}>Create administrator</Button>
            </div>
          </div>
        )}
      </form>
    </>
  );
}
