"use client";
import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Copy, History, Play, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PageHeader, Pill, Skeleton } from "@/components/ui/misc";
import { api, ApiClientError } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { JobStatusBadge, JobProgress, type JobStats } from "@/components/jobs/job-bits";
import { LANGUAGES } from "./script-list";

const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), { ssr: false, loading: () => <Skeleton className="h-[420px]" /> });

interface Param { name: string; label?: string; type: "string" | "number" | "boolean" | "select" | "secret" | "device_field"; required?: boolean; default?: string | number | boolean; options?: string[]; description?: string }
interface Script { id: string; orgId: string | null; name: string; description: string | null; language: string; content: string; parameters: Param[]; platforms: string[]; category: string | null; tags: string[]; timeoutSeconds: number; runAs: "system" | "user" | "elevated_user"; successCodes: number[]; outputJson: boolean; risk: "low" | "medium" | "high"; requiresApproval: boolean; version: number; isBuiltin: boolean; isFavorite: boolean; updatedAt: string }

const TEMPLATES: Record<string, string> = {
  powershell: "param(\n  [string]$Target = $env:MW_PARAM_TARGET\n)\n$ErrorActionPreference = 'Stop'\n\n# Parameters arrive as -Name arguments and as MW_PARAM_<NAME> environment variables.\nWrite-Output \"Running on $env:COMPUTERNAME\"\n",
  bash: "#!/usr/bin/env bash\nset -euo pipefail\n\n# Parameters arrive as positional arguments and as MW_PARAM_<NAME> environment variables.\necho \"Running on $(hostname)\"\n",
  sh: "#!/bin/sh\nset -eu\necho \"Running on $(hostname)\"\n",
  zsh: "#!/usr/bin/env zsh\nset -euo pipefail\necho \"Running on $(hostname)\"\n",
  python: "#!/usr/bin/env python3\nimport os, platform\n\n# Parameters arrive as MW_PARAM_<NAME> environment variables.\nprint(f\"Running on {platform.node()}\")\n",
  cmd: "@echo off\necho Running on %COMPUTERNAME%\n",
  node: "// Parameters arrive as MW_PARAM_<NAME> environment variables.\nconsole.log(`Running on ${require('os').hostname()}`);\n",
  applescript: "display notification \"Hello from MagicWand\" with title \"IT\"\n",
};
const EMPTY: Script = { id: "", orgId: "", name: "", description: "", language: "powershell", content: TEMPLATES.powershell, parameters: [], platforms: [], category: "", tags: [], timeoutSeconds: 300, runAs: "system", successCodes: [0], outputJson: false, risk: "low", requiresApproval: false, version: 1, isBuiltin: false, isFavorite: false, updatedAt: "" };

