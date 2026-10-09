/**
 * Permission model. Permissions are "resource.action" strings. Roles hold lists of permissions; "*" grants all,
 * "devices.*" grants every action on devices. Memberships may additionally be scoped to sites / groups.
 */
export const PERMISSIONS = {
  // Organization & admin
  "org.view": "View organization settings",
  "org.manage": "Edit organization settings, branding and billing",
  "org.delete": "Delete organization",
  "sites.manage": "Create and edit sites",
  "users.view": "View users and roles",
  "users.manage": "Invite, edit and remove users; manage roles",
  "audit.view": "View the audit log",
  "apikeys.manage": "Create and revoke API keys",
  "integrations.manage": "Configure integrations and webhooks",
  "sso.manage": "Configure single sign-on",
  // Devices
  "devices.view": "View devices and inventory",
  "devices.manage": "Edit device details, tags, groups, custom fields; decommission",
  "devices.enroll": "Create enrollment tokens and download installers",
  "devices.approve": "Approve pending devices",
  "devices.power": "Reboot, shutdown, wake and sleep devices",
  "devices.delete": "Delete devices",
  "groups.manage": "Create and edit device groups",
  // Remote access
  "remote.desktop": "Start remote desktop sessions",
  "remote.desktop_control": "Control (not just view) remote desktops",
  "remote.terminal": "Open remote terminals / shells",
  "remote.files": "Browse and transfer files",
  "remote.tools": "Use background tools (processes, services, registry, event logs)",
  "remote.tunnel": "Open TCP tunnels (RDP/SSH/VNC)",
  "remote.share": "Create guest share links",
  "remote.recordings": "View session recordings",
  "remote.bypass_consent": "Connect without end-user consent (where policy allows)",
  "remote.jit_approve": "Approve just-in-time access requests",
  // Automation
  "scripts.view": "View the script library",
  "scripts.manage": "Create and edit scripts",
  "scripts.run": "Run scripts and commands on devices",
  "scripts.run_high_risk": "Run scripts classified as high risk",
  "jobs.view": "View jobs and runs",
  "jobs.manage": "Create, cancel and approve jobs",
  "schedules.manage": "Manage schedules",
  "automations.manage": "Create and edit automations",
  "policies.manage": "Create, edit and assign policies",
  // Monitoring
  "monitors.view": "View monitors",
  "monitors.manage": "Create and edit monitors and notification channels",
  "alerts.view": "View alerts",
  "alerts.manage": "Acknowledge, resolve and snooze alerts",
  "maintenance.manage": "Manage maintenance windows",
  // Patching & software
  "patches.view": "View patch status",
  "patches.manage": "Approve, reject and deploy patches",
  "software.view": "View software inventory",
  "software.manage": "Deploy and uninstall software; manage the catalog",
  "vulnerabilities.view": "View vulnerabilities",
  // Security
  "security.view": "View security posture",
  "security.manage": "Run security scans, rotate local admin passwords",
  "vault.view": "View vault entries (metadata)",
  "vault.reveal": "Reveal vault secrets",
  "vault.manage": "Create and edit vault secrets",
  // Service desk & docs
  "tickets.view": "View tickets",
  "tickets.manage": "Create, assign and resolve tickets",
  "contacts.manage": "Manage contacts / end users",
  "docs.view": "View documentation",
  "docs.manage": "Edit documentation",
  // Reporting & network
  "reports.view": "View reports and dashboards",
  "reports.manage": "Create and schedule reports",
  "network.view": "View discovered devices",
  "network.manage": "Run discovery scans and manage SNMP devices",
  // AI
  "ai.use": "Use the AI copilot",
  // Platform (super admin only)
  "platform.manage": "Manage the platform: all orgs, server settings, agent releases",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Built-in roles created in every organization. */
export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: string[] }[] = [
  { key: "owner", name: "Owner", description: "Full access to the organization", permissions: ["*"] },
  {
    key: "admin",
    name: "Administrator",
    description: "Everything except deleting the organization",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "org.delete" && p !== "platform.manage"),
  },
  {
    key: "technician",
    name: "Technician",
    description: "Day-to-day device management and remote support",
    permissions: [
      "org.view", "devices.view", "devices.manage", "devices.enroll", "devices.approve", "devices.power", "groups.manage",
      "remote.desktop", "remote.desktop_control", "remote.terminal", "remote.files", "remote.tools", "remote.tunnel", "remote.share", "remote.recordings",
      "scripts.view", "scripts.manage", "scripts.run", "jobs.view", "jobs.manage", "schedules.manage", "automations.manage", "policies.manage",
      "monitors.view", "monitors.manage", "alerts.view", "alerts.manage", "maintenance.manage",
      "patches.view", "patches.manage", "software.view", "software.manage", "vulnerabilities.view",
      "security.view", "security.manage", "vault.view", "vault.reveal", "vault.manage",
      "tickets.view", "tickets.manage", "contacts.manage", "docs.view", "docs.manage", "reports.view", "reports.manage", "network.view", "network.manage", "ai.use",
    ],
  },
  {
    key: "helpdesk",
    name: "Help Desk",
    description: "Remote support and tickets, no configuration changes",
    permissions: ["org.view", "devices.view", "devices.power", "remote.desktop", "remote.desktop_control", "remote.terminal", "remote.files", "remote.tools", "scripts.view", "scripts.run", "jobs.view", "alerts.view", "alerts.manage", "patches.view", "software.view", "security.view", "tickets.view", "tickets.manage", "contacts.manage", "docs.view", "reports.view", "ai.use"],
  },
  {
    key: "viewer",
    name: "Read only",
    description: "View everything, change nothing",
    permissions: ["org.view", "devices.view", "scripts.view", "jobs.view", "monitors.view", "alerts.view", "patches.view", "software.view", "vulnerabilities.view", "security.view", "vault.view", "tickets.view", "docs.view", "reports.view", "network.view", "audit.view"],
  },
  { key: "client_admin", name: "Client Administrator", description: "Customer-side admin: view devices, tickets, reports and the portal", permissions: ["org.view", "devices.view", "alerts.view", "patches.view", "software.view", "security.view", "tickets.view", "tickets.manage", "contacts.manage", "docs.view", "reports.view"] },
];

export function hasPermission(granted: readonly string[], needed: Permission | Permission[]): boolean {
  const need = Array.isArray(needed) ? needed : [needed];
  if (granted.includes("*")) return true;
  return need.every((n) => {
    if (granted.includes(n)) return true;
    const [resource] = n.split(".");
    return granted.includes(`${resource}.*`);
  });
}
