"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Building2, Mail, KeyRound, User } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = React.useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    apiFetch<{ needsSetup: boolean }>("/api/auth/setup").then((r) => { if (!r.needsSetup) router.replace("/login"); else setDone(false); }).catch(() => setDone(false));
  }, [router]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/setup", { method: "POST", json: form });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }
  if (done === null) return null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="card p-6 md:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Set up your console</h1>
      <p className="mt-1 text-sm text-fg-muted">Create the first organization and the administrator account. You can add clients, sites and technicians afterwards.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Organization name" hint="your company or MSP">
          <Input required value={form.orgName} onChange={set("orgName")} leftIcon={<Building2 />} placeholder="Acme IT Services" autoFocus />
        </Field>
        <Field label="Your name">
          <Input required value={form.name} onChange={set("name")} leftIcon={<User />} placeholder="Jane Doe" />
        </Field>
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={set("email")} leftIcon={<Mail />} placeholder="jane@acme.com" />
        </Field>
        <Field label="Password" hint="12+ characters">
          <Input type="password" required minLength={12} value={form.password} onChange={set("password")} leftIcon={<KeyRound />} />
        </Field>
        {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
        <Button type="submit" className="w-full" size="lg" loading={loading}>Create administrator</Button>
      </form>
    </div>
  );
}
