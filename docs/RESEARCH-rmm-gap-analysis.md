# RMM Gap Analysis: MeshCentral 1.2.6 vs. the 2026 RMM market, and the re-implementation blueprint

Date: 2026-10-09. Author role: principal product architect (RMM).
Working name for the re-implementation: **MagicWand RMM** (after the `nextjs-magicwand` repo). Target stack assumed throughout: Next.js admin panel, Node/TypeScript control plane, Postgres (+ Redis for pub/sub and queues, S3-compatible object storage), a single static Go agent, hostable on Railway, any VPS, or a Windows/RDP host.

## 0. Scope, sources and method

- The file `scratchpad/research/meshcentral-feature-inventory.md` referenced by the task **did not exist** at run time. The inventory was therefore derived directly from the MeshCentral source tree at `scratchpad/meshcentral-src` (package.json version 1.2.6, agent build set `agents/agents_sep2026`), by reading `meshcentral-config-schema.json` (all `settings`, `domains`, `letsEncrypt`, `peers`, email/SMS/messaging sections), the `serverCommands` table and `case` labels in `meshuser.js`, the agent console/command handlers in `agents/meshcore.js` and `agents/modules_meshcore/*`, the server-side agent handlers in `meshagent.js`, the HTTP/WS routes in `webserver.js`, the `MESHRIGHT_*`/`SITERIGHT_*` bitmasks, `meshctrl.js` CLI verbs, plugin hooks in `pluginHandler.js`, `views/` and `public/` UI surfaces, and the Docker guide. Section 1 is a compact restatement of that inventory so this document stands alone.
- Market baseline refreshed with web search (October 2026). Key confirmations used below: ScreenConnect 25.x (Backstage, shared toolbox, Extended Auditing recording, extensions, 25.7-25.9 notes); NinjaOne (Patch Intelligence AI, macOS MDM early 2026, Dropsuite SaaS backup, NinjaOne PSA Q1 2026); Datto RMM 14.8 (patch counts aligned to Microsoft logic, legacy UI retired); N-able (AI scripting from plain language, "Enzo/N-zo" UEM assistant preview, developer portal); Atera (Copilot + Autopilot, rebranded "Robin" March 2026, autonomous low-risk fixes); Action1 (vulnerability integrations with Rapid7, Tenable, CrowdStrike Spotlight, Defender; AEM positioning); Automox (Zendesk sidebar app March 2026, 800+ device attributes, KEV reporting); Addigy (Security Suite, prebuilt app catalog, real-time compliance benchmarks); Syncro (XMM with M365 multi-tenant, network discovery, universal billing); Level (tag-targeted policies, trigger/condition/action automations incl. webhooks, CLI spec diff/apply, P2P connections, consent modes); Tactical RMM (policy inheritance global > client > site > agent with "Enforced", checks every 120 s, patch list refresh every 8 h, alert templates); TeamViewer (Session Insights summaries, "Tia" in-session AI agent, 1M+ AI sessions, AEM closed loop); Gartner 2026 MQ scoring "autonomous endpoint management" as a critical capability.
- Legend for the MeshCentral column: **Yes** = present and usable from the UI/API; **Partial** = exists only via console command, config file, plugin, or in a limited form; **No** = absent.

---

## 1. MeshCentral 1.2.6 baseline (derived inventory)

**Server.** Node >= 20, Express + express-ws. Databases: NeDB (default), SQLite, MongoDB, PostgreSQL, MySQL/MariaDB, AceBase. Multi-domain (tenant) config with per-domain branding, auth, limits, quotas, consent, recording, agent customization. Peering/multi-server (`peers`, `multiserver.js`), Prometheus endpoint (`monitoring.js`), watchdog, CrowdSec bouncer, IP allow/block lists for users and agents, brute-force lockout (`maxInvalidLogin`, `maxInvalid2fa`), enrollment rate limit by IP, Let's Encrypt/ZeroSSL, TLS offload/trusted proxy, auto-backup (zip, mongodump/pg_dump/mysqldump) to local/Google Drive/WebDAV/S3, self-update, syslog (plain/json/tcp), authLog, dbExpire retention, web push, MQTT broker, Firebase relay for Android, plugin system (hooks: `server_startup`, `hook_agentCoreIsStable`, `hook_processAgentData`, `hook_setupHttpHandlers`, `hook_userLoggedIn`, plus UI hooks), MeshBot sample, inter-user messaging for bots.

**Auth and access.** Local accounts (password policy, common-password ban, reset/expiry), LDAP/AD (group sync, required membership, site-admin groups), SSO via SAML, OIDC, Azure, Google, GitHub, Twitter, JumpCloud, Intel. 2FA: TOTP, email, SMS (Twilio/Plivo/Telnyx/URL), Duo, push (Android app/web push), FIDO2/WebAuthn, YubiKey OTP, backup codes; `force2factor`, `skip2factor` by IP, 2FA cookie duration. Login tokens (alternate credentials), login keys, user groups, per-domain and cross-domain management rights. RBAC: site-rights bitmask (`SITERIGHT_*`: manage users, server backup/restore/update, file access, locked, no new groups/devices, recordings, user groups, all events) and per-device-group/per-device rights bitmask (`MESHRIGHT_*`: edit group, manage users, manage computers, remote control, agent console, server files, wake, set notes, view-only, no terminal/files/AMT/desktop/registry/software, limited input, limit events, chat/notify, uninstall, reset/off, remote command, guest sharing, device details, relay). Session idle timeout, cookie IP check, allowed origins, HSTS, iframe policy.

**Device model.** Device groups ("meshes") of type 1 = agentless Intel AMT, 2 = agent, 3 = local/agentless network devices (RDP/SSH/VNC/HTTP via relay), 4 = IP-KVM. Device fields: name, description, tags, host/IP, icon, RDP/SSH/RFB/HTTP(S) ports, consent flags, Intel AMT credentials, user location; notes; power timeline; events; last-connect. No custom fields, no org/site hierarchy below domain.

**Agent (MeshAgent).** Native C + Duktape JS core (`meshcore.js` + modules). Builds for Windows x86/x64/ARM64 (service exe), Linux x86/x64/ARM/ARM64/MIPS/RISC-V/Alpine/OpenWrt/Poky, macOS universal, FreeBSD, OpenBSD, Android APK; `_nokvm` variants; recovery and diagnostic cores; self-update (native or core-based); agent hash check and sign lock; Authenticode signing with your own cert and timestamp server; branded installer (name, company, service name, icon, colors, file metadata); `.msh` embedded enrollment with invite codes/links/email; LAN/WAN/hybrid modes with encrypted multicast discovery; proxy support; WebRTC; core dumps and log dumps. Capabilities (console verbs and actions): sysinfo/cpuinfo/osinfo/smbios/rawsmbios, volumes and BitLocker (key escrow with retention), netinfo/dnsinfo/dhcp/wifi scan/iplocation, battery, thermals, VM/docker/chassis detection, installed apps and store apps (Windows), dpkg/rpm/apk/pacman/snap/flatpak (Linux), mac apps, uninstall app, Windows Update list/installed/history (read-only), QFE, pending reboot, defrag, Security Center/Defender/AV/firewall status, services list/start/stop/restart, processes/kill, users/sessions, printers list, registry read/write (tunnel protocol 4), run commands as agent/user (cmd/PowerShell/sh), eval JS, wget/httpget, file ops (ls/mkdir/rm/rename/zip/unzip/upload/download/find), WoL, power actions (off/reset/sleep/hibernate/lock/logoff), toast/alertbox/messagebox/notify, open URL, set/get clipboard, wallpaper/display, privacy bar, autolock, UAC/secure desktop, KVM desktop (multi-monitor, quality, scaling), terminals (admin cmd, admin PowerShell, user shell, user PowerShell, ConPTY), AMT LMS/MEI/APF, Intel AMT activation (ACM/CCM), request help / cancel help (Assistant), guest self-sharing.

**Remote access and tools.** Browser remote desktop (KVM, WebRTC optional, server-side multiplexing, in-browser WebM capture), terminal (xterm.js), files (SFTP optional), web RDP (`mstsc`), web SSH/SFTP, noVNC, IP-KVM, Intel AMT KVM/SOL/IDER/power, MeshCommander embedded, MeshCentral Router (TCP port mapping, RDP/SSH/SCP links, custom links), MeshCmd (AMT CLI), MeshCentral Satellite (AD/802.1x cert enrollment for AMT), MeshCentral Assistant (Windows tray app: status, request help, self-share, branded), Android agent. Session recording (.mcrec, text/desktop/AMT, indexing, retention by count/days/size, player), user consent prompts/notifications/privacy bar with auto-accept rules (timeout, no user, locked), per-device consent, guest device-share links (desktop/terminal/files bits, expiry, recurring daily, consent, port forward), messenger/chat with end user, alternate messaging links (Jitsi etc.), pre-configured remote input strings, pre-configured scripts (config file), desktop view-only mode, bulk actions (run commands, power, toast, message, wake, move group, uninstall agent, update agents).

**Notifications and reporting.** Device-group online/offline notifications to email/SMS/messaging (Telegram, Discord, XMPP, CallMeBot, Slack, Pushover, ntfy, Zulip), user-to-user messaging, web push. Events log (device, user, server), power timeline, traffic stats, server stats/timeline, `report` command (CSV exports of sessions/traffic/logins), device list export, Prometheus.

**UI.** `default.handlebars` (classic monolithic ~1.7 MB SPA), `default3.handlebars` (Bootstrap "modern" UI behind `showModernUIToggle`), mobile site, night mode, theme packs, custom CSS/UI, custom device icons, PWA manifest, i18n (30+ languages), embeddable/iframe, URL switching, notes panel, "My Server" tab (backup/restore/upgrade/console/trace/config/error log).

**Deployment.** `npm install meshcentral`, Windows service (`winservice.js`), Docker images (ghcr, slim/mongodb/postgresql/mysql variants, env-driven config), reverse proxy guides, LAN-only/WAN-only modes, multi-server peering. No Railway template, no Helm chart, no MSI/DEB/RPM agent packages (EXE, .msh, macOS pkg/dmg, Linux shell installer, APK only).

---

## 2. Capability matrix

Columns: **MeshCentral** (Yes/Partial/No + note) | **Typical modern RMM (2026)** | **Beyond-market idea** (expanded in section 4 where numbered as B-n).

