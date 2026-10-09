# Developing MagicWand RMM

This document is the contract every module follows. Read it before adding code.

## Layout

| Path | Purpose |
| --- | --- |
| `server/` | Custom Node server: Next.js + agent WebSocket gateway (`/agent/ws`) + browser realtime hub (`/ws`). |
| `lib/db/schema/*.ts` | Drizzle (Postgres) schema, one file per domain. `drizzle/` holds generated migrations (applied at boot). |
| `lib/protocol/agent.ts` | Agent <-> server protocol (zod). Mirrored in `agent/internal/protocol/messages.go`. |
| `lib/realtime/` | `agentRegistry` (connected agents, `command()` RPC, binary streams) and `clientHub` (browser sockets, topic fan-out, stream relay). |
| `lib/bus/` | Process-wide event bus (`bus.publish(name, payload, {orgId, deviceId, userId})`, `bus.subscribe("alert.*", h)`), Redis fan-out when `REDIS_URL` is set. |
| `lib/services/` | Domain services (plain async functions over Drizzle). Routes and modules call services; services never import routes. |
| `lib/modules/<name>/index.ts` | Feature module entry: `register(ctx)` wires bus subscriptions and background loops. Registered in `lib/services/registry.ts`. |
| `app/api/v1/**/route.ts` | REST API (App Router handlers wrapped with `api()`). |
| `app/(app)/**` | Authenticated UI pages (server components by default; client components for interactivity). |
| `components/ui/` | Design-system primitives. `components/shell/` the app shell. Feature components live in `components/<feature>/`. |
| `agent/` | Go agent (`cmd/magicwand-agent`), `agent/packaging/` installers. |

## Server conventions

- **Routes** use `api()` from `lib/api/route.ts`:
  ```ts
  export const GET = api({ permission: "devices.view", query: Query }, async ({ orgId, query, principal, audit }) => ({ ... }));
  ```
  It resolves the principal (cookie session or `Authorization: Bearer mw_...` API key), enforces the permission in the active org, validates `query`/`body` with zod (zod v4: use `z.treeifyError`), maps `ApiError` to JSON errors and gives you `audit()` for the audit log. Always scope queries by `orgId`. Add `export const dynamic = "force-dynamic"` to every route file.
- **Device targeting**: use `resolveTargets()` in `lib/services/device-filter.ts` for device/group/site/org/filter targets.
- **Sending commands to agents**: `agentRegistry.command(deviceId, "process_list", args, { timeoutSeconds })` for interactive RPC (throws `DeviceOfflineError` -> 409). For durable/offline-capable work create a job with `createJob()` (`lib/services/jobs.ts`); jobs fan out to `jobRuns`, stream output on the bus (`job.run.output`) and publish `job.run.succeeded|failed`, `job.completed|failed`.
- **Bus events** are dotted, lowercase, past tense: `device.online`, `alert.opened`, `patch.installed`. Always pass `{ orgId, deviceId }` scope so the client hub can authorise fan-out. Topics browsers subscribe to: `org:<id>`, `device:<id>`, `job:<id>`, `session:<id>`, `ticket:<id>`, `user:<id>`.
- **Secrets at rest**: `encryptSecret()/decryptSecret()` from `lib/util/crypto.ts`; never store plaintext credentials. Tokens are hashed with `hashToken()`.
- **Background loops** run only on the leader node: `if (!(await isLeader())) return;` (`lib/boot.ts`). Use `setInterval(...).unref()`.
- **Logging**: `createLogger("scope")`.
- **Email**: `sendMail()` in `lib/services/email.ts` (no-op with a log line when SMTP is unconfigured). **Files**: `lib/services/storage.ts`. **Settings**: `lib/services/settings.ts`. **In-app notifications**: `lib/services/inbox.ts`.
- **Interactive device tools ("Backstage")** go through `POST /api/v1/devices/[id]/rpc` and the allowlist in `lib/services/device-rpc.ts`: every command declares the permission it needs, a zod schema for its arguments and whether it is audited. Add a row there before exposing a new agent command to the UI; never call `agentRegistry.command()` from a route with a free-form `cmd`.
- **Single-device actions** (`POST /api/v1/devices/[id]/actions`) and the console both create jobs (`lib/services/job-create.ts`), so the device timeline, the jobs page and the audit log agree on what ran, who ran it and what it printed. `createJobFromRequest` enforces per-job-type permissions, hydrates script references and implements canary rollouts (first wave now, second wave `awaiting_approval`, auto-promoted by the jobs module when the canary finishes with zero failures).
- **Device access**: use `requireDevice(principal, orgId, id)` and `siteScope()` from `lib/services/device-access.ts` in every `/devices/[id]/*` route and page so site-scoped memberships cannot reach other sites' devices by id.
- Services that are loaded at boot by a module (`lib/modules/*`) must not import `lib/api/route` (it pulls in `next/server` before Next.js is initialised); return `null`/throw plain errors and let the route translate them.
- Frozen files (change only through a foundation change request): schema + migrations, `package.json`, `lib/protocol/agent.ts`, `lib/rbac/permissions.ts`, `lib/services/registry.ts`, `components/shell/nav.ts`, `server/**`, `lib/realtime/**`, `lib/api/route.ts`, `lib/auth/session.ts`, `lib/boot.ts`, `app/globals.css`, `components/ui/**`. Store module-specific extra data in the existing `jsonb` columns (`data`, `facts`, `settings`, `config`, `customFields`, `payload`).