export function ScriptEditor({ id, permissions }: { id: string | null; permissions: string[] }) {
  const router = useRouter();
  const can = (p: string) => permissions.includes("*") || permissions.includes(p) || permissions.includes(p.split(".")[0] + ".*");
  const { data, isLoading, mutate } = useSWR<{ script: Script; versions: { id: string; version: number; changelog: string | null; createdAt: string }[]; recentRuns: { jobId: string; name: string; status: string; stats: JobStats; createdAt: string; createdByName: string | null }[] }>(id ? `scripts/${id}` : null);
  const [form, setForm] = React.useState<Script>(EMPTY);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [changelog, setChangelog] = React.useState("");
  React.useEffect(() => { if (data?.script) { setForm(data.script); setDirty(false); } }, [data]);
  const readOnly = !can("scripts.manage") || (!!form.id && form.isBuiltin);
  const set = <K extends keyof Script>(k: K, v: Script[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  async function save() {
    if (!form.name.trim()) { toast.error("Give the script a name"); return; }
    setBusy(true);
    try {
      const body = { name: form.name, description: form.description || null, language: form.language, content: form.content, parameters: form.parameters, platforms: form.platforms, category: form.category || null, tags: form.tags, timeoutSeconds: form.timeoutSeconds, runAs: form.runAs, successCodes: form.successCodes, outputJson: form.outputJson, risk: form.risk, requiresApproval: form.requiresApproval, isFavorite: form.isFavorite };
      if (form.id) { await api.patch(`scripts/${form.id}`, { ...body, changelog: changelog || undefined }); toast.success("Saved"); setChangelog(""); mutate(); }
      else { const r = await api.post<{ script: Script }>("scripts", body); toast.success("Script created"); router.replace(`/scripts/${r.script.id}`); }
      setDirty(false);
    } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Save failed"); } finally { setBusy(false); }
  }
  async function duplicate() {
    try { const r = await api.post<{ script: Script }>("scripts", { ...form, name: `${form.name} (copy)`, id: undefined, isBuiltin: undefined, isFavorite: false }); toast.success("Copied to your library"); router.push(`/scripts/${r.script.id}`); } catch (err) { toast.error(err instanceof ApiClientError ? err.message : "Copy failed"); }
  }
  const addParam = () => set("parameters", [...form.parameters, { name: `param${form.parameters.length + 1}`, label: "", type: "string", required: false }]);
  const updParam = (i: number, patch: Partial<Param>) => set("parameters", form.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  if (id && (isLoading || !data)) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-[480px]" /></div>;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Scripts", href: "/scripts" }, { label: form.id ? form.name : "New script" }]}
        title={form.id ? form.name : "New script"}
        badge={form.id && <span className="flex items-center gap-1.5"><Badge tone="outline" size="xs">v{form.version}</Badge>{form.isBuiltin && <Badge tone="info" size="xs">built-in · read-only</Badge>}{dirty && <Badge tone="warning" size="xs">unsaved</Badge>}</span>}
        description={form.id ? `Updated ${relativeTime(form.updatedAt)}` : "Parameters become form fields; every run is a tracked job."}
        actions={<>
          {form.id && can("scripts.run") && <Button variant="secondary" leftIcon={<Play className="h-4 w-4" />} onClick={() => router.push(`/jobs/new?script=${form.id}`)}>Run…</Button>}
          {form.id && can("scripts.manage") && <Button variant="ghost" leftIcon={<Copy className="h-4 w-4" />} onClick={duplicate}>Duplicate</Button>}
          {form.id && !readOnly && <Button variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete</Button>}
          {!readOnly && <Button leftIcon={<Save className="h-4 w-4" />} onClick={save} loading={busy} disabled={!dirty && !!form.id}>{form.id ? "Save" : "Create script"}</Button>}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <Select value={form.language} onChange={(e) => { const lang = e.target.value; set("language", lang); if (!form.id && (form.content === TEMPLATES[form.language] || !form.content.trim())) set("content", TEMPLATES[lang] ?? ""); }} className="h-8 w-auto text-xs" disabled={readOnly} aria-label="Language">{LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</Select>
              <span className="text-xs text-fg-subtle">{form.content.split("\n").length} lines</span>
              <span className="ml-auto text-[11px] text-fg-subtle">Params: <span className="mono">MW_PARAM_NAME</span> env + {form.language === "powershell" ? "-Name args" : "positional args"}</span>
            </div>
            <CodeEditor value={form.content} language={form.language} readOnly={readOnly} onChange={(v) => set("content", v)} />
          </Card>
          <Card>
            <CardHeader title="Parameters" description="Collected when the script is run; secrets are never stored in job history." actions={!readOnly && <Button size="xs" variant="secondary" leftIcon={<Plus className="h-3 w-3" />} onClick={addParam}>Add</Button>} />
            <CardBody>
              {form.parameters.length === 0 ? <p className="text-sm text-fg-muted">No parameters.</p> : (
                <ul className="space-y-2">
                  {form.parameters.map((p, i) => (
                    <li key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_120px_1fr_auto]">
                      <Input value={p.name} onChange={(e) => updParam(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} placeholder="name" className="mono h-8 text-xs" disabled={readOnly} aria-label="Parameter name" />
                      <Input value={p.label ?? ""} onChange={(e) => updParam(i, { label: e.target.value })} placeholder="Label" className="h-8 text-xs" disabled={readOnly} aria-label="Label" />
                      <Select value={p.type} onChange={(e) => updParam(i, { type: e.target.value as Param["type"] })} className="h-8 text-xs" disabled={readOnly} aria-label="Type">{["string", "number", "boolean", "select", "secret"].map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                      {p.type === "select" ? <Input value={(p.options ?? []).join(", ")} onChange={(e) => updParam(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="option a, option b" className="h-8 text-xs" disabled={readOnly} aria-label="Options" /> : <Input value={String(p.default ?? "")} onChange={(e) => updParam(i, { default: p.type === "number" ? Number(e.target.value) : p.type === "boolean" ? e.target.value === "true" : e.target.value })} placeholder="default" className="h-8 text-xs" disabled={readOnly} aria-label="Default" />}
                      <div className="flex items-center gap-2"><Switch checked={!!p.required} onCheckedChange={(v) => updParam(i, { required: v })} label="req." disabled={readOnly} />{!readOnly && <button type="button" onClick={() => set("parameters", form.parameters.filter((_, j) => j !== i))} className="rounded p-1 text-fg-subtle hover:text-danger" aria-label="Remove"><X className="h-4 w-4" /></button>}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-3">
              <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Restart print spooler" disabled={readOnly} /></Field>
              <Field label="Description"><Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} className="min-h-[64px]" disabled={readOnly} placeholder="What it does, when to use it, what it changes." /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category"><Input value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} placeholder="Maintenance" disabled={readOnly} /></Field>
                <Field label="Tags" hint="comma"><Input value={form.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} disabled={readOnly} /></Field>
              </div>
              <Field label="Platforms" hint="none = any"><div className="flex flex-wrap gap-1">{["windows", "linux", "macos", "freebsd"].map((p) => <Pill key={p} active={form.platforms.includes(p)} onClick={() => !readOnly && set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p])} className="capitalize">{p}</Pill>)}</div></Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Execution" />
            <CardBody className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Run as"><Select value={form.runAs} onChange={(e) => set("runAs", e.target.value as Script["runAs"])} disabled={readOnly}><option value="system">SYSTEM / root</option><option value="user">Logged-in user</option><option value="elevated_user">Elevated user</option></Select></Field>
                <Field label="Timeout (s)"><Input type="number" min={10} value={form.timeoutSeconds} onChange={(e) => set("timeoutSeconds", Number(e.target.value))} disabled={readOnly} /></Field>
                <Field label="Success exit codes" hint="comma"><Input value={form.successCodes.join(", ")} onChange={(e) => set("successCodes", e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)))} disabled={readOnly} /></Field>
                <Field label="Risk"><Select value={form.risk} onChange={(e) => set("risk", e.target.value as Script["risk"])} disabled={readOnly}><option value="low">Low - read-only / reversible</option><option value="medium">Medium - changes state</option><option value="high">High - destructive</option></Select></Field>
              </div>
              <Switch checked={form.requiresApproval} onCheckedChange={(v) => set("requiresApproval", v)} label="Jobs using this script need approval" disabled={readOnly} />
              <Switch checked={form.outputJson} onCheckedChange={(v) => set("outputJson", v)} label="Parse last JSON object in stdout as structured output" disabled={readOnly} />
              <Switch checked={form.isFavorite} onCheckedChange={(v) => set("isFavorite", v)} label="Favorite (pinned to the top)" disabled={readOnly} />
              {form.id && !readOnly && dirty && <Field label="Change note" hint="saved with the new version"><Input value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="Handle missing module" /></Field>}
            </CardBody>
          </Card>
          {data && (
            <>
              <Card>
                <CardHeader title="Recent runs" actions={<History className="h-4 w-4 text-fg-subtle" />} />
                <CardBody className="px-0 pb-2">{!data.recentRuns.length ? <p className="px-5 pb-3 text-sm text-fg-muted">Never run.</p> : <ul className="divide-y divide-border/70">{data.recentRuns.map((r) => <li key={r.jobId}><Link href={`/jobs/${r.jobId}`} className="block px-5 py-2 hover:bg-surface-hover/60"><div className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{r.name}</span><JobStatusBadge status={r.status} /></div><div className="mt-1 flex items-center gap-2 text-xs text-fg-subtle"><JobProgress stats={r.stats} className="flex-1" /><span>{relativeTime(r.createdAt)}</span></div></Link></li>)}</ul>}</CardBody>
              </Card>
              <Card>
                <CardHeader title="Versions" />
                <CardBody className="px-0 pb-2"><ul className="divide-y divide-border/70 text-sm">{data.versions.map((v) => <li key={v.id} className="flex items-center gap-2 px-5 py-2"><Badge tone={v.version === form.version ? "accent" : "outline"} size="xs">v{v.version}</Badge><span className="min-w-0 flex-1 truncate text-fg-muted">{v.changelog || "—"}</span><span className="text-xs text-fg-subtle" title={formatDateTime(v.createdAt)}>{relativeTime(v.createdAt)}</span></li>)}</ul></CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete "${form.name}"?`} description="Past job runs keep their copy of the content; schedules and automations referencing it will fail." confirmLabel="Delete" onConfirm={async () => { await api.delete(`scripts/${form.id}`); toast.success("Script deleted"); router.push("/scripts"); }} />
    </>
  );
}