### 2.1 Inventory and asset management

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 1 | Hardware inventory (CPU, RAM, disks, SMBIOS, serial, chassis) | **Yes** - sysinfo, smbios, volumes, computer-identifiers | Standard; Automox exposes 800+ attributes | Device twin with per-attribute provenance and change timeline (B-6) |
| 2 | OS inventory, build, patch level, uptime, pending reboot | **Yes** - osinfo, qfe, pendingReboot | Standard | OS end-of-support countdown per device with upgrade-path suggestion |
| 3 | Software inventory (Win apps + Store, dpkg/rpm/apk/pacman/snap/flatpak, mac apps) | **Yes** - win-info, linux-info, mac-info | Standard, plus normalization to a software catalog | Normalized software graph (publisher, product, version, CPE) shared across tenants for CVE mapping |
| 4 | Custom fields / asset attributes (typed, per tenant) | **No** - only name, desc, tags, host, ports | Standard (Level custom-field triggers, Ninja custom fields) | Fields can be script-populated and policy-targeted |
| 5 | Asset lifecycle (owner, purchase date, cost, lease, location, status) | **No** | Standard in Ninja/Datto/Syncro ITAM | Lifecycle predictions (refresh date from perf + age + warranty) |
| 6 | Warranty lookup (Dell, Lenovo, HP, Apple, Microsoft) | **No** | Common natively or via integration | Warranty-expiry included in health score and refresh planning |
| 7 | Device change history / configuration diffs over time | **Partial** - event log and power timeline; no inventory diffs | Partial in most; Automox/Ninja show history | Device twin timeline with "what changed before this incident" view (B-6) |
| 8 | Static tags and dynamic groups (saved filters) | **Partial** - static tags and device groups; search not saved | Standard (Level tag targeting, Ninja dynamic groups) | Groups defined by natural-language queries that compile to filters (B-3) |
| 9 | Logged-in users and sessions | **Yes** - users, userSessions, activeusers | Standard | Last-user-to-device affinity map for "whose laptop is this" |
| 10 | Battery, thermal, VM/container/chassis detection | **Yes** | Standard | Battery health trend with replacement alert |
| 11 | Network inventory (NICs, IPs, MACs, DHCP, DNS, Wi-Fi scan) | **Yes** - netinfo, dhcp, dnsinfo, scanwifi | Standard | Wi-Fi quality telemetry per user for DEX scoring |
| 12 | Printers inventory | **Partial** - list only (win-info printers) | Standard list; limited management | See 61-62 |
| 13 | Peripherals, USB devices, monitors | **No** | Partial (Ninja monitors, USB via scripts) | USB device policy with allow/deny and audit (see 83) |
| 14 | Hypervisor and VM inventory (Hyper-V, VMware, Proxmox) | **No** | Partial (Hyper-V/VMware monitors in Ninja/N-central) | VM-to-host topology in the device graph |

### 2.2 Monitoring and alerting

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 15 | Live CPU/memory/disk/network telemetry | **Partial** - on-demand sysinfo/cpuinfo; no streaming | Standard, 60-120 s cadence | Adaptive sampling (fast while a tech is looking, slow otherwise) |
| 16 | Historical metrics time-series and graphs | **No** - only power timeline and server stats | Standard (30-90 day retention) | Explainable health score built on the series (B-1) |
| 17 | Threshold checks (disk, CPU, memory, service, ping, script) | **No** | Standard (Tactical checks every 120 s, Level monitors) | Baseline-relative thresholds instead of fixed numbers (B-7) |
| 18 | Service/process monitoring with auto-restart | **Partial** - console list/restart; no monitor | Standard | Crash-loop detection with blast-radius-limited restart playbook (B-4) |
| 19 | Event log / syslog / journald monitoring rules | **No** | Standard (Windows event log checks) | Cross-fleet event correlation ("12 devices logged the same error in 10 minutes") |
| 20 | Anomaly detection and performance baselines | **No** | Emerging (Ninja/N-able AI insights) | Per-device seasonal baselines (B-7) |
| 21 | Notification channels (email, SMS, Telegram, Discord, Slack, ntfy, Pushover, Zulip, XMPP, web push) | **Yes** for channels; **Partial** for triggers (online/offline only) | Standard channels; alert templates | Channel-aware digests with quiet hours per technician |
| 22 | Alert lifecycle: dedup, escalation, on-call, snooze, maintenance windows | **No** | Standard (Tactical alert templates, Ninja escalation) | Alert fatigue budget per tenant with auto-tuning suggestions |
| 23 | SNMP polling and traps | **No** | Standard via probe (Ninja NMS, N-central, Syncro) | See 65 |
| 24 | Agentless uptime checks (ICMP/TCP/HTTP/TLS expiry) | **No** - meshScanner is AMT-only | Standard | Checks run from the nearest agent, not a cloud poller |
| 25 | Online/offline history and uptime | **Yes** - power timeline, lastconnect | Standard | Outage attribution (device vs ISP vs server) using peer agents |
| 26 | Server self-monitoring (Prometheus, stats, watchdog) | **Yes** | Vendor-internal | Public status page per tenant (see 103) |
| 27 | Disk health (SMART), defrag, free-space forecast | **Partial** - defrag, volumes; no SMART | SMART common | "Days until full" forecast per volume |
| 28 | Network quality to the server (RTT, packet loss) | **Yes** - rtt, trafficstats | Partial | Agent-to-agent LAN quality mesh for site diagnostics |

### 2.3 Patching (OS and third-party)

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 29 | Windows Update scan, available/installed/history | **Yes** - win-updates (read-only), winupdates console | Standard | Patch counts reconciled to Microsoft logic (Datto 14.8 lesson) |
| 30 | Windows Update install, approve/decline, hide | **No** | Standard | Staged install with automatic pause on failure spikes |
| 31 | Patch policies (classifications, KB allow/deny, rings, deferrals, maintenance windows) | **No** | Standard (Ninja, Datto, Action1, Tactical 8-h refresh) | Ring promotion gated by health-score delta of earlier rings (B-9) |
| 32 | Third-party app patching (Chrome, Zoom, Adobe, Java...) | **No** | Standard (catalogs of 100-500 apps) | Community-curated catalog with signed manifests |
| 33 | Linux (apt/dnf/zypper) and macOS (softwareupdate) patching | **No** | Common (Action1 adding mac/Linux; Addigy for Apple) | Unified "patch intent" model across OS families |
| 34 | Patch compliance reporting, CVE/KEV mapping | **No** | Standard (Automox KEV, Action1 vulnerability views) | Exposure score weighted by device role and exploitability |
| 35 | Reboot orchestration with user prompts, deferrals, deadlines | **Partial** - poweraction + toast; no deferral UX | Standard | Reboot windows learned from user activity patterns (B-14) |
| 36 | Driver, firmware, BIOS updates (Dell DCU, Lenovo, HP) | **No** | Partial (Ninja via vendor tools) | Firmware management with rollback image and power-safety checks (B-12) |
| 37 | Patch rollback / uninstall KB | **No** | Partial | Automatic rollback when post-patch health drops (B-9) |
| 38 | Patch distribution via LAN cache / P2P | **No** | Partial (Delivery Optimization, Ninja cache) | P2P patch and package distribution (B-2) |

### 2.4 Software deployment and app catalog

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 39 | App catalog with one-click install (winget/choco/brew/apt) | **No** - uninstall only | Standard (Addigy prebuilt catalog, Ninja, Level) | Catalog entries carry install, detect, uninstall, update and health-check steps |
| 40 | Package repository (MSI/EXE/PKG/DEB with args, detection rules, versions) | **No** - only server/user file storage | Standard | Content-addressed storage with dedupe and P2P delivery (B-2) |
| 41 | Package-manager integration (winget, Chocolatey, Homebrew, apt/dnf) | **No** | Common | Pin-by-policy with drift alert when version changes |
| 42 | Software uninstall | **Yes** - uninstallapp/uninstallstoreapp | Standard | Silent-uninstall recipe inference from registry strings |
| 43 | Software allow/deny lists and unwanted-software alerts | **No** | Standard | Shadow-IT detector using fleet-wide software graph |
| 44 | End-user self-service app store | **No** | Common (Ninja, Addigy Self Service, Intune Company Portal) | Approval workflows with manager sign-off (see 68) |

### 2.5 Scripting, automation and runbooks

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 45 | Ad-hoc commands (cmd, PowerShell, sh) as system or user | **Yes** - runcommands, runAsUser 0/1/2 | Standard | Sandboxed dry-run that shows predicted file/registry changes |
| 46 | Script library (versioned, parameters, secrets, OS targeting, categories) | **Partial** - PreconfiguredScripts in config only | Standard | Signed scripts with provenance and reviewer approval |
| 47 | Scheduled tasks per device/group (cron, once, on boot) | **No** - only via community ScriptTask plugin | Standard | Schedules expressed in user-local time with DST-safe semantics |
| 48 | Event-triggered automations (on enroll, alert, tag change, webhook) | **No** - plugin hooks only | Standard (Level triggers/conditions/actions) | Blast-radius-limited playbooks (B-4) |
| 49 | Multi-step runbooks with conditions, approvals, rollback | **No** | Emerging (Atera Robin, N-able Enzo) | Change-risk scoring per step (B-5) |
| 50 | Structured script results (exit code, stdout, JSON, artifacts, history) | **Partial** - console text, events | Standard | Results indexed for NL queries ("which devices returned non-zero") |
| 51 | Embedded runtimes (JS, Python, Deno) | **Partial** - Duktape JS eval in agent | Partial (Tactical Python) | Embedded Deno/QuickJS sandbox with capability permissions |
| 52 | Bulk actions on a selection or query | **Yes** - commands, power, toast, msg, wake, move, update | Standard | Canary-first bulk execution with automatic halt (B-4) |
| 53 | Shared technician toolbox (run EXE/script in session) | **Partial** - server files + upload; no toolbox UI | ScreenConnect toolbox standard | Toolbox items with hashes, versions and per-role sharing |
| 54 | CLI and spec-as-code (diff/apply automations) | **Partial** - meshctrl covers admin ops; no spec diff | Level CLI spec diff/apply | GitOps for RMM policy (B-19) |

### 2.6 Policies, drift and compliance

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 55 | Configuration policies per group (consent, features, recording, agent settings) | **Partial** - mesh flags and domain config | Standard | Policy simulation ("what would change if I apply this") |
| 56 | Desired-state / drift detection and auto-remediation | **No** | Standard (Ninja policies, Level, Tactical enforced policies) | Drift heatmap by policy section (B-8) |
| 57 | CIS/benchmark compliance scanning (Win, mac, Linux) | **No** | Common (Addigy real-time benchmarks, Action1) | Benchmark rules compiled to the same check engine as monitors |
| 58 | Registry/plist/config enforcement | **Partial** - registry tunnel protocol read/write; no policy | Standard | Config items as typed resources (registry, plist, file, service) |
| 59 | Policy inheritance (global > org > site > group > device) with overrides | **No** - domain > group only | Standard (Tactical global/client/site/agent) | Effective-policy explorer that shows which layer set each key |
| 60 | Compliance reports and attestations (SOC2/ISO evidence) | **No** | Common | Signed, timestamped evidence packs exported per audit period |
| 61 | Local account management (create/disable/rotate admins) | **Partial** - list users only | Standard | See LAPS (74) |

