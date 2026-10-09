# MagicWand RMM feature matrix

What a technician can do from the admin panel, per operating system, and what is still planned. Legend: **✅ done** (shipped and exercised against a live agent), **🟡 partial** (code paths exist for the OS but have not been run on real hardware yet, or cover a subset), **📋 planned** (designed, not built). Every action is permission-gated (`lib/rbac/permissions.ts`), audited, and runs as SYSTEM/root unless marked *as user*.

## Remote access

| Capability | Windows | Linux | macOS | Notes |
|---|---|---|---|---|
| Interactive terminal (real PTY: colours, tab completion, vim/top) | 🟡 ConPTY (PowerShell, pwsh, cmd) | ✅ bash/zsh/sh | 🟡 zsh/bash | `/devices/:id/terminal`. Streams through the server; replay buffer for late viewers; every session recorded with who/when/how long/bytes in `/remote`. |
| Terminal *as the signed-in user* | 🟡 `WTSQueryUserToken` | ✅ `setuid` to console user | 🟡 console user via `scutil` | Needs `remote.desktop_control`. |
| One-shot command console (job-backed, offline-queued) | ✅ | ✅ | ✅ | `/devices/:id/console`, risk analyser for destructive commands. |
| File browser: browse, preview, upload, download, mkdir, rename, delete | ✅ | ✅ | ✅ | `/devices/:id/files`. |
| Process manager: list, sort, kill, kill tree | ✅ | ✅ | ✅ | `/devices/:id/processes`. |
| Network tools: ping, traceroute, port check, DNS, interfaces, listeners | ✅ | ✅ | ✅ | `/devices/:id/network`. |
| Screenshot of the user's display | 🟡 GDI capture | ✅ `import`/`scrot`/`gnome-screenshot` | 🟡 `screencapture` | Actions → Take screenshot. Audited. |
| Remote desktop (view/control, multi-monitor, clipboard) | 📋 | 📋 | 📋 | Gate page exists; needs a frame-capture + input-injection relay. Plan: WebRTC via the existing stream multiplexer. |
| TCP tunnels (RDP/SSH/VNC through the agent) | 📋 | 📋 | 📋 | Permission `remote.tunnel` already defined. |
| Guest share links / technician hand-off | 📋 | 📋 | 📋 | `remote.share`. |
| Session recording playback | 📋 | 📋 | 📋 | Terminal bytes are already counted; store + replay is next. |

## Unlocking and account recovery

| Capability | Windows | Linux | macOS | Notes |
|---|---|---|---|---|
| Unlock a locked-out local account | 🟡 `Enable-LocalUser` + lockout clear | ✅ `faillock --reset` / `pam_tally2`, `usermod -U` | 🟡 `pwpolicy -clearaccountpolicies` | Users tab → ⋯ → Unlock account. |
| Reset a local password (+ require change at next sign-in) | 🟡 `Set-LocalUser` via stdin | ✅ `chpasswd` + `chage -d 0` | 🟡 `dscl . -passwd` | Password sent once over the authenticated channel, redacted from the audit log. |
| Enable / disable sign-in | 🟡 | ✅ | 🟡 | Blocked for the currently signed-in user. |
| Make / remove local administrator | 🟡 `Administrators` group | ✅ `sudo`/`wheel` | 🟡 `admin` group | |
| Create / delete local account | 🟡 | ✅ | 🟡 | Home folder kept on delete. |
| Unlock the desktop session (the lock screen) | 📋 needs a credential provider | ✅ `loginctl unlock-sessions` | 📋 not possible without user credentials | Actions → Unlock desktop session (shown only when the agent reports `session_unlock`). |
| Rotate local admin passwords on a schedule (LAPS-style) with vault reveal | 📋 | 📋 | 📋 | `managed` flag + `vault.*` permissions exist. |
| Lock screen / log off / message the user | ✅ | ✅ | ✅ | Actions menu, job-backed. |

## Inventory and configuration

| Capability | Windows | Linux | macOS | Notes |
|---|---|---|---|---|
| Hardware, OS, network, disks, telemetry (CPU/RAM/disk/net) | ✅ | ✅ | ✅ | Overview tab, 24 h charts. |
| Installed software inventory with change tracking | ✅ registry/MSI/winget/store | ✅ dpkg/rpm/snap/flatpak | ✅ apps/brew/pkg | Software tab; timeline shows installs/removals. |
| Install software silently | 🟡 winget, Chocolatey, MSI/EXE from URL (+SHA-256) | ✅ apt/dnf/zypper, snap, flatpak, .deb/.rpm from URL | 🟡 brew, cask, .pkg from URL | Software tab → Install package. Job-backed, offline-queued. |
| Uninstall software | 🟡 uninstall string / winget / choco | ✅ package manager | 🟡 brew / app bundle | Software tab → ⋯ → Uninstall. |
| Services / daemons: start, stop, restart, startup type | 🟡 `Set-Service` | ✅ systemd (`enable/disable`) | 🟡 `launchctl` | Services tab row menu; the row updates from the live result. |
| Scheduled tasks / cron / launchd: list, run now, enable, disable | 🟡 Task Scheduler | ✅ crontabs + `/etc/cron.d` + systemd timers | 🟡 launchd | Tasks tab. |
| Event logs / journal / unified log with filters | 🟡 `Get-WinEvent` | ✅ `journalctl` + `/var/log` fallback | 🟡 `log show` | Logs tab (source, level, since, search). |
| Registry browser and editor | 🟡 all hives, typed values, audited writes | n/a | n/a | Registry tab (Windows only). |
| Security posture (AV, firewall, encryption, Secure Boot, TPM, UAC, screen lock, RDP, SMBv1, Gatekeeper, SIP, SSH root) | ✅ | ✅ | ✅ | Security tab, 0-100 score, findings feed alerts. |
| Local administrators and listening ports | ✅ | ✅ | ✅ | Security tab. |
| Custom fields, tags, sites, groups | ✅ | ✅ | ✅ | |
| Configuration profiles / MDM (Wi-Fi, certificates, restrictions) | 📋 | 📋 | 📋 | macOS needs an MDM push certificate; Windows via CSP/Intune bridge. |
| Group Policy / registry-based policy packs | 📋 | n/a | n/a | Build on `registry_set` + policies module. |
| Printer management (list, add, remove, default, clear queue) | 📋 | 📋 | 📋 | `Get-Printer` / CUPS. |
| Mapped drives, shares, certificates, browser extensions | 📋 | 📋 | 📋 | |
| Bitlocker / FileVault / LUKS key escrow | 📋 | 📋 | 📋 | Posture already reports encryption state. |

