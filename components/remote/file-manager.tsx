"use client";
import * as React from "react";
import { toast } from "sonner";
import { ArrowUp, ChevronRight, Download, Eye, File, FileText, Folder, FolderPlus, Hash, HardDrive, Loader2, Pencil, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import { Pill, Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/menu";
import { formatBytes, formatDateTime, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";
import { useDevice } from "@/components/devices/device-context";
import { DeviceOfflineNotice } from "@/components/devices/device-header";
import { useRpc } from "./use-rpc";

interface Entry { name: string; path: string; isDir: boolean; size: number; mode: string; modified: string; symlink?: boolean; hidden?: boolean }
const MAX_TRANSFER = 8 << 20;
const TEXT_EXT = /\.(txt|log|md|json|ya?ml|xml|ini|conf|cfg|toml|csv|sh|ps1|bat|cmd|py|js|ts|html?|css|env|properties|service|plist)$/i;

function splitPath(p: string, win: boolean): { label: string; path: string }[] {
  if (!p) return [];
  const sep = win ? "\\" : "/";
  const parts = p.split(/[\\/]/).filter(Boolean);
  const out: { label: string; path: string }[] = [];
  let acc = win ? "" : "/";
  parts.forEach((part, i) => {
    if (win) acc = i === 0 ? part + "\\" : acc + part + (i < parts.length - 1 ? sep : "");
    else acc = i === 0 ? "/" + part : acc + "/" + part;
    out.push({ label: part, path: acc });
  });
  return out;
}
function parentOf(p: string, win: boolean): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return win ? "" : "/";
  parts.pop();
  return win ? parts.join("\\") + "\\" : "/" + parts.join("/");
}
function join(dir: string, name: string, win: boolean) {
  if (!dir) return name;
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + (win ? "\\" : "/") + name;
}

export function FileManager() {
  const { data, can } = useDevice();
  const d = data.device;
  const win = d.platform === "windows";
  const rpc = useRpc(d.id);
  const [path, setPath] = React.useState<string>(win ? "" : "/");
  const [pathInput, setPathInput] = React.useState(path);
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hidden, setHidden] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [selected, setSelected] = React.useState<Entry | null>(null);
  const [preview, setPreview] = React.useState<{ path: string; text: string; truncated: boolean; size: number } | null>(null);
  const [dialog, setDialog] = React.useState<null | { kind: "mkdir" } | { kind: "rename"; entry: Entry } | { kind: "delete"; entry: Entry } | { kind: "search" }>(null);
  const [name, setName] = React.useState("");
  const [search, setSearch] = React.useState<{ pattern: string; results: Entry[] | null; truncated: boolean }>({ pattern: "", results: null, truncated: false });
  const [uploading, setUploading] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const online = d.status === "online";

  const load = React.useCallback(async (p: string) => {
    setEntries(null); setError(null); setSelected(null); setPreview(null);
    try {
      const r = await rpc.call<{ path: string; entries: Entry[] | null }>("file_list", { path: p });
      setEntries(r.data.entries ?? []);
      setPath(p); setPathInput(p);
    } catch (err) { setError((err as Error).message); setEntries([]); }
  }, [rpc]);

  React.useEffect(() => { if (online) void load(path); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(e: Entry) {
    if (e.isDir) return load(e.path);
    setSelected(e);
    setPreview(null);
    if (e.size <= 256 * 1024 && (TEXT_EXT.test(e.name) || e.size < 4096)) {
      try {
        const r = await rpc.call<{ contentBase64: string; truncated: boolean; size: number }>("file_read", { path: e.path, maxBytes: 256 * 1024 });
        const bytes = Uint8Array.from(atob(r.data.contentBase64), (c) => c.charCodeAt(0));
        const looksBinary = bytes.subarray(0, 1024).some((b) => b === 0);
        if (!looksBinary) setPreview({ path: e.path, text: new TextDecoder().decode(bytes), truncated: r.data.truncated, size: r.data.size });
      } catch { /* preview is best effort */ }
    }
  }

  async function download(e: Entry) {
    if (e.size > MAX_TRANSFER) { toast.error(`Files over ${formatBytes(MAX_TRANSFER, 0)} need a transfer session (coming with the streaming file channel).`); return; }
    try {
      const r = await rpc.call<{ contentBase64: string }>("file_read", { path: e.path, maxBytes: MAX_TRANSFER });
      const bytes = Uint8Array.from(atob(r.data.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement("a"); a.href = url; a.download = e.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) { toast.error((err as Error).message); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length || !path) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_TRANSFER) { toast.error(`${f.name} is larger than ${formatBytes(MAX_TRANSFER, 0)}`); continue; }
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await rpc.call("file_write", { path: join(path, f.name, win), contentBase64: btoa(bin) });
        toast.success(`Uploaded ${f.name}`);
      }
      await load(path);
    } catch (err) { toast.error((err as Error).message); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function hash(e: Entry) {
    try { const r = await rpc.call<{ sha256: string; size: number }>("file_hash", { path: e.path }); toast.success(<span className="mono break-all text-xs">SHA-256 {r.data.sha256}</span>, { duration: 15_000 }); } catch (err) { toast.error((err as Error).message); }
  }

  async function submitDialog() {
    if (!dialog) return;
    try {
      if (dialog.kind === "mkdir") { await rpc.call("file_mkdir", { path: join(path, name.trim(), win) }); toast.success("Folder created"); }
      if (dialog.kind === "rename") { await rpc.call("file_rename", { from: dialog.entry.path, to: join(parentOf(dialog.entry.path, win), name.trim(), win) }); toast.success("Renamed"); }
      if (dialog.kind === "search") {
        const r = await rpc.call<{ entries: Entry[] | null; truncated: boolean }>("file_search", { root: path || (win ? "C:\\" : "/"), pattern: name.trim(), maxResults: 500 });
        setSearch({ pattern: name.trim(), results: r.data.entries ?? [], truncated: r.data.truncated });
        setDialog(null); return;
      }
      setDialog(null); setName("");
      await load(path);
    } catch (err) { toast.error((err as Error).message); }
  }

  if (!can("remote.files")) return <p className="text-sm text-fg-muted">You need the &quot;remote.files&quot; permission to browse files.</p>;
  if (!online) return <DeviceOfflineNotice what="The file browser" />;

  const crumbs = splitPath(path, win);
  const shown = (search.results ?? entries ?? []).filter((e) => (hidden || !e.hidden) && (!filter || e.name.toLowerCase().includes(filter.toLowerCase())));
  const busy = rpc.busy;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          <Tooltip content="Up"><Button variant="ghost" size="icon-sm" onClick={() => load(parentOf(path, win))} disabled={!path || (!win && path === "/")} aria-label="Parent folder"><ArrowUp className="h-4 w-4" /></Button></Tooltip>
          <Tooltip content="Refresh"><Button variant="ghost" size="icon-sm" onClick={() => load(path)} aria-label="Refresh"><RefreshCw className={cn("h-4 w-4", busy === "file_list" && "animate-spin")} /></Button></Tooltip>
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm" aria-label="Path">
            <button type="button" onClick={() => load(win ? "" : "/")} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"><HardDrive className="h-3.5 w-3.5" />{win ? "Drives" : "/"}</button>
            {crumbs.map((c) => <React.Fragment key={c.path}><ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" /><button type="button" onClick={() => load(c.path)} className="truncate rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg last:text-fg">{c.label}</button></React.Fragment>)}
          </nav>
          <form onSubmit={(e) => { e.preventDefault(); void load(pathInput); }} className="hidden md:block"><Input value={pathInput} onChange={(e) => setPathInput(e.target.value)} className="mono h-8 w-64 text-xs" placeholder={win ? "C:\\Users" : "/var/log"} aria-label="Go to path" /></form>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder…" leftIcon={<Search />} className="h-8 w-56 text-xs" />
          <Pill active={hidden} onClick={() => setHidden((h) => !h)}>Hidden files</Pill>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" leftIcon={<Search className="h-3.5 w-3.5" />} onClick={() => { setName(""); setDialog({ kind: "search" }); }}>Search</Button>
          <Button variant="ghost" size="sm" leftIcon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => { setName(""); setDialog({ kind: "mkdir" }); }} disabled={!path}>New folder</Button>
          <Button variant="secondary" size="sm" leftIcon={uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} onClick={() => fileInput.current?.click()} disabled={!path || uploading}>Upload</Button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        </div>
        {search.results && (
          <div className="flex items-center gap-2 border-b border-border bg-accent-soft/30 px-3 py-1.5 text-xs">
            <Search className="h-3.5 w-3.5 text-accent-hover" /> {search.results.length}{search.truncated ? "+" : ""} results for “{search.pattern}” under <span className="mono">{path || "/"}</span>
            <button type="button" className="ml-auto rounded p-0.5 hover:bg-surface-hover" onClick={() => setSearch({ pattern: "", results: null, truncated: false })} aria-label="Close search"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="max-h-[62vh] overflow-auto">
          {error && <div className="px-4 py-3 text-sm text-danger">{error}</div>}
          {entries === null && !error ? <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div> : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2/90 text-left text-xs text-fg-muted backdrop-blur"><tr><th className="h-8 px-3 font-medium">Name</th><th className="h-8 w-24 px-3 text-right font-medium">Size</th><th className="h-8 w-36 px-3 font-medium">Modified</th><th className="h-8 w-28 px-3 font-medium">Mode</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.path} onClick={() => setSelected(e)} onDoubleClick={() => open(e)} className={cn("cursor-default border-t border-border/60 hover:bg-surface-hover/70", selected?.path === e.path && "bg-accent-soft/40")}>
                    <td className="px-3 py-1.5"><button type="button" onClick={(ev) => { ev.stopPropagation(); void open(e); }} className="flex min-w-0 items-center gap-2 text-left focus-ring rounded">{e.isDir ? <Folder className="h-4 w-4 shrink-0 text-accent-hover" /> : TEXT_EXT.test(e.name) ? <FileText className="h-4 w-4 shrink-0 text-fg-subtle" /> : <File className="h-4 w-4 shrink-0 text-fg-subtle" />}<span className={cn("truncate", e.hidden && "text-fg-subtle")}>{search.results ? e.path : e.name}</span></button></td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-fg-muted">{e.isDir ? "" : formatBytes(e.size, 0)}</td>
                    <td className="px-3 py-1.5 text-xs text-fg-muted" title={e.modified ? formatDateTime(e.modified) : ""}>{e.modified ? relativeTime(e.modified) : ""}</td>
                    <td className="mono px-3 py-1.5 text-[11px] text-fg-subtle">{e.mode}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-fg-subtle">{filter ? "Nothing matches the filter." : "Empty folder."}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside className="card flex min-h-[200px] flex-col p-4">
        {!selected ? <div className="m-auto text-center text-sm text-fg-subtle"><Eye className="mx-auto mb-2 h-5 w-5" />Select a file to preview it or act on it.</div> : (
          <>
            <div className="flex items-start gap-2">
              {selected.isDir ? <Folder className="mt-0.5 h-5 w-5 text-accent-hover" /> : <File className="mt-0.5 h-5 w-5 text-fg-subtle" />}
              <div className="min-w-0"><div className="truncate font-medium" title={selected.name}>{selected.name}</div><div className="mono truncate text-[11px] text-fg-subtle" title={selected.path}>{selected.path}</div></div>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {!selected.isDir && <><dt className="text-fg-subtle">Size</dt><dd className="tabular">{formatBytes(selected.size)}</dd></>}
              <dt className="text-fg-subtle">Modified</dt><dd>{selected.modified ? formatDateTime(selected.modified) : "—"}</dd>
              <dt className="text-fg-subtle">Mode</dt><dd className="mono">{selected.mode || "—"}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selected.isDir ? <Button size="sm" variant="secondary" onClick={() => load(selected.path)}>Open</Button> : <Button size="sm" variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => download(selected)}>Download</Button>}
              {!selected.isDir && <Button size="sm" variant="ghost" leftIcon={<Hash className="h-3.5 w-3.5" />} onClick={() => hash(selected)}>SHA-256</Button>}
              <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setName(selected.name); setDialog({ kind: "rename", entry: selected }); }}>Rename</Button>
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDialog({ kind: "delete", entry: selected })}>Delete</Button>
            </div>
            {preview && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <div className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle"><span>Preview{preview.truncated ? " (first 256 KB)" : ""}</span><span className="tabular">{formatBytes(preview.size)}</span></div>
                <pre className="mono max-h-[40vh] flex-1 overflow-auto rounded-lg border border-border bg-surface-2 p-2 text-[11px] leading-relaxed text-fg">{preview.text}</pre>
              </div>
            )}
          </>
        )}
      </aside>

      <Dialog open={dialog?.kind === "mkdir" || dialog?.kind === "rename" || dialog?.kind === "search"} onOpenChange={(o) => !o && setDialog(null)} title={dialog?.kind === "mkdir" ? "New folder" : dialog?.kind === "rename" ? "Rename" : "Search files"} description={dialog?.kind === "search" ? `Searches names under ${path || "/"} (substring or glob)` : undefined} size="sm" footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={submitDialog} disabled={!name.trim()} loading={!!busy && busy !== "file_list"}>{dialog?.kind === "search" ? "Search" : dialog?.kind === "mkdir" ? "Create" : "Rename"}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void submitDialog(); }}>
          <Field label={dialog?.kind === "search" ? "Pattern" : "Name"}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={dialog?.kind === "search" ? "*.log" : "New folder"} className="mono" /></Field>
        </form>
      </Dialog>
      <ConfirmDialog open={dialog?.kind === "delete"} onOpenChange={(o) => !o && setDialog(null)} title={`Delete ${dialog?.kind === "delete" ? dialog.entry.name : ""}?`} description={dialog?.kind === "delete" && dialog.entry.isDir ? "The folder and everything inside it will be removed permanently. This is logged in the audit trail." : "The file will be removed permanently. This is logged in the audit trail."} confirmLabel="Delete" onConfirm={async () => { if (dialog?.kind !== "delete") return; try { await rpc.call("file_delete", { path: dialog.entry.path, recursive: dialog.entry.isDir }); toast.success("Deleted"); await load(path); } catch (err) { toast.error((err as Error).message); throw err; } }} />
    </div>
  );
}