### 2.7 Printers, warranty, geolocation

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 62 | Printer management (drivers, mapping, queue clear, default) | **No** | Partial | Print-queue stuck-job auto-remediation playbook |
| 63 | Warranty lookup and expiry alerts | **No** | Common | Included in health score and refresh planning |
| 64 | Geolocation (IP, Wi-Fi/GPS) and map | **Partial** - ipLocation, geoLocation flagged "not being worked on" | Standard (IP-based; Wi-Fi via MDM) | Geofence policies: lock or restrict when outside region (see 84) |

### 2.8 Network discovery, SNMP, agentless

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 65 | Subnet discovery from an agent (ARP/ping/mDNS/NetBIOS) | **Partial** - AMT scanner and manual local devices | Standard (Syncro, Ninja, Level discovery) | Every agent is a probe; probe election per subnet (B-20) |
| 66 | SNMP v2c/v3 polling, traps, MIB library | **No** | Standard via probe | Vendor-neutral device profiles auto-learned from sysObjectID |
| 67 | Network topology map (L2/L3) | **No** | Common (Auvik-style in Ninja NMS) | Live map with per-link quality from agent mesh |
| 68 | Agentless managed devices (switches, printers, IoT, cameras) | **Partial** - local devices with RDP/SSH/VNC/HTTP links | Standard | Agentless "shadow twin" with the same timeline as agents |
| 69 | Rogue/new device detection (DHCP watch) | **No** | Common | Auto-enroll suggestion for unmanaged Windows hosts found on LAN |
| 70 | Dedicated network probe / collector | **No** | Standard | No appliance: any agent can be elected probe (B-20) |

### 2.9 Remote access and remote tools

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 71 | Remote desktop (Win/Linux/mac), multi-monitor, quality, scaling, clipboard | **Yes** - KVM, display, clipboardGet/Set | Standard; ScreenConnect remains the UX bar | Session co-browsing with pointer for end user (B-10) |
| 72 | Remote terminal (cmd, PowerShell, sh; admin and user) | **Yes** - protocols 1/6/8/9, ConPTY | Standard | Terminal with command risk hints before Enter (B-5) |
| 73 | File manager (browse, upload, download, zip, rename, search) | **Yes** | Standard | Resumable transfers and background file sync jobs |
| 74 | Background tools without disturbing the user (services, processes, registry, event viewer, task scheduler, users) | **Partial** - console verbs and registry tunnel; no event viewer, limited UI | ScreenConnect Backstage is the bar | "Backstage" in the browser with every tool as a typed panel |
| 75 | Session recording and playback with search and retention | **Yes** - .mcrec, index, retention | Standard (ScreenConnect Extended Auditing) | AI session summaries and command transcript search (B-13) |
| 76 | End-user consent, notification banner, privacy bar, auto-accept rules | **Yes** - per domain and per device | Standard (Level approval modes) | Consent policies by device class, time of day and tech role |
| 77 | Just-in-time guest/share links (expiry, recurring, consent, scoped tools) | **Yes** - createDeviceShareLink; Assistant self-share | Common | JIT with approval, reason capture and auto-revoke (B-16) |
| 78 | Multi-technician sessions, co-presence | **Yes** - desktop multiplex, kvmusers | Standard | Live cursor and chat between techs in session |
| 79 | Web RDP/SSH/SFTP/VNC to LAN hosts via agent relay | **Yes** - mstsc, ssh, novnc, sshfiles, local devices | Common | Credential vault injection without revealing passwords |
| 80 | Native port-mapping/router client | **Yes** - MeshCentral Router | Common | Browser-only equivalent via WebTransport, no install |
| 81 | Wake-on-LAN, power actions, lock, logoff | **Yes** | Standard | WoL via peer agent on same subnet automatically |
| 82 | Intel AMT/vPro OOB (KVM, SOL, IDER, power, ACM/CCM, CIRA, MPS, 802.1x) | **Yes** - best in class | Rare (Ninja partial) | Keep parity; expose through the same session UI |
| 83 | IP-KVM support | **Yes** | Rare | Keep |
| 84 | Redfish/IPMI/iDRAC/iLO OOB | **No** | Rare | Unified OOB adapter (AMT, Redfish, IPMI) behind one "Power/Console" surface |
| 85 | Chat with end user from console | **Yes** - messenger | Standard | Chat continuity across sessions and tray app (B-11) |
| 86 | Remote printing, remote audio, mic | **No** | TeamViewer/Splashtop have; RMMs mostly not | Remote audio routed over WebRTC when supported |
| 87 | Mobile agents (Android, iOS) | **Yes** Android; **No** iOS | Common (MDM-based) | See MDM (90-93) |
| 88 | Session notes, time tracking, ticket link per session | **No** | Standard in PSA-attached RMMs | Auto-drafted session note from transcript (B-13) |
| 89 | Blank screen, block input, lock after session, secure desktop | **Partial** - autolock, UAC, privacy bar; no blank/block | Standard | Blank-screen with hardware-level fallback via AMT on vPro |
| 90 | Session handoff / invite another technician / escalate | **Partial** - multiplex only | Standard | Handoff with context packet (what was tried, timeline) |
| 91 | Pre-configured remote input / macros | **Yes** | Common | Macro recorder from live session |
| 92 | Technician mobile console | **Partial** - mobile site | Standard apps | PWA with push and remote desktop on mobile |

### 2.10 End-user tray app and self-service

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 93 | Tray app with status and "request help" | **Yes** - MeshCentral Assistant (Windows) | Standard | Cross-platform tray app shared with the installer binary |
| 94 | Self-service portal (approved apps, fixes, password reset) | **No** | Common | Self-heal buttons powered by playbooks with blast-radius 1 |
| 95 | End-user chat with technician | **Yes** | Standard | Threaded chat tied to a ticket (B-11) |
| 96 | Announcements, toasts, message boxes | **Yes** | Standard | Targeted announcements with acknowledgement tracking |
| 97 | Post-session feedback / CSAT | **No** | Common | CSAT linked to session recording for coaching |
| 98 | Create ticket from tray with auto-attached diagnostics | **No** | Common | Ticket carries a device snapshot and last 10 minutes of telemetry |

### 2.11 Ticketing, PSA, documentation, vault

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 99 | Built-in lightweight ticketing | **No** | Common (Atera, Syncro, NinjaOne PSA) | Tickets auto-created and auto-closed by playbooks |
| 100 | PSA integrations (ConnectWise Manage, Autotask, HaloPSA) | **No** | Standard | Bidirectional sync via generic webhook/connector SDK |
| 101 | Time tracking and billing hooks | **No** | Common | Session time auto-logged against client |
| 102 | Device notes and runbook-style docs | **Partial** - notes only | Standard (Ninja Documentation, IT Glue) | Notes with device-field templating and expiring secrets |
| 103 | Credential vault (device creds, BitLocker, LAPS, SSH keys) | **Partial** - saved device creds, BitLocker keys | Standard | Vault with just-in-time reveal and auto-rotation (B-16) |
| 104 | Documentation types (licenses, SSL certs, domains, contracts) | **No** | Common | Auto-discovered cert/domain expiry entries |

### 2.12 Reporting, dashboards, health score

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 105 | Fleet dashboard (KPIs, offline, alerts, patch status) | **Partial** - server stats; no fleet KPIs | Standard | Dashboards defined by NL queries (B-3) |
| 106 | Scheduled and exportable reports (CSV, PDF, email) | **Partial** - report CSVs, device export | Standard | Report builder on the same query engine |
| 107 | Device and tenant health score | **No** | Common (Ninja, Datto device health) | Explainable health score (B-1) |
| 108 | Audit trail of all user/tech/system actions | **Yes** | Standard | Tamper-evident hash-chained audit log |
| 109 | Executive/QBR reports per client | **No** | Common | Auto-narrated QBR with trends and recommendations |
| 110 | Energy and carbon reporting | **No** | Rare | Power-profile telemetry to kWh and CO2e (B-15) |

### 2.13 Security posture and platform security

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 111 | AV/EDR status and Defender health | **Yes** - Security Center, defender | Standard | EDR signal ingestion to posture score |
| 112 | Disk encryption status and key escrow (BitLocker, FileVault, LUKS) | **Yes** BitLocker; **Partial** mac/Linux | Standard | Escrow with reveal audit and expiry |
| 113 | Firewall status and rules | **Partial** - status only | Standard | Rule drift vs baseline |
| 114 | LAPS / local admin password rotation | **No** | Common | Rotation with JIT reveal (B-16) |
| 115 | Admin MFA (TOTP, FIDO2, YubiKey OTP, Duo, email, SMS, push, backup codes) | **Yes** - best in class | Standard (fewer methods) | Keep; add passkeys as default |
| 116 | SSO (SAML, OIDC, Azure, Google, GitHub, JumpCloud, LDAP/AD) | **Yes** | Standard | SCIM provisioning |
| 117 | RBAC with custom roles and scoped permissions | **Partial** - fixed bitmasks, no custom roles | Standard | Attribute-based access (ABAC) with device posture (B-17) |
| 118 | IP allow/deny, brute-force lockout, CrowdSec | **Yes** | Standard | Geo and ASN-aware risk scoring on logins |
| 119 | Agent and installer code signing, hash lock | **Yes** | Standard | Reproducible agent builds with public transparency log |
| 120 | Vulnerability scanning (software CVE, KEV) | **No** | Standard (Action1, Automox, Ninja) | Exposure score with exploit-in-the-wild weighting |
| 121 | Secure Boot, TPM, OS hardening posture | **No** | Common | Posture gates remote access (B-17) |
| 122 | USB/removable device control | **No** | Partial | Policy with audit trail and temporary exceptions |
| 123 | Zero-trust posture gating for sessions and apps | **No** | Rare | B-17 |
| 124 | Four-eyes approval for risky actions | **No** | Rare | Approvals bound to change-risk score (B-5) |
| 125 | Session and agent transport security (TLS pinning, WebRTC DTLS, relay isolation) | **Yes** | Standard | Per-session ephemeral keys and MLS-style group sessions |

### 2.14 Backup, MDM, OOB

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 126 | Backup job monitoring (Veeam, Acronis, Windows Backup, Time Machine) | **No** | Common | Backup freshness in health score |
| 127 | Server self-backup and restore | **Yes** - zip, DB dumps, GDrive/WebDAV/S3 | Vendor-internal | Point-in-time restore rehearsal mode (B-18) |
| 128 | Apple MDM (ADE/DEP, profiles, FileVault, app installs) | **No** | Common (Ninja macOS MDM 2026, Addigy, Jamf) | MDM and agent unified under one policy model |
| 129 | Android Enterprise MDM | **Partial** - Android agent only | Common | Same |
| 130 | Windows MDM/CSP enrollment | **No** | Partial (Intune adjacency) | CSP policies delivered by agent when MDM absent |
| 131 | iOS/iPadOS | **No** | Common | Same |
| 132 | OOB adapters (AMT, Redfish, IPMI) | **Yes** AMT; **No** Redfish/IPMI | Rare | Unified OOB surface (84) |