## UI conventions

- Dark-first design. Use tokens (`bg-surface`, `text-fg-muted`, `border-border`, `text-accent-hover`, `bg-accent-soft`, status colours `success|warning|danger|info|critical`) and the primitives in `components/ui` (`Button`, `Input`, `Select`, `Field`, `Switch`, `Badge`, `Card`, `Dialog`, `Sheet`, `ConfirmDialog`, `Menu`, `Tabs`, `Tooltip`, `DataTable`, `PageHeader`, `Stat`, `EmptyState`, `StatusDot`, `Progress`, `Skeleton`, `Code`, `Pill`, `Toolbar`). Icons: `lucide-react`. Toasts: `toast` from `sonner`.
- Data fetching: `useSWR(key)` with the global fetcher (`"devices"` -> `GET /api/v1/devices`, or `["devices", { page: 1 }]`), `usePaginated()` from `lib/client/hooks.ts`, mutations through `api.post/patch/delete` from `lib/client/api.ts`.
- Live updates: `useRealtime("alert.*", handler, ["org:<id>"])` from `components/shell/realtime-provider.tsx`; subscribe to `device:<id>` on device pages.
- Pages are under `app/(app)/...`; server components may call services directly after `await requireUser()` (`lib/auth/server.ts`) and must check permissions with `can(principal, "x.y")`.
- Keep pages responsive (works at 390px), keyboard accessible, with loading skeletons and empty states. Every list has search, filters and bulk actions where it makes sense.
- Charts: `recharts` with the palette in `lib/client/chart-palette.ts` (see dataviz skill guidance): neutral grid, accent series, status colours only for status.
- Ad-hoc commands typed by technicians pass through `assessCommand()` (`lib/client/command-risk.ts`) and show a `RiskNotice`; destructive commands need an explicit second confirmation. Keep the patterns there in sync with anything new the agent can execute.
- The agent announces only capabilities it implements (`agent/internal/protocol/messages.go`); the device header gates remote tools on `device.capabilities`, so adding a feature to the agent means adding its capability string there too.

## Agent conventions (Go)

- Pure Go, `CGO_ENABLED=0` must build for all targets in `agent/build.sh`. cgo-only features go behind build tags with a non-cgo fallback.
- Commands are registered in `cmd/magicwand-agent/agent.go` (`registerCommands`) and implemented in `internal/commands` (one file per area, `//go:build` per OS where needed). A handler receives `*commands.Command` (`Arg()`, `Emit()`, `SetExitCode()`) and returns `(data, error)`.
- Streams (desktop/terminal/file transfer) use binary frames `[u32 streamId][payload]`; the server allocates stream ids in `session_open` args.
- Never block the read loop; long work runs in goroutines; respect `ctx` cancellation.

## Quality gate

`npm run typecheck && npm run lint && npm run test` and `cd agent && go vet ./... && bash build.sh` must pass before a change is done.
