import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Monitor, Bell, Play, FileCode2, Workflow, ShieldCheck, Download, Package, Cast, Ticket, BookOpen, KeyRound, BarChart3, Network, Lock, Settings, Sparkles, Users, Building2, Puzzle, ScrollText, Server, Globe, CalendarClock, Bug, FolderKanban } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  badge?: "alerts" | "tickets" | "pending";
  superAdmin?: boolean;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Devices", href: "/devices", icon: Monitor, permission: "devices.view" },
      { label: "Alerts", href: "/alerts", icon: Bell, permission: "alerts.view", badge: "alerts" },
      { label: "Remote sessions", href: "/remote", icon: Cast, permission: "remote.desktop" },
      { label: "Tickets", href: "/tickets", icon: Ticket, permission: "tickets.view", badge: "tickets" },
    ],
  },
  {
    label: "Automate",
    items: [
      { label: "Jobs", href: "/jobs", icon: Play, permission: "jobs.view" },
      { label: "Scripts", href: "/scripts", icon: FileCode2, permission: "scripts.view" },
      { label: "Automations", href: "/automations", icon: Workflow, permission: "automations.manage" },
      { label: "Schedules", href: "/schedules", icon: CalendarClock, permission: "schedules.manage" },
      { label: "Policies", href: "/policies", icon: ShieldCheck, permission: "policies.manage" },
    ],
  },
  {
    label: "Maintain",
    items: [
      { label: "Patching", href: "/patches", icon: Download, permission: "patches.view" },
      { label: "Software", href: "/software", icon: Package, permission: "software.view" },
      { label: "Vulnerabilities", href: "/vulnerabilities", icon: Bug, permission: "vulnerabilities.view" },
      { label: "Security", href: "/security", icon: Lock, permission: "security.view" },
      { label: "Monitoring", href: "/monitoring", icon: Server, permission: "monitors.view" },
      { label: "Network", href: "/network", icon: Network, permission: "network.view" },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { label: "Documentation", href: "/docs", icon: BookOpen, permission: "docs.view" },
      { label: "Vault", href: "/vault", icon: KeyRound, permission: "vault.view" },
      { label: "Reports", href: "/reports", icon: BarChart3, permission: "reports.view" },
      { label: "AI Copilot", href: "/copilot", icon: Sparkles, permission: "ai.use" },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Deploy agent", href: "/deploy", icon: FolderKanban, permission: "devices.enroll" },
      { label: "Users & roles", href: "/settings/users", icon: Users, permission: "users.view" },
      { label: "Sites & groups", href: "/settings/sites", icon: Building2, permission: "sites.manage" },
      { label: "Integrations", href: "/settings/integrations", icon: Puzzle, permission: "integrations.manage" },
      { label: "Audit log", href: "/settings/audit", icon: ScrollText, permission: "audit.view" },
      { label: "Settings", href: "/settings", icon: Settings, permission: "org.view" },
      { label: "Platform", href: "/platform", icon: Globe, superAdmin: true },
    ],
  },
];