### 2.15 Multi-tenancy, MSP, white-label, portals

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 133 | Tenant isolation (data, users, agents, branding) | **Yes** - domains | Standard | Row-level security enforced in DB, not only app |
| 134 | Hierarchy: MSP > client org > site > group > device | **Partial** - domain > group | Standard | Hierarchy drives policy inheritance (59) |
| 135 | White-label (title, logos, agent name/icon, tray app, emails, URLs) | **Yes** | Standard | Per-client branded installer and portal domain |
| 136 | Client portal (customer self-view, approvals) | **Partial** - restricted users only | Common | Portal with approvals for JIT access and change windows |
| 137 | Public status page | **No** | Rare | Tenant status page from monitors |
| 138 | Usage metering and billing export | **Partial** - limits, traffic | Common | Per-client cost and carbon report |

### 2.16 API, webhooks, CLI, plugins

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 139 | WebSocket control API and CLI | **Yes** - meshctrl | Standard | Keep as transport; add typed SDK |
| 140 | REST API with OpenAPI, API keys, scopes, rate limits | **No** - login tokens only | Standard (N-able developer portal) | OpenAPI generated from the same schema as the UI |
| 141 | Outbound webhooks and event streams | **No** - plugin hooks only | Standard (Level inbound webhooks) | Signed webhooks with replay and dead-letter |
| 142 | Plugin/extension system | **Yes** | ScreenConnect extensions | Sandboxed extensions with declared permissions |
| 143 | MQTT broker for IoT | **Yes** | Rare | Keep |
| 144 | IaC (Terraform provider, spec files) | **No** | Emerging (Level CLI) | GitOps policy repo (B-19) |

### 2.17 AI features

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 145 | AI copilot over fleet data (chat) | **No** | Common (Atera Copilot, N-able Enzo preview, Ninja) | NL fleet queries compiled to a typed query (B-3) |
| 146 | AI script generation and explanation | **No** | Common (N-able plain-language scripting) | Scripts generated with tests and a dry-run plan |
| 147 | AI session summaries and notes | **No** | TeamViewer Session Insights | B-13 |
| 148 | AI patch risk intelligence | **No** | NinjaOne Patch Intelligence AI | B-9 |
| 149 | AI autonomous remediation with guardrails | **No** | Atera Robin, Gartner AEM | B-4 plus B-5 |

