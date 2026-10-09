import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Bell, CheckCircle2, Download, HeartPulse, Monitor, Play, PowerOff, RotateCw, Ticket, UserCheck, Users, WifiOff } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/session";
import { getDashboardOverview, type DashboardOverview } from "@/lib/services/dashboard";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, severityTone } from "@/components/ui/badge";
import { EmptyState, StatusDot } from "@/components/ui/misc";
import { BarList, LiveRefresh, ScoreRing, SectionLink, StatusMeter } from "@/components/dashboard/widgets";
import { platformLabel, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/util/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const p = await requireUser("/");
  const orgId = p.activeOrgId;
  const firstName = (p.user.name || "").split(" ")[0];

  if (!orgId) {
    return (
      <>
        <Greeting name={firstName} />
        <EmptyState icon={<Users />} title="You're not a member of any organization yet" description="Ask an administrator to invite you to an organization to start managing devices." />
      </>
    );
  }

  const perms = {
    devices: can(p, "devices.view"),
    alerts: can(p, "alerts.view"),
    tickets: can(p, "tickets.view"),
    enroll: can(p, "devices.enroll"),
    approve: can(p, "devices.approve"),
    scripts: can(p, "scripts.run"),
  };
  const siteIds = p.memberships.find((m) => m.orgId === orgId)?.siteIds ?? undefined;
  const data = await getDashboardOverview(orgId, { devices: perms.devices, alerts: perms.alerts, tickets: perms.tickets, siteIds: siteIds?.length ? siteIds : undefined });
  const dv = data.devices;
  const online = dv.byStatus.online ?? 0;

  return (
    <>
      <LiveRefresh />
      <Greeting
        name={firstName}
        actions={
          <>
            {perms.scripts && dv.total > 0 && (
              <Link href="/jobs/new" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-3 px-3.5 text-sm font-medium transition-colors hover:bg-surface-hover focus-ring">
                <Play className="h-4 w-4" /> Run script
              </Link>
            )}
            {perms.enroll && (
              <Link href="/deploy" className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg shadow-[0_0_0_1px_var(--accent-strong),0_8px_24px_-10px_var(--accent-glow)] transition-colors hover:bg-accent-hover focus-ring">
                <Download className="h-4 w-4" /> Deploy agent
              </Link>
            )}
          </>
        }
      />

      {perms.devices && dv.total === 0 ? (
        <Onboarding canEnroll={perms.enroll} />
      ) : (
        <div className="space-y-6">
          {/* KPI row */}
          <section className="stagger-in grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4 [&>*]:min-w-0" aria-label="Key metrics">
            {perms.devices && <Kpi href="/devices" icon={<Monitor />} label="Devices online" value={online.toLocaleString()} suffix={`/ ${dv.total.toLocaleString()}`} hint={dv.total ? `${Math.round((online / dv.total) * 100)}% of fleet reachable` : "No devices"} />}
            {data.alerts ? (
              <Kpi
                href="/alerts"
                icon={<Bell />}
                tone={(data.alerts.bySeverity.critical ?? 0) > 0 ? "danger" : data.alerts.open > 0 ? "warning" : "success"}
                label="Open alerts"
                value={data.alerts.open.toLocaleString()}
                hint={(data.alerts.bySeverity.critical ?? 0) > 0 ? `${data.alerts.bySeverity.critical} critical` : data.alerts.open ? "None critical" : "All clear"}
              />
            ) : perms.devices && (
              <Kpi href="/devices?status=offline" icon={<WifiOff />} label="Offline" value={(dv.byStatus.offline ?? 0).toLocaleString()} hint="devices unreachable" />
            )}
            {perms.devices && <Kpi href="/devices?sort=healthScore" icon={<HeartPulse />} label="Fleet health" value={dv.avgHealth === null ? "—" : String(dv.avgHealth)} suffix={dv.avgHealth === null ? undefined : "/ 100"} hint="average device score" ring={dv.avgHealth} />}
            {data.tickets ? (
              <Kpi href="/tickets" icon={<Ticket />} label="Open tickets" value={data.tickets.open.toLocaleString()} hint="new or in progress" />
            ) : perms.devices && (
              <Kpi href="/devices" icon={<RotateCw />} label="Pending reboot" value={dv.pendingReboot.toLocaleString()} hint="devices awaiting restart" />
            )}
          </section>

          {perms.devices && <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card className="lg:col-span-2">
              <CardHeader title="Fleet status" description={`${dv.total.toLocaleString()} managed devices`} actions={<SectionLink href="/devices">All devices</SectionLink>} />
              <CardBody className="space-y-6">
                <StatusMeter
                  total={dv.total}
                  segments={[
                    { key: "online", label: "Online", value: dv.byStatus.online ?? 0, color: "var(--success)", href: "/devices?status=online" },
                    { key: "offline", label: "Offline", value: dv.byStatus.offline ?? 0, color: "var(--danger)", href: "/devices?status=offline" },
                    { key: "maintenance", label: "Maintenance", value: dv.byStatus.maintenance ?? 0, color: "var(--info)", href: "/devices?status=maintenance" },
                    { key: "pending", label: "Pending", value: dv.byStatus.pending ?? 0, color: "var(--warning)", href: "/devices?status=pending" },
                  ]}
                />
                {dv.byPlatform.length > 0 && (
                  <div>
                    <div className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">By platform</div>
                    <BarList items={dv.byPlatform.slice(0, 6).map((r) => ({ key: r.platform, label: platformLabel[r.platform] ?? r.platform, value: r.count, href: `/devices?platform=${r.platform}` }))} />
                  </div>
                )}
              </CardBody>
            </Card>

            <AttentionCard data={data} canApprove={perms.approve} />
          </div>}

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            {data.alerts && <RecentAlerts alerts={data.alerts} className={perms.devices ? "lg:col-span-2" : "lg:col-span-3"} />}
            {perms.devices && <DeviceWatchlist dv={dv} className={data.alerts ? undefined : "lg:col-span-3"} />}
          </div>
        </div>
      )}
    </>
  );
}

