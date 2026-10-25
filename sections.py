"""HawkZero admin sections.

Ported verbatim from the original config/sections.js: every section maps to one
HUD banner image in static/img/buttons, with a label and a colour theme used by
the CSS-only .hz-btn controls inside that section.
"""

SECTIONS = [
    {"slug": "dashboard", "label": "Dashboard", "image": "hawk.png", "theme": "cyan",
     "blurb": "HawkZero command overview."},
    {"slug": "targets", "label": "Targets", "image": "targets.png", "theme": "cyan",
     "blurb": "Tracked hosts and objectives."},
    {"slug": "console", "label": "Console", "image": "console.png", "theme": "cyan",
     "blurb": "Terminal and raw logs."},
    {"slug": "signals", "label": "Signals", "image": "signals.png", "theme": "cyan",
     "blurb": "Telemetry and broadcast channels."},
    {"slug": "recon", "label": "Recon", "image": "recon.png", "theme": "gold",
     "blurb": "Navigation & reconnaissance."},
    {"slug": "system", "label": "System Power", "image": "system.png", "theme": "gold",
     "blurb": "Services, uptime and power state."},
    {"slug": "analytics", "label": "Analytics", "image": "analytics.png", "theme": "gold",
     "blurb": "Metrics, trends and reports."},
    {"slug": "alerts", "label": "Alerts", "image": "alerts.png", "theme": "violet",
     "blurb": "Warnings and incident feed."},
    {"slug": "files", "label": "Files", "image": "files.png", "theme": "violet",
     "blurb": "Storage, uploads and archives."},
    {"slug": "api-keys", "label": "API Keys", "image": "api-keys.png", "theme": "violet",
     "blurb": "Issue and revoke access keys."},
    {"slug": "security", "label": "Security", "image": "security.png", "theme": "violet",
     "blurb": "Auth, roles and lockdown."},
    {"slug": "network", "label": "Network", "image": "network.png", "theme": "cyan",
     "blurb": "Nodes, links and topology."},
    {"slug": "web", "label": "Web", "image": "web.png", "theme": "cyan",
     "blurb": "Domains, endpoints and HTTP."},
    {"slug": "scans", "label": "Scans", "image": "scans.png", "theme": "cyan",
     "blurb": "Radar sweeps and scheduled scans."},
    {"slug": "mobile-security", "label": "Mobile Security", "image": "mobile-security.png",
     "theme": "cyan", "blurb": "Device shield and app hardening."},
]

BY_SLUG = {s["slug"]: s for s in SECTIONS}