### 2.18 Deployment and hosting

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 150 | Docker images and compose | **Yes** - multi-DB variants | SaaS-only for most vendors; Tactical self-hosted | Single image, env-driven, migrations on boot |
| 151 | Railway/PaaS one-click deploy (PORT env, single process, volume, managed Postgres/Redis) | **Partial** - works with manual volume/env; no template | Not offered (SaaS) | Railway template with health checks and object storage for recordings |
| 152 | VPS install (Ubuntu/Debian script, Caddy/Nginx, Let's Encrypt) | **Yes** | Tactical install script | One-line installer with automatic TLS and backups |
| 153 | Windows host / RDP-host install as a service | **Yes** - winservice.js | ScreenConnect on-prem Windows | Windows service wrapper plus WSL-free single binary |
| 154 | Reverse proxy, TLS offload, trusted proxy, aliases | **Yes** | Standard | Same |
| 155 | Multi-DB support | **Yes** | Vendor-internal | Postgres only (simplicity), SQLite for dev |
| 156 | HA / multi-node / peering | **Yes** | Vendor-internal | Stateless nodes behind Redis pub/sub |
| 157 | Kubernetes/Helm | **No** (community) | N/A | Helm chart optional, later |
| 158 | Server self-update and migrations | **Yes** | N/A | Blue-green with schema migration gating |

### 2.19 Agent engineering

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 159 | Self-update (staged, signed, rollback) | **Yes** - native and core | Standard | Ring-based agent rollout gated by crash telemetry |
| 160 | Tamper protection (service hardening, uninstall password, anti-kill) | **Partial** - signLock, uninstall rights | Standard | Tamper events feed posture gating (B-17) |
| 161 | Offline command queue (execute on reconnect, TTL) | **No** | Standard | Queue with expiry and idempotency keys |
| 162 | P2P / LAN cache for packages and patches | **No** | Partial | B-2 |
| 163 | Low footprint (CPU, RAM, binary size) | **Yes** - C + Duktape | Standard | Single static Go binary < 15 MB, < 30 MB RSS |
| 164 | Code signing (Authenticode, Apple notarization, Linux sigs) | **Yes** Authenticode; **Partial** mac notarization | Standard | Reproducible builds, Sigstore transparency |
| 165 | Installer outputs: EXE, MSI, PKG, DMG, DEB, RPM, APK | **Partial** - EXE, PKG/DMG, shell, APK; no MSI/DEB/RPM | Standard (MSI/PKG/DEB common) | All formats generated by an external installer builder bound to tenant/site (section 5.2) |
| 166 | Branded installer pre-linked to tenant/group with invite codes/links | **Yes** - .msh embed, invite, email | Standard | Installer deep-links back to the admin panel and shows live enrollment status |
| 167 | Broad OS/arch coverage (x86, x64, ARM, MIPS, RISC-V, BSD, OpenWrt) | **Yes** - exceptional | Narrower | Keep via Go cross-compile; drop nothing |
| 168 | Agent health telemetry, crash dumps, log upload | **Yes** | Standard | Chaos/self-test mode (B-21) |
| 169 | Direct P2P sessions (WebRTC) with relay fallback | **Yes** | Common (Level P2P) | WebRTC plus WebTransport, QUIC relay |
| 170 | LAN/WAN/hybrid connectivity, multicast discovery, proxy support | **Yes** | Partial | Same |
| 171 | Enrollment security (rate limits, approval, allowlists) | **Yes** | Standard | Enrollment attestation with TPM-bound identity |

### 2.20 UI and UX (the "better than ScreenConnect" bar)

| # | Capability | MeshCentral | Typical modern RMM (2026) | Beyond-market idea |
|---|---|---|---|---|
| 172 | Modern component-based SPA | **Partial** - 1.7 MB Handlebars monolith; Bootstrap "modern" toggle | Standard (React/Vue) | Next.js app with streaming, optimistic updates |
| 173 | Dark theme, theming tokens | **Yes** - nightMode, themePack (dated visuals) | Standard | Dark-first design system, per-tenant accent tokens |
| 174 | Command palette and keyboard-first navigation | **No** | Rare | Palette that also runs fleet actions and NL queries |
| 175 | Responsive and mobile console | **Partial** | Standard | Full PWA with push |
| 176 | Customizable dashboards and widgets | **No** | Common | Widgets bound to saved queries |
| 177 | Presence (who is viewing/acting on this device now) | **Partial** - kvmusers in session | Rare | Device-level presence and action locks |
| 178 | Session UI parity with ScreenConnect (toolbar, monitors, quality, backstage, toolbox, notes) | **Partial** | ScreenConnect is the bar | Single session shell hosting desktop, terminal, files, backstage, chat, notes as tabs with split view |

Row count: 178.

---

## 3. Design sketches for every No/Partial row

Conventions used in every sketch: all tables carry `tenant_id` and use row-level security; ids are ULIDs; `jobs` is the universal server-to-agent work queue (`jobs(id, tenant_id, device_id, type, payload jsonb, status, idempotency_key, expires_at, result jsonb, created_by)`) with Redis fan-out and persistent delivery so every command is offline-capable; `events` is append-only; `metrics` is a time-partitioned table (Timescale optional). Agent = single Go binary with a module registry; Server = Node/TS services behind the Next.js API; UI = Next.js App Router pages.

**R4 Custom fields.** Data: `field_defs(tenant_id, scope: device|user|org, key, type, options, validation, script_source)`, `field_values(entity_id, key, value jsonb)`. Agent: a script job may return `{fields: {...}}` to populate values. Server: field service validates, indexes JSONB with GIN, exposes fields in query language. UI: Fields settings page; device header shows pinned fields; column picker in grids.

**R5 Asset lifecycle.** Data: `assets(device_id?, kind, owner_user, purchase_date, cost, vendor, lease_end, location_id, status)`, `locations`. Server: lifecycle service with status transitions and reminders; merges with warranty (R6). UI: Assets tab per device, Lifecycle report with refresh-planning view.

**R6 Warranty lookup.** Data: `warranties(device_id, vendor, start, end, service_level, source, fetched_at)`. Agent: serial/model already reported (R1). Server: pluggable `warranty_providers` (Dell TechDirect, Lenovo, HP, Apple via GSX where licensed), nightly refresh with per-vendor rate limiting and cache. UI: badge on device header, "Expiring warranties" widget, health-score factor.

**R7 Change history / device twin.** Data: `twin_snapshots(device_id, ts, section, hash, doc jsonb)` plus `twin_diffs(device_id, ts, section, path, old, new)`. Agent: sends full inventory with per-section hashes; server only stores changed sections. Server: diff service computes JSON patches. UI: Timeline tab with filter by section and "compare to date" view.

**R8 Dynamic groups.** Data: `groups(kind: static|dynamic, filter_ast jsonb, tag_rules)`, materialized `group_members` refreshed by triggers on device/field changes. Server: query compiler (section 4, B-3) evaluates filter AST; membership changes emit events usable by automations. UI: group builder with live count preview; saved searches become groups in one click.

**R12/R62 Printers.** Data: `printers(device_id, name, driver, port, shared, default, status, queue_len)`. Agent: Windows WMI/CUPS collectors; actions `printer.clear_queue`, `printer.set_default`, `printer.add` (driver package via R40). Server: printer service. UI: Printers tab per device, fleet printer view.

**R13 Peripherals/USB/monitors.** Data: `peripherals(device_id, class, vendor_id, product_id, serial, name, first_seen, last_seen)`. Agent: SetupAPI/udev/IOKit enumerators with hotplug events. Server: stores, raises `peripheral.connected` events. UI: Peripherals tab; USB policy (R122).

**R14 Hypervisor inventory.** Agent: Hyper-V (WMI), VMware (govmomi, agentless from any agent), Proxmox API, libvirt; produces host-to-VM edges. Data: `device_links(parent_id, child_id, kind: hosts)`. UI: host card shows VMs; VM card links to host.

**R15/R16 Telemetry and time-series.** Data: `metrics(device_id, ts, name, value, labels)` partitioned by week; `metric_rollups` (5 m, 1 h). Agent: collectors every 60 s (CPU, mem, disk io, net, per-process top-N optional) with delta compression; adaptive cadence when a tech has the device open. Server: ingest via WebSocket batch, write-behind with Redis buffer. UI: sparklines on device header, Metrics tab with brush/zoom, fleet heatmap.

**R17 Threshold checks.** Data: `checks(policy_id, type, params, interval, severity, remediation_playbook_id)`, `check_results(device_id, check_id, ts, status, value, output)`. Agent: evaluates agent-side checks locally and sends only state changes plus periodic heartbeats; server-side checks (ping/HTTP) run from elected probe agents. UI: Checks section in policy editor; device Health tab lists current check states.

**R18 Service/process monitors.** Checks of type `service` (name, expected state, restart on fail, max restarts per hour) and `process` (present/absent, CPU cap). Agent: service controller via SCM/systemd/launchd. Remediation calls a playbook with blast radius.

**R19 Event log monitoring.** Agent: Windows EventLog subscription (EvtSubscribe) with filter XPath, journald follower, syslog file tailer; forwards matched records only. Data: `log_events(device_id, ts, source, id, level, message, fields jsonb)` with 30-day retention. UI: Event Viewer in Backstage (R74) and rule editor in policies.

**R20 Anomaly detection.** Server: per-device rolling baselines (EWMA and seasonal weekday/hour bands) computed in a worker; emits `anomaly` events scored by deviation. UI: "unusual" badges and an Anomalies feed.

**R21/R22 Alert lifecycle.** Data: `alerts(id, device_id, source, severity, status: open|acked|snoozed|resolved, fingerprint, first_seen, last_seen, count, assignee)`, `escalation_policies`, `maintenance_windows`, `on_call_schedules`. Server: alert manager dedupes by fingerprint, applies maintenance windows, escalates on timers, routes via channel adapters (reuse MeshCentral's channel set). UI: Alerts inbox with bulk ack, snooze, assign; per-tenant routing rules.

**R23/R66 SNMP.** Agent: embedded SNMP client (gosnmp) runs polls assigned by server; trap listener optional on the elected probe. Data: `snmp_profiles(sysobjectid, oids, mib_refs)`, `agentless_devices`. UI: add device by IP + community/v3 creds; metrics appear like agent metrics.

**R24 Agentless uptime checks.** Check types `icmp`, `tcp`, `http(s)` (status, body match, TLS expiry) executed by the probe agent nearest the target (same subnet preferred). UI: Monitors list with latency charts.

**R27 SMART and capacity forecast.** Agent: smartctl-equivalent via raw ioctl (Linux/Win) or IOKit; reports attributes and health; server fits linear trend on free space to produce `days_until_full`. UI: Storage tab.

**R30/R31 Windows Update install and policies.** Agent: WUA COM (IUpdateSearcher/Downloader/Installer) with progress, plus `wuauclt`-free scheduling; supports hide/unhide, reboot requirement capture. Data: `patch_policies(scope, classifications, include/exclude KBs, rings, deferral_days, maintenance_window, reboot_rules)`, `patch_runs(device_id, policy_id, ts, result, kbs jsonb)`, `patches(kb, title, severity, cve_list, product)`. Server: patch orchestrator resolves effective policy via inheritance (R59), assigns ring membership, schedules jobs, tracks compliance counts aligned to the Windows Update view. UI: Patching area with policies, rings, approvals, device compliance grid.

**R32 Third-party patching.** Data: `catalog_apps(id, name, publisher, detect_rules, install_cmd, uninstall_cmd, update_feed, versions, signatures)`. Server: catalog service pulls from winget/choco/homebrew metadata plus curated manifests; version diff engine decides updates. Agent: executes install/update jobs with detection before and after. UI: Catalog browser, "outdated apps" report.

**R33 Linux/macOS patching.** Agent: apt/dnf/zypper/pacman drivers (list, dry-run, install with lock handling), `softwareupdate` with MDM-less limitations noted. Same policy model as R31 with OS-specific sections.

**R34 Patch compliance and CVE mapping.** Server: nightly import of NVD/CISA KEV feeds; map software inventory (CPE) and missing KBs to CVEs; compute exposure per device. UI: Vulnerabilities tab, KEV filter, compliance report.

**R35 Reboot orchestration.** Agent: tray app prompt with countdown, deferral count/limit, "reboot now" and "schedule tonight"; respects active calls (checks microphone/camera in use). Data: `reboot_requests(device_id, reason, deadline, deferrals_used)`. UI: reboot rules in patch policy; device shows pending reboot and deferral history.

**R36 Firmware/BIOS.** Agent: Dell Command Update CLI, Lenovo System Update, HP Image Assistant, fwupd (LVFS) on Linux; capture power/battery and BitLocker state before flashing (auto-suspend BitLocker, require AC). Data: `firmware(device_id, component, current, available, source)`. UI: Firmware tab with risk gating.

**R37 Patch rollback.** Agent: `wusa /uninstall /kb:` and package-manager downgrade where supported; server triggers rollback playbook when post-patch health drops (B-9). UI: "Roll back" on patch run row.

**R38/R162 P2P distribution.** See B-2. Agent: content-addressed cache directory, LAN peer discovery via the existing multicast/mDNS channel, HTTP range serving to peers with token auth; server issues a signed manifest listing chunk hashes. Data: `blobs(hash, size, refs)`, `peer_cache_state(device_id, hash)`.

**R39-R41 App catalog and package repo.** Data: `packages(id, name, version, os, arch, type: msi|exe|pkg|dmg|deb|rpm|script, blob_hash, install_args, detect_rules, uninstall, requires_reboot)`, `deployments(package_id, target_group, schedule, state)`. Server: upload to object storage, antivirus scan hook, signing verification. Agent: download (via P2P when available), verify hash, install with per-type driver, report detection result. UI: Software area (Catalog, Packages, Deployments), device Software tab with "Install" button.

**R43 Software allow/deny.** Policy section `software_rules(allow|deny|alert, matcher)`; evaluation on inventory change; deny can trigger uninstall playbook. UI: Unwanted Software report.

**R44/R94 Self-service portal.** Tray app (R93) opens a local web view to `/portal` authenticated by device identity plus user SSO; shows approved apps (R39), fixes (playbooks with blast radius 1), password reset (via AD/Entra connector), ticket creation (R98). Data: `self_service_items(tenant_id, kind, target_groups, approval_required)`.

**R46 Script library.** Data: `scripts(id, name, lang: ps|cmd|sh|py|js, body, params schema, os_targets, run_as, timeout, version, signature, approved_by)`, `script_versions`. Server: review workflow, signing with tenant key; agent verifies signature before run. UI: Scripts editor with Monaco, parameter form, "run on selection".

**R47 Scheduled tasks.** Data: `schedules(target_group|device, cron, tz, script_id|playbook_id, params, window, jitter)`. Server: scheduler worker enqueues jobs; agent also stores schedules locally for offline execution and reconciles results on reconnect.

**R48/R49 Automations and runbooks.** Data: `automations(trigger jsonb, conditions jsonb, steps jsonb, blast_radius, approval_rule, version)`, `automation_runs(step results, status)`. Server: workflow engine (durable, step-level retries, timeouts), triggers from events (enroll, alert, tag/field change, webhook, schedule, monitor state). Step types: script, package, patch, service, notify, ticket, wait-for-approval, branch. UI: visual builder with YAML view; run log with per-step output.

**R50 Structured results.** Agent returns `{exit_code, stdout, stderr, json?, artifacts[]}`; artifacts uploaded to object storage. Data: `job_results` searchable; JSON fields indexed. UI: results grid with facets and diff between runs.

**R51 Embedded runtime.** Agent embeds QuickJS (or goja) with a capability API (fs, process, registry, http) gated by per-script permissions declared in the script manifest; Python optional via a downloadable runtime package.

**R53 Toolbox.** Data: `toolbox_items(scope: personal|team|tenant, name, blob_hash, run_args, os)`. Agent: downloads to temp, executes in session context (Backstage or user desktop). UI: Toolbox drawer inside the session shell with search and favorites.

**R54 Spec-as-code.** CLI (`mw`) exports policies/automations/scripts as YAML, `mw diff`, `mw apply`; server validates with the same JSON schema used by the UI forms. GitOps described in B-19.

**R55/R56/R59 Policies with inheritance and drift.** Data: `policies(id, scope_type: tenant|org|site|group|device, scope_id, sections jsonb, enforced bool, priority)`; effective policy computed by merge order tenant > org > site > group > device with `enforced` preventing lower overrides; cached per device with hash. Agent: receives effective policy, applies resources (registry, plist, file, service, config), reports `drift(items[])` every cycle. Server: drift service raises `drift.detected`, auto-remediates when section marked `remediate`. UI: Policy editor with sections, "effective policy" explorer showing the layer that set each key, drift heatmap.

**R57 CIS benchmarks.** Benchmarks shipped as rule packs (YAML) compiled to checks (R17) with evidence capture; levels and profiles selectable; exceptions with expiry. UI: Compliance area with pass/fail per control and evidence export.

**R58 Config enforcement.** Resource model: `registry_value`, `plist_key`, `file`, `service`, `scheduled_task`, `local_group_member`, `firewall_rule`; idempotent apply with before/after capture.

**R60 Compliance reports.** Report templates bound to benchmark results and patch compliance; signed PDF/JSON export with hash chain (R108).

**R61/R114 Local accounts and LAPS.** Agent: local user enumeration, create/disable, group membership, password rotation with policy; store rotated secret in vault (R103) encrypted with tenant KEK. UI: Local Accounts tab; LAPS reveal with reason and audit.

**R63 Warranty alerts.** Extension of R6: alerts at 90/30/7 days; appears in health score.

**R64 Geolocation.** Agent: IP geolocation (server-side), Wi-Fi BSSID triangulation via provider where allowed, GPS on mobile; Data: `locations(device_id, ts, lat, lon, accuracy, source)`. UI: map with clustering; geofence policies (lock, alert, restrict tools) in R123.

**R65/R69/R70 Discovery and probe election.** Agent: ARP/ICMP/mDNS/NetBIOS/SSDP sweep of its subnet when elected; server elects one probe per subnet (most uptime, wired) and rotates on failure. Data: `discovered_hosts(subnet_id, ip, mac, vendor, hostname, open_ports, first_seen, last_seen, managed_device_id?)`. UI: Network area: subnets, discovered hosts, "deploy agent" to unmanaged Windows hosts via WMI/PSExec-style push with stored creds.

**R67 Topology map.** Server: builds graph from ARP/LLDP/SNMP bridge tables; UI: force-directed map with link quality from agent-to-agent probes.

**R68 Agentless devices.** Reuse MeshCentral local-device concept with richer twin: SNMP/HTTP fingerprint, uptime checks, credentials from vault, RDP/SSH/VNC/HTTP relay through nearest agent.

**R74 Backstage tools.** Agent session type `backstage` creating a hidden session context (Windows: separate desktop/session 0 service context; macOS/Linux: root shell plus helper). Tools as typed panels over the same job/stream protocol: Services, Processes (tree, CPU, kill, dump), Registry (browse/edit with undo), Event Viewer (R19 live tail), Task Scheduler, Local Users, Network (connections, netstat), Startup items, Installed apps. UI: session shell tab "Backstage" with split panes.

**R84/R132 Redfish/IPMI and unified OOB.** Server: OOB adapter interface `{power, console, sensors, inventory}` with AMT, Redfish (HTTP), IPMI (RMCP+) implementations executed from the nearest agent or server. Data: `oob_endpoints(device_id, kind, address, creds_ref)`. UI: same Power/Console controls regardless of backend.

**R86 Remote audio/printing.** WebRTC audio track from agent capture (WASAPI loopback/CoreAudio/PulseAudio) when policy allows; remote printing via virtual printer driver that streams PDF to technician browser. Lower priority.

**R87/R128-R131 MDM.** Server: Apple MDM (APNs, DEP/ADE, profiles, DDM), Android Enterprise (EMM API), Windows MDM (CSP via OMA-DM) as separate services sharing the policy model; agent and MDM both feed the same device twin. UI: Enrollment profiles, Profiles library, Apps (VPP). Phase late.

**R88 Session notes/time.** Data: `sessions(id, device_id, tech_id, start, end, tools_used[], recording_ref, notes, ticket_id)`; auto time entry. UI: notes side panel in session shell; session list on device.

**R89 Blank screen/block input.** Agent: Windows blank via dummy display mode and input block (BlockInput plus low-level hook with hotkey escape); macOS via CGDisplay capture; Linux via Xorg/Wayland portal where possible; fallback message overlay. UI: toggles in session toolbar.

**R90 Handoff.** Invite another tech into the session with a context packet (timeline, commands run, notes); transfer ownership; escalate to on-call.

**R92 Technician mobile.** Next.js PWA with push (web push already in MeshCentral), mobile-optimized device cards, alerts inbox, approve/deny JIT requests, remote desktop touch mode.

**R93 Cross-platform tray.** The agent binary ships a `tray` mode (Windows WinUI/Win32, macOS NSStatusBar, Linux AppIndicator) launched per user session by the service; shows status, request help, self-service portal, chat, pending reboots.

**R97 CSAT.** After session end, tray asks 1-5 plus comment; stored on `sessions`; dashboards per tech.

**R98 Ticket from tray.** Tray collects screenshot (user-approved), recent telemetry window and twin snapshot; posts to built-in ticketing (R99) or PSA (R100).

**R99-R101 Ticketing/PSA.** Data: `tickets(id, tenant, org, device_id?, requester, status, priority, assignee, sla_due, source)`, `ticket_events`, `time_entries`. Server: lightweight helpdesk with email-in, playbook hooks (auto-create on alert, auto-close on resolve), PSA connectors (ConnectWise Manage, Autotask, HaloPSA) via connector SDK with bidirectional mapping. UI: Tickets area, device ticket tab, session link.

**R102-R104 Documentation and vault.** Data: `docs(kind: note|runbook|license|cert|domain|contract, body md, fields jsonb, relations[])`, `secrets(id, kek_version, ciphertext, reveal_policy, rotation)` using envelope encryption (tenant KEK in KMS or sealed with server master key). UI: Docs area with templates; secrets reveal with reason + MFA re-prompt; cert/domain expiry auto-discovered from checks.

**R105/R106 Dashboards and reports.** Server: query engine (B-3) exposes a typed query DSL; widgets and reports are saved queries with visualization specs; scheduler renders PDF (headless Chromium) and emails. UI: dashboard grid, report builder.

**R107 Health score.** See B-1: factors (patch, security posture, disk, crashes, backup, warranty, uptime, drift) each with weight and explanation; stored `health(device_id, ts, score, factors jsonb)`.

**R109 QBR.** Report template over tenant trends with narrative generated from the numbers (deterministic templates first, LLM optional).

**R110 Energy/carbon.** See B-15.

**R112 FileVault/LUKS.** Agent: `fdesetup status`, personal recovery key escrow via MDM or local rotation; LUKS status via `cryptsetup status`. Escrow stored in vault with reveal audit.

**R113 Firewall rules.** Agent: Windows Firewall rule listing (netsh/WFP), ufw/nftables, pf; policy resource `firewall_rule`; drift detection.

**R117 Custom roles / ABAC.** Data: `roles(name, permissions[])` with permission strings like `device.remote.desktop`, `patch.approve`; `assignments(user|group, role, scope: tenant|org|site|group|device)`; posture conditions (R123). Server: policy decision point with cached decisions; every API route declares required permission. UI: Roles editor with scope matrix.

**R120 Vulnerability scanning.** See R34; plus EDR integrations (Defender for Endpoint, CrowdStrike, Rapid7, Tenable) to import findings (Action1 pattern).

**R121 Hardening posture.** Agent: Secure Boot (UEFI var), TPM (Get-Tpm/tpm2-tools), SIP/Gatekeeper, SELinux/AppArmor, screen lock timeout, auto-login off, guest account; posture doc feeds R123 and the health score.

**R122 USB control.** Policy resource `usb_policy(allow classes, deny storage, exceptions with expiry)`; Windows via Device Installation Restrictions/WPD policies, macOS via MDM profile, Linux via udev rules; audit `peripheral.connected` events.

**R123 Zero-trust gating.** See B-17.

**R124 Four-eyes approvals.** Data: `approvals(action_ref, risk_score, requested_by, approver_rule, status, expires)`; actions above risk threshold (B-5) pause until approved; approvers notified via channels; UI inbox.

**R126 Backup monitoring.** Agent: parsers for Veeam Agent/B&R events, Acronis logs, Windows Server Backup (wbadmin), Time Machine (tmutil), restic/borg logs; emits `backup.result` with freshness; integrations for cloud backup vendors via API. UI: Backup tab and fleet freshness report.

**R134 Hierarchy.** Data: `orgs(tenant_id, parent_id, kind: msp|client|site)`; groups belong to a site; every device has `org_id`, `site_id`; RLS keyed on tenant with org scoping in the permission layer. UI: tree navigator left rail; breadcrumbs.

**R136 Client portal.** Separate Next.js route group `/portal` with client-scoped roles: device list, health, tickets, approvals (JIT, change windows), reports, invoices export. Branded per client domain.

**R137 Status page.** Public page per tenant/org fed by monitors with manual incidents; `status_components`, `incidents`. Optional custom domain.

**R138 Metering.** Usage counters per org (devices, sessions, storage, bandwidth, energy) exported as CSV/JSON and via API.

**R140 REST/OpenAPI.** Server: tRPC or Zod-defined routes with generated OpenAPI 3.1; API keys with scopes and rate limits; audit of API calls. UI: Developer settings with key management and interactive docs.

**R141 Webhooks.** Data: `webhooks(url, secret, event_filters, retries)`, `webhook_deliveries` with signed payloads (HMAC, timestamp), replay, dead-letter view. Inbound webhooks as automation triggers (Level pattern).

**R142 Extensions.** Extensions declare manifest (permissions, UI slots, server hooks); run server-side in isolated workers (isolated-vm) and UI-side in sandboxed iframes with postMessage API; signed and installable from a registry.

**R144 IaC.** Terraform provider over the REST API for tenants, orgs, policies, roles, webhooks; YAML specs via CLI (R54).

**R145-R149 AI.** Server: `ai_gateway` abstracting providers (bring-your-own key), strict tool-calling only over the typed query engine, script generator with mandatory dry-run and reviewer approval, session summarizer over transcripts/recordings metadata, patch-risk model trained on fleet outcomes, remediation agent constrained by playbooks and blast radius. Details in B-3, B-4, B-5, B-9, B-13.

**R151 Railway/PaaS.** Single Node process serving Next.js + WebSocket + workers (worker mode selectable by env), `PORT` from env, Postgres and Redis as Railway plugins, Railway volume mounted for small assets, S3-compatible bucket (Cloudflare R2/Backblaze) for recordings and packages, health endpoint `/healthz`, migrations run at boot with advisory lock, `railway.json` template. Agent connects to the public Railway domain over WSS 443 only (no extra ports), so relays and WebRTC signaling share the single port; TURN optional via external provider.

**R152/R153 VPS and Windows/RDP host.** `install.sh` (Docker Compose with Caddy auto-TLS, Postgres, Redis, MinIO optional) and `install.ps1` (Windows service via WinSW/NSSM wrapper or native service in Go sidecar, Postgres bundled or external, Caddy for TLS). Both register automatic backups (R127) and expose the same single HTTPS port.

**R157 Kubernetes.** Later: Helm chart with HPA on stateless web/relay pods, Redis, Postgres operator.

**R160 Tamper protection.** Agent: service recovery actions, protected process light where available, uninstall password embedded as hash, watchdog peer process, signed config; tamper events reported and fed to posture.

**R161 Offline queue.** Jobs persisted server-side with TTL and idempotency key; agent keeps a local journal for schedules and partial results; reconciliation protocol on reconnect (ack ranges).

**R164 Signing.** Build pipeline: Authenticode (EV or OV cert, RFC3161 timestamp), Apple Developer ID + notarization + stapling, Linux detached signatures and repo GPG; reproducible builds with SLSA provenance published to a transparency log.

**R165/R166 Installer outputs (external installer builder).** See section 5.2. Formats: MSI (WiX, with properties for tenant/site/token), EXE bootstrapper, PKG and DMG (pkgbuild/productbuild, notarized), DEB/RPM (nfpm), APK, plus shell/PowerShell one-liners. Enrollment token embedded as a signed JWT bound to tenant, org/site, group, expiry and max-uses; installer shows a QR/deep link to the admin panel device page after enrollment.

**R172-R178 UI.** Next.js App Router, React Server Components for lists, client components for sessions; design tokens (dark-first), Radix primitives, Tailwind; command palette (cmd-k) with actions and NL queries; session shell with tabbed Desktop/Terminal/Files/Backstage/Chat/Notes and split view; presence via Redis pub/sub showing avatars on device rows; widgets bound to saved queries; full PWA.

---

## 4. Beyond the market: think outside the box (30 ideas)

**B-1 Explainable health score.** Each device gets a 0-100 score computed from weighted factors (patch currency, posture, disk forecast, crash rate, backup freshness, warranty, drift, uptime) with every factor exposing its contribution and the exact evidence rows behind it. Clicking a factor opens the fix (playbook, patch run, reboot) so the score is actionable, not decorative. Weights are per tenant and the score is versioned so trend lines remain comparable.

**B-2 P2P patch and package distribution.** The server publishes a signed manifest of content-addressed chunks; agents on the same subnet discover each other over the existing multicast channel and serve chunks over authenticated HTTP ranges. A site with 200 laptops pulls a 2 GB update from the WAN once; the server only tracks which peers hold which hashes and prefers wired, AC-powered peers as seeders.

**B-3 Natural-language fleet queries that compile to a typed query.** A query engine exposes a safe DSL over inventory, metrics, checks and results; an LLM translates "laptops in Berlin with less than 10% disk that rebooted this week" to the DSL, which is shown, validated and run (never raw SQL). Saved NL queries become dynamic groups, dashboard widgets, report sources and automation targets, so the same primitive powers four features.

**B-4 Auto-remediation playbooks with blast-radius limits.** Every automation declares a blast radius (max devices per run, per hour, per org, canary percentage, required health-score delta between waves) and halt conditions (failure rate, new alerts, reboot storms). The workflow engine executes canary > wave 1 > wave N, pauses automatically when the halt condition trips and requests human approval to continue. Atera-style autonomy becomes safe enough for servers, not only password resets.

**B-5 Change-risk scoring.** Before a command, script, patch or policy applies, a scorer estimates risk from target count, device roles (server, DC, kiosk), time of day, business hours of the site, history of that script on similar devices, and destructive-token heuristics (rm -rf, Remove-Item -Recurse, format, reg delete). Scores above thresholds require four-eyes approval or canary; the terminal shows a risk hint inline before Enter.

**B-6 Device twin timeline.** Every inventory section is snapshotted on change with diffs, so a device page has a scrubbable timeline: "what changed between the last good state and the first alert". Incidents automatically link to the diffs in the preceding 24 hours and the UI offers "revert this change" where a resource is policy-managed.

**B-7 Baseline-relative monitoring.** Instead of fixed thresholds, checks can be expressed as deviations from the device's own seasonal baseline (weekday/hour bands); a 70% CPU on a render box is normal while 40% on a receptionist PC at 2 a.m. is not. Baselines are shown as bands on the metric graphs so technicians trust the alert.

**B-8 Drift heatmap and policy simulation.** The policy editor shows a live simulation ("applying this would change 212 devices: 180 registry values, 32 services") before saving, and a heatmap of drift by policy section across sites. Enforced sections remediate automatically; others just report, and the heatmap tells you which to flip to enforce.

**B-9 Ring promotion gated by health deltas and automatic rollback.** Patch rings promote only when the previous ring's health score and crash/alert rates did not degrade beyond a tenant threshold for N hours; a degradation triggers automatic rollback (uninstall KB, downgrade package) on the affected ring and a pause on the rest. Patch risk intelligence is learned from the fleet's own outcomes, not only vendor data.

**B-10 Session co-browsing with end user.** Rather than taking over, the technician can enter "guide" mode: the user keeps control, the tech draws arrows and highlights on an overlay and can request control for one action. The tray app shows exactly what the tech can see, which raises consent quality and lowers support friction.

**B-11 Continuous end-user chat thread.** Chat between tray app and console is a persistent thread per user-device pair, bound to tickets and sessions, with offline delivery and read receipts; technicians can push buttons into chat ("Reboot now", "Install Zoom") that run blast-radius-1 playbooks when tapped.

**B-12 Firmware and BIOS management with safety interlocks.** Firmware jobs check AC power, battery level, BitLocker suspension, pending Windows updates and free disk before flashing, keep the previous image for vendors that support rollback, and run in a dedicated ring with a mandatory canary. Firmware currency becomes a security-posture factor.

**B-13 AI session summaries and command transcripts.** Every session produces a structured transcript (commands run, files touched, services changed, duration per tool); an LLM drafts the session note and ticket update from that structured data, and the recording player lets you jump to the moment a specific command ran. Notes are editable and the model never sees screen pixels unless the tenant enables it.

**B-14 Reboot windows learned from activity.** The agent observes idle patterns per device (input idle, screen locked, no calls) and proposes a per-device "best reboot window" with confidence; patch policies can target "learned window" instead of a fixed hour, reducing deferrals.

**B-15 Energy and carbon reporting.** Agents sample power state, CPU package power (RAPL/ETW/IOKit) and display on-time; the server converts to kWh with device-class models and to CO2e using regional grid intensity by site location. Reports show cost and carbon per org with "sleep policy would save X" simulations.

**B-16 JIT access, credential vault and auto-revoke.** Remote sessions, local-admin reveals (LAPS) and vault secrets are granted just-in-time with a reason, an approver rule, a TTL and automatic revocation; secrets are injected into RDP/SSH relays without being shown. Every reveal is a signed audit record with session linkage.

**B-17 Zero-trust device posture gating.** The technician's own workstation posture (agent present, disk encrypted, OS patched, EDR healthy, MFA used) is evaluated before allowing high-risk actions; a technician on a non-compliant laptop can view but not control. The same gate can be exposed to third-party apps as a posture signal (SSO claim).

**B-18 Restore rehearsal mode.** Server backups are periodically restored into an ephemeral instance (container) and smoke-tested (login, device count, open a recording) automatically; the dashboard shows "last proven restorable" rather than "last backed up".

**B-19 GitOps for RMM policy.** Policies, automations, scripts and roles are exportable as YAML; a Git repo can be connected so pull requests show `mw diff` output and merges apply with the blast-radius engine. Level's CLI spec idea extended to the whole configuration surface with review and rollback history.

**B-20 Every agent is a probe.** No appliance: per subnet, the server elects one agent as the probe for discovery, SNMP, ping/HTTP checks and WoL, rotating on failure; secondary probes verify outages so an alert says "device down (confirmed by 2 peers)" vs "probe lost".

**B-21 Chaos and self-test mode.** A tenant can schedule self-tests: kill the agent and verify the watchdog restarts it, block the server and verify the offline queue replays, simulate a disk-full check and verify the alert route fires, restore a backup (B-18). Results feed a "platform assurance" score shown next to the device health score.

**B-22 Shadow-IT and software graph.** Fleet-wide normalized software graph (publisher, product, version, CPE) across tenants (anonymized counts) enables "this app is on 3% of your fleet and 0.1% of similar fleets", unwanted-software detection and CVE mapping without per-tenant catalog work.

**B-23 Outage attribution.** When devices go offline, the server correlates by site, ISP ASN, server region and peer-probe reachability to label the outage (device, site network, ISP, platform) and suppresses hundreds of duplicate alerts into one incident.

**B-24 Browser-only port mapping.** Replace a native router app with WebTransport/WebRTC data channels so a technician can open an RDP/SSH/HTTP tunnel to a LAN host from the browser without installing anything; fallback to the native client stays available.

**B-25 Technician handoff context packet.** Transferring a session or escalating sends a machine-readable packet: twin diffs, commands run, results, notes, open alerts, and the recording timestamp, rendered as a one-screen briefing for the next technician.

**B-26 Acknowledgement-tracked announcements.** Broadcast messages to users (via tray) record acknowledgement, allow "remind me later" and report compliance (useful for policy notices or scheduled maintenance), replacing email blasts.

**B-27 Tamper-evident audit log.** Audit events are hash-chained and periodically anchored (publish the chain head to an external store or transparency log) so an attacker with DB access cannot silently edit history; auditors verify integrity with a CLI.

**B-28 Device-aware reboot and maintenance negotiation.** Servers hosting VMs, DCs, print servers and kiosks declare dependencies; the orchestrator sequences reboots (VMs before hosts, secondary DC before primary) and refuses conflicting windows, with a Gantt view of the plan.

**B-29 Installer that links back to the console.** The external installer builder produces branded packages bound to tenant/site/group; after enrollment the installer displays a QR code and deep link to the device's page in the admin panel, and the admin panel shows a live "waiting for enrollment" card for tokens issued in the last hour.

**B-30 Multi-agent LAN quality mesh.** Agents on a site periodically exchange small probes to measure RTT/jitter/loss between them and to the gateway, producing a site network-quality map that explains "VoIP is bad on floor 2" without any switch access.

---

## 5. Prioritized module list with dependencies

### 5.1 Phases and modules

Legend: P0 = foundation (nothing ships without it), P1 = parity with MeshCentral plus table-stakes RMM, P2 = modern RMM parity, P3 = differentiators, P4 = expansion. Dependencies name modules by id.

| Id | Module | Phase | Depends on | Notes |
|---|---|---|---|---|
| M01 | Core platform: Next.js app, auth (local + passkeys + TOTP + SSO OIDC/SAML), tenants/orgs/sites/groups, custom roles (ABAC-ready), audit log (hash-chained) | P0 | - | Rows 115-118, 133-134, 108, 117 |
| M02 | Data layer: Postgres schema, RLS, migrations, Redis pub/sub, object storage, job queue with offline semantics, events bus | P0 | M01 | Rows 161, universal `jobs` |
| M03 | Agent core (Go): identity/enrollment, TLS pinning, WSS transport, module registry, self-update, tamper protection, local journal, tray mode shell | P0 | M02 | Rows 159-161, 163, 167, 170-171 |
| M04 | Installer builder (external service): MSI/EXE/PKG/DMG/DEB/RPM/APK, branding, signed enrollment tokens, deep link to console, enrollment status cards | P0 | M01, M03 | Rows 165-166, B-29, section 5.2 |
| M05 | Deployment kits: Docker image, Railway template, VPS install.sh (Caddy), Windows service install.ps1, backups to S3/WebDAV, health endpoints | P0 | M01, M02 | Rows 150-153, 127 |
| M06 | Inventory and device twin: hardware/OS/software/network/users/printers/peripherals, snapshots and diffs, custom fields, dynamic groups | P1 | M02, M03 | Rows 1-14, B-6 |
| M07 | Remote session shell: desktop (WebRTC + relay), terminal, files, clipboard, multi-monitor, consent and privacy, recording and player, multi-tech, guest/JIT links | P1 | M03, M02 | Rows 71-73, 75-78, 89, 91 |
| M08 | Backstage tools: services, processes, registry, event viewer, scheduler, users, network, startup | P1 | M07, M06 | Row 74 |
| M09 | Commands, scripts library, scheduled tasks, structured results, toolbox | P1 | M02, M03 | Rows 45-47, 50, 53 |
| M10 | Telemetry and monitoring: metrics time-series, checks, service/process/event-log monitors, alert manager (dedup, escalation, maintenance), channels | P1 | M02, M03, M06 | Rows 15-22, 25, 27 |
| M11 | Notifications and chat: channel adapters (email/SMS/Telegram/Discord/Slack/ntfy/Pushover/web push), tray chat thread, announcements | P1 | M01, M03 | Rows 21, 85, 95-96, B-11, B-26 |
| M12 | Policies engine: inheritance tenant>org>site>group>device, enforced sections, resources, drift detection, effective-policy explorer, simulation | P2 | M06, M09 | Rows 55-59, B-8 |
| M13 | Patching: Windows Update install, Linux/mac, patch policies and rings, reboot orchestration, compliance, rollback | P2 | M12, M09, M10 | Rows 29-38, B-9, B-14 |
| M14 | Software deployment: package repo, app catalog, winget/choco/brew, self-service portal, allow/deny | P2 | M12, M09, M04 | Rows 39-44, 94 |
| M15 | Automations and runbooks: triggers, conditions, steps, approvals, blast radius, change-risk scoring | P2 | M09, M10, M12 | Rows 48-49, 124, B-4, B-5 |
| M16 | Query engine and dashboards: typed DSL, saved queries, widgets, reports, health score | P2 | M06, M10, M13 | Rows 105-107, B-1, B-3 |
| M17 | REST/OpenAPI, API keys, webhooks in/out, CLI with spec diff/apply, extensions SDK | P2 | M01, M02 | Rows 139-142, 144, B-19 |
| M18 | Security posture: AV/EDR, encryption escrow, firewall, hardening, vulnerabilities/KEV, USB control, LAPS, vault | P2 | M06, M12, M10 | Rows 111-114, 120-122, 103, B-16 |
| M19 | Network: discovery, probe election, SNMP, agentless devices, uptime checks, topology | P3 | M03, M10 | Rows 23-24, 65-70, B-20, B-30 |
| M20 | Ticketing and PSA: lightweight helpdesk, session notes/time, CSAT, PSA connectors, docs | P3 | M11, M07, M17 | Rows 88, 97-104 |
| M21 | P2P distribution and LAN cache | P3 | M14, M13, M03 | Row 38/162, B-2 |
| M22 | OOB: Intel AMT (parity), Redfish, IPMI, IP-KVM | P3 | M07, M19 | Rows 82-84 |
| M23 | AI layer: gateway, NL queries, script generation with dry-run, session summaries, patch risk, remediation agent | P3 | M16, M15, M07, M13 | Rows 145-149, B-13 |
| M24 | Zero-trust gating, four-eyes approvals, geofencing, status page, client portal, metering | P3 | M18, M15, M01 | Rows 123-124, 64, 136-138, B-17 |
| M25 | Firmware/BIOS, backup monitoring, energy/carbon, warranty, asset lifecycle | P4 | M13, M10, M06 | Rows 5-6, 36, 126, 110, B-12, B-15 |
| M26 | MDM (Apple, Android Enterprise, Windows CSP), iOS | P4 | M12, M04 | Rows 128-131 |
| M27 | Kubernetes/Helm, HA multi-node | P4 | M05 | Rows 156-157 |
| M28 | Chaos/self-test, restore rehearsal, GitOps | P4 | M05, M15, M17 | B-18, B-21, B-19 |

### 5.2 Dependency graph (text)

```
M01 core -> M02 data -> M03 agent -> M04 installer builder
                     \-> M05 deploy kits
M03 + M02 -> M06 inventory -> M12 policies -> M13 patching -> M21 P2P
M03 + M02 -> M07 sessions  -> M08 backstage
M02 + M03 -> M09 scripts   -> M15 automations (also needs M10, M12)
M02 + M03 + M06 -> M10 monitoring -> M19 network -> M22 OOB
M01 + M03 -> M11 notifications/chat -> M20 ticketing (also M07, M17)
M06 + M10 + M13 -> M16 query/dashboards/health -> M23 AI (also M15, M07, M13)
M12 + M09 + M04 -> M14 software deployment -> M21 P2P
M06 + M12 + M10 -> M18 security posture -> M24 zero-trust/portal
M01 + M02 -> M17 API/webhooks/CLI -> M20, M28
M13 + M10 + M06 -> M25 firmware/backup/energy/warranty
M12 + M04 -> M26 MDM
M05 -> M27 k8s/HA ; M05 + M15 + M17 -> M28 chaos/GitOps
```

### 5.3 Why this order

- P0 front-loads the three things MeshCentral makes painful to change later: a real tenant/org hierarchy with custom roles, a universal offline-capable job queue, and an external installer builder that binds packages to tenant/site and links back to the console (the user's explicit requirement). Deployment kits are P0 because Railway, VPS and Windows/RDP hosting shape the architecture (single port, env config, object storage for recordings).
- P1 reaches MeshCentral parity on the things it does best (sessions, backstage-style tools, scripts, inventory) while adding the monitoring and alerting it lacks; this is the first shippable product.
- P2 adds the modern-RMM table stakes that MeshCentral has none of (policies with inheritance, patching, software deployment, automations, API, posture) and the query engine that the dashboards, health score and later AI all build on.
- P3 and P4 are the differentiators and expansions whose value depends on the P2 primitives existing (blast-radius automations need policies and monitoring; P2P needs packages; AI needs the typed query engine and structured results).

### 5.4 Hosting and installer notes tied to the user request

- **Railway:** one web service (Next.js + WS + workers in-process by default), Railway Postgres and Redis plugins, an S3-compatible bucket for recordings/packages, `PORT` honored, `/healthz`, migrations on boot under an advisory lock, no second port (agents, relays and WebRTC signaling share 443; TURN external). A `railway.json` template and a "Deploy on Railway" button in the README.
- **VPS:** `curl -fsSL .../install.sh | bash` sets up Docker Compose with Caddy auto-TLS, Postgres, Redis, optional MinIO, nightly backups to S3/WebDAV, and prints the admin URL and first-login token.
- **Windows / RDP host:** `install.ps1` installs the server as a Windows service (Go sidecar or WinSW), bundles PostgreSQL or points at an external one, uses Caddy for TLS, and registers scheduled backups; the same single HTTPS port is used.
- **External client installer:** a separate "Installer Builder" service (can be the same deployment or a build worker) renders MSI/EXE/PKG/DMG/DEB/RPM/APK with tenant branding, embeds a signed enrollment token (tenant, org/site, group, expiry, max uses), signs/notarizes with tenant or platform certificates, and publishes download links and one-liners from the admin panel's "Deploy agent" page. After install the agent's tray shows "Enrolled - open in console" with a deep link and QR to the device page; the admin panel shows a live enrollment card for recent tokens.
- **UI bar:** dark-first design system, session shell with tabbed Desktop/Terminal/Files/Backstage/Chat/Notes and split view, cmd-k palette that runs fleet actions and NL queries, presence avatars on device rows, widgets bound to saved queries; these are the concrete items that put the UI ahead of ScreenConnect's host page and MeshCentral's Handlebars UI.

---

## 6. Sources consulted (web, October 2026)

- ScreenConnect: [Backstage](https://www.screenconnect.com/blog/backstage), [Remote support](https://www.screenconnect.com/remote-support-software), [Screen capture menu / Extended Auditing](https://docs.connectwise.com/ScreenConnect_Documentation/Get_started/Host_client/Screen_capture_menu), [2025.7 release notes](https://docs.connectwise.com/ScreenConnect_Documentation/ScreenConnect_release_notes/ScreenConnect_2025.7_Release_notes), [25.8](https://screenconnect.product.connectwise.com/communities/26/topics/5010-screenconnect-258), [25.9](https://screenconnect.product.connectwise.com/communities/26/topics/5038-screenconnect-259), [ScreenConnect review 2026](https://www.flamingo.run/blog/connectwise-screenconnect-review)
- NinjaOne: [ninjaone.com](https://www.ninjaone.com/), [Endpoint management FAQs](https://www.ninjaone.com/endpoint-management/faqs/), [NinjaOne review 2026](https://www.flamingo.run/blog/ninjaone-review), [Capterra NinjaOne](https://www.capterra.com/p/184229/NinjaOne/)
- Datto RMM: [Capterra Datto RMM](https://capterra.com/p/213158/Datto-RMM/reviews/), [G2 Datto RMM features](https://g2.com/products/datto-rmm/features)
- N-able: [AI announcement Jan 2026](https://www.businesswire.com/news/home/20260129759774/en/N-able-Ushers-in-New-Era-of-Business-Resilience-Fueled-by-AI), [Developer portal](https://www.businesswire.com/news/home/20250130871047/en/5779528/N-able-Furthers-Open-Ecoverse-Vision-with-Launch-of-AI-Powered-Developer-Portal%E2%80%94Accelerating-API-Integrations-for-Faster-Seamless-IT-and-Security-Services-Delivery), [Q4 2025 call](https://finance.yahoo.com/news/n-able-nabl-q4-2025-151916689.html)
- Atera: [TechRadar review](https://techradar.com/pro/atera-review), [Atera on Wikipedia (Robin rebrand)](https://en.wikipedia.org/wiki/Atera_Networks)
- Action1: [CB Insights Action1](https://www.cbinsights.com/company/action1), [Capterra Action1](https://capterra.com/p/180609/Action1-RMM/reviews/)
- Automox / Syncro / Addigy: [Automox visibility and reporting](https://markets.financialcontent.com/concordmonitor/article/gnwcq-2025-7-15-automox-equips-it-teams-to-act-with-high-impact-visibility-and-reporting), [Automox device attributes](https://markets.financialcontent.com/ms.intelvalue/article/gnwcq-2025-5-6-automox-surfaces-hundreds-of-device-attributes-to-accelerate-cross-platform-visibility-and-action), [Syncro XMM](https://markets.financialcontent.com/concordmonitor/article/bizwire-2025-4-29-syncro-launches-xmm-unified-it-and-security-management-platform-with-microsoft-integration), [Addigy app catalog](https://www.businesswire.com/news/home/20250701156114/en/Addigy-Unveils-Industrys-Only-Prebuilt-App-Catalog-for-Real-time-Automated-macOS-App-Management), [Addigy 2026](https://www.businesswire.com/news/home/20260225670929/en/MSPs-and-Enterprise-IT-Leaders-Accelerate-Adoption-of-Addigy-to-Secure-Apple-Fleets-at-Scale)
- Level: [level.io](https://level.io/), [RMM feature checklist](https://level.io/features/rmm-feature-checklist), [Getting started](https://docs.level.io/en/articles/9922664-getting-started-with-level), [Device details](https://docs.level.io/en/articles/9927515-device-details), [Remote control approval](https://docs.level.io/en/articles/9927385-remote-control-approval)
- Tactical RMM: [Automation policies](https://docs.tacticalrmm.com/functions/automation_policies/), [Checks](https://docs.tacticalrmm.com/functions/automated_checks/), [Alerting](https://docs.tacticalrmm.com/functions/alerting/), [How it works](https://docs.tacticalrmm.com/howitworks/)
- TeamViewer: [TeamViewer AI label (PR)](https://www.prnewswire.com/de/news-releases/teamviewer-bundelt-ki-funktionen-unter-neuem-label-teamviewer-intelligence-fur-effizientere-it-support-prozesse-302495975.html), [1M AI sessions](https://www.prnewswire.com/de/news-releases/teamviewer-surpasses-one-million-ai-sessions-in-major-adoption-milestone-302730082.html), [TeamViewer on Wikipedia](https://en.wikipedia.org/wiki/TeamViewer)
- RustDesk: [rustdesk-server-pro on Docker Hub](https://hub.docker.com/r/rustdesk/rustdesk-server-pro)
- Market: [Tanium 2026 Gartner MQ](https://www.businesswire.com/news/home/20260105723180/en/Tanium-Named-a-Leader-in-the-2026-Gartner-Magic-Quadrant-for-Endpoint-Management-Tools), [Jamf 2026 Gartner MQ](https://www.malaymail.com/news/money/mediaoutreach/2026/01/19/jamf-named-a-leader-in-the-2026-gartner-magic-quadrant-for-endpoint-management-tools/444173), [UEM market forecast](https://www.globenewswire.com/fr/news-release/2026/01/05/3212526/0/en/Unified-Endpoint-Management-Market-to-Surpass-USD-27-63-Billion-by-2033-Driven-by-Rising-Mobile-Workforces-and-Endpoint-Security-Needs-SNS-Insider.html)
- MeshCentral: local source tree `scratchpad/meshcentral-src` (v1.2.6), [MeshCentral repo](https://github.com/Ylianst/MeshCentral), [Docs repo](https://github.com/Ylianst/MeshCentralDocs/tree/main)