function Greeting({ name, actions }: { name: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{name ? <>Welcome back, <span className="text-gradient">{name}</span></> : "Dashboard"}</h1>
        <p className="mt-1 text-sm text-fg-muted">Here&apos;s what&apos;s happening across your fleet right now.</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const kpiTone = { accent: "text-accent-hover bg-accent-soft", success: "text-success bg-success-soft", warning: "text-warning bg-warning-soft", danger: "text-danger bg-danger-soft" } as const;

function Kpi({ href, icon, label, value, suffix, hint, tone = "accent", ring }: { href: string; icon: React.ReactNode; label: string; value: string; suffix?: string; hint?: string; tone?: keyof typeof kpiTone; ring?: number | null }) {
  return (
    <Link href={href} className="card card-hover group relative flex flex-col gap-3 p-4 focus-ring md:p-5">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", kpiTone[tone])}>{icon}</span>
        {ring !== undefined ? <ScoreRing value={ring} size={32} /> : <ArrowUpRight className="h-4 w-4 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div>
        <div className="text-xs font-medium text-fg-muted">{label}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular tracking-tight text-fg md:text-3xl">{value}</span>
          {suffix && <span className="text-sm tabular text-fg-subtle">{suffix}</span>}
        </div>
        {hint && <div className="mt-1 truncate text-xs text-fg-subtle">{hint}</div>}
      </div>
    </Link>
  );
}

function AttentionCard({ data, canApprove }: { data: DashboardOverview; canApprove: boolean }) {
  const dv = data.devices;
  const items = [
    data.alerts && (data.alerts.bySeverity.critical ?? 0) > 0 && { icon: <AlertTriangle />, tone: "danger" as const, label: "Critical alerts open", count: data.alerts.bySeverity.critical!, href: "/alerts?severity=critical" },
    data.alerts && (data.alerts.bySeverity.high ?? 0) > 0 && { icon: <Bell />, tone: "danger" as const, label: "High-severity alerts", count: data.alerts.bySeverity.high!, href: "/alerts?severity=high" },
    canApprove && (dv.byStatus.pending ?? 0) > 0 && { icon: <UserCheck />, tone: "warning" as const, label: "Devices awaiting approval", count: dv.byStatus.pending!, href: "/devices?status=pending" },
    (dv.byStatus.offline ?? 0) > 0 && { icon: <PowerOff />, tone: "warning" as const, label: "Devices offline", count: dv.byStatus.offline!, href: "/devices?status=offline" },
    dv.pendingReboot > 0 && { icon: <RotateCw />, tone: "info" as const, label: "Pending reboot", count: dv.pendingReboot, href: "/devices" },
    dv.unhealthy.length > 0 && { icon: <HeartPulse />, tone: "warning" as const, label: "Low health score", count: dv.unhealthy.length, href: "/devices?sort=healthScore" },
  ].filter(Boolean) as { icon: React.ReactNode; tone: "danger" | "warning" | "info"; label: string; count: number; href: string }[];
  const toneCls = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", info: "bg-info-soft text-info" };
  return (
    <Card>
      <CardHeader title="Needs attention" description={items.length ? `${items.length} item${items.length === 1 ? "" : "s"} to review` : undefined} />
      <CardBody>
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-success-soft text-success"><CheckCircle2 className="h-5 w-5" /></span>
            <div className="text-sm font-medium">Everything looks good</div>
            <div className="mt-0.5 text-xs text-fg-subtle">No critical alerts, offline devices or pending approvals.</div>
          </div>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {items.map((i) => (
              <li key={i.label}>
                <Link href={i.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover focus-ring">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", toneCls[i.tone])}>{i.icon}</span>
                  <span className="flex-1 truncate text-sm text-fg-muted group-hover:text-fg">{i.label}</span>
                  <span className="tabular text-sm font-semibold text-fg">{i.count.toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RecentAlerts({ alerts, className }: { alerts: NonNullable<DashboardOverview["alerts"]>; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title="Open alerts" description="Most severe first" actions={<SectionLink href="/alerts">View all</SectionLink>} />
      <CardBody className="px-0 pb-2">
        {alerts.recent.length === 0 ? (
          <div className="mx-5 mb-3 flex items-center gap-3 rounded-lg border border-dashed border-border-strong/70 px-4 py-6 text-sm text-fg-muted">
            <CheckCircle2 className="h-5 w-5 text-success" /> No open alerts. Nice work.
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {alerts.recent.map((a) => (
              <li key={a.id}>
                <Link href={`/alerts/${a.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover/60 focus-ring">
                  <Badge tone={severityTone(a.severity)} size="xs" className="w-[62px] justify-center capitalize">{a.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{a.title}</div>
                    <div className="mt-0.5 truncate text-xs text-fg-subtle">
                      {a.deviceName ?? "Organization-wide"}
                      {a.occurrences > 1 && <> · {a.occurrences}× occurrences</>}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-fg-subtle">{relativeTime(a.openedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function DeviceWatchlist({ dv, className }: { dv: DashboardOverview["devices"]; className?: string }) {
  const rows = [
    ...dv.unhealthy.map((d) => ({ id: d.id, name: d.name, platform: d.platform, status: d.status, meta: <span className={cn("tabular font-medium", (d.healthScore ?? 0) < 50 ? "text-danger" : "text-warning")}>{d.healthScore}</span>, sub: "Health score" })),
    ...dv.recentlyOffline.filter((o) => !dv.unhealthy.some((u) => u.id === o.id)).map((d) => ({ id: d.id, name: d.name, platform: d.platform, status: "offline", meta: <span className="text-xs text-fg-subtle">{relativeTime(d.lastSeenAt)}</span>, sub: "Last seen" })),
  ].slice(0, 6);
  return (
    <Card className={className}>
      <CardHeader title="Device watchlist" description="Unhealthy or recently offline" actions={<SectionLink href="/devices">Devices</SectionLink>} />
      <CardBody className="px-0 pb-2">
        {rows.length === 0 ? (
          <div className="mx-5 mb-3 flex items-center gap-3 rounded-lg border border-dashed border-border-strong/70 px-4 py-6 text-sm text-fg-muted">
            <CheckCircle2 className="h-5 w-5 text-success" /> All devices healthy and online.
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((d) => (
              <li key={d.id}>
                <Link href={`/devices/${d.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover/60 focus-ring">
                  <StatusDot status={d.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{d.name}</div>
                    <div className="text-xs text-fg-subtle">{platformLabel[d.platform] ?? d.platform} · {d.sub}</div>
                  </div>
                  {d.meta}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Onboarding({ canEnroll }: { canEnroll: boolean }) {
  const steps = [
    { icon: <Download />, title: "Deploy your first agent", body: "Create an enrollment token and run the installer on a Windows, macOS or Linux machine.", href: "/deploy", cta: "Get installer", enabled: canEnroll },
    { icon: <Users />, title: "Invite your team", body: "Add technicians and assign roles scoped to clients and sites.", href: "/settings/users", cta: "Invite users", enabled: true },
    { icon: <Bell />, title: "Tune alerting", body: "Pick monitoring policies and where notifications should go.", href: "/policies", cta: "Configure", enabled: true },
  ];
  return (
    <section className="card relative overflow-hidden p-6 md:p-10">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-[90px]" />
      <div className="relative max-w-2xl">
        <Badge tone="accent" size="xs">Getting started</Badge>
        <h2 className="mt-3 text-xl font-semibold tracking-tight md:text-2xl">Let&apos;s bring your first devices online</h2>
        <p className="mt-1.5 text-sm text-fg-muted">Your console is ready. Once an agent checks in, this dashboard fills with live health, alerts and inventory.</p>
      </div>
      <ol className="stagger-in relative mt-8 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-xl border border-border bg-surface-2/60 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-hover [&>svg]:h-4 [&>svg]:w-4">{s.icon}</span>
              <span className="text-xs font-medium text-fg-subtle">Step {i + 1}</span>
            </div>
            <div className="mt-3 text-sm font-semibold">{s.title}</div>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-fg-muted">{s.body}</p>
            {s.enabled && <div className="mt-4"><SectionLink href={s.href}>{s.cta}</SectionLink></div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