## Patching and updates

| Capability | Windows | Linux | macOS | Notes |
|---|---|---|---|---|
| Patch scan | 🟡 Windows Update COM API | ✅ apt / dnf / zypper | 🟡 `softwareupdate -l` | Device Patches tab → Scan now; fleet view `/patches`. |
| Install selected / all updates, reboot flag | 🟡 WUA download+install | ✅ | 🟡 | Device tab and fleet drill-down ("install on the N devices missing it"). |
| Fleet compliance tiles, grouped-by-update table, filters, canary rollouts | ✅ | ✅ | ✅ | `/patches`. |
| Third-party application patching (browsers, runtimes) | 📋 | 📋 | 📋 | Reuse `software_install` with a catalog of latest versions. |
| Patch policies: approval rules, maintenance windows, deferrals, reboot prompts | 📋 | 📋 | 📋 | Schema rows (`approved`, `deferred`, `rejected`) exist. |
| Driver and firmware updates | 📋 | 📋 | n/a | |
| CVE mapping / vulnerability view | 📋 | 📋 | 📋 | `cveIds` column is populated where the source provides it. |

## Fleet operations

| Capability | Status | Notes |
|---|---|---|
| Durable, offline-queued jobs with per-device runs, output, exit codes | ✅ | Every action is a job: console, scripts, power, software, patches, WOL. |
| Canary rollouts (first wave, automatic promotion on clean result) | ✅ | Jobs wizard, fleet patching. |
| Script library (PowerShell, bash, zsh, Python) with editor and parameters | ✅ | |
| Bulk actions from the devices list, saved filters, attribute targeting | ✅ | |
| Wake-on-LAN via a peer device on the same subnet | ✅ | Device header → Wake. |
| Alerts with severity, snooze, bulk ops, device drill-down | ✅ | Posture findings and job failures raise alerts. |
| Live timeline per device (boots, sign-ins, software, jobs, alerts) | ✅ | |
| Agent deployment page (per-OS installers, enrollment tokens) | ✅ | |
| Automations (event → action), monitoring thresholds, schedules | 🟡 | Modules and permissions exist; UI is a placeholder. |
| Reports and exports (compliance, inventory, audit) | 📋 | |
| Tickets, documentation, vault, AI copilot | 📋 | Navigation and permissions are in place. |
| Multi-tenant sites, site-scoped technicians, RBAC, audit log, MFA | ✅ | |

## Suggested next features (not yet built)

**All platforms**
- Remote desktop with multi-monitor, clipboard, file drag-and-drop and session recording playback.
- Backstage "silent" mode: block input and blank the screen during maintenance.
- Technician chat and consent prompts on the device (notification path exists).
- Tunnels: one-click RDP/SSH/VNC/HTTP through the agent, no VPN.
- Snapshots: diff inventory, services, users and posture between two points in time.
- Self-healing: automation rules such as "service X stopped → restart, alert on second failure".
- End-user self-service portal (request software, reset my password, report a problem).
- Offline-first scripting with return codes mapped to alerts; approval workflows for risky scripts.

**Windows**
- Group Policy result viewer (`gpresult`), BitLocker key escrow and recovery, Defender scan/quarantine, Windows Update ring policies, Autopilot/Intune co-management, printer and driver management, RDP shadowing, DISM/SFC repair, Bluescreen (minidump) analysis, Local Administrator Password Solution, Credential Guard/ASR rule status.

**Linux**
- Unattended-upgrades policy, SELinux/AppArmor status and mode, kernel live-patch status, container/VM inventory (docker, podman, libvirt), disk/LVM management, SSH key distribution and sshd hardening, systemd unit editor, log shipping, sudoers audit.

**macOS**
- MDM enrolment (ADE/ABM), configuration profiles, FileVault escrow, Gatekeeper/XProtect/TCC status, Rosetta install, Munki-style self-service catalog, kernel/system extension approval, Time Machine status, battery health, macOS major-version upgrade staging with user deferral windows.
