/**
 * The shipped Toolbox library: ready-made, idempotent IT tools for Windows (PowerShell), Linux and macOS (bash).
 * Each entry becomes a global `scripts` row (orgId null, isBuiltin true, category "toolbox") the first time the toolbox API is
 * used; `ensureBuiltinTools()` in ./toolbox.ts upserts by (name, language). Tools that share a `key` are platform variants of
 * the same tool - the run endpoint picks the variant matching each target device, so one card runs on a mixed fleet.
 *
 * Conventions for the scripts themselves:
 *  - Parameters arrive as MW_PARAM_<NAME> environment variables (and as -name args for PowerShell), so every script reads
 *    `$env:MW_PARAM_X` / `${MW_PARAM_X:-default}` and never prompts.
 *  - Reports exit 0 and print human-readable sections; actions print what they changed and exit non-zero on failure.
 *  - Nothing here needs third-party modules; optional tools (smartctl, nmap, docker) are detected and skipped with a message.
 */
import type { ToolboxCategory, ToolLanguage, ToolParameter, ToolPlatform, ToolRisk, ToolRunAs } from "../api/contracts/toolbox";

export interface BuiltinTool {
  /** Stable slug shared by platform variants; also the tag `toolbox:key:<key>`. */
  key: string;
  name: string;
  description: string;
  category: Exclude<ToolboxCategory, "Custom">;
  language: ToolLanguage;
  platforms: ToolPlatform[];
  content: string;
  parameters?: ToolParameter[];
  timeoutSeconds?: number;
  runAs?: ToolRunAs;
  risk?: ToolRisk;
  tags?: string[];
  /** Maps to a native job type instead of running a script (e.g. "inventory"). `content` is then only a description. */
  action?: "inventory" | "patch_scan";
}

const WIN: ToolPlatform[] = ["windows"];
const LIN: ToolPlatform[] = ["linux"];
const MAC: ToolPlatform[] = ["macos"];
const NIX: ToolPlatform[] = ["linux", "macos"];
const ALL: ToolPlatform[] = ["windows", "linux", "macos"];

/* =============================================================================================================== Diagnostics */

const diagnostics: BuiltinTool[] = [
  {
    key: "system-report",
    name: "System report",
    description: "One-page summary: OS, uptime, hardware, disks, network addresses and signed-in users.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$boot = $os.LastBootUpTime
$up = (Get-Date) - $boot
Write-Output "=== System ==="
Write-Output ("Host:        {0} ({1})" -f $env:COMPUTERNAME, $cs.Domain)
Write-Output ("OS:          {0} {1} build {2}" -f $os.Caption, $os.OSArchitecture, $os.BuildNumber)
Write-Output ("Model:       {0} {1}" -f $cs.Manufacturer, $cs.Model)
Write-Output ("Serial:      {0}" -f (Get-CimInstance Win32_BIOS).SerialNumber)
Write-Output ("CPU:         {0} ({1} cores / {2} threads)" -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors)
Write-Output ("Memory:      {0:N1} GB total, {1:N1} GB free" -f ($cs.TotalPhysicalMemory/1GB), ($os.FreePhysicalMemory/1MB))
Write-Output ("Last boot:   {0}  (up {1}d {2}h {3}m)" -f $boot, $up.Days, $up.Hours, $up.Minutes)
Write-Output ("Pending reboot: {0}" -f ((Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') -or (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending')))
Write-Output ""
Write-Output "=== Disks ==="
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  $pct = if ($_.Size) { [math]::Round(100 - ($_.FreeSpace / $_.Size * 100)) } else { 0 }
  Write-Output ("{0}  {1,8:N1} GB total  {2,8:N1} GB free  {3,3}% used" -f $_.DeviceID, ($_.Size/1GB), ($_.FreeSpace/1GB), $pct)
}
Write-Output ""
Write-Output "=== Network ==="
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Output ("{0,-24} {1}/{2}" -f $_.InterfaceAlias, $_.IPAddress, $_.PrefixLength) }
Write-Output ("DNS:         {0}" -f ((Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object ServerAddresses | Select-Object -ExpandProperty ServerAddresses -Unique) -join ', '))
Write-Output ("Gateway:     {0}" -f ((Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -ExpandProperty NextHop -Unique) -join ', '))
Write-Output ""
Write-Output "=== Users ==="
$sessions = quser 2>$null
if ($sessions) { $sessions } else { Write-Output "No interactive sessions" }
Write-Output ""
Write-Output ("=== Top processes by memory ===")
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 | ForEach-Object { Write-Output ("{0,-30} {1,8:N0} MB" -f $_.ProcessName, ($_.WorkingSet64/1MB)) }
`,
  },
  {
    key: "system-report",
    name: "System report",
    description: "One-page summary: OS, uptime, hardware, disks, network addresses and signed-in users.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "=== System ==="
echo "Host:        $(hostname)"
if [ -r /etc/os-release ]; then . /etc/os-release; echo "OS:          \${PRETTY_NAME:-$NAME} ($(uname -m))"; else echo "OS:          $(uname -srm) $(sw_vers -productVersion 2>/dev/null)"; fi
echo "Kernel:      $(uname -r)"
if command -v lscpu >/dev/null 2>&1; then echo "CPU:         $(lscpu | awk -F: '/Model name/ {gsub(/^ +/,"",$2); print $2; exit}') ($(nproc) threads)"; else echo "CPU:         $(sysctl -n machdep.cpu.brand_string 2>/dev/null) ($(sysctl -n hw.ncpu 2>/dev/null) threads)"; fi
if [ -r /proc/meminfo ]; then awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "Memory:      %.1f GB total, %.1f GB available\\n", t/1048576, a/1048576}' /proc/meminfo; else echo "Memory:      $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )) GB total"; fi
echo "Uptime:      $(uptime | sed 's/.*up \\(.*\\),  *[0-9]* user.*/\\1/')"
if [ -f /var/run/reboot-required ]; then echo "Pending reboot: yes"; else echo "Pending reboot: no"; fi
echo
echo "=== Disks ==="
df -hP -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR==1 || $1 ~ /^\\//' || df -hP
echo
echo "=== Network ==="
if command -v ip >/dev/null 2>&1; then ip -4 -o addr show scope global | awk '{printf "%-16s %s\\n", $2, $4}'; echo "Gateway:     $(ip route show default 2>/dev/null | awk '{print $3}' | head -1)"; else ifconfig 2>/dev/null | awk '/^[a-z]/ {i=$1} /inet / && $2 != "127.0.0.1" {printf "%-16s %s\\n", i, $2}'; echo "Gateway:     $(netstat -rn 2>/dev/null | awk '/^default/ {print $2; exit}')"; fi
echo "DNS:         $( (grep -h '^nameserver' /etc/resolv.conf 2>/dev/null | awk '{print $2}' | sort -u | tr '\\n' ' ') )"
echo
echo "=== Users ==="
who 2>/dev/null || echo "No interactive sessions"
echo
echo "=== Top processes by memory ==="
ps -eo rss,comm --sort=-rss 2>/dev/null | head -9 | awk 'NR>1 {printf "%-30s %8.0f MB\\n", $2, $1/1024}' || ps -eo rss,comm | sort -rn | head -8
`,
  },
  {
    key: "top-processes",
    name: "Top CPU and memory processes",
    description: "The heaviest processes right now by CPU and by memory, with owner and PID.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "count", label: "Processes per list", type: "number", default: 15 }],
    content: `param([int]$count = 15)
if ($env:MW_PARAM_COUNT) { $count = [int]$env:MW_PARAM_COUNT }
$ErrorActionPreference = 'SilentlyContinue'
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$s1 = Get-Process | Select-Object Id, ProcessName, @{n='cpu';e={$_.TotalProcessorTime.TotalMilliseconds}}
Start-Sleep -Seconds 2
$s2 = Get-Process | Select-Object Id, ProcessName, WorkingSet64, @{n='cpu';e={$_.TotalProcessorTime.TotalMilliseconds}}
$owners = @{}
Get-CimInstance Win32_Process | ForEach-Object { $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner; if ($o.User) { $owners[$_.ProcessId] = $o.User } }
$rows = foreach ($p in $s2) {
  $prev = $s1 | Where-Object Id -eq $p.Id
  $pct = if ($prev) { [math]::Round((($p.cpu - $prev.cpu) / 2000 / $cores) * 100, 1) } else { 0 }
  [pscustomobject]@{ PID=$p.Id; Name=$p.ProcessName; 'CPU%'=$pct; 'MemMB'=[math]::Round($p.WorkingSet64/1MB); User=$owners[[uint32]$p.Id] }
}
Write-Output "=== Top $count by CPU (2 s sample, $cores logical CPUs) ==="
$rows | Sort-Object 'CPU%' -Descending | Select-Object -First $count | Format-Table -AutoSize | Out-String -Width 160
Write-Output "=== Top $count by memory ==="
$rows | Sort-Object MemMB -Descending | Select-Object -First $count | Format-Table -AutoSize | Out-String -Width 160
`,
  },
  {
    key: "top-processes",
    name: "Top CPU and memory processes",
    description: "The heaviest processes right now by CPU and by memory, with owner and PID.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "count", label: "Processes per list", type: "number", default: 15 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
N="\${MW_PARAM_COUNT:-15}"
echo "=== Top $N by CPU ==="
ps -eo pid,user,pcpu,pmem,rss,comm --sort=-pcpu 2>/dev/null | head -n $((N+1)) || ps -eo pid,user,pcpu,pmem,rss,comm -r | head -n $((N+1))
echo
echo "=== Top $N by memory ==="
ps -eo pid,user,pcpu,pmem,rss,comm --sort=-rss 2>/dev/null | head -n $((N+1)) || ps -eo pid,user,pcpu,pmem,rss,comm -m | head -n $((N+1))
echo
echo "Load average: $(uptime | sed 's/.*load average[s]*: //')"
`,
  },
  {
    key: "disk-usage-by-folder",
    name: "Disk usage by folder",
    description: "Sizes of the top-level folders under a path so you can see what is filling the disk.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "path", label: "Folder to analyse", type: "string", default: "C:\\" }, { name: "top", label: "Show largest N", type: "number", default: 25 }],
    timeoutSeconds: 1800,
    content: `param([string]$path = 'C:\\', [int]$top = 25)
if ($env:MW_PARAM_PATH) { $path = $env:MW_PARAM_PATH }
if ($env:MW_PARAM_TOP) { $top = [int]$env:MW_PARAM_TOP }
$ErrorActionPreference = 'SilentlyContinue'
if (-not (Test-Path $path)) { Write-Error "Path not found: $path"; exit 2 }
Write-Output "Scanning $path ..."
$rows = Get-ChildItem -LiteralPath $path -Directory -Force | ForEach-Object {
  $size = (Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  [pscustomobject]@{ Folder = $_.FullName; GB = [math]::Round(($size / 1GB), 2) }
}
$files = (Get-ChildItem -LiteralPath $path -File -Force | Measure-Object Length -Sum).Sum
$rows += [pscustomobject]@{ Folder = "(files directly in $path)"; GB = [math]::Round(($files / 1GB), 2) }
$rows | Sort-Object GB -Descending | Select-Object -First $top | Format-Table -AutoSize | Out-String -Width 200
$drive = (Get-Item $path).PSDrive
if ($drive) { Write-Output ("Drive {0}: {1:N1} GB free of {2:N1} GB" -f $drive.Name, ($drive.Free/1GB), (($drive.Used+$drive.Free)/1GB)) }
`,
  },
  {
    key: "disk-usage-by-folder",
    name: "Disk usage by folder",
    description: "Sizes of the top-level folders under a path so you can see what is filling the disk.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "path", label: "Folder to analyse", type: "string", default: "/" }, { name: "top", label: "Show largest N", type: "number", default: 25 }],
    timeoutSeconds: 1800,
    content: `#!/usr/bin/env bash
set -uo pipefail
P="\${MW_PARAM_PATH:-/}"
N="\${MW_PARAM_TOP:-25}"
[ -d "$P" ] || { echo "Path not found: $P" >&2; exit 2; }
echo "Scanning $P ..."
du -xhd1 "$P" 2>/dev/null | sort -rh | head -n "$((N+1))"
echo
df -hP "$P" | tail -1 | awk '{print "Filesystem " $1 ": " $4 " free of " $2 " (" $5 " used)"}'
`,
  },
  {
    key: "battery-thermal-report",
    name: "Battery and thermal report",
    description: "Battery health, cycle count and charge state plus any thermal sensors the OS exposes.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$bat = Get-CimInstance Win32_Battery
if (-not $bat) { Write-Output "No battery present (desktop or server)." } else {
  foreach ($b in $bat) {
    $status = switch ($b.BatteryStatus) { 1 {'Discharging'} 2 {'On AC'} 3 {'Fully charged'} 4 {'Low'} 5 {'Critical'} 6 {'Charging'} 7 {'Charging (high)'} 8 {'Charging (low)'} 9 {'Charging (critical)'} default {"code $($b.BatteryStatus)"} }
    Write-Output ("Battery:     {0} - {1}, {2}% charge" -f $b.Name, $status, $b.EstimatedChargeRemaining)
    if ($b.EstimatedRunTime -and $b.EstimatedRunTime -lt 71582788) { Write-Output ("Runtime est: {0} min" -f $b.EstimatedRunTime) }
  }
  $full = Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity
  $stat = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStaticData
  $cycle = Get-CimInstance -Namespace root\\wmi -ClassName BatteryCycleCount
  if ($full -and $stat -and $stat.DesignedCapacity) { Write-Output ("Health:      {0}% of design capacity ({1} / {2} mWh)" -f [math]::Round($full.FullChargedCapacity / $stat.DesignedCapacity * 100), $full.FullChargedCapacity, $stat.DesignedCapacity) }
  if ($cycle) { Write-Output ("Cycles:      {0}" -f $cycle.CycleCount) }
}
Write-Output ""
Write-Output "=== Thermal zones ==="
$zones = Get-CimInstance -Namespace root\\wmi -ClassName MSAcpi_ThermalZoneTemperature
if ($zones) { $zones | ForEach-Object { Write-Output ("{0,-40} {1,6:N1} C" -f $_.InstanceName, (($_.CurrentTemperature / 10) - 273.15)) } } else { Write-Output "No ACPI thermal zones exposed by this firmware." }
Write-Output ""
Write-Output "=== Power scheme ==="
powercfg /getactivescheme
`,
  },
  {
    key: "battery-thermal-report",
    name: "Battery and thermal report",
    description: "Battery health, cycle count and charge state plus any thermal sensors the OS exposes.",
    category: "Diagnostics",
    language: "bash",
    platforms: LIN,
    content: `#!/usr/bin/env bash
set -uo pipefail
found=0
for b in /sys/class/power_supply/BAT*; do
  [ -d "$b" ] || continue; found=1
  echo "=== $(basename "$b") ==="
  for f in status capacity cycle_count energy_full energy_full_design charge_full charge_full_design; do [ -r "$b/$f" ] && printf "%-20s %s\\n" "$f" "$(cat "$b/$f")"; done
  if [ -r "$b/energy_full" ] && [ -r "$b/energy_full_design" ]; then awk -v f="$(cat "$b/energy_full")" -v d="$(cat "$b/energy_full_design")" 'BEGIN { if (d>0) printf "%-20s %.0f%% of design\\n", "health", f/d*100 }'; fi
  if [ -r "$b/charge_full" ] && [ -r "$b/charge_full_design" ]; then awk -v f="$(cat "$b/charge_full")" -v d="$(cat "$b/charge_full_design")" 'BEGIN { if (d>0) printf "%-20s %.0f%% of design\\n", "health", f/d*100 }'; fi
done
[ $found = 1 ] || echo "No battery present (desktop or server)."
echo
echo "=== Thermal zones ==="
tz=0
for z in /sys/class/thermal/thermal_zone*; do
  [ -r "$z/temp" ] || continue; tz=1
  printf "%-28s %6.1f C\\n" "$(cat "$z/type" 2>/dev/null)" "$(awk '{print $1/1000}' "$z/temp")"
done
if command -v sensors >/dev/null 2>&1; then sensors 2>/dev/null | grep -E '°C|Core|Package' | head -20; tz=1; fi
[ $tz = 1 ] || echo "No thermal sensors exposed."
`,
  },
  {
    key: "battery-thermal-report",
    name: "Battery and thermal report",
    description: "Battery health, cycle count and charge state plus any thermal sensors the OS exposes.",
    category: "Diagnostics",
    language: "bash",
    platforms: MAC,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "=== Battery ==="
pmset -g batt
system_profiler SPPowerDataType 2>/dev/null | grep -E "Cycle Count|Condition|Maximum Capacity|Full Charge Capacity|State of Charge|Charging|Connected" | sed 's/^ *//'
echo
echo "=== Thermal ==="
pmset -g therm 2>/dev/null || echo "Thermal state not available."
`,
  },
  {
    key: "eventlog-errors-24h",
    name: "Event log errors (last 24h)",
    description: "Critical and error events from the System and Application logs in the last 24 hours, grouped by source.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "hours", label: "Look back (hours)", type: "number", default: 24 }],
    content: `param([int]$hours = 24)
if ($env:MW_PARAM_HOURS) { $hours = [int]$env:MW_PARAM_HOURS }
$ErrorActionPreference = 'SilentlyContinue'
$since = (Get-Date).AddHours(-$hours)
foreach ($log in 'System','Application') {
  $ev = Get-WinEvent -FilterHashtable @{ LogName=$log; Level=1,2; StartTime=$since } -MaxEvents 2000
  Write-Output "=== $log : $(@($ev).Count) critical/error events since $since ==="
  if ($ev) {
    $ev | Group-Object ProviderName | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0,5}  {1}" -f $_.Count, $_.Name) }
    Write-Output "--- most recent 15 ---"
    $ev | Select-Object -First 15 | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  [{1}] {2} ({3}): {4}" -f $_.TimeCreated, $_.LevelDisplayName, $_.ProviderName, $_.Id, (($_.Message -split "\\r?\\n")[0])) }
  }
  Write-Output ""
}
`,
  },
  {
    key: "eventlog-errors-24h",
    name: "Event log errors (last 24h)",
    description: "Error-level journal entries from the last 24 hours, grouped by unit.",
    category: "Diagnostics",
    language: "bash",
    platforms: LIN,
    parameters: [{ name: "hours", label: "Look back (hours)", type: "number", default: 24 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
H="\${MW_PARAM_HOURS:-24}"
if command -v journalctl >/dev/null 2>&1; then
  echo "=== journal: priority err and above, last $H hours ==="
  journalctl -p err --since "$H hours ago" --no-pager -o short-iso 2>/dev/null | awk '{print $4}' | sed 's/\\[.*//' | sort | uniq -c | sort -rn | head -15
  echo "--- most recent 25 ---"
  journalctl -p err --since "$H hours ago" --no-pager -o short-iso 2>/dev/null | tail -25
else
  echo "=== /var/log/syslog + messages: error lines, last $H hours ==="
  find /var/log -maxdepth 1 -type f \\( -name syslog -o -name messages \\) -mmin -$((H*60)) -exec grep -ihE 'error|crit|fail' {} + 2>/dev/null | tail -40
fi
echo
echo "=== Kernel ring buffer errors ==="
dmesg --level=err,crit,alert,emerg -T 2>/dev/null | tail -15 || dmesg 2>/dev/null | grep -iE 'error|fail' | tail -15
`,
  },
  {
    key: "eventlog-errors-24h",
    name: "Event log errors (last 24h)",
    description: "Error-level unified log entries from the last 24 hours, grouped by process.",
    category: "Diagnostics",
    language: "bash",
    platforms: MAC,
    parameters: [{ name: "hours", label: "Look back (hours)", type: "number", default: 24 }],
    timeoutSeconds: 900,
    content: `#!/usr/bin/env bash
set -uo pipefail
H="\${MW_PARAM_HOURS:-24}"
echo "=== Unified log: errors and faults, last $H hours (top processes) ==="
log show --last "\${H}h" --predicate 'messageType == error OR messageType == fault' --style compact 2>/dev/null | awk 'NR>1 {print $3}' | sed 's/\\[.*//' | sort | uniq -c | sort -rn | head -15
echo "--- most recent 25 ---"
log show --last "\${H}h" --predicate 'messageType == error OR messageType == fault' --style compact 2>/dev/null | tail -25
`,
  },
  {
    key: "pending-reboot-check",
    name: "Pending reboot check",
    description: "Tells you whether the OS is waiting for a restart and which component asked for it.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$reasons = @()
if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { $reasons += 'Component Based Servicing (CBS)' }
if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { $reasons += 'Windows Update' }
if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\PostRebootReporting') { $reasons += 'Windows Update (post-reboot reporting)' }
$pfro = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager').PendingFileRenameOperations
if ($pfro) { $reasons += "Pending file rename operations ($(@($pfro).Count / 2) files)" }
$cn = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ActiveComputerName').ComputerName
$cn2 = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ComputerName').ComputerName
if ($cn -and $cn2 -and $cn -ne $cn2) { $reasons += "Computer rename ($cn -> $cn2)" }
if (Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Services\\Pending' -ErrorAction SilentlyContinue) { $reasons += 'Windows Update services pending' }
try { $ccm = Invoke-CimMethod -Namespace root\\ccm\\ClientSDK -ClassName CCM_ClientUtilities -MethodName DetermineIfRebootPending; if ($ccm.RebootPending -or $ccm.IsHardRebootPending) { $reasons += 'Configuration Manager client' } } catch {}
$up = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Write-Output ("Uptime: {0}d {1}h {2}m" -f $up.Days, $up.Hours, $up.Minutes)
if ($reasons.Count) { Write-Output "PENDING REBOOT: yes"; $reasons | ForEach-Object { Write-Output " - $_" } } else { Write-Output "PENDING REBOOT: no" }
`,
  },
  {
    key: "pending-reboot-check",
    name: "Pending reboot check",
    description: "Tells you whether the OS is waiting for a restart and which component asked for it.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "Uptime: $(uptime | sed 's/.*up \\(.*\\),  *[0-9]* user.*/\\1/')"
pending=0
if [ -f /var/run/reboot-required ]; then pending=1; echo "Reason: /var/run/reboot-required"; [ -f /var/run/reboot-required.pkgs ] && sed 's/^/  package: /' /var/run/reboot-required.pkgs; fi
if command -v needs-restarting >/dev/null 2>&1; then if ! needs-restarting -r >/dev/null 2>&1; then pending=1; echo "Reason: needs-restarting reports a reboot is required"; fi; fi
if [ -r /proc/version ] && [ -d /lib/modules ]; then running=$(uname -r); newest=$(ls -1 /lib/modules 2>/dev/null | sort -V | tail -1); if [ -n "$newest" ] && [ "$newest" != "$running" ]; then pending=1; echo "Reason: newer kernel installed ($newest) but running $running"; fi; fi
if [ "$(uname)" = "Darwin" ]; then if softwareupdate -l 2>/dev/null | grep -qi restart; then pending=1; echo "Reason: a macOS update that requires a restart is available"; fi; fi
if [ $pending = 1 ]; then echo "PENDING REBOOT: yes"; else echo "PENDING REBOOT: no"; fi
`,
  },
  {
    key: "boot-time-uptime",
    name: "Boot time and uptime",
    description: "Last boot timestamp, uptime, and the last few shutdown/startup events to spot unexpected restarts.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$up = (Get-Date) - $os.LastBootUpTime
Write-Output ("Last boot: {0}" -f $os.LastBootUpTime)
Write-Output ("Uptime:    {0}d {1}h {2}m" -f $up.Days, $up.Hours, $up.Minutes)
Write-Output ("Fast startup: {0}" -f ((Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power').HiberbootEnabled -eq 1))
Write-Output ""
Write-Output "=== Recent boot/shutdown events ==="
Get-WinEvent -FilterHashtable @{ LogName='System'; Id=12,13,41,1074,6005,6006,6008 } -MaxEvents 20 | ForEach-Object {
  $what = switch ($_.Id) { 12 {'Startup'} 13 {'Shutdown'} 41 {'UNEXPECTED: kernel power loss'} 1074 {'Shutdown requested: ' + (($_.Message -split "\\r?\\n")[0])} 6005 {'Event log started'} 6006 {'Event log stopped'} 6008 {'UNEXPECTED shutdown'} }
  Write-Output ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f $_.TimeCreated, $what)
}
`,
  },
  {
    key: "boot-time-uptime",
    name: "Boot time and uptime",
    description: "Last boot timestamp, uptime, and the last few shutdown/startup events to spot unexpected restarts.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v uptime >/dev/null 2>&1 && uptime -s >/dev/null 2>&1; then echo "Last boot: $(uptime -s)"; else echo "Last boot: $(sysctl -n kern.boottime 2>/dev/null | sed 's/.*sec = \\([0-9]*\\).*/\\1/' | xargs -I{} date -r {} 2>/dev/null)"; fi
echo "Uptime:    $(uptime | sed 's/.*up \\(.*\\),  *[0-9]* user.*/\\1/')"
echo
echo "=== Recent boots (last) ==="
last reboot 2>/dev/null | head -10 || echo "(last not available)"
echo
echo "=== Recent shutdowns ==="
last -x shutdown 2>/dev/null | head -10 || echo "(not available)"
if command -v journalctl >/dev/null 2>&1; then echo; echo "=== Boots known to the journal ==="; journalctl --list-boots --no-pager 2>/dev/null | tail -10; fi
`,
  },
  {
    key: "network-config-report",
    name: "Network configuration report",
    description: "Adapters, IP addresses, gateways, DNS servers, DHCP state and link speed for every interface.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
Get-NetAdapter | Sort-Object Status -Descending | ForEach-Object {
  $a = $_
  Write-Output ("=== {0} ({1}) - {2}, {3} ===" -f $a.Name, $a.InterfaceDescription, $a.Status, $a.LinkSpeed)
  Write-Output ("MAC: {0}" -f $a.MacAddress)
  $ipc = Get-NetIPConfiguration -InterfaceIndex $a.ifIndex
  if ($ipc) {
    $ipc.IPv4Address | ForEach-Object { Write-Output ("IPv4: {0}/{1}" -f $_.IPAddress, $_.PrefixLength) }
    if ($ipc.IPv4DefaultGateway) { Write-Output ("Gateway: {0}" -f ($ipc.IPv4DefaultGateway.NextHop -join ', ')) }
    if ($ipc.DNSServer) { Write-Output ("DNS: {0}" -f (($ipc.DNSServer | Where-Object AddressFamily -eq 2 | Select-Object -ExpandProperty ServerAddresses) -join ', ')) }
    $dhcp = Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4
    if ($dhcp) { Write-Output ("DHCP: {0}" -f $dhcp.Dhcp) }
  }
  Write-Output ""
}
Write-Output "=== DNS suffix / domain ==="
Write-Output ("Primary DNS suffix: {0}" -f (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters').'NV Domain')
Write-Output ("Search list: {0}" -f ((Get-DnsClientGlobalSetting).SuffixSearchList -join ', '))
Write-Output ""
Write-Output "=== Proxy (WinHTTP) ==="
netsh winhttp show proxy
`,
  },
  {
    key: "network-config-report",
    name: "Network configuration report",
    description: "Adapters, IP addresses, gateways, DNS servers, DHCP state and link speed for every interface.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v ip >/dev/null 2>&1; then
  echo "=== Interfaces ==="; ip -br link; echo
  echo "=== Addresses ==="; ip -br addr; echo
  echo "=== Routes ==="; ip route; echo
  if command -v nmcli >/dev/null 2>&1; then echo "=== NetworkManager connections ==="; nmcli -t -f NAME,TYPE,DEVICE,STATE connection show --active; echo; fi
  if command -v resolvectl >/dev/null 2>&1; then echo "=== DNS (resolvectl) ==="; resolvectl status 2>/dev/null | grep -E 'Link|DNS Servers|DNS Domain|Current DNS' | sed 's/^ *//'; else echo "=== DNS (/etc/resolv.conf) ==="; grep -vE '^#|^$' /etc/resolv.conf; fi
  echo; echo "=== Link speed ==="
  for i in /sys/class/net/*; do n=$(basename "$i"); [ "$n" = lo ] && continue; s=$(cat "$i/speed" 2>/dev/null || echo "?"); echo "$n: \${s} Mb/s, state $(cat "$i/operstate" 2>/dev/null)"; done
else
  echo "=== Interfaces ==="; ifconfig; echo
  echo "=== Routes ==="; netstat -rn -f inet; echo
  echo "=== DNS ==="; scutil --dns 2>/dev/null | grep -E 'nameserver|search domain' | sort -u
  echo; echo "=== Services ==="; networksetup -listallhardwareports 2>/dev/null
fi
`,
  },
  {
    key: "dns-test",
    name: "DNS resolution test",
    description: "Resolves a host name against the configured resolvers and against 8.8.8.8 / 1.1.1.1 to separate local DNS faults from connectivity faults.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "host", label: "Host name", type: "string", default: "www.microsoft.com" }],
    content: `param([string]$host = 'www.microsoft.com')
if ($env:MW_PARAM_HOST) { $host = $env:MW_PARAM_HOST }
$ErrorActionPreference = 'SilentlyContinue'
Write-Output "Configured resolvers: $((Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object ServerAddresses | Select-Object -ExpandProperty ServerAddresses -Unique) -join ', ')"
Write-Output ""
foreach ($srv in @($null, '8.8.8.8', '1.1.1.1')) {
  $label = if ($srv) { $srv } else { 'system resolver' }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = if ($srv) { Resolve-DnsName $host -Server $srv -Type A -DnsOnly } else { Resolve-DnsName $host -Type A }
  $sw.Stop()
  if ($r) { Write-Output ("[OK]   {0,-16} {1} -> {2} ({3} ms)" -f $label, $host, (($r | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress) -join ', '), $sw.ElapsedMilliseconds) }
  else { Write-Output ("[FAIL] {0,-16} {1}: no answer ({2})" -f $label, $host, $Error[0].Exception.Message) }
}
Write-Output ""
Write-Output "Cache entries: $(@(Get-DnsClientCache).Count)"
`,
  },
  {
    key: "dns-test",
    name: "DNS resolution test",
    description: "Resolves a host name against the configured resolvers and against 8.8.8.8 / 1.1.1.1 to separate local DNS faults from connectivity faults.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "host", label: "Host name", type: "string", default: "www.google.com" }],
    content: `#!/usr/bin/env bash
set -uo pipefail
H="\${MW_PARAM_HOST:-www.google.com}"
echo "Configured resolvers: $(grep -h '^nameserver' /etc/resolv.conf 2>/dev/null | awk '{print $2}' | tr '\\n' ' ')"
echo
q() { # q <label> [server]
  local label="$1" srv="\${2:-}" out rc start end
  start=$(date +%s%N 2>/dev/null || echo 0)
  if command -v dig >/dev/null 2>&1; then
    if [ -n "$srv" ]; then out=$(dig +short +time=3 +tries=1 "@$srv" "$H" A 2>&1); else out=$(dig +short +time=3 +tries=1 "$H" A 2>&1); fi; rc=$?
  elif command -v nslookup >/dev/null 2>&1; then
    out=$(nslookup "$H" $srv 2>&1 | awk '/^Address/ && !/#/ {print $2}'); rc=$?; [ -z "$out" ] && rc=1
  else
    out=$(getent hosts "$H" 2>&1 | awk '{print $1}'); rc=$?
  fi
  end=$(date +%s%N 2>/dev/null || echo 0)
  ms=$(( (end-start)/1000000 ))
  if [ $rc -eq 0 ] && [ -n "$out" ]; then printf "[OK]   %-16s %s -> %s (%s ms)\\n" "$label" "$H" "$(echo "$out" | tr '\\n' ' ')" "$ms"; else printf "[FAIL] %-16s %s: %s\\n" "$label" "$H" "$(echo "$out" | head -1)"; fi
}
q "system resolver"
q "8.8.8.8" 8.8.8.8
q "1.1.1.1" 1.1.1.1
`,
  },
  {
    key: "latency-test",
    name: "Latency and packet loss test",
    description: "Pings the default gateway, 8.8.8.8 and 1.1.1.1 and reports loss, min/avg/max round-trip and a quick download throughput sample.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    timeoutSeconds: 300,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
foreach ($t in @($gw, '8.8.8.8', '1.1.1.1') | Where-Object { $_ }) {
  $r = Test-Connection $t -Count 10 -ErrorAction SilentlyContinue
  $ok = @($r | Where-Object { $_.StatusCode -eq 0 -or $_.Status -eq 'Success' })
  $lat = $ok | ForEach-Object { if ($_.PSObject.Properties['Latency']) { $_.Latency } else { $_.ResponseTime } }
  $loss = [math]::Round((10 - $ok.Count) / 10 * 100)
  if ($ok.Count) { Write-Output ("{0,-16} loss {1,3}%  min {2,4} ms  avg {3,6:N1} ms  max {4,4} ms" -f $t, $loss, ($lat | Measure-Object -Minimum).Minimum, ($lat | Measure-Object -Average).Average, ($lat | Measure-Object -Maximum).Maximum) }
  else { Write-Output ("{0,-16} loss 100%  unreachable" -f $t) }
}
Write-Output ""
Write-Output "=== Throughput sample (10 MB from Cloudflare) ==="
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $bytes = (Invoke-WebRequest -Uri 'https://speed.cloudflare.com/__down?bytes=10000000' -UseBasicParsing -TimeoutSec 60).RawContentLength
  $sw.Stop()
  Write-Output ("Downloaded {0:N1} MB in {1:N1} s = {2:N1} Mbit/s" -f ($bytes/1MB), $sw.Elapsed.TotalSeconds, ($bytes*8/1e6/$sw.Elapsed.TotalSeconds))
} catch { Write-Output "Download test failed: $($_.Exception.Message)" }
`,
  },
  {
    key: "latency-test",
    name: "Latency and packet loss test",
    description: "Pings the default gateway, 8.8.8.8 and 1.1.1.1 and reports loss, min/avg/max round-trip and a quick download throughput sample.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    timeoutSeconds: 300,
    content: `#!/usr/bin/env bash
set -uo pipefail
GW=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1); [ -z "$GW" ] && GW=$(netstat -rn 2>/dev/null | awk '/^default/ {print $2; exit}')
for t in $GW 8.8.8.8 1.1.1.1; do
  out=$(ping -c 10 -i 0.3 -W 2 "$t" 2>/dev/null || ping -c 10 "$t" 2>/dev/null)
  loss=$(echo "$out" | grep -oE '[0-9.]+% packet loss' | head -1)
  rtt=$(echo "$out" | grep -E 'rtt|round-trip' | sed 's/.*= //')
  if [ -n "$rtt" ]; then printf "%-16s loss %-6s rtt min/avg/max/mdev %s\\n" "$t" "$loss" "$rtt"; else printf "%-16s unreachable (%s)\\n" "$t" "\${loss:-no reply}"; fi
done
echo
echo "=== Throughput sample (10 MB from Cloudflare) ==="
if command -v curl >/dev/null 2>&1; then
  curl -s -o /dev/null -w 'Downloaded %{size_download} bytes in %{time_total} s = ' --max-time 60 'https://speed.cloudflare.com/__down?bytes=10000000' && curl -s -o /dev/null -w '%{speed_download}' --max-time 60 'https://speed.cloudflare.com/__down?bytes=10000000' | awk '{printf "%.1f Mbit/s\\n", $1*8/1000000}'
else
  echo "curl not installed; skipping throughput sample"
fi
`,
  },
  {
    key: "listening-ports",
    name: "Open ports and listening services",
    description: "Every TCP/UDP listener with the process that owns it, so you can spot unexpected services.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$procs = @{}; Get-Process | ForEach-Object { $procs[$_.Id] = $_.ProcessName }
Write-Output "=== TCP listeners ==="
Get-NetTCPConnection -State Listen | Sort-Object LocalPort | ForEach-Object { [pscustomobject]@{ Proto='TCP'; Address=$_.LocalAddress; Port=$_.LocalPort; PID=$_.OwningProcess; Process=$procs[[int]$_.OwningProcess] } } | Format-Table -AutoSize | Out-String -Width 160
Write-Output "=== UDP listeners ==="
Get-NetUDPEndpoint | Sort-Object LocalPort | ForEach-Object { [pscustomobject]@{ Proto='UDP'; Address=$_.LocalAddress; Port=$_.LocalPort; PID=$_.OwningProcess; Process=$procs[[int]$_.OwningProcess] } } | Format-Table -AutoSize | Out-String -Width 160
Write-Output "=== Established connections by process (top 15) ==="
Get-NetTCPConnection -State Established | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0,5}  {1} (PID {2})" -f $_.Count, $procs[[int]$_.Name], $_.Name) }
`,
  },
  {
    key: "listening-ports",
    name: "Open ports and listening services",
    description: "Every TCP/UDP listener with the process that owns it, so you can spot unexpected services.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v ss >/dev/null 2>&1; then
  echo "=== Listening sockets (ss) ==="; ss -tulpnH 2>/dev/null | awk '{printf "%-5s %-28s %s\\n", $1, $5, $7}' | sort -u
  echo; echo "=== Established connections by process (top 15) ==="; ss -tnpH state established 2>/dev/null | awk '{print $6}' | sed 's/users:(("//; s/".*//' | sort | uniq -c | sort -rn | head -15
elif command -v lsof >/dev/null 2>&1; then
  echo "=== Listening sockets (lsof) ==="; lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null; echo; lsof -nP -iUDP 2>/dev/null | head -40
  echo; echo "=== Established TCP by process (top 15) ==="; lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1 {print $1}' | sort | uniq -c | sort -rn | head -15
else
  netstat -tulpn 2>/dev/null || netstat -an | grep -i listen
fi
`,
  },
  {
    key: "large-files-finder",
    name: "Large files finder",
    description: "Lists the biggest files under a path above a size threshold - the quickest way to reclaim disk space.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "path", label: "Search under", type: "string", default: "C:\\" }, { name: "minmb", label: "Minimum size (MB)", type: "number", default: 500 }, { name: "top", label: "Show largest N", type: "number", default: 40 }],
    timeoutSeconds: 1800,
    content: `param([string]$path = 'C:\\', [int]$minmb = 500, [int]$top = 40)
if ($env:MW_PARAM_PATH) { $path = $env:MW_PARAM_PATH }
if ($env:MW_PARAM_MINMB) { $minmb = [int]$env:MW_PARAM_MINMB }
if ($env:MW_PARAM_TOP) { $top = [int]$env:MW_PARAM_TOP }
$ErrorActionPreference = 'SilentlyContinue'
Write-Output "Files >= $minmb MB under $path (largest $top):"
Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Length -ge ($minmb * 1MB) } | Sort-Object Length -Descending | Select-Object -First $top | ForEach-Object { Write-Output ("{0,10:N0} MB  {1:yyyy-MM-dd}  {2}" -f ($_.Length/1MB), $_.LastWriteTime, $_.FullName) }
`,
  },
  {
    key: "large-files-finder",
    name: "Large files finder",
    description: "Lists the biggest files under a path above a size threshold - the quickest way to reclaim disk space.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "path", label: "Search under", type: "string", default: "/" }, { name: "minmb", label: "Minimum size (MB)", type: "number", default: 500 }, { name: "top", label: "Show largest N", type: "number", default: 40 }],
    timeoutSeconds: 1800,
    content: `#!/usr/bin/env bash
set -uo pipefail
P="\${MW_PARAM_PATH:-/}"; MIN="\${MW_PARAM_MINMB:-500}"; N="\${MW_PARAM_TOP:-40}"
echo "Files >= \${MIN} MB under $P (largest $N):"
find "$P" -xdev -type f -size "+\${MIN}M" -not -path '/proc/*' -not -path '/sys/*' -not -path '/dev/*' -exec du -m {} + 2>/dev/null | sort -rn | head -n "$N" | awk '{printf "%10s MB  %s\\n", $1, substr($0, index($0,$2))}'
`,
  },
  {
    key: "windows-update-history",
    name: "Windows Update history",
    description: "The last 40 update installations with result codes, straight from the Windows Update Agent.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$count = $searcher.GetTotalHistoryCount()
if ($count -eq 0) { Write-Output "No update history recorded."; exit 0 }
$hist = $searcher.QueryHistory(0, [math]::Min($count, 40))
$hist | ForEach-Object {
  $res = switch ($_.ResultCode) { 1 {'In progress'} 2 {'Succeeded'} 3 {'Succeeded (with errors)'} 4 {'FAILED'} 5 {'Aborted'} default {"code $($_.ResultCode)"} }
  $op = switch ($_.Operation) { 1 {'Install'} 2 {'Uninstall'} default {'Other'} }
  Write-Output ("{0:yyyy-MM-dd HH:mm}  {1,-9} {2,-24} {3}" -f $_.Date, $op, $res, $_.Title)
  if ($_.ResultCode -eq 4 -and $_.UnmappedResultCode) { Write-Output ("                  error 0x{0:X8}" -f $_.UnmappedResultCode) }
}
Write-Output ""
Write-Output ("Total history entries: {0}" -f $count)
$lastSuccess = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\Results\\Install').LastSuccessTime
if ($lastSuccess) { Write-Output "Last successful install: $lastSuccess" }
`,
  },
  {
    key: "recent-software",
    name: "Recently installed software",
    description: "Applications installed or updated in the last N days, newest first.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "days", label: "Look back (days)", type: "number", default: 30 }],
    content: `param([int]$days = 30)
if ($env:MW_PARAM_DAYS) { $days = [int]$env:MW_PARAM_DAYS }
$ErrorActionPreference = 'SilentlyContinue'
$since = (Get-Date).AddDays(-$days)
$keys = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKU:\\*\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
if (-not (Get-PSDrive HKU)) { New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS | Out-Null }
$rows = Get-ItemProperty $keys | Where-Object { $_.DisplayName -and $_.InstallDate } | ForEach-Object {
  $d = $null; [void][datetime]::TryParseExact($_.InstallDate, 'yyyyMMdd', $null, 'None', [ref]$d)
  if ($d -and $d -ge $since) { [pscustomobject]@{ Installed=$d.ToString('yyyy-MM-dd'); Name=$_.DisplayName; Version=$_.DisplayVersion; Publisher=$_.Publisher } }
}
Write-Output "Installed since $($since.ToString('yyyy-MM-dd')): $(@($rows).Count)"
$rows | Sort-Object Installed -Descending | Format-Table -AutoSize | Out-String -Width 200
Write-Output "=== Store apps installed recently ==="
Get-AppxPackage -AllUsers | Where-Object { $_.InstallLocation -and (Get-Item $_.InstallLocation).CreationTime -ge $since } | Select-Object Name, Version | Format-Table -AutoSize | Out-String -Width 160
`,
  },
  {
    key: "recent-software",
    name: "Recently installed software",
    description: "Packages installed or upgraded in the last N days, newest first.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "days", label: "Look back (days)", type: "number", default: 30 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
D="\${MW_PARAM_DAYS:-30}"
if command -v dpkg >/dev/null 2>&1; then
  echo "=== dpkg installs/upgrades, last $D days ==="
  find /var/log -maxdepth 1 -name 'dpkg.log*' -mtime -"$D" 2>/dev/null | xargs -r zgrep -hE ' (install|upgrade) ' 2>/dev/null | awk -v s="$(date -d "-$D days" +%Y-%m-%d 2>/dev/null)" '$1 >= s {print $1, $2, $3, $4, $NF}' | sort -r | head -60
fi
if command -v rpm >/dev/null 2>&1; then
  echo "=== rpm packages by install time (newest 60) ==="
  rpm -qa --last 2>/dev/null | awk -v cutoff="$(date -d "-$D days" +%s 2>/dev/null || echo 0)" '{print}' | head -60
fi
if command -v snap >/dev/null 2>&1; then echo; echo "=== snap changes ==="; snap changes 2>/dev/null | head -20; fi
if command -v flatpak >/dev/null 2>&1; then echo; echo "=== flatpak (newest first) ==="; flatpak list --columns=application,version,installation 2>/dev/null | head -20; fi
if [ "$(uname)" = "Darwin" ]; then
  echo "=== /Applications modified in the last $D days ==="
  find /Applications -maxdepth 1 -name '*.app' -mtime -"$D" -exec stat -f '%Sm  %N' -t '%Y-%m-%d' {} \\; 2>/dev/null | sort -r
  if command -v brew >/dev/null 2>&1; then echo; echo "=== Homebrew ==="; ls -lt "$(brew --cellar 2>/dev/null)" 2>/dev/null | head -20; fi
  echo; echo "=== Installer receipts ==="; pkgutil --pkgs 2>/dev/null | tail -20
fi
`,
  },
  {
    key: "disk-encryption-status",
    name: "Disk encryption status",
    description: "BitLocker / FileVault / LUKS state for every volume, including protector types and whether a recovery key exists.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$vols = Get-BitLockerVolume
if (-not $vols) { Write-Output "BitLocker cmdlets unavailable; falling back to manage-bde"; manage-bde -status; exit 0 }
foreach ($v in $vols) {
  Write-Output ("=== {0} ({1}) ===" -f $v.MountPoint, $v.VolumeType)
  Write-Output ("Protection:  {0}" -f $v.ProtectionStatus)
  Write-Output ("Status:      {0}, {1}% encrypted, method {2}" -f $v.VolumeStatus, $v.EncryptionPercentage, $v.EncryptionMethod)
  Write-Output ("Protectors:  {0}" -f (($v.KeyProtector | ForEach-Object { $_.KeyProtectorType }) -join ', '))
  $rk = $v.KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword'
  if ($rk) { Write-Output ("Recovery key IDs: {0}" -f (($rk | ForEach-Object { $_.KeyProtectorId }) -join ', ')) } else { Write-Output "Recovery key: NONE (escrow a recovery password before enabling protection)" }
  Write-Output ""
}
$tpm = Get-Tpm
if ($tpm) { Write-Output ("TPM: present={0} ready={1} enabled={2}" -f $tpm.TpmPresent, $tpm.TpmReady, $tpm.TpmEnabled) }
`,
  },
  {
    key: "disk-encryption-status",
    name: "Disk encryption status",
    description: "LUKS/dm-crypt state for every block device and whether the root filesystem is encrypted.",
    category: "Diagnostics",
    language: "bash",
    platforms: LIN,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "=== Block devices ==="
lsblk -o NAME,TYPE,FSTYPE,SIZE,MOUNTPOINT 2>/dev/null
echo
enc=0
for dev in $(lsblk -rno NAME,FSTYPE 2>/dev/null | awk '$2=="crypto_LUKS" {print $1}'); do
  enc=1; echo "=== /dev/$dev (LUKS) ==="
  cryptsetup luksDump "/dev/$dev" 2>/dev/null | grep -E 'Version|Cipher|Key Slot|Keyslots|^ +[0-9]+: luks' | head -12
  for m in $(lsblk -rno NAME,TYPE "/dev/$dev" 2>/dev/null | awk '$2=="crypt" {print $1}'); do cryptsetup status "$m" 2>/dev/null | head -6; done
done
[ $enc = 1 ] || echo "No LUKS volumes found."
echo
root_src=$(findmnt -no SOURCE / 2>/dev/null)
if echo "$root_src" | grep -q mapper; then echo "Root filesystem ($root_src): on an encrypted mapping"; else echo "Root filesystem ($root_src): NOT encrypted"; fi
`,
  },
  {
    key: "disk-encryption-status",
    name: "Disk encryption status",
    description: "FileVault state, enabled users and whether a personal or institutional recovery key is present.",
    category: "Diagnostics",
    language: "bash",
    platforms: MAC,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "FileVault: $(fdesetup status 2>/dev/null)"
echo "Enabled users: $(fdesetup list 2>/dev/null | cut -d, -f1 | tr '\\n' ' ')"
echo "Personal recovery key present: $(fdesetup haspersonalrecoverykey 2>/dev/null)"
echo "Institutional recovery key present: $(fdesetup hasinstitutionalrecoverykey 2>/dev/null)"
echo
diskutil apfs list 2>/dev/null | grep -E 'Volume disk|Name:|FileVault|Encrypted' | sed 's/^ *//'
`,
  },
  {
    key: "av-status",
    name: "Antivirus status",
    description: "Which antivirus is registered, whether real-time protection is on, signature age and last scan time.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== Registered AV products (Security Center) ==="
$products = Get-CimInstance -Namespace root\\SecurityCenter2 -ClassName AntiVirusProduct
if ($products) { foreach ($p in $products) { $hex = ('{0:X6}' -f $p.productState); $rt = if ($hex.Substring(2,2) -eq '10') { 'ON' } else { 'OFF' }; $upd = if ($hex.Substring(4,2) -eq '00') { 'up to date' } else { 'OUT OF DATE' }; Write-Output ("{0,-40} real-time {1,-4} definitions {2}" -f $p.displayName, $rt, $upd) } } else { Write-Output "(no products registered - server OS or Security Center disabled)" }
Write-Output ""
$mp = Get-MpComputerStatus
if ($mp) {
  Write-Output "=== Microsoft Defender ==="
  Write-Output ("Antivirus enabled:        {0}" -f $mp.AntivirusEnabled)
  Write-Output ("Real-time protection:     {0}" -f $mp.RealTimeProtectionEnabled)
  Write-Output ("Behaviour monitoring:     {0}" -f $mp.BehaviorMonitorEnabled)
  Write-Output ("Tamper protection:        {0}" -f $mp.IsTamperProtected)
  Write-Output ("Engine / platform:        {0} / {1}" -f $mp.AMEngineVersion, $mp.AMProductVersion)
  Write-Output ("Signatures:               {0} (age {1} d, updated {2})" -f $mp.AntivirusSignatureVersion, $mp.AntivirusSignatureAge, $mp.AntivirusSignatureLastUpdated)
  Write-Output ("Last quick scan:          {0}" -f $mp.QuickScanEndTime)
  Write-Output ("Last full scan:           {0}" -f $mp.FullScanEndTime)
  $threats = Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 5
  if ($threats) { Write-Output ""; Write-Output "=== Recent detections ==="; $threats | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  threat {1}  {2}" -f $_.InitialDetectionTime, $_.ThreatID, ($_.Resources -join '; ')) } }
}
`,
  },
  {
    key: "av-status",
    name: "Antivirus status",
    description: "Detects common endpoint protection agents and reports whether they are running, plus ClamAV signature age.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
found=0
check() { if pgrep -fl "$2" >/dev/null 2>&1; then echo "[running]  $1"; found=1; elif [ -n "\${3:-}" ] && [ -e "$3" ]; then echo "[installed, not running]  $1"; found=1; fi; }
check "ClamAV daemon" clamd /usr/sbin/clamd
check "Microsoft Defender for Endpoint" wdavdaemon /opt/microsoft/mdatp
check "CrowdStrike Falcon" falcon-sensor /opt/CrowdStrike
check "SentinelOne" sentinelone /opt/sentinelone
check "Sophos" sophos /opt/sophos-spl
check "ESET" eset /opt/eset
check "Bitdefender" bdsec /opt/bitdefender
check "Trellix / McAfee ENS" mfetpd /opt/McAfee
check "Huntress" HuntressAgent /Applications/Huntress.app
[ $found = 1 ] || echo "No known antivirus / EDR agent detected."
echo
if command -v freshclam >/dev/null 2>&1 || command -v clamscan >/dev/null 2>&1; then echo "=== ClamAV ==="; clamscan --version 2>/dev/null; for f in /var/lib/clamav/*.cvd /var/lib/clamav/*.cld; do [ -e "$f" ] && echo "$(basename "$f"): $(stat -c %y "$f" 2>/dev/null || stat -f %Sm "$f")"; done; fi
if command -v mdatp >/dev/null 2>&1; then echo "=== Defender for Endpoint ==="; mdatp health 2>/dev/null | grep -E 'healthy|real_time_protection_enabled|definitions_updated|engine_version' ; fi
if [ "$(uname)" = "Darwin" ]; then echo "=== Built-in protection ==="; echo "XProtect: $(defaults read /Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist CFBundleShortVersionString 2>/dev/null)"; echo "Gatekeeper: $(spctl --status 2>/dev/null)"; fi
`,
  },
  {
    key: "firewall-status",
    name: "Firewall status",
    description: "Firewall state per profile with the default inbound/outbound actions and the number of active rules.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
Get-NetFirewallProfile | ForEach-Object { Write-Output ("{0,-8} enabled={1,-5} inbound={2,-6} outbound={3,-6} logging={4}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction, $_.DefaultOutboundAction, $_.LogAllowed) }
Write-Output ""
$rules = Get-NetFirewallRule -Enabled True
Write-Output ("Active rules: {0} ({1} inbound allow, {2} inbound block)" -f @($rules).Count, @($rules | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }).Count, @($rules | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' }).Count)
Write-Output ""
Write-Output "=== Inbound allow rules opened for Any remote address (first 25) ==="
Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | Where-Object { ($_ | Get-NetFirewallAddressFilter).RemoteAddress -eq 'Any' } | Select-Object -First 25 | ForEach-Object { $pf = $_ | Get-NetFirewallPortFilter; Write-Output ("{0,-50} {1}/{2}" -f $_.DisplayName, $pf.Protocol, $pf.LocalPort) }
`,
  },
  {
    key: "firewall-status",
    name: "Firewall status",
    description: "ufw / firewalld / nftables / iptables state with the active rule summary.",
    category: "Diagnostics",
    language: "bash",
    platforms: LIN,
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v ufw >/dev/null 2>&1; then echo "=== ufw ==="; ufw status verbose 2>/dev/null; echo; fi
if command -v firewall-cmd >/dev/null 2>&1; then echo "=== firewalld ==="; firewall-cmd --state 2>/dev/null; firewall-cmd --list-all 2>/dev/null; echo; fi
if command -v nft >/dev/null 2>&1; then echo "=== nftables (rule count per table) ==="; nft list tables 2>/dev/null; nft list ruleset 2>/dev/null | grep -c -E '^\\s+(accept|drop|reject|tcp|udp|ip)' | sed 's/^/rules: /'; echo; fi
if command -v iptables >/dev/null 2>&1; then echo "=== iptables filter policy ==="; iptables -S 2>/dev/null | grep -E '^-P'; echo "rules: $(iptables -S 2>/dev/null | grep -vc '^-P')"; fi
`,
  },
  {
    key: "firewall-status",
    name: "Firewall status",
    description: "Application firewall state, stealth mode, block-all setting and the apps allowed through.",
    category: "Diagnostics",
    language: "bash",
    platforms: MAC,
    content: `#!/usr/bin/env bash
set -uo pipefail
FW=/usr/libexec/ApplicationFirewall/socketfilterfw
echo "Global state:   $($FW --getglobalstate 2>/dev/null)"
echo "Stealth mode:   $($FW --getstealthmode 2>/dev/null)"
echo "Block all:      $($FW --getblockall 2>/dev/null)"
echo "Signed apps:    $($FW --getallowsigned 2>/dev/null | tr '\\n' ' ')"
echo
echo "=== Applications with explicit rules ==="
$FW --listapps 2>/dev/null
echo
if pfctl -s info >/dev/null 2>&1; then echo "=== pf ==="; pfctl -s info 2>/dev/null | head -3; pfctl -s rules 2>/dev/null | head -20; fi
`,
  },
  {
    key: "gpresult",
    name: "Group Policy result",
    description: "Applied computer and user GPOs, the last refresh time and any policies that failed to apply.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    timeoutSeconds: 600,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$dom = (Get-CimInstance Win32_ComputerSystem).PartOfDomain
if (-not $dom) { Write-Output "This computer is not domain-joined; only local policy applies."; }
Write-Output "=== Computer scope ==="
gpresult /scope computer /r 2>&1 | Select-String -Pattern 'Applied Group Policy Objects', 'Last time Group Policy was applied', 'Group Policy was applied from', 'The following GPOs were not applied', '^\\s{8}\\S' | ForEach-Object { $_.Line }
Write-Output ""
Write-Output "=== User scope (console user) ==="
$user = (Get-CimInstance Win32_ComputerSystem).UserName
if ($user) { gpresult /scope user /user "$user" /r 2>&1 | Select-String -Pattern 'Applied Group Policy Objects', 'Last time Group Policy was applied', 'The following GPOs were not applied', '^\\s{8}\\S' | ForEach-Object { $_.Line } } else { Write-Output "No console user signed in." }
Write-Output ""
Write-Output "=== Recent Group Policy errors (GroupPolicy operational log) ==="
Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-GroupPolicy/Operational'; Level=2,3; StartTime=(Get-Date).AddDays(-3) } -MaxEvents 10 | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  {1}: {2}" -f $_.TimeCreated, $_.Id, (($_.Message -split "\\r?\\n")[0])) }
`,
  },
  {
    key: "smart-disk-health",
    name: "SMART disk health",
    description: "Drive model, firmware, wear/reallocated sectors, temperature and the OS health verdict for every physical disk.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
Get-PhysicalDisk | ForEach-Object {
  $d = $_
  Write-Output ("=== {0} ({1}, {2}, {3:N0} GB) ===" -f $d.FriendlyName, $d.MediaType, $d.BusType, ($d.Size/1GB))
  Write-Output ("Health: {0}   Operational: {1}   Firmware: {2}   Serial: {3}" -f $d.HealthStatus, ($d.OperationalStatus -join ','), $d.FirmwareVersion, $d.SerialNumber.Trim())
  $r = $d | Get-StorageReliabilityCounter
  if ($r) { Write-Output ("Temp: {0} C   Power-on: {1} h   Wear: {2}%   Read errors: {3}   Write errors: {4}   Reallocated: {5}" -f $r.Temperature, $r.PowerOnHours, $r.Wear, $r.ReadErrorsTotal, $r.WriteErrorsTotal, $r.ReallocatedSectors) }
  Write-Output ""
}
Write-Output "=== WMI predictive failure status ==="
Get-CimInstance -Namespace root\\wmi -ClassName MSStorageDriver_FailurePredictStatus | ForEach-Object { Write-Output ("{0,-60} predict failure: {1}" -f $_.InstanceName, $_.PredictFailure) }
`,
  },
  {
    key: "smart-disk-health",
    name: "SMART disk health",
    description: "Drive model, firmware, wear/reallocated sectors, temperature and the OS health verdict for every physical disk.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v smartctl >/dev/null 2>&1; then
  for d in $(smartctl --scan 2>/dev/null | awk '{print $1}'); do
    echo "=== $d ==="
    smartctl -H -i "$d" 2>/dev/null | grep -E 'Model|Serial|Firmware|Capacity|SMART overall-health|SMART Health Status'
    smartctl -A "$d" 2>/dev/null | grep -E 'Reallocated_Sector|Current_Pending|Offline_Uncorrectable|Temperature|Power_On_Hours|Wear_Leveling|Percentage Used|Media and Data Integrity|Available Spare' | sed 's/  */ /g'
    echo
  done
else
  echo "smartctl is not installed (package: smartmontools). Falling back to OS information."
  if [ "$(uname)" = "Darwin" ]; then
    for d in $(diskutil list physical 2>/dev/null | grep -oE '^/dev/disk[0-9]+'); do echo "=== $d ==="; diskutil info "$d" 2>/dev/null | grep -E 'Device / Media Name|SMART Status|Disk Size|Solid State|Protocol'; echo; done
  else
    lsblk -dno NAME,MODEL,SIZE,ROTA,TRAN 2>/dev/null
    echo; echo "=== Kernel I/O errors ==="; dmesg 2>/dev/null | grep -iE 'I/O error|ata[0-9].*error|nvme.*error' | tail -10
  fi
fi
`,
  },
  {
    key: "memory-diagnostic-schedule",
    name: "Schedule memory diagnostic",
    description: "Schedules Windows Memory Diagnostic to run at the next restart (results appear in the System event log, source MemoryDiagnostics-Results).",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'Stop'
bcdedit /bootsequence '{memdiag}' | Out-Null
Write-Output "Windows Memory Diagnostic is scheduled for the next restart."
Write-Output "After the test completes the machine boots normally; check Event Viewer > System for 'MemoryDiagnostics-Results' (event 1201 = no errors)."
$last = Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Microsoft-Windows-MemoryDiagnostics-Results' } -MaxEvents 1 -ErrorAction SilentlyContinue
if ($last) { Write-Output ("Last result ({0:yyyy-MM-dd}): {1}" -f $last.TimeCreated, (($last.Message -split "\\r?\\n")[0])) }
`,
  },
  {
    key: "crash-dumps-list",
    name: "Crash dumps list",
    description: "Kernel and application crash dumps with sizes and dates, plus the bug-check codes from recent blue screens.",
    category: "Diagnostics",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== Kernel dumps ==="
foreach ($p in 'C:\\Windows\\Minidump\\*.dmp', 'C:\\Windows\\MEMORY.DMP', 'C:\\Windows\\LiveKernelReports\\*\\*.dmp') { Get-Item $p | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  {1,8:N1} MB  {2}" -f $_.LastWriteTime, ($_.Length/1MB), $_.FullName) } }
Write-Output ""
Write-Output "=== Bug checks (event 1001, last 90 days) ==="
Get-WinEvent -FilterHashtable @{ LogName='System'; Id=1001; ProviderName='Microsoft-Windows-WER-SystemErrorReporting'; StartTime=(Get-Date).AddDays(-90) } -MaxEvents 10 | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  {1}" -f $_.TimeCreated, (($_.Message -split "\\r?\\n")[0])) }
Write-Output ""
Write-Output "=== Application crash reports (WER, newest 15) ==="
Get-ChildItem 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive', 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue' -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  {1}" -f $_.LastWriteTime, $_.Name) }
Write-Output ""
Write-Output "=== Application errors (event 1000, last 7 days, by app) ==="
Get-WinEvent -FilterHashtable @{ LogName='Application'; Id=1000; StartTime=(Get-Date).AddDays(-7) } -MaxEvents 500 | ForEach-Object { ($_.Message -split "\\r?\\n")[0] -replace '^Faulting application name: ', '' -replace ', version.*', '' } | Group-Object | Sort-Object Count -Descending | Select-Object -First 10 | ForEach-Object { Write-Output ("{0,5}  {1}" -f $_.Count, $_.Name) }
`,
  },
  {
    key: "crash-dumps-list",
    name: "Crash dumps list",
    description: "Core dumps and kernel panic reports with sizes and dates.",
    category: "Diagnostics",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v coredumpctl >/dev/null 2>&1; then echo "=== systemd-coredump (newest 20) ==="; coredumpctl list --no-pager 2>/dev/null | tail -20; echo; fi
for d in /var/crash /var/lib/systemd/coredump /var/lib/apport/coredump; do
  [ -d "$d" ] || continue
  echo "=== $d ==="; ls -lht "$d" 2>/dev/null | head -15; echo
done
if [ "$(uname)" = "Darwin" ]; then
  echo "=== Kernel panics ==="; ls -lt /Library/Logs/DiagnosticReports/*.panic 2>/dev/null | head -10 || echo "none"
  echo; echo "=== Application crash reports (newest 20) ==="; ls -lt /Library/Logs/DiagnosticReports/*.ips /Library/Logs/DiagnosticReports/*.crash /Users/*/Library/Logs/DiagnosticReports/*.ips 2>/dev/null | head -20
fi
if command -v journalctl >/dev/null 2>&1; then echo "=== Segfaults / OOM kills in the journal (7 days) ==="; journalctl --since "7 days ago" --no-pager 2>/dev/null | grep -iE 'segfault|out of memory|oom-kill' | tail -15; fi
`,
  },
];

/* =============================================================================================================== Repair */

const repair: BuiltinTool[] = [
  {
    key: "sfc-scannow",
    name: "System File Checker (sfc /scannow)",
    description: "Verifies and repairs protected Windows system files. Takes 5-20 minutes.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 3600,
    content: `$ErrorActionPreference = 'Continue'
Write-Output "Running sfc /scannow (this takes a while)..."
$out = & sfc.exe /scannow 2>&1 | Out-String
# sfc writes UTF-16 with embedded nulls on some builds; normalise before printing.
$out = ($out -replace [char]0, '') -split "\\r?\\n" | Where-Object { $_.Trim() } | Select-Object -Last 8
$out
if ($LASTEXITCODE -ne 0) { Write-Output "sfc exit code $LASTEXITCODE"; }
Write-Output ""
Write-Output "=== CBS log summary (last 20 [SR] lines) ==="
Get-Content C:\\Windows\\Logs\\CBS\\CBS.log -ErrorAction SilentlyContinue | Select-String '\\[SR\\]' | Select-Object -Last 20 | ForEach-Object { $_.Line }
`,
  },
  {
    key: "dism-restorehealth",
    name: "DISM RestoreHealth",
    description: "Repairs the Windows component store from Windows Update so that sfc can then fix system files. Takes 10-30 minutes.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 5400,
    content: `$ErrorActionPreference = 'Continue'
Write-Output "DISM /Online /Cleanup-Image /CheckHealth"
& DISM.exe /Online /Cleanup-Image /CheckHealth /NoRestart 2>&1 | Where-Object { $_ -match 'health|repair|error|version' }
Write-Output ""
Write-Output "DISM /Online /Cleanup-Image /RestoreHealth (this takes a while)..."
& DISM.exe /Online /Cleanup-Image /RestoreHealth /NoRestart 2>&1 | Where-Object { $_ -match 'health|repair|error|complete|%' } | Select-Object -Last 6
Write-Output "DISM exit code: $LASTEXITCODE"
if ($LASTEXITCODE -eq 0) { Write-Output "Component store repaired. Run 'System File Checker' next if files were corrupt." }
`,
  },
  {
    key: "chkdsk-schedule",
    name: "Schedule disk check (chkdsk)",
    description: "Marks a volume dirty so Windows runs chkdsk /f on it at the next restart, without interrupting the user now.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "drive", label: "Drive letter", type: "string", default: "C:" }],
    content: `param([string]$drive = 'C:')
if ($env:MW_PARAM_DRIVE) { $drive = $env:MW_PARAM_DRIVE }
$ErrorActionPreference = 'Stop'
$drive = $drive.TrimEnd('\\').ToUpper(); if ($drive -notmatch ':$') { $drive += ':' }
if (-not (Test-Path "$drive\\")) { Write-Error "Drive $drive not found"; exit 2 }
Write-Output "Current state: $(fsutil dirty query $drive)"
fsutil dirty set $drive | Out-Null
Write-Output "Volume $drive is marked dirty - chkdsk /f will run automatically at the next restart."
Write-Output "Quick read-only check now:"
chkdsk $drive 2>&1 | Select-Object -Last 12
`,
  },
  {
    key: "reset-windows-update",
    name: "Reset Windows Update components",
    description: "Stops the update services, renames SoftwareDistribution and catroot2, re-registers the update DLLs and restarts the services.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 900,
    content: `$ErrorActionPreference = 'Continue'
$svcs = 'wuauserv','bits','cryptsvc','msiserver','UsoSvc'
Write-Output "Stopping services: $($svcs -join ', ')"
foreach ($s in $svcs) { Stop-Service $s -Force -ErrorAction SilentlyContinue }
Start-Sleep 3
$stamp = Get-Date -Format yyyyMMddHHmmss
foreach ($p in 'C:\\Windows\\SoftwareDistribution', 'C:\\Windows\\System32\\catroot2') {
  if (Test-Path $p) { Rename-Item $p "$p.old.$stamp" -ErrorAction SilentlyContinue; if ($?) { Write-Output "Renamed $p -> $p.old.$stamp" } else { Write-Output "Could not rename $p (in use); clearing contents instead"; Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue } }
}
Remove-Item "$env:ALLUSERSPROFILE\\Application Data\\Microsoft\\Network\\Downloader\\qmgr*.dat" -Force -ErrorAction SilentlyContinue
Write-Output "Resetting BITS and Windows Update service security descriptors"
sc.exe sdset bits 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;AU)(A;;CCLCSWRPWPDTLOCRRC;;;PU)' | Out-Null
sc.exe sdset wuauserv 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;AU)(A;;CCLCSWRPWPDTLOCRRC;;;PU)' | Out-Null
Write-Output "Re-registering update components"
$dlls = 'atl.dll','urlmon.dll','mshtml.dll','shdocvw.dll','browseui.dll','jscript.dll','vbscript.dll','scrrun.dll','msxml.dll','msxml3.dll','msxml6.dll','actxprxy.dll','softpub.dll','wintrust.dll','dssenh.dll','rsaenh.dll','gpkcsp.dll','sccbase.dll','slbcsp.dll','cryptdlg.dll','oleaut32.dll','ole32.dll','shell32.dll','initpki.dll','wuapi.dll','wuaueng.dll','wuaueng1.dll','wucltui.dll','wups.dll','wups2.dll','wuweb.dll','qmgr.dll','qmgrprxy.dll','wucltux.dll','muweb.dll','wuwebv.dll'
foreach ($d in $dlls) { if (Test-Path "C:\\Windows\\System32\\$d") { & regsvr32.exe /s "C:\\Windows\\System32\\$d" } }
Write-Output "Starting services"
foreach ($s in $svcs) { Start-Service $s -ErrorAction SilentlyContinue }
Write-Output "Triggering a scan"
Start-Process -FilePath 'UsoClient.exe' -ArgumentList 'StartScan' -WindowStyle Hidden -ErrorAction SilentlyContinue
Write-Output "Done. Windows Update components were reset; old folders are kept with the .old.$stamp suffix and can be deleted after a successful update."
`,
  },
  {
    key: "reset-winsock-ip",
    name: "Reset Winsock and TCP/IP stack",
    description: "netsh winsock reset + netsh int ip reset + flush DNS. Fixes 'no internet' states after bad VPN/AV uninstalls. Needs a restart to complete.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'Continue'
netsh winsock reset
netsh int ip reset
netsh int ipv6 reset
ipconfig /flushdns | Out-Null
Write-Output "Winsock catalog and TCP/IP stack reset. A restart is required for the change to take effect."
`,
  },
  {
    key: "flush-dns",
    name: "Flush DNS cache",
    description: "Clears the local resolver cache so stale or poisoned records stop being used.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'Continue'
$before = @(Get-DnsClientCache -ErrorAction SilentlyContinue).Count
Clear-DnsClientCache
ipconfig /flushdns | Out-Null
ipconfig /registerdns | Out-Null
Write-Output "Flushed $before cached DNS records and re-registered this host with its DNS server."
`,
  },
  {
    key: "flush-dns",
    name: "Flush DNS cache",
    description: "Clears the local resolver cache so stale or poisoned records stop being used.",
    category: "Repair",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
done=0
if command -v resolvectl >/dev/null 2>&1 && resolvectl flush-caches 2>/dev/null; then echo "systemd-resolved cache flushed"; done=1; fi
if command -v systemd-resolve >/dev/null 2>&1 && [ $done = 0 ] && systemd-resolve --flush-caches 2>/dev/null; then echo "systemd-resolved cache flushed"; done=1; fi
if command -v nscd >/dev/null 2>&1 && nscd -i hosts 2>/dev/null; then echo "nscd hosts cache invalidated"; done=1; fi
if command -v rndc >/dev/null 2>&1 && rndc flush 2>/dev/null; then echo "bind cache flushed"; done=1; fi
if systemctl is-active dnsmasq >/dev/null 2>&1 && systemctl restart dnsmasq 2>/dev/null; then echo "dnsmasq restarted"; done=1; fi
if [ "$(uname)" = "Darwin" ]; then dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null; echo "macOS DNS cache flushed (dscacheutil + mDNSResponder)"; done=1; fi
[ $done = 1 ] || echo "No caching resolver detected on this system; nothing to flush."
`,
  },
  {
    key: "restart-print-spooler",
    name: "Restart print spooler and clear queue",
    description: "Stops the Spooler service, deletes stuck jobs from the spool folder and starts it again.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'Continue'
$spool = "$env:SystemRoot\\System32\\spool\\PRINTERS"
$jobs = @(Get-ChildItem $spool -File -ErrorAction SilentlyContinue)
Write-Output "Queued spool files: $($jobs.Count)"
Stop-Service Spooler -Force
Start-Sleep 2
$jobs | Remove-Item -Force -ErrorAction SilentlyContinue
Start-Service Spooler
Start-Sleep 2
Write-Output "Spooler: $((Get-Service Spooler).Status). Cleared $($jobs.Count) stuck job file(s)."
Get-Printer -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ("{0,-40} {1}" -f $_.Name, $_.PrinterStatus) }
`,
  },
  {
    key: "restart-explorer",
    name: "Restart Explorer",
    description: "Restarts the Windows shell for the signed-in user to fix a frozen taskbar, Start menu or missing icons.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    runAs: "user",
    content: `$ErrorActionPreference = 'Continue'
$before = @(Get-Process explorer -ErrorAction SilentlyContinue)
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep 2
if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
Start-Sleep 2
Write-Output "Explorer restarted for $env:USERNAME ($($before.Count) process(es) ended, $(@(Get-Process explorer -ErrorAction SilentlyContinue).Count) running now)."
`,
  },
  {
    key: "rebuild-icon-cache",
    name: "Rebuild icon and thumbnail cache",
    description: "Deletes the per-user icon/thumbnail cache databases and restarts Explorer so blank or wrong icons are regenerated.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    runAs: "user",
    risk: "medium",
    content: `$ErrorActionPreference = 'Continue'
$dir = "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer"
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep 2
$n = 0
Get-ChildItem $dir -Filter 'iconcache_*.db' -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue; $n++ }
Get-ChildItem $dir -Filter 'thumbcache_*.db' -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue; $n++ }
Remove-Item "$env:LOCALAPPDATA\\IconCache.db" -Force -ErrorAction SilentlyContinue
ie4uinit.exe -show 2>$null
Start-Process explorer.exe
Write-Output "Removed $n cache database(s) for $env:USERNAME and restarted Explorer. Icons rebuild in the background."
`,
  },
  {
    key: "repair-wmi",
    name: "Repair WMI repository",
    description: "Verifies the WMI repository and salvages it if inconsistent; re-registers providers. Fixes monitoring and inventory gaps.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 900,
    content: `$ErrorActionPreference = 'Continue'
$v = winmgmt /verifyrepository 2>&1
Write-Output "Verify: $v"
if ($v -match 'inconsistent') {
  Write-Output "Repository inconsistent - salvaging"
  Write-Output (winmgmt /salvagerepository 2>&1)
  Write-Output (winmgmt /verifyrepository 2>&1)
} else { Write-Output "Repository is consistent; refreshing provider registrations only" }
Write-Output "Re-registering WMI providers (mofcomp) ..."
Get-ChildItem "$env:SystemRoot\\System32\\wbem\\*.mof" -Exclude '*uninstall*' | ForEach-Object { & mofcomp.exe $_.FullName | Out-Null }
Get-ChildItem "$env:SystemRoot\\System32\\wbem\\*.mfl" | ForEach-Object { & mofcomp.exe $_.FullName | Out-Null }
Write-Output "Restarting Winmgmt"
Restart-Service Winmgmt -Force -ErrorAction SilentlyContinue
Start-Sleep 3
$test = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($test) { Write-Output "WMI query test OK: $($test.Caption)" } else { Write-Output "WMI query test FAILED - a restart may be required" }
`,
  },
  {
    key: "reregister-store-apps",
    name: "Re-register Microsoft Store apps",
    description: "Re-registers all provisioned Store apps (Start menu, Settings, Calculator, Photos...) when they refuse to open.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 1800,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$pkgs = Get-AppxPackage -AllUsers | Where-Object { $_.InstallLocation -and (Test-Path "$($_.InstallLocation)\\AppxManifest.xml") }
Write-Output "Re-registering $(@($pkgs).Count) packages..."
$ok = 0; $fail = 0
foreach ($p in $pkgs) {
  try { Add-AppxPackage -DisableDevelopmentMode -Register "$($p.InstallLocation)\\AppxManifest.xml" -ErrorAction Stop; $ok++ } catch { $fail++; if ($_.Exception.Message -notmatch '0x80073D02|0x80073CF3|0x80073D06') { Write-Output "  failed: $($p.Name) - $(($_.Exception.Message -split "\\r?\\n")[0])" } }
}
Write-Output "Re-registered $ok package(s); $fail skipped (already current or in use)."
wsreset.exe 2>$null
Write-Output "Store cache reset requested."
`,
  },
  {
    key: "fix-time-sync",
    name: "Fix time synchronisation",
    description: "Restarts the time service, points it at the domain/NTP source and forces an immediate resync. Fixes Kerberos and TLS errors caused by clock drift.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'Continue'
Write-Output "Before: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
$dom = (Get-CimInstance Win32_ComputerSystem).PartOfDomain
Set-Service w32time -StartupType Automatic
Start-Service w32time -ErrorAction SilentlyContinue
if ($dom) { w32tm /config /syncfromflags:domhier /update | Out-Null } else { w32tm /config /manualpeerlist:"time.windows.com,0x9 pool.ntp.org,0x9" /syncfromflags:manual /reliable:no /update | Out-Null }
Restart-Service w32time -Force
Start-Sleep 2
w32tm /resync /force 2>&1
Write-Output ""
w32tm /query /status 2>&1 | Select-String 'Source|Last Successful|Stratum|Phase Offset'
Write-Output "After:  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
`,
  },
  {
    key: "fix-time-sync",
    name: "Fix time synchronisation",
    description: "Enables NTP (chrony, systemd-timesyncd or ntpd) and forces an immediate step so the clock is right.",
    category: "Repair",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "Before: $(date -R)"
if command -v chronyc >/dev/null 2>&1; then systemctl enable --now chronyd 2>/dev/null || systemctl enable --now chrony 2>/dev/null; chronyc makestep; chronyc tracking | head -6; echo "Synchronised with chrony."
elif command -v timedatectl >/dev/null 2>&1; then timedatectl set-ntp true; systemctl restart systemd-timesyncd 2>/dev/null; sleep 3; timedatectl timesync-status 2>/dev/null | head -8 || timedatectl status | grep -iE 'ntp|synchron'; echo "Synchronised with systemd-timesyncd."
elif command -v ntpdate >/dev/null 2>&1; then systemctl stop ntp 2>/dev/null; ntpdate -u pool.ntp.org; systemctl start ntp 2>/dev/null; echo "Stepped with ntpdate."
else echo "No NTP client found. Install chrony (apt-get install chrony / dnf install chrony)."; exit 1; fi
echo "After:  $(date -R)"
`,
  },
  {
    key: "fix-time-sync",
    name: "Fix time synchronisation",
    description: "Turns network time on and forces an immediate sync with Apple's time servers.",
    category: "Repair",
    language: "bash",
    platforms: MAC,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "Before: $(date)"
systemsetup -setusingnetworktime on >/dev/null 2>&1
systemsetup -setnetworktimeserver time.apple.com >/dev/null 2>&1
sntp -sS time.apple.com 2>&1 | tail -2
echo "After:  $(date)"
echo "Network time: $(systemsetup -getusingnetworktime 2>/dev/null)"
`,
  },
  {
    key: "reset-network-adapters",
    name: "Reset network adapters",
    description: "Disables and re-enables every physical adapter (Wi-Fi/Ethernet). Connectivity drops for ~10 seconds; the agent reconnects automatically.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'Continue'
$adapters = Get-NetAdapter -Physical | Where-Object Status -ne 'Disabled'
Write-Output "Resetting: $($adapters.Name -join ', ')"
$adapters | Disable-NetAdapter -Confirm:$false
Start-Sleep 4
$adapters | Enable-NetAdapter -Confirm:$false
Start-Sleep 8
Get-NetAdapter -Physical | ForEach-Object { Write-Output ("{0,-30} {1,-14} {2}" -f $_.Name, $_.Status, $_.LinkSpeed) }
Write-Output "Adapters reset."
`,
  },
  {
    key: "reset-network-adapters",
    name: "Reset network adapters",
    description: "Restarts the network stack (NetworkManager or systemd-networkd). Connectivity drops for a few seconds; the agent reconnects automatically.",
    category: "Repair",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
if systemctl is-active NetworkManager >/dev/null 2>&1; then nmcli networking off; sleep 2; nmcli networking on; echo "NetworkManager networking toggled off/on"
elif systemctl is-active systemd-networkd >/dev/null 2>&1; then systemctl restart systemd-networkd; echo "systemd-networkd restarted"
elif systemctl is-active networking >/dev/null 2>&1; then systemctl restart networking; echo "networking service restarted"
else for i in $(ls /sys/class/net | grep -v lo); do ip link set "$i" down; sleep 1; ip link set "$i" up; echo "cycled $i"; done; fi
sleep 5
ip -br addr 2>/dev/null
`,
  },
  {
    key: "clear-teams-outlook-cache",
    name: "Clear Teams and Outlook cache",
    description: "Closes Teams/Outlook for the signed-in user and removes their local caches (sign-in state, OST stays). Fixes stuck sign-in, missing chats and sync loops.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    runAs: "user",
    risk: "medium",
    content: `$ErrorActionPreference = 'SilentlyContinue'
Get-Process ms-teams, Teams, OUTLOOK, olk -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 3
$removed = 0
$paths = @(
  "$env:LOCALAPPDATA\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView",
  "$env:LOCALAPPDATA\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\Logs",
  "$env:APPDATA\\Microsoft\\Teams\\Cache", "$env:APPDATA\\Microsoft\\Teams\\blob_storage", "$env:APPDATA\\Microsoft\\Teams\\databases", "$env:APPDATA\\Microsoft\\Teams\\GPUCache", "$env:APPDATA\\Microsoft\\Teams\\IndexedDB", "$env:APPDATA\\Microsoft\\Teams\\Local Storage", "$env:APPDATA\\Microsoft\\Teams\\tmp", "$env:APPDATA\\Microsoft\\Teams\\Service Worker\\CacheStorage",
  "$env:LOCALAPPDATA\\Microsoft\\Outlook\\RoamCache", "$env:LOCALAPPDATA\\Microsoft\\Windows\\INetCache\\Content.Outlook",
  "$env:LOCALAPPDATA\\Microsoft\\Olk\\EBWebView\\Default\\Cache"
)
foreach ($p in $paths) { if (Test-Path $p) { $size = (Get-ChildItem $p -Recurse -File | Measure-Object Length -Sum).Sum; Remove-Item $p -Recurse -Force; $removed += $size; Write-Output ("cleared {0,8:N1} MB  {1}" -f ($size/1MB), $p) } }
Write-Output ("Total cleared: {0:N1} MB for {1}. Start Teams/Outlook again; they rebuild their cache on launch." -f ($removed/1MB), $env:USERNAME)
`,
  },
  {
    key: "repair-office-c2r",
    name: "Repair Office (Click-to-Run quick repair)",
    description: "Runs the Click-to-Run quick repair silently; Office apps are closed first. Use when Office apps crash or will not activate.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 3600,
    parameters: [{ name: "type", label: "Repair type", type: "select", options: ["QuickRepair", "FullRepair"], default: "QuickRepair" }],
    content: `param([string]$type = 'QuickRepair')
if ($env:MW_PARAM_TYPE) { $type = $env:MW_PARAM_TYPE }
$ErrorActionPreference = 'Continue'
$c2r = "$env:ProgramFiles\\Common Files\\Microsoft Shared\\ClickToRun\\OfficeClickToRun.exe"
if (-not (Test-Path $c2r)) { Write-Error "Click-to-Run Office is not installed on this computer"; exit 2 }
$cfg = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration' -ErrorAction SilentlyContinue
$platform = if ($cfg.Platform) { $cfg.Platform } else { 'x64' }
$culture = if ($cfg.ClientCulture) { $cfg.ClientCulture } else { 'en-us' }
Get-Process WINWORD, EXCEL, POWERPNT, OUTLOOK, ONENOTE, MSACCESS, MSPUB, lync, Teams -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Output "Starting $type for Office $($cfg.VersionToReport) ($platform, $culture)..."
$p = Start-Process -FilePath $c2r -ArgumentList "scenario=Repair platform=$platform culture=$culture forceappshutdown=True RepairType=$type DisplayLevel=False" -PassThru -Wait
Write-Output "OfficeClickToRun exit code: $($p.ExitCode)"
if ($p.ExitCode -eq 0) { Write-Output "Repair completed." } else { Write-Output "Repair returned a non-zero code; try FullRepair or check %TEMP% logs." }
`,
  },
  {
    key: "apt-fix-broken",
    name: "Fix broken packages (apt/dpkg)",
    description: "Finishes interrupted dpkg configuration and resolves broken dependencies non-interactively.",
    category: "Repair",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    timeoutSeconds: 1800,
    content: `#!/usr/bin/env bash
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v dpkg >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then echo "RPM system: running dnf check + distro-sync"; dnf check 2>&1 | tail -20; dnf -y distro-sync 2>&1 | tail -15; exit 0; fi
  echo "Neither dpkg nor dnf found"; exit 2
fi
if fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then echo "Another package operation is running (dpkg lock held). Try again later."; exit 1; fi
echo "=== dpkg --configure -a ==="; dpkg --configure -a 2>&1 | tail -20
echo "=== apt-get install -f ==="; apt-get install -f -y 2>&1 | tail -20
echo "=== Remaining problems ==="; dpkg -l 2>/dev/null | awk '$1 !~ /^(ii|rc)$/ && NR>5 {print}' | head -20
echo "Done."
`,
  },
  {
    key: "journal-vacuum",
    name: "Vacuum systemd journal",
    description: "Trims the persistent journal to the last N days and 500 MB, then reports the size.",
    category: "Repair",
    language: "bash",
    platforms: LIN,
    parameters: [{ name: "days", label: "Keep (days)", type: "number", default: 7 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
D="\${MW_PARAM_DAYS:-7}"
command -v journalctl >/dev/null 2>&1 || { echo "journalctl not available"; exit 2; }
echo "Before: $(journalctl --disk-usage 2>/dev/null)"
journalctl --rotate 2>/dev/null
journalctl --vacuum-time="\${D}d" 2>&1 | tail -3
journalctl --vacuum-size=500M 2>&1 | tail -3
echo "After:  $(journalctl --disk-usage 2>/dev/null)"
`,
  },
  {
    key: "rebuild-spotlight",
    name: "Rebuild Spotlight index",
    description: "Erases and rebuilds the Spotlight index on the boot volume. Search is degraded for a few minutes while it re-indexes.",
    category: "Repair",
    language: "bash",
    platforms: MAC,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
mdutil -i on / >/dev/null 2>&1
mdutil -E / 2>&1
echo "Spotlight index on / is being rebuilt. Status: $(mdutil -s / 2>/dev/null | tail -1)"
`,
  },
  {
    key: "reset-launch-services",
    name: "Reset Launch Services database",
    description: "Rebuilds the 'Open with' / default-app database to fix duplicate entries and wrong file associations.",
    category: "Repair",
    language: "bash",
    platforms: MAC,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSR" -kill -r -domain local -domain system -domain user 2>&1 | tail -2
killall Finder 2>/dev/null || true
echo "Launch Services database rebuilt and Finder restarted."
`,
  },
  {
    key: "kill-process-by-name",
    name: "Kill hung process by name",
    description: "Force-ends every process matching a name (without extension) and reports how many were ended.",
    category: "Repair",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "name", label: "Process name (e.g. OUTLOOK, Teams)", type: "string", required: true }],
    content: `param([string]$name = $env:MW_PARAM_NAME)
if ($env:MW_PARAM_NAME) { $name = $env:MW_PARAM_NAME }
$ErrorActionPreference = 'Continue'
if (-not $name) { Write-Error "name is required"; exit 2 }
$name = $name -replace '\\.exe$', ''
$procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
if (-not $procs.Count) { Write-Output "No process named '$name' is running."; exit 0 }
$procs | ForEach-Object { Write-Output ("ending PID {0} ({1}, {2:N0} MB)" -f $_.Id, $_.ProcessName, ($_.WorkingSet64/1MB)); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
$left = @(Get-Process -Name $name -ErrorAction SilentlyContinue).Count
Write-Output "Ended $($procs.Count) process(es); $left still running."
`,
  },
  {
    key: "kill-process-by-name",
    name: "Kill hung process by name",
    description: "Sends SIGTERM then SIGKILL to every process matching a name and reports how many were ended.",
    category: "Repair",
    language: "bash",
    platforms: NIX,
    risk: "medium",
    parameters: [{ name: "name", label: "Process name (e.g. firefox, chrome)", type: "string", required: true }],
    content: `#!/usr/bin/env bash
set -uo pipefail
NAME="\${MW_PARAM_NAME:-}"
[ -n "$NAME" ] || { echo "name is required" >&2; exit 2; }
pids=$(pgrep -x "$NAME" 2>/dev/null || true)
[ -n "$pids" ] || pids=$(pgrep -f "$NAME" 2>/dev/null | grep -v "^$$\\$" || true)
[ -n "$pids" ] || { echo "No process named '$NAME' is running."; exit 0; }
for p in $pids; do echo "ending PID $p ($(ps -o comm= -p "$p" 2>/dev/null))"; kill "$p" 2>/dev/null || true; done
sleep 2
for p in $pids; do kill -0 "$p" 2>/dev/null && { kill -9 "$p" 2>/dev/null; echo "force-killed PID $p"; }; done
echo "Ended $(echo "$pids" | wc -w | tr -d ' ') process(es)."
`,
  },
];

/* =============================================================================================================== Cleanup */

const cleanup: BuiltinTool[] = [
  {
    key: "clean-temp-files",
    name: "Clean temporary files",
    description: "Removes Windows temp, user temp, Windows Update download cache, delivery optimisation files and error reports. Reports space reclaimed.",
    category: "Cleanup",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 1800,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$free0 = (Get-PSDrive C).Free
$targets = @("$env:SystemRoot\\Temp\\*", "$env:SystemRoot\\SoftwareDistribution\\Download\\*", "$env:SystemRoot\\Logs\\CBS\\*.log", "$env:ProgramData\\Microsoft\\Windows\\WER\\ReportQueue\\*", "$env:ProgramData\\Microsoft\\Windows\\WER\\ReportArchive\\*", "$env:SystemRoot\\Prefetch\\*.pf", "$env:SystemRoot\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache\\*")
Get-ChildItem 'C:\\Users' -Directory | ForEach-Object { $targets += "$($_.FullName)\\AppData\\Local\\Temp\\*"; $targets += "$($_.FullName)\\AppData\\Local\\Microsoft\\Windows\\INetCache\\*"; $targets += "$($_.FullName)\\AppData\\Local\\CrashDumps\\*" }
foreach ($t in $targets) { Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue }
Stop-Service wuauserv -Force; Remove-Item "$env:SystemRoot\\SoftwareDistribution\\Download\\*" -Recurse -Force; Start-Service wuauserv
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
$free1 = (Get-PSDrive C).Free
Write-Output ("Reclaimed {0:N0} MB. C: now has {1:N1} GB free." -f (($free1 - $free0)/1MB), ($free1/1GB))
`,
  },
  {
    key: "clean-temp-files",
    name: "Clean temporary files",
    description: "Removes /tmp and /var/tmp files older than 7 days, package manager caches and old crash reports. Reports space reclaimed.",
    category: "Cleanup",
    language: "bash",
    platforms: NIX,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
before=$(df -Pk / | awk 'NR==2 {print $4}')
find /tmp /var/tmp -xdev -mindepth 1 -mtime +7 -not -path '*/systemd-private*' -not -name '.X*-lock' -exec rm -rf {} + 2>/dev/null
if command -v apt-get >/dev/null 2>&1; then apt-get clean >/dev/null 2>&1 && echo "apt cache cleaned"; fi
if command -v dnf >/dev/null 2>&1; then dnf clean all >/dev/null 2>&1 && echo "dnf cache cleaned"; fi
if command -v zypper >/dev/null 2>&1; then zypper clean -a >/dev/null 2>&1 && echo "zypper cache cleaned"; fi
rm -rf /var/crash/* 2>/dev/null
if command -v journalctl >/dev/null 2>&1; then journalctl --vacuum-size=500M >/dev/null 2>&1 && echo "journal trimmed to 500 MB"; fi
if [ "$(uname)" = "Darwin" ]; then
  find /private/var/folders -type f -mtime +7 -path '*/T/*' -exec rm -f {} + 2>/dev/null
  rm -rf /Library/Caches/com.apple.iconservices.store 2>/dev/null
  for u in /Users/*; do [ -d "$u/Library/Caches" ] && find "$u/Library/Caches" -type f -mtime +30 -exec rm -f {} + 2>/dev/null; done
  echo "macOS caches older than 30 days cleaned"
fi
after=$(df -Pk / | awk 'NR==2 {print $4}')
echo "Reclaimed $(( (after-before)/1024 )) MB. / now has $(( after/1024/1024 )) GB free."
`,
  },
  {
    key: "windows-component-cleanup",
    name: "Windows component store cleanup",
    description: "DISM StartComponentCleanup plus the Disk Cleanup system categories - safely removes superseded update files (often several GB).",
    category: "Cleanup",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 5400,
    content: `$ErrorActionPreference = 'Continue'
$free0 = (Get-PSDrive C).Free
Write-Output "Component store before:"
& DISM.exe /Online /Cleanup-Image /AnalyzeComponentStore 2>&1 | Where-Object { $_ -match 'Actual Size|Reclaimable|Recommended' }
Write-Output "Running StartComponentCleanup (10-40 minutes)..."
& DISM.exe /Online /Cleanup-Image /StartComponentCleanup /NoRestart 2>&1 | Select-Object -Last 3
Write-Output "Running Disk Cleanup system categories..."
$key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches'
$cats = 'Update Cleanup','Windows Upgrade Log Files','Temporary Files','Previous Installations','Device Driver Packages','Windows Error Reporting Files','Delivery Optimization Files','Temporary Setup Files','Setup Log Files','System error memory dump files','System error minidump files','Windows Defender'
foreach ($c in $cats) { if (Test-Path "$key\\$c") { New-ItemProperty "$key\\$c" -Name StateFlags0042 -Value 2 -PropertyType DWord -Force | Out-Null } }
$p = Start-Process cleanmgr.exe -ArgumentList '/sagerun:42' -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(2400000)) { $p.Kill(); Write-Output "cleanmgr timed out and was stopped" }
foreach ($c in $cats) { Remove-ItemProperty "$key\\$c" -Name StateFlags0042 -ErrorAction SilentlyContinue }
$free1 = (Get-PSDrive C).Free
Write-Output ("Reclaimed {0:N0} MB. C: now has {1:N1} GB free." -f (($free1 - $free0)/1MB), ($free1/1GB))
`,
  },
  {
    key: "clear-browser-caches",
    name: "Clear browser caches",
    description: "Empties Chrome, Edge and Firefox caches for every user profile (not cookies, passwords or history). Browsers must be closed; running ones are skipped.",
    category: "Cleanup",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'SilentlyContinue'
$running = Get-Process chrome, msedge, firefox -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique
if ($running) { Write-Output "Skipping running browsers: $($running -join ', ')" }
$total = 0
foreach ($u in Get-ChildItem 'C:\\Users' -Directory) {
  $la = "$($u.FullName)\\AppData\\Local"
  $paths = @()
  if ($running -notcontains 'chrome') { $paths += Get-ChildItem "$la\\Google\\Chrome\\User Data\\*\\Cache*", "$la\\Google\\Chrome\\User Data\\*\\Code Cache" -Directory -ErrorAction SilentlyContinue }
  if ($running -notcontains 'msedge') { $paths += Get-ChildItem "$la\\Microsoft\\Edge\\User Data\\*\\Cache*", "$la\\Microsoft\\Edge\\User Data\\*\\Code Cache" -Directory -ErrorAction SilentlyContinue }
  if ($running -notcontains 'firefox') { $paths += Get-ChildItem "$la\\Mozilla\\Firefox\\Profiles\\*\\cache2" -Directory -ErrorAction SilentlyContinue }
  foreach ($p in $paths) { $size = (Get-ChildItem $p.FullName -Recurse -File | Measure-Object Length -Sum).Sum; Remove-Item "$($p.FullName)\\*" -Recurse -Force -ErrorAction SilentlyContinue; $total += $size }
  if ($paths) { Write-Output ("{0,-20} {1} cache folder(s) cleared" -f $u.Name, $paths.Count) }
}
Write-Output ("Total cleared: {0:N1} MB" -f ($total/1MB))
`,
  },
  {
    key: "clear-browser-caches",
    name: "Clear browser caches",
    description: "Empties Chrome, Chromium, Edge and Firefox caches for every user (not cookies, passwords or history). Running browsers are skipped.",
    category: "Cleanup",
    language: "bash",
    platforms: NIX,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
total=0
running=$(pgrep -l -x 'chrome|chromium|chromium-browser|msedge|firefox|firefox-bin|Google Chrome|Microsoft Edge' 2>/dev/null | awk '{print $2}' | sort -u | tr '\\n' ' ')
[ -n "$running" ] && echo "Skipping running browsers: $running"
clear_dir() { [ -d "$1" ] || return 0; s=$(du -sk "$1" 2>/dev/null | awk '{print $1}'); rm -rf "$1"/* 2>/dev/null; total=$((total + s)); }
for home in /home/* /root /Users/*; do
  [ -d "$home" ] || continue
  if ! echo "$running" | grep -qiE 'chrome|chromium'; then for d in "$home"/.cache/google-chrome/*/Cache "$home"/.cache/chromium/*/Cache "$home"/.config/google-chrome/*/Cache "$home"/Library/Caches/Google/Chrome/*/Cache; do clear_dir "$d"; done; fi
  if ! echo "$running" | grep -qi edge; then for d in "$home"/.cache/microsoft-edge/*/Cache "$home"/Library/Caches/Microsoft\\ Edge/*/Cache; do clear_dir "$d"; done; fi
  if ! echo "$running" | grep -qi firefox; then for d in "$home"/.cache/mozilla/firefox/*/cache2 "$home"/Library/Caches/Firefox/Profiles/*/cache2 "$home"/snap/firefox/common/.cache/mozilla/firefox/*/cache2; do clear_dir "$d"; done; fi
done
echo "Total cleared: $((total/1024)) MB"
`,
  },
  {
    key: "empty-recycle-bin",
    name: "Empty recycle bin / trash",
    description: "Empties the recycle bin for all users and reports the space reclaimed.",
    category: "Cleanup",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'SilentlyContinue'
$size = 0
Get-ChildItem 'C:\\$Recycle.Bin' -Force -Directory | ForEach-Object { $size += (Get-ChildItem $_.FullName -Recurse -File -Force | Measure-Object Length -Sum).Sum }
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
Get-ChildItem 'C:\\$Recycle.Bin' -Force -Directory | ForEach-Object { Remove-Item "$($_.FullName)\\*" -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output ("Recycle bin emptied for all users: {0:N1} MB reclaimed." -f ($size/1MB))
`,
  },
  {
    key: "empty-recycle-bin",
    name: "Empty recycle bin / trash",
    description: "Empties every user's trash folder and reports the space reclaimed.",
    category: "Cleanup",
    language: "bash",
    platforms: NIX,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
total=0
for t in /home/*/.local/share/Trash /root/.local/share/Trash /Users/*/.Trash /Users/*/.local/share/Trash; do
  [ -d "$t" ] || continue
  s=$(du -sk "$t" 2>/dev/null | awk '{print $1}'); total=$((total+s))
  rm -rf "$t"/files/* "$t"/info/* 2>/dev/null; [ "$(basename "$t")" = ".Trash" ] && rm -rf "$t"/* 2>/dev/null
  echo "emptied $t ($((s/1024)) MB)"
done
echo "Total reclaimed: $((total/1024)) MB"
`,
  },
  {
    key: "old-user-profiles-report",
    name: "Old user profiles report",
    description: "Lists local profiles not used for N days with their size, so you can decide which to remove.",
    category: "Cleanup",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "days", label: "Unused for (days)", type: "number", default: 90 }],
    timeoutSeconds: 1800,
    content: `param([int]$days = 90)
if ($env:MW_PARAM_DAYS) { $days = [int]$env:MW_PARAM_DAYS }
$ErrorActionPreference = 'SilentlyContinue'
$cut = (Get-Date).AddDays(-$days)
$profiles = Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special -and $_.LocalPath -like 'C:\\Users\\*' }
$rows = foreach ($p in $profiles) {
  $last = $p.LastUseTime
  $ntuser = Get-Item "$($p.LocalPath)\\NTUSER.DAT" -Force -ErrorAction SilentlyContinue
  if ($ntuser -and $ntuser.LastWriteTime -gt $last) { $last = $ntuser.LastWriteTime }
  $size = (Get-ChildItem $p.LocalPath -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  [pscustomobject]@{ Profile = Split-Path $p.LocalPath -Leaf; LastUsed = $last; GB = [math]::Round($size/1GB, 2); LoadedNow = $p.Loaded; Stale = ($last -lt $cut -and -not $p.Loaded) }
}
Write-Output "Profiles unused for more than $days days:"
$rows | Where-Object Stale | Sort-Object LastUsed | Format-Table Profile, LastUsed, GB -AutoSize | Out-String -Width 160
Write-Output "All profiles:"
$rows | Sort-Object LastUsed -Descending | Format-Table -AutoSize | Out-String -Width 160
Write-Output ("Stale total: {0:N1} GB in {1} profile(s)" -f (($rows | Where-Object Stale | Measure-Object GB -Sum).Sum), @($rows | Where-Object Stale).Count)
`,
  },
  {
    key: "old-user-profiles-report",
    name: "Old user profiles report",
    description: "Lists home directories whose owner has not logged in for N days with their size.",
    category: "Cleanup",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "days", label: "Unused for (days)", type: "number", default: 90 }],
    timeoutSeconds: 1800,
    content: `#!/usr/bin/env bash
set -uo pipefail
D="\${MW_PARAM_DAYS:-90}"
now=$(date +%s)
printf "%-20s %-12s %-10s %s\\n" "USER" "LAST LOGIN" "SIZE" "HOME"
for home in /home/* /Users/*; do
  [ -d "$home" ] || continue
  user=$(basename "$home"); [ "$user" = "Shared" ] && continue
  if command -v lastlog >/dev/null 2>&1; then ll=$(lastlog -u "$user" 2>/dev/null | awk 'NR==2 {if ($0 ~ /Never/) print "never"; else print $4" "$5" "$9}'); else ll=$(last -1 "$user" 2>/dev/null | awk 'NR==1 && NF>3 {print $4" "$5" "$6}'); fi
  [ -z "$ll" ] && ll="never"
  mtime=$(stat -c %Y "$home" 2>/dev/null || stat -f %m "$home" 2>/dev/null)
  age=$(( (now - mtime) / 86400 ))
  size=$(du -sh "$home" 2>/dev/null | awk '{print $1}')
  flag=""; [ "$age" -gt "$D" ] && flag="  <- stale ($age days since home modified)"
  printf "%-20s %-12s %-10s %s%s\\n" "$user" "$ll" "$size" "$home" "$flag"
done
`,
  },
  {
    key: "old-downloads-report",
    name: "Old downloads report",
    description: "Finds files in every user's Downloads folder older than N days and totals their size (report only).",
    category: "Cleanup",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "days", label: "Older than (days)", type: "number", default: 90 }],
    content: `param([int]$days = 90)
if ($env:MW_PARAM_DAYS) { $days = [int]$env:MW_PARAM_DAYS }
$ErrorActionPreference = 'SilentlyContinue'
$cut = (Get-Date).AddDays(-$days)
$grand = 0
foreach ($u in Get-ChildItem 'C:\\Users' -Directory) {
  $files = Get-ChildItem "$($u.FullName)\\Downloads" -Recurse -File -Force | Where-Object LastWriteTime -lt $cut
  if ($files) { $sum = ($files | Measure-Object Length -Sum).Sum; $grand += $sum; Write-Output ("{0,-20} {1,5} files  {2,8:N1} MB" -f $u.Name, $files.Count, ($sum/1MB)); $files | Sort-Object Length -Descending | Select-Object -First 5 | ForEach-Object { Write-Output ("    {0,8:N1} MB  {1:yyyy-MM-dd}  {2}" -f ($_.Length/1MB), $_.LastWriteTime, $_.Name) } }
}
Write-Output ("Total older than {0} days: {1:N1} MB" -f $days, ($grand/1MB))
`,
  },
  {
    key: "old-downloads-report",
    name: "Old downloads report",
    description: "Finds files in every user's Downloads folder older than N days and totals their size (report only).",
    category: "Cleanup",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "days", label: "Older than (days)", type: "number", default: 90 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
D="\${MW_PARAM_DAYS:-90}"
grand=0
for dl in /home/*/Downloads /root/Downloads /Users/*/Downloads; do
  [ -d "$dl" ] || continue
  n=$(find "$dl" -type f -mtime +"$D" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || continue
  kb=$(find "$dl" -type f -mtime +"$D" -exec du -k {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')
  grand=$((grand+kb))
  printf "%-40s %5s files %8s MB\\n" "$dl" "$n" "$((kb/1024))"
  find "$dl" -type f -mtime +"$D" -exec du -k {} + 2>/dev/null | sort -rn | head -5 | awk '{printf "    %8.1f MB  %s\\n", $1/1024, substr($0, index($0,$2))}'
done
echo "Total older than $D days: $((grand/1024)) MB"
`,
  },
  {
    key: "apt-autoremove-clean",
    name: "Package manager autoremove and clean",
    description: "Removes orphaned dependencies and old kernels, purges removed-package configs and clears the download cache.",
    category: "Cleanup",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    timeoutSeconds: 1800,
    content: `#!/usr/bin/env bash
set -uo pipefail
before=$(df -Pk / | awk 'NR==2 {print $4}')
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get autoremove --purge -y 2>&1 | tail -5
  apt-get autoclean -y >/dev/null 2>&1; apt-get clean
  dpkg -l 2>/dev/null | awk '/^rc/ {print $2}' | xargs -r dpkg --purge 2>/dev/null
  echo "apt: autoremove, clean and purge of removed configs done"
elif command -v dnf >/dev/null 2>&1; then dnf -y autoremove 2>&1 | tail -5; dnf clean all; echo "dnf: autoremove and clean done"
elif command -v zypper >/dev/null 2>&1; then zypper -n packages --unneeded 2>/dev/null | tail -5; zypper clean -a; echo "zypper: clean done"
else echo "No supported package manager found"; exit 2; fi
if command -v snap >/dev/null 2>&1; then snap list --all 2>/dev/null | awk '/disabled/ {print $1, $3}' | while read -r n r; do snap remove "$n" --revision="$r" >/dev/null 2>&1 && echo "snap: removed old revision $n $r"; done; fi
after=$(df -Pk / | awk 'NR==2 {print $4}')
echo "Reclaimed $(( (after-before)/1024 )) MB"
`,
  },
  {
    key: "docker-prune",
    name: "Docker prune",
    description: "Removes stopped containers, dangling images, unused networks and build cache older than a week. Volumes are kept.",
    category: "Cleanup",
    language: "bash",
    platforms: NIX,
    risk: "medium",
    timeoutSeconds: 1800,
    content: `#!/usr/bin/env bash
set -uo pipefail
command -v docker >/dev/null 2>&1 || { echo "Docker is not installed on this device."; exit 0; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running."; exit 1; }
echo "=== Before ==="; docker system df
echo; docker container prune -f --filter "until=168h" | tail -1
docker image prune -af --filter "until=168h" | tail -1
docker network prune -f --filter "until=168h" | tail -1
docker builder prune -af --filter "until=168h" 2>/dev/null | tail -1
echo; echo "=== After ==="; docker system df
`,
  },
  {
    key: "brew-cleanup",
    name: "Homebrew cleanup",
    description: "Removes old formula versions and cached downloads; runs as the signed-in user because brew refuses root.",
    category: "Cleanup",
    language: "bash",
    platforms: MAC,
    runAs: "user",
    content: `#!/usr/bin/env bash
set -uo pipefail
BREW=$(command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1)
[ -n "$BREW" ] || { echo "Homebrew is not installed for this user."; exit 0; }
"$BREW" cleanup -s --prune=7 2>&1 | tail -15
echo "Cache: $(du -sh "$("$BREW" --cache)" 2>/dev/null | awk '{print $1}')"
`,
  },
  {
    key: "force-logrotate",
    name: "Force log rotation",
    description: "Runs logrotate immediately with the system configuration and reports the biggest remaining logs.",
    category: "Cleanup",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
command -v logrotate >/dev/null 2>&1 || { echo "logrotate is not installed"; exit 2; }
before=$(du -sk /var/log 2>/dev/null | awk '{print $1}')
logrotate -f /etc/logrotate.conf 2>&1 | tail -10
after=$(du -sk /var/log 2>/dev/null | awk '{print $1}')
echo "/var/log: $((before/1024)) MB -> $((after/1024)) MB"
echo; echo "=== Largest logs now ==="; find /var/log -type f -size +20M -exec du -h {} + 2>/dev/null | sort -rh | head -10
`,
  },
];

/* =============================================================================================================== Security */

const security: BuiltinTool[] = [
  {
    key: "local-admins-list",
    name: "Local administrators list",
    description: "Members of the local Administrators group (direct and via domain groups) with enabled state and last sign-in.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$members = Get-LocalGroupMember -Group 'Administrators'
if (-not $members) { $members = ([ADSI]'WinNT://./Administrators,group').psbase.Invoke('Members') | ForEach-Object { [pscustomobject]@{ Name = $_.GetType().InvokeMember('Name','GetProperty',$null,$_,$null); ObjectClass = $_.GetType().InvokeMember('Class','GetProperty',$null,$_,$null); PrincipalSource = 'Unknown' } } }
Write-Output "Members of Administrators ($(@($members).Count)):"
foreach ($m in $members) {
  $extra = ''
  if ($m.ObjectClass -eq 'User' -and $m.PrincipalSource -eq 'Local') { $u = Get-LocalUser -Name ($m.Name -split '\\\\')[-1]; if ($u) { $extra = "enabled=$($u.Enabled) lastLogon=$($u.LastLogon) pwdLastSet=$($u.PasswordLastSet)" } }
  Write-Output ("  {0,-45} {1,-6} {2,-12} {3}" -f $m.Name, $m.ObjectClass, $m.PrincipalSource, $extra)
}
Write-Output ""
Write-Output "Built-in Administrator (RID 500): $((Get-LocalUser | Where-Object { $_.SID -like '*-500' }).Enabled | ForEach-Object { if ($_) {'ENABLED'} else {'disabled'} })"
Write-Output "UAC enabled: $((Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System').EnableLUA -eq 1)"
`,
  },
  {
    key: "local-admins-list",
    name: "Local administrators list",
    description: "Accounts that can gain root: sudo/wheel/admin group members plus sudoers entries and UID 0 accounts.",
    category: "Security",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if [ "$(uname)" = "Darwin" ]; then
  echo "admin group:  $(dscl . -read /Groups/admin GroupMembership 2>/dev/null | cut -d: -f2)"
  echo "wheel group:  $(dscl . -read /Groups/wheel GroupMembership 2>/dev/null | cut -d: -f2)"
else
  for g in sudo wheel admin adm; do m=$(getent group "$g" 2>/dev/null | cut -d: -f4); [ -n "$m" ] && echo "$g group:  $m"; done
fi
echo
echo "=== UID 0 accounts ==="; awk -F: '$3==0 {print "  "$1}' /etc/passwd
echo
echo "=== sudoers rules (excluding comments) ==="
{ grep -hvE '^\\s*(#|$|Defaults)' /etc/sudoers 2>/dev/null; for f in /etc/sudoers.d/*; do [ -f "$f" ] && grep -hvE '^\\s*(#|$|Defaults)' "$f" | sed "s|^|$(basename "$f"): |"; done; } | sed 's/^/  /'
echo
echo "=== Last sign-ins of privileged users ==="
for u in $(getent group sudo wheel admin 2>/dev/null | cut -d: -f4 | tr ',' '\\n' | sort -u); do [ -n "$u" ] && echo "  $u: $(last -1 "$u" 2>/dev/null | head -1 | awk '{print $4, $5, $6, $7}')"; done
`,
  },
  {
    key: "guest-account-toggle",
    name: "Enable or disable Guest account",
    description: "Sets the built-in Guest account enabled or disabled (disabled is the secure default).",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "enabled", label: "Enable guest account", type: "boolean", default: false }],
    content: `param([string]$enabled = 'false')
if ($env:MW_PARAM_ENABLED) { $enabled = $env:MW_PARAM_ENABLED }
$ErrorActionPreference = 'Stop'
$on = $enabled -match '^(true|1|yes|on)$'
$guest = Get-LocalUser | Where-Object { $_.SID -like '*-501' }
if (-not $guest) { Write-Output "No Guest account present."; exit 0 }
if ($on) { Enable-LocalUser -Name $guest.Name } else { Disable-LocalUser -Name $guest.Name }
Write-Output ("Guest account '{0}' is now {1}." -f $guest.Name, ($(if ($on) {'ENABLED'} else {'disabled'})))
`,
  },
  {
    key: "guest-account-toggle",
    name: "Enable or disable Guest account",
    description: "Turns the macOS Guest User on or off (off is the secure default).",
    category: "Security",
    language: "bash",
    platforms: MAC,
    risk: "medium",
    parameters: [{ name: "enabled", label: "Enable guest account", type: "boolean", default: false }],
    content: `#!/usr/bin/env bash
set -uo pipefail
case "\${MW_PARAM_ENABLED:-false}" in true|1|yes|on) v=true;; *) v=false;; esac
sysadminctl -guestAccount "$([ $v = true ] && echo on || echo off)" 2>&1 | tail -1
defaults write /Library/Preferences/com.apple.loginwindow GuestEnabled -bool $v
echo "Guest user is now $([ $v = true ] && echo ENABLED || echo disabled)."
`,
  },
  {
    key: "enable-firewall",
    name: "Enable firewall",
    description: "Turns the host firewall on for every profile with inbound blocked by default, keeping existing allow rules.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    content: `$ErrorActionPreference = 'Stop'
Set-Service mpssvc -StartupType Automatic
Start-Service mpssvc -ErrorAction SilentlyContinue
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Allow -NotifyOnListen True -LogBlocked True
Get-NetFirewallProfile | ForEach-Object { Write-Output ("{0,-8} enabled={1} inbound={2}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction) }
Write-Output "Firewall enabled on all profiles."
`,
  },
  {
    key: "enable-firewall",
    name: "Enable firewall",
    description: "Enables ufw (or firewalld) with a deny-incoming default while keeping SSH reachable.",
    category: "Security",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
if command -v ufw >/dev/null 2>&1; then
  ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
  ufw --force enable
  ufw status verbose | head -8
elif command -v firewall-cmd >/dev/null 2>&1; then
  systemctl enable --now firewalld
  firewall-cmd --permanent --add-service=ssh >/dev/null; firewall-cmd --reload >/dev/null
  firewall-cmd --state; firewall-cmd --list-services
else
  echo "Neither ufw nor firewalld is installed. Install one first (apt-get install ufw / dnf install firewalld)."; exit 2
fi
echo "Firewall enabled (SSH allowed)."
`,
  },
  {
    key: "enable-firewall",
    name: "Enable firewall",
    description: "Turns on the macOS application firewall with stealth mode.",
    category: "Security",
    language: "bash",
    platforms: MAC,
    risk: "medium",
    content: `#!/usr/bin/env bash
set -uo pipefail
FW=/usr/libexec/ApplicationFirewall/socketfilterfw
$FW --setglobalstate on >/dev/null
$FW --setstealthmode on >/dev/null
$FW --setallowsigned on >/dev/null
echo "State: $($FW --getglobalstate) / $($FW --getstealthmode)"
`,
  },
  {
    key: "defender-scan",
    name: "Microsoft Defender scan",
    description: "Starts a quick or full Defender scan and reports detections found.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 7200,
    parameters: [{ name: "scantype", label: "Scan type", type: "select", options: ["QuickScan", "FullScan"], default: "QuickScan" }],
    content: `param([string]$scantype = 'QuickScan')
if ($env:MW_PARAM_SCANTYPE) { $scantype = $env:MW_PARAM_SCANTYPE }
$ErrorActionPreference = 'Stop'
$st = Get-MpComputerStatus
if (-not $st.AntivirusEnabled) { Write-Error "Microsoft Defender antivirus is not active on this computer (another AV may be registered)."; exit 2 }
Write-Output "Starting $scantype at $(Get-Date -Format 'HH:mm:ss') (signatures $($st.AntivirusSignatureVersion), age $($st.AntivirusSignatureAge) d)..."
$t0 = Get-Date
Start-MpScan -ScanType $scantype
$st = Get-MpComputerStatus
Write-Output ("Scan finished in {0:N0} s." -f ((Get-Date) - $t0).TotalSeconds)
$threats = Get-MpThreatDetection | Where-Object InitialDetectionTime -ge $t0
if ($threats) { Write-Output "DETECTIONS: $(@($threats).Count)"; $threats | ForEach-Object { $t = Get-MpThreat -ThreatID $_.ThreatID; Write-Output ("  {0} [{1}] {2}" -f $t.ThreatName, $t.SeverityID, ($_.Resources -join '; ')) } } else { Write-Output "No threats detected." }
`,
  },
  {
    key: "defender-signature-update",
    name: "Update Defender signatures",
    description: "Forces a Defender definition update and shows the version/age before and after.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    timeoutSeconds: 900,
    content: `$ErrorActionPreference = 'Continue'
$b = Get-MpComputerStatus
Write-Output ("Before: {0} (age {1} d)" -f $b.AntivirusSignatureVersion, $b.AntivirusSignatureAge)
Update-MpSignature -ErrorAction Continue
$a = Get-MpComputerStatus
Write-Output ("After:  {0} (age {1} d, updated {2})" -f $a.AntivirusSignatureVersion, $a.AntivirusSignatureAge, $a.AntivirusSignatureLastUpdated)
`,
  },
  {
    key: "smbv1-check",
    name: "Check SMBv1",
    description: "Reports whether the insecure SMBv1 protocol is enabled on the server and client side.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$srv = (Get-SmbServerConfiguration).EnableSMB1Protocol
Write-Output "SMB1 server protocol enabled: $srv"
$feat = Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol
if ($feat) { Write-Output "SMB1Protocol feature state: $($feat.State)" }
$client = Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol-Client
if ($client) { Write-Output "SMB1 client feature state: $($client.State)" }
$drv = Get-Service mrxsmb10
if ($drv) { Write-Output "mrxsmb10 driver: $($drv.Status) / start type $($drv.StartType)" } else { Write-Output "mrxsmb10 driver: not present" }
Write-Output ""
Write-Output "SMB2/3 enabled: $((Get-SmbServerConfiguration).EnableSMB2Protocol)"
Write-Output "SMB signing required: $((Get-SmbServerConfiguration).RequireSecuritySignature)"
if ($srv -or ($feat -and $feat.State -eq 'Enabled')) { Write-Output ""; Write-Output "RESULT: SMBv1 is ENABLED - run 'Disable SMBv1'." } else { Write-Output ""; Write-Output "RESULT: SMBv1 is disabled." }
`,
  },
  {
    key: "smbv1-disable",
    name: "Disable SMBv1",
    description: "Turns off the SMBv1 server protocol and removes the SMB1 optional feature (a restart finalises the removal).",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    timeoutSeconds: 900,
    content: `$ErrorActionPreference = 'Continue'
Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart | Out-Null
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol-Client -NoRestart -ErrorAction SilentlyContinue | Out-Null
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol-Server -NoRestart -ErrorAction SilentlyContinue | Out-Null
sc.exe config lanmanworkstation depend= bowser/mrxsmb20/nsi | Out-Null
sc.exe config mrxsmb10 start= disabled | Out-Null
Write-Output "SMB1 server protocol enabled: $((Get-SmbServerConfiguration).EnableSMB1Protocol)"
Write-Output "SMB1Protocol feature: $((Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol).State)"
Write-Output "SMBv1 disabled. A restart completes the feature removal."
`,
  },
  {
    key: "rdp-toggle",
    name: "Enable or disable Remote Desktop",
    description: "Enables RDP with Network Level Authentication and the firewall rule group, or disables it entirely.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "enabled", label: "Enable Remote Desktop", type: "boolean", default: true }],
    content: `param([string]$enabled = 'true')
if ($env:MW_PARAM_ENABLED) { $enabled = $env:MW_PARAM_ENABLED }
$ErrorActionPreference = 'Stop'
$on = $enabled -match '^(true|1|yes|on)$'
$ts = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server'
if ($on) {
  Set-ItemProperty $ts -Name fDenyTSConnections -Value 0
  Set-ItemProperty "$ts\\WinStations\\RDP-Tcp" -Name UserAuthentication -Value 1
  Set-ItemProperty "$ts\\WinStations\\RDP-Tcp" -Name SecurityLayer -Value 2
  Enable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue
  Set-Service TermService -StartupType Automatic; Start-Service TermService -ErrorAction SilentlyContinue
  Write-Output "Remote Desktop ENABLED with Network Level Authentication (TLS). Port: $((Get-ItemProperty "$ts\\WinStations\\RDP-Tcp").PortNumber)"
} else {
  Set-ItemProperty $ts -Name fDenyTSConnections -Value 1
  Disable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue
  Write-Output "Remote Desktop DISABLED and firewall rules closed."
}
`,
  },
  {
    key: "ssh-hardening-check",
    name: "SSH hardening check",
    description: "Reads the effective sshd configuration and flags weak settings (root login, password auth, old ciphers, X11 forwarding).",
    category: "Security",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ]; then echo "sshd is not installed."; exit 0; fi
SSHD=$(command -v sshd || echo /usr/sbin/sshd)
cfg=$($SSHD -T 2>/dev/null) || { echo "Could not read effective config (sshd -T failed; is the service installed as root?)"; exit 1; }
if [ "$(uname)" = "Darwin" ]; then echo "Remote Login: $(systemsetup -getremotelogin 2>/dev/null)"; else echo "Service: $(systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null)"; fi
echo
chk() { # chk <key> <good-regex> <advice>
  v=$(echo "$cfg" | awk -v k="$1" 'tolower($1)==k {$1=""; print substr($0,2); exit}')
  if echo "$v" | grep -qiE "$2"; then printf "[ok]   %-28s %s\\n" "$1" "$v"; else printf "[WEAK] %-28s %s  -> %s\\n" "$1" "$v" "$3"; fi
}
chk permitrootlogin '^(no|prohibit-password|without-password)$' "set PermitRootLogin no"
chk passwordauthentication '^no$' "use keys only: PasswordAuthentication no"
chk permitemptypasswords '^no$' "PermitEmptyPasswords no"
chk pubkeyauthentication '^yes$' "PubkeyAuthentication yes"
chk x11forwarding '^no$' "X11Forwarding no"
chk maxauthtries '^[1-6]$' "MaxAuthTries 4"
chk logingracetime '^([1-5]?[0-9]|60)$' "LoginGraceTime 60"
chk clientaliveinterval '^([1-9][0-9]{0,2})$' "ClientAliveInterval 300"
chk allowtcpforwarding '^no$' "AllowTcpForwarding no (unless needed)"
chk usepam '^yes$' "UsePAM yes"
chk loglevel '^(verbose|info)$' "LogLevel VERBOSE"
echo
echo "Ciphers: $(echo "$cfg" | awk '$1=="ciphers" {print $2}')"
echo "MACs:    $(echo "$cfg" | awk '$1=="macs" {print $2}')"
echo "KEX:     $(echo "$cfg" | awk '$1=="kexalgorithms" {print $2}')"
echo "$cfg" | awk '$1=="ciphers" {print $2}' | grep -qiE 'cbc|arcfour|3des' && echo "[WEAK] CBC/arcfour/3des ciphers are enabled"
echo
echo "Listening: $(echo "$cfg" | awk '$1=="port" {print $2}' | tr '\\n' ' ')  AllowUsers: $(echo "$cfg" | awk '$1=="allowusers" {$1=""; print}' | tr -s ' ')"
`,
  },
  {
    key: "failed-logins-report",
    name: "Failed sign-in report",
    description: "Failed sign-in attempts in the last 24 hours grouped by account and source address (Security log event 4625).",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "hours", label: "Look back (hours)", type: "number", default: 24 }],
    content: `param([int]$hours = 24)
if ($env:MW_PARAM_HOURS) { $hours = [int]$env:MW_PARAM_HOURS }
$ErrorActionPreference = 'SilentlyContinue'
$ev = Get-WinEvent -FilterHashtable @{ LogName='Security'; Id=4625; StartTime=(Get-Date).AddHours(-$hours) } -MaxEvents 5000
Write-Output "Failed sign-ins in the last $hours h: $(@($ev).Count)"
if (-not $ev) { exit 0 }
$rows = $ev | ForEach-Object { $x = [xml]$_.ToXml(); $d = @{}; $x.Event.EventData.Data | ForEach-Object { $d[$_.Name] = $_.'#text' }; [pscustomobject]@{ Time=$_.TimeCreated; Account="$($d.TargetDomainName)\\$($d.TargetUserName)"; Source=$d.IpAddress; Workstation=$d.WorkstationName; LogonType=$d.LogonType; Status=$d.SubStatus } }
Write-Output ""; Write-Output "=== By account ==="
$rows | Group-Object Account | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0,5}  {1}" -f $_.Count, $_.Name) }
Write-Output ""; Write-Output "=== By source address ==="
$rows | Group-Object Source | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { Write-Output ("{0,5}  {1}" -f $_.Count, $_.Name) }
Write-Output ""; Write-Output "=== Reasons ==="
$reasons = @{ '0xc000006a'='bad password'; '0xc0000064'='unknown user'; '0xc0000234'='account locked'; '0xc0000072'='account disabled'; '0xc000006f'='outside logon hours'; '0xc0000070'='workstation restriction'; '0xc0000193'='account expired'; '0xc0000071'='password expired'; '0xc0000133'='clock skew'; '0xc000015b'='logon type not granted' }
$rows | Group-Object Status | Sort-Object Count -Descending | ForEach-Object { Write-Output ("{0,5}  {1} ({2})" -f $_.Count, $_.Name, $reasons[$_.Name.ToLower()]) }
Write-Output ""; Write-Output "=== Most recent 10 ==="
$rows | Select-Object -First 10 | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm:ss}  {1,-30} from {2,-15} type {3}" -f $_.Time, $_.Account, $_.Source, $_.LogonType) }
Write-Output ""; Write-Output "=== Locked out accounts (4740) ==="
Get-WinEvent -FilterHashtable @{ LogName='Security'; Id=4740; StartTime=(Get-Date).AddHours(-$hours) } -MaxEvents 20 | ForEach-Object { Write-Output ("{0:yyyy-MM-dd HH:mm}  {1}" -f $_.TimeCreated, (($_.Message -split "\\r?\\n")[0])) }
`,
  },
  {
    key: "failed-logins-report",
    name: "Failed sign-in report",
    description: "Failed SSH/console/sudo sign-in attempts in the last 24 hours grouped by account and source address.",
    category: "Security",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "hours", label: "Look back (hours)", type: "number", default: 24 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
H="\${MW_PARAM_HOURS:-24}"
if [ "$(uname)" = "Darwin" ]; then
  echo "=== Failed authentications, last $H h (unified log) ==="
  log show --last "\${H}h" --predicate 'eventMessage CONTAINS[c] "authentication failed" OR eventMessage CONTAINS[c] "Failed to authenticate" OR (process == "sshd" AND eventMessage CONTAINS "Failed")' --style compact 2>/dev/null | tail -40
  exit 0
fi
if command -v journalctl >/dev/null 2>&1; then src=$(journalctl --since "$H hours ago" --no-pager -o short-iso 2>/dev/null | grep -E 'Failed password|Invalid user|authentication failure|FAILED LOGIN|FAILED su|pam_unix.*auth.*fail'); else src=$(grep -hE 'Failed password|Invalid user|authentication failure|FAILED LOGIN' /var/log/auth.log /var/log/secure 2>/dev/null | tail -5000); fi
total=$(echo "$src" | grep -c . || true)
echo "Failed sign-ins in the last $H h: $total"
[ "$total" -gt 0 ] || exit 0
echo; echo "=== By account ==="
echo "$src" | grep -oE '(for (invalid user )?|user=)[A-Za-z0-9._-]+' | sed -E 's/for (invalid user )?//; s/user=//' | sort | uniq -c | sort -rn | head -15
echo; echo "=== By source address ==="
echo "$src" | grep -oE '(from |rhost=)[0-9a-fA-F.:]+' | sed -E 's/from |rhost=//' | sort | uniq -c | sort -rn | head -15
echo; echo "=== Most recent 10 ==="; echo "$src" | tail -10
if command -v lastb >/dev/null 2>&1; then echo; echo "=== lastb (bad logins) ==="; lastb -n 10 2>/dev/null; fi
if command -v faillock >/dev/null 2>&1; then echo; echo "=== Locked accounts (faillock) ==="; faillock 2>/dev/null | grep -B1 -E '^[0-9]' | head -20; fi
`,
  },
  {
    key: "usb-storage-toggle",
    name: "Block or allow USB storage",
    description: "Blocks (or re-allows) USB mass-storage devices via the USBSTOR driver start value; already-mounted drives are not ejected.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "blocked", label: "Block USB storage", type: "boolean", default: true }],
    content: `param([string]$blocked = 'true')
if ($env:MW_PARAM_BLOCKED) { $blocked = $env:MW_PARAM_BLOCKED }
$ErrorActionPreference = 'Stop'
$block = $blocked -match '^(true|1|yes|on)$'
$key = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USBSTOR'
Set-ItemProperty $key -Name Start -Value $(if ($block) { 4 } else { 3 }) -Type DWord
$pol = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\RemovableStorageDevices\\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}'
if ($block) { New-Item $pol -Force | Out-Null; Set-ItemProperty $pol -Name Deny_All -Value 1 -Type DWord } elseif (Test-Path $pol) { Remove-Item $pol -Recurse -Force }
Write-Output ("USB storage is now {0} (USBSTOR Start={1}). Devices plugged in from now on are affected." -f ($(if ($block) {'BLOCKED'} else {'allowed'})), (Get-ItemProperty $key).Start)
`,
  },
  {
    key: "usb-storage-toggle",
    name: "Block or allow USB storage",
    description: "Blocks (or re-allows) the usb-storage kernel module via a modprobe blacklist; already-mounted drives are not ejected.",
    category: "Security",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    parameters: [{ name: "blocked", label: "Block USB storage", type: "boolean", default: true }],
    content: `#!/usr/bin/env bash
set -uo pipefail
F=/etc/modprobe.d/magicwand-usb-storage.conf
case "\${MW_PARAM_BLOCKED:-true}" in true|1|yes|on) block=1;; *) block=0;; esac
if [ $block = 1 ]; then
  printf 'blacklist usb-storage\\nblacklist uas\\ninstall usb-storage /bin/false\\ninstall uas /bin/false\\n' > "$F"
  modprobe -r uas usb-storage 2>/dev/null || true
  echo "USB storage BLOCKED ($F written, modules unloaded where possible)."
else
  rm -f "$F"; echo "USB storage allowed ($F removed)."
fi
command -v update-initramfs >/dev/null 2>&1 && update-initramfs -u >/dev/null 2>&1 && echo "initramfs updated"
command -v dracut >/dev/null 2>&1 && dracut -f >/dev/null 2>&1 && echo "initramfs rebuilt (dracut)"
`,
  },
  {
    key: "screensaver-lock-policy",
    name: "Screen lock policy",
    description: "Enforces a password-protected screen saver after N minutes of inactivity for all users (machine policy).",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "minutes", label: "Lock after (minutes)", type: "number", default: 10 }],
    content: `param([int]$minutes = 10)
if ($env:MW_PARAM_MINUTES) { $minutes = [int]$env:MW_PARAM_MINUTES }
$ErrorActionPreference = 'Stop'
$key = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop'
New-Item $key -Force | Out-Null
Set-ItemProperty $key -Name ScreenSaveActive -Value '1' -Type String
Set-ItemProperty $key -Name ScreenSaverIsSecure -Value '1' -Type String
Set-ItemProperty $key -Name ScreenSaveTimeOut -Value ([string]($minutes * 60)) -Type String
Set-ItemProperty $key -Name SCRNSAVE.EXE -Value 'scrnsave.scr' -Type String
# Also the machine inactivity limit (applies on the lock screen path even when the saver is disabled)
$sec = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
Set-ItemProperty $sec -Name InactivityTimeoutSecs -Value ($minutes * 60) -Type DWord
gpupdate /target:user /force 2>$null | Out-Null
Write-Output "Screen lock enforced after $minutes minute(s) of inactivity for all users (policy keys written; applies at next policy refresh or sign-in)."
`,
  },
  {
    key: "screensaver-lock-policy",
    name: "Screen lock policy",
    description: "Requires a password immediately after sleep/screen saver and starts the screen saver after N minutes for all users.",
    category: "Security",
    language: "bash",
    platforms: MAC,
    risk: "medium",
    parameters: [{ name: "minutes", label: "Lock after (minutes)", type: "number", default: 10 }],
    content: `#!/usr/bin/env bash
set -uo pipefail
M="\${MW_PARAM_MINUTES:-10}"
S=$((M*60))
for home in /Users/*; do
  u=$(basename "$home"); [ "$u" = Shared ] && continue; id "$u" >/dev/null 2>&1 || continue
  sudo -u "$u" defaults -currentHost write com.apple.screensaver idleTime -int "$S" 2>/dev/null
  sudo -u "$u" defaults write com.apple.screensaver askForPassword -int 1 2>/dev/null
  sudo -u "$u" defaults write com.apple.screensaver askForPasswordDelay -int 0 2>/dev/null
  echo "configured for $u"
done
sysadminctl -screenLock immediate -password - >/dev/null 2>&1 || true
pmset -a displaysleep "$M" >/dev/null 2>&1 || true
echo "Screen saver after $M min with immediate password requirement (takes effect at next login or after restarting the preferences agent)."
`,
  },
  {
    key: "password-policy-report",
    name: "Password policy report",
    description: "Minimum length, complexity, history, max age and lockout thresholds in force on this computer.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
net accounts
Write-Output ""
$tmp = "$env:TEMP\\secpol-$PID.inf"
secedit /export /cfg $tmp /quiet | Out-Null
if (Test-Path $tmp) {
  Write-Output "=== Local security policy ==="
  Get-Content $tmp | Select-String 'PasswordComplexity|ClearTextPassword|MinimumPasswordLength|PasswordHistorySize|MaximumPasswordAge|MinimumPasswordAge|LockoutBadCount|ResetLockoutCount|LockoutDuration' | ForEach-Object { $_.Line }
  Remove-Item $tmp -Force
}
Write-Output ""
Write-Output "=== Accounts with password never expires ==="
Get-LocalUser | Where-Object { $_.Enabled -and $_.PasswordNeverExpires } | ForEach-Object { Write-Output ("  {0} (last set {1})" -f $_.Name, $_.PasswordLastSet) }
`,
  },
  {
    key: "password-policy-report",
    name: "Password policy report",
    description: "login.defs ageing, PAM quality rules and faillock thresholds, plus accounts with no password or no expiry.",
    category: "Security",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if [ "$(uname)" = "Darwin" ]; then
  echo "=== Global account policies ==="; pwpolicy -getaccountpolicies 2>/dev/null | grep -E 'policyContent|policyIdentifier|minimumLength|maxFailed|policyAttributeExpires' | sed 's/^ *//' | head -30
  echo; echo "=== Users without password required ==="; for u in $(dscl . -list /Users UniqueID | awk '$2>=500 {print $1}'); do dscl . -authonly "$u" "" >/dev/null 2>&1 && echo "  $u has an EMPTY password"; done; echo "(done)"
  exit 0
fi
echo "=== /etc/login.defs ==="; grep -E '^(PASS_MAX_DAYS|PASS_MIN_DAYS|PASS_MIN_LEN|PASS_WARN_AGE|ENCRYPT_METHOD|LOGIN_RETRIES)' /etc/login.defs 2>/dev/null
echo; echo "=== PAM password quality ==="; grep -hE 'pam_pwquality|pam_cracklib|pam_unix.*(remember|minlen)|pam_pwhistory' /etc/pam.d/common-password /etc/pam.d/system-auth /etc/pam.d/password-auth 2>/dev/null | sort -u
[ -f /etc/security/pwquality.conf ] && { echo "--- pwquality.conf ---"; grep -vE '^\\s*(#|$)' /etc/security/pwquality.conf; }
echo; echo "=== Lockout (faillock / tally) ==="; grep -hE 'pam_faillock|pam_tally' /etc/pam.d/common-auth /etc/pam.d/system-auth /etc/pam.d/password-auth 2>/dev/null | sort -u; [ -f /etc/security/faillock.conf ] && grep -vE '^\\s*(#|$)' /etc/security/faillock.conf
echo; echo "=== Accounts with empty password ==="; awk -F: '($2=="" || $2=="!" && 0) {print "  "$1}' /etc/shadow 2>/dev/null; awk -F: '$2=="" {print "  "$1" (EMPTY)"}' /etc/shadow 2>/dev/null
echo; echo "=== Interactive accounts: max age / last change ==="
awk -F: '$3>=1000 && $7 !~ /(nologin|false)$/ {print $1}' /etc/passwd | while read -r u; do printf "  %-16s %s\\n" "$u" "$(chage -l "$u" 2>/dev/null | grep -E 'Last password change|Maximum' | awk -F: '{printf "%s;", $2}')"; done
`,
  },
  {
    key: "audit-sudoers",
    name: "Audit sudoers",
    description: "Validates sudoers syntax and lists every rule, highlighting NOPASSWD and ALL grants.",
    category: "Security",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "=== Syntax check ==="; visudo -c 2>&1
echo; echo "=== Rules ==="
for f in /etc/sudoers /etc/sudoers.d/*; do
  [ -f "$f" ] || continue
  grep -vE '^\\s*(#|$)' "$f" 2>/dev/null | while IFS= read -r line; do
    flag=""
    echo "$line" | grep -q NOPASSWD && flag="$flag [NOPASSWD]"
    echo "$line" | grep -qE 'ALL\\s*=\\s*\\(ALL(:ALL)?\\)\\s*(NOPASSWD:\\s*)?ALL' && flag="$flag [FULL ROOT]"
    echo "$line" | grep -qE '^\\s*Defaults.*!?(authenticate|requiretty|env_reset)' && flag="$flag [security default]"
    printf "%-28s %s%s\\n" "$(basename "$f")" "$line" "$flag"
  done
done
echo; echo "=== Users able to run sudo (group membership) ==="
for g in sudo wheel admin; do m=$(getent group "$g" 2>/dev/null | cut -d: -f4); [ -n "$m" ] && echo "  $g: $m"; done
[ "$(uname)" = "Darwin" ] && echo "  admin: $(dscl . -read /Groups/admin GroupMembership 2>/dev/null | cut -d: -f2)"
echo; echo "=== Recent sudo usage (last 50) ==="
if command -v journalctl >/dev/null 2>&1; then journalctl _COMM=sudo --no-pager -o short-iso --since "7 days ago" 2>/dev/null | grep -E 'COMMAND=' | tail -50 | sed 's/^/  /'; else grep -hE 'sudo.*COMMAND=' /var/log/auth.log /var/log/secure 2>/dev/null | tail -50 | sed 's/^/  /'; fi
`,
  },
  {
    key: "open-shares-list",
    name: "Open shares list",
    description: "SMB shares with their paths and permissions, plus whether Everyone/Guest has access.",
    category: "Security",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$shares = Get-SmbShare | Where-Object { $_.Name -notin 'IPC$' }
foreach ($s in $shares) {
  Write-Output ("=== {0}  ->  {1}  ({2})" -f $s.Name, $s.Path, $s.Description)
  Get-SmbShareAccess -Name $s.Name | ForEach-Object { $flag = if ($_.AccountName -match 'Everyone|Guest|ANONYMOUS|Authenticated Users' -and $_.AccessControlType -eq 'Allow') { '  <- broad access' } else { '' }; Write-Output ("    {0,-40} {1,-6} {2}{3}" -f $_.AccountName, $_.AccessControlType, $_.AccessRight, $flag) }
}
Write-Output ""
Write-Output ("Administrative shares (C$ etc.) present: {0}" -f (@($shares | Where-Object Name -match '^[A-Z]\\$$|ADMIN\\$').Count -gt 0))
Write-Output ("Active SMB sessions: {0}" -f @(Get-SmbSession).Count)
Write-Output ("Open files over SMB: {0}" -f @(Get-SmbOpenFile).Count)
`,
  },
  {
    key: "open-shares-list",
    name: "Open shares list",
    description: "Samba shares, NFS exports and macOS file sharing configuration with guest-access warnings.",
    category: "Security",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if [ "$(uname)" = "Darwin" ]; then
  echo "=== File sharing ==="; sharing -l 2>/dev/null || echo "(no shares)"
  echo; echo "Screen sharing: $(launchctl list 2>/dev/null | grep -c screensharing) service(s) loaded"
  exit 0
fi
if command -v testparm >/dev/null 2>&1; then
  echo "=== Samba shares (testparm) ==="; testparm -s 2>/dev/null | awk '/^\\[/ {sec=$0; print sec} /path|guest ok|read only|writeable|valid users|browseable/ {print "   " $0}'
  testparm -s 2>/dev/null | grep -qiE 'guest ok *= *yes' && echo "WARNING: at least one share allows guest access"
  echo; echo "Active SMB sessions: $(smbstatus -b 2>/dev/null | awk 'NR>4 && NF' | wc -l)"
else echo "Samba is not installed."; fi
echo
if command -v exportfs >/dev/null 2>&1; then echo "=== NFS exports ==="; exportfs -v 2>/dev/null || echo "(none)"; else echo "NFS server is not installed."; fi
`,
  },
];

/* =============================================================================================================== Users & sessions */

const users: BuiltinTool[] = [
  {
    key: "logged-on-users",
    name: "Logged-on users",
    description: "Interactive sessions with state (active/disconnected), idle time, logon time and session type.",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$q = quser 2>$null
if ($q) { $q } else { Write-Output "No interactive sessions." }
Write-Output ""
Write-Output "=== Console user ==="
Write-Output ((Get-CimInstance Win32_ComputerSystem).UserName)
Write-Output ""
Write-Output "=== Logon sessions (Win32_LogonSession, interactive/remote) ==="
Get-CimInstance Win32_LogonSession | Where-Object { $_.LogonType -in 2,10,11 } | ForEach-Object { $u = Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_Account | Select-Object -First 1; if ($u) { Write-Output ("{0,-30} type {1,-3} since {2}" -f "$($u.Domain)\\$($u.Name)", $_.LogonType, $_.StartTime) } }
`,
  },
  {
    key: "logged-on-users",
    name: "Logged-on users",
    description: "Interactive sessions with terminal, source address, idle time and login time.",
    category: "Users & sessions",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
echo "=== who ==="; who -u 2>/dev/null || who
echo
if command -v loginctl >/dev/null 2>&1; then echo "=== loginctl sessions ==="; loginctl list-sessions --no-legend 2>/dev/null | while read -r id uid user seat tty rest; do printf "%-6s %-16s seat=%-6s tty=%-8s state=%s idle=%s\\n" "$id" "$user" "$seat" "$tty" "$(loginctl show-session "$id" -p State --value 2>/dev/null)" "$(loginctl show-session "$id" -p IdleHint --value 2>/dev/null)"; done; echo; fi
if [ "$(uname)" = "Darwin" ]; then echo "Console user: $(stat -f %Su /dev/console)"; echo "Screen locked: $(python3 -c 'import Quartz; d=Quartz.CGSessionCopyCurrentDictionary(); print(bool(d.get("CGSSessionScreenIsLocked",0)))' 2>/dev/null || echo unknown)"; fi
echo; echo "=== Last 10 logins ==="; last -n 10 2>/dev/null | head -10
`,
  },
  {
    key: "logoff-idle-sessions",
    name: "Log off idle and disconnected sessions",
    description: "Logs off sessions that are disconnected or idle for more than N minutes (the console session is never touched).",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "idleminutes", label: "Idle longer than (minutes)", type: "number", default: 120 }, { name: "dryrun", label: "Report only (no logoff)", type: "boolean", default: false }],
    content: `param([int]$idleminutes = 120, [string]$dryrun = 'false')
if ($env:MW_PARAM_IDLEMINUTES) { $idleminutes = [int]$env:MW_PARAM_IDLEMINUTES }
if ($env:MW_PARAM_DRYRUN) { $dryrun = $env:MW_PARAM_DRYRUN }
$ErrorActionPreference = 'SilentlyContinue'
$dry = $dryrun -match '^(true|1|yes|on)$'
$lines = quser 2>$null | Select-Object -Skip 1
if (-not $lines) { Write-Output "No interactive sessions."; exit 0 }
$count = 0
foreach ($l in $lines) {
  $f = ($l.Trim() -replace '\\s{2,}', ',') -split ','
  if ($l -match '^\\s*>') { $f[0] = $f[0].TrimStart('>') }
  $disconnected = $l -match '\\sDisc\\s'
  if ($disconnected) { $user,$id,$state,$idle = $f[0],$f[1],$f[2],$f[3] } else { $user,$session,$id,$state,$idle = $f[0],$f[1],$f[2],$f[3],$f[4] }
  if ($id -eq '1' -and -not $disconnected -and $session -eq 'console') { Write-Output "skip  $user (console session $id)"; continue }
  $idleMin = 0
  if ($idle -match '^(\\d+)\\+(\\d+):(\\d+)$') { $idleMin = [int]$matches[1]*1440 + [int]$matches[2]*60 + [int]$matches[3] } elseif ($idle -match '^(\\d+):(\\d+)$') { $idleMin = [int]$matches[1]*60 + [int]$matches[2] } elseif ($idle -match '^\\d+$') { $idleMin = [int]$idle }
  if ($disconnected -or $idleMin -ge $idleminutes) {
    if ($dry) { Write-Output "would log off  $user (session $id, $(if ($disconnected) {'disconnected'} else {"idle $idleMin min"}))" } else { logoff $id; Write-Output "logged off  $user (session $id, $(if ($disconnected) {'disconnected'} else {"idle $idleMin min"}))"; $count++ }
  } else { Write-Output "keep  $user (session $id, idle $idleMin min)" }
}
Write-Output "Done: $count session(s) logged off."
`,
  },
  {
    key: "logoff-idle-sessions",
    name: "Log off idle and disconnected sessions",
    description: "Terminates login sessions that report idle for more than N minutes (the session running this tool is never touched).",
    category: "Users & sessions",
    language: "bash",
    platforms: LIN,
    risk: "medium",
    parameters: [{ name: "idleminutes", label: "Idle longer than (minutes)", type: "number", default: 120 }, { name: "dryrun", label: "Report only (no logoff)", type: "boolean", default: false }],
    content: `#!/usr/bin/env bash
set -uo pipefail
M="\${MW_PARAM_IDLEMINUTES:-120}"
case "\${MW_PARAM_DRYRUN:-false}" in true|1|yes|on) dry=1;; *) dry=0;; esac
command -v loginctl >/dev/null 2>&1 || { echo "loginctl not available"; exit 2; }
now=$(date +%s); n=0
for id in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
  user=$(loginctl show-session "$id" -p Name --value 2>/dev/null)
  idle=$(loginctl show-session "$id" -p IdleHint --value 2>/dev/null)
  since=$(loginctl show-session "$id" -p IdleSinceHintMonotonic --value 2>/dev/null)
  class=$(loginctl show-session "$id" -p Class --value 2>/dev/null)
  [ "$class" = "user" ] || continue
  if [ "$idle" = "yes" ] && [ -n "$since" ] && [ "$since" != "0" ]; then
    up=$(awk '{print int($1*1000000)}' /proc/uptime); mins=$(( (up - since) / 60000000 ))
    if [ "$mins" -ge "$M" ]; then
      if [ $dry = 1 ]; then echo "would terminate session $id ($user, idle $mins min)"; else loginctl terminate-session "$id" && echo "terminated session $id ($user, idle $mins min)" && n=$((n+1)); fi
    else echo "keep session $id ($user, idle $mins min)"; fi
  else echo "keep session $id ($user, active)"; fi
done
echo "Done: $n session(s) terminated."
`,
  },
  {
    key: "unlock-account",
    name: "Unlock local account",
    description: "Clears the lockout and re-enables a local account so the user can sign in again.",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    risk: "medium",
    parameters: [{ name: "username", label: "User name", type: "string", required: true }],
    content: `param([string]$username = $env:MW_PARAM_USERNAME)
if ($env:MW_PARAM_USERNAME) { $username = $env:MW_PARAM_USERNAME }
$ErrorActionPreference = 'Stop'
if (-not $username) { Write-Error "username is required"; exit 2 }
$u = Get-LocalUser -Name $username -ErrorAction SilentlyContinue
if (-not $u) { Write-Error "Local user '$username' not found (domain accounts must be unlocked in Active Directory)"; exit 2 }
$adsi = [ADSI]"WinNT://./$username,user"
if ($adsi.IsAccountLocked) { $adsi.IsAccountLocked = $false; $adsi.SetInfo(); Write-Output "Lockout cleared." } else { Write-Output "Account was not locked out." }
if (-not $u.Enabled) { Enable-LocalUser -Name $username; Write-Output "Account re-enabled." }
net user $username /active:yes | Out-Null
$u = Get-LocalUser -Name $username
Write-Output ("{0}: enabled={1} lastLogon={2} passwordExpires={3}" -f $u.Name, $u.Enabled, $u.LastLogon, $u.PasswordExpires)
`,
  },
  {
    key: "unlock-account",
    name: "Unlock local account",
    description: "Resets faillock/pam_tally counters and removes the password lock so the user can sign in again.",
    category: "Users & sessions",
    language: "bash",
    platforms: NIX,
    risk: "medium",
    parameters: [{ name: "username", label: "User name", type: "string", required: true }],
    content: `#!/usr/bin/env bash
set -uo pipefail
U="\${MW_PARAM_USERNAME:-}"
[ -n "$U" ] || { echo "username is required" >&2; exit 2; }
id "$U" >/dev/null 2>&1 || { echo "User '$U' not found" >&2; exit 2; }
if [ "$(uname)" = "Darwin" ]; then
  pwpolicy -u "$U" -clearaccountpolicies >/dev/null 2>&1 || true
  dscl . -delete "/Users/$U" AuthenticationAuthority ";DisabledUser;" 2>/dev/null || true
  echo "Cleared account policies / disabled flag for $U."
  exit 0
fi
command -v faillock >/dev/null 2>&1 && faillock --user "$U" --reset && echo "faillock counter reset"
command -v pam_tally2 >/dev/null 2>&1 && pam_tally2 --user "$U" --reset >/dev/null && echo "pam_tally2 counter reset"
if passwd -S "$U" 2>/dev/null | awk '{print $2}' | grep -q '^L'; then passwd -u "$U" >/dev/null && echo "password lock removed"; else echo "password was not locked"; fi
usermod -U "$U" 2>/dev/null || true
if chage -l "$U" 2>/dev/null | grep -q 'Account expires.*: *never'; then :; else chage -E -1 "$U" 2>/dev/null && echo "account expiry cleared"; fi
echo "Status: $(passwd -S "$U" 2>/dev/null)"
`,
  },
  {
    key: "list-local-accounts",
    name: "List local accounts",
    description: "Every local account with enabled state, admin membership, last logon and password age.",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    content: `$ErrorActionPreference = 'SilentlyContinue'
$admins = (Get-LocalGroupMember Administrators | ForEach-Object { ($_.Name -split '\\\\')[-1] })
Get-LocalUser | Sort-Object Enabled -Descending | ForEach-Object {
  [pscustomobject]@{ Name=$_.Name; Enabled=$_.Enabled; Admin=($admins -contains $_.Name); LastLogon=$_.LastLogon; PasswordLastSet=$_.PasswordLastSet; NeverExpires=$_.PasswordNeverExpires; Description=$_.Description }
} | Format-Table -AutoSize | Out-String -Width 220
`,
  },
  {
    key: "list-local-accounts",
    name: "List local accounts",
    description: "Every interactive local account with UID, shell, groups, last login and lock state.",
    category: "Users & sessions",
    language: "bash",
    platforms: NIX,
    content: `#!/usr/bin/env bash
set -uo pipefail
if [ "$(uname)" = "Darwin" ]; then
  printf "%-20s %-6s %-6s %-30s %s\\n" USER UID ADMIN HOME SHELL
  dscl . -list /Users UniqueID | awk '$2>=500' | while read -r u uid; do adm=no; dseditgroup -o checkmember -m "$u" admin >/dev/null 2>&1 && adm=YES; printf "%-20s %-6s %-6s %-30s %s\\n" "$u" "$uid" "$adm" "$(dscl . -read /Users/$u NFSHomeDirectory 2>/dev/null | cut -d' ' -f2)" "$(dscl . -read /Users/$u UserShell 2>/dev/null | cut -d' ' -f2)"; done
  exit 0
fi
printf "%-18s %-6s %-8s %-22s %-24s %s\\n" USER UID LOCKED GROUPS LASTLOGIN SHELL
awk -F: '$3>=1000 && $3<65534 {print $1":"$3":"$7}' /etc/passwd | while IFS=: read -r u uid sh; do
  st=$(passwd -S "$u" 2>/dev/null | awk '{print $2}'); case "$st" in L|LK) lk=yes;; *) lk=no;; esac
  g=$(id -nG "$u" 2>/dev/null | tr ' ' ',' | cut -c1-22)
  ll=$(lastlog -u "$u" 2>/dev/null | awk 'NR==2 {if ($0 ~ /Never/) print "never"; else print $4, $5, $6, $9}')
  printf "%-18s %-6s %-8s %-22s %-24s %s\\n" "$u" "$uid" "$lk" "$g" "\${ll:-?}" "$sh"
done
echo; echo "root: $(passwd -S root 2>/dev/null)"
`,
  },
  {
    key: "admin-group-toggle",
    name: "Add or remove local administrator",
    description: "Adds a user to or removes them from the local Administrators group (domain users as DOMAIN\\user).",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    risk: "high",
    parameters: [{ name: "username", label: "User (or DOMAIN\\user)", type: "string", required: true }, { name: "action", label: "Action", type: "select", options: ["add", "remove"], default: "add" }],
    content: `param([string]$username = $env:MW_PARAM_USERNAME, [string]$action = 'add')
if ($env:MW_PARAM_USERNAME) { $username = $env:MW_PARAM_USERNAME }
if ($env:MW_PARAM_ACTION) { $action = $env:MW_PARAM_ACTION }
$ErrorActionPreference = 'Stop'
if (-not $username) { Write-Error "username is required"; exit 2 }
$members = Get-LocalGroupMember Administrators | ForEach-Object { $_.Name }
$isMember = $members | Where-Object { $_ -ieq $username -or ($_ -split '\\\\')[-1] -ieq $username }
if ($action -eq 'add') {
  if ($isMember) { Write-Output "$username is already a local administrator." } else { Add-LocalGroupMember -Group Administrators -Member $username; Write-Output "$username ADDED to local Administrators." }
} else {
  if (-not $isMember) { Write-Output "$username is not a local administrator." } else { Remove-LocalGroupMember -Group Administrators -Member $isMember; Write-Output "$username REMOVED from local Administrators." }
}
Write-Output "Administrators now: $((Get-LocalGroupMember Administrators | ForEach-Object Name) -join ', ')"
`,
  },
  {
    key: "admin-group-toggle",
    name: "Add or remove local administrator",
    description: "Adds a user to or removes them from the sudo/wheel (Linux) or admin (macOS) group.",
    category: "Users & sessions",
    language: "bash",
    platforms: NIX,
    risk: "high",
    parameters: [{ name: "username", label: "User name", type: "string", required: true }, { name: "action", label: "Action", type: "select", options: ["add", "remove"], default: "add" }],
    content: `#!/usr/bin/env bash
set -uo pipefail
U="\${MW_PARAM_USERNAME:-}"; A="\${MW_PARAM_ACTION:-add}"
[ -n "$U" ] || { echo "username is required" >&2; exit 2; }
id "$U" >/dev/null 2>&1 || { echo "User '$U' not found" >&2; exit 2; }
if [ "$(uname)" = "Darwin" ]; then
  if [ "$A" = add ]; then dseditgroup -o edit -a "$U" -t user admin && echo "$U ADDED to admin group."; else dseditgroup -o edit -d "$U" -t user admin && echo "$U REMOVED from admin group."; fi
  echo "admin group: $(dscl . -read /Groups/admin GroupMembership | cut -d: -f2)"; exit 0
fi
G=sudo; getent group sudo >/dev/null 2>&1 || G=wheel
if [ "$A" = add ]; then
  if id -nG "$U" | tr ' ' '\\n' | grep -qx "$G"; then echo "$U is already in $G."; else usermod -aG "$G" "$U" && echo "$U ADDED to $G."; fi
else
  if id -nG "$U" | tr ' ' '\\n' | grep -qx "$G"; then gpasswd -d "$U" "$G" >/dev/null && echo "$U REMOVED from $G."; else echo "$U is not in $G."; fi
fi
echo "$G group: $(getent group "$G" | cut -d: -f4)"
`,
  },
  {
    key: "clear-credential-manager",
    name: "Clear Credential Manager",
    description: "Removes the signed-in user's saved Windows credentials (network shares, Office/Teams tokens) to fix sign-in loops.",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    runAs: "user",
    risk: "medium",
    parameters: [{ name: "filter", label: "Only targets containing (blank = all)", type: "string", default: "" }],
    content: `param([string]$filter = '')
if ($env:MW_PARAM_FILTER) { $filter = $env:MW_PARAM_FILTER }
$ErrorActionPreference = 'SilentlyContinue'
$targets = cmdkey /list | Select-String 'Target:' | ForEach-Object { ($_.Line -replace '^\\s*Target:\\s*', '').Trim() }
if ($filter) { $targets = $targets | Where-Object { $_ -like "*$filter*" } }
Write-Output "Credentials for $env:USERNAME matching '$filter': $(@($targets).Count)"
$n = 0
foreach ($t in $targets) { $name = $t -replace '^(LegacyGeneric|Domain):target=', ''; cmdkey /delete:$name | Out-Null; if ($?) { $n++; Write-Output "  removed $name" } }
Write-Output "Removed $n credential(s). Office/Teams will ask the user to sign in again."
`,
  },
  {
    key: "map-network-drive",
    name: "Map network drive",
    description: "Maps a persistent drive letter to a UNC path for the signed-in user (reconnects at sign-in).",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    runAs: "user",
    risk: "medium",
    parameters: [{ name: "letter", label: "Drive letter", type: "string", default: "S" }, { name: "path", label: "UNC path", type: "string", required: true, description: "\\\\server\\share" }, { name: "persist", label: "Reconnect at sign-in", type: "boolean", default: true }],
    content: `param([string]$letter = 'S', [string]$path = $env:MW_PARAM_PATH, [string]$persist = 'true')
if ($env:MW_PARAM_LETTER) { $letter = $env:MW_PARAM_LETTER }
if ($env:MW_PARAM_PATH) { $path = $env:MW_PARAM_PATH }
if ($env:MW_PARAM_PERSIST) { $persist = $env:MW_PARAM_PERSIST }
$ErrorActionPreference = 'Stop'
if (-not $path) { Write-Error "path is required"; exit 2 }
$letter = $letter.TrimEnd(':').ToUpper()
$p = $persist -match '^(true|1|yes|on)$'
$existing = Get-PSDrive -Name $letter -ErrorAction SilentlyContinue
if ($existing -and $existing.DisplayRoot -eq $path) { Write-Output "$letter\`: is already mapped to $path for $env:USERNAME."; exit 0 }
if ($existing) { net use "$letter\`:" /delete /y | Out-Null }
$out = net use "$letter\`:" "$path" $(if ($p) { '/persistent:yes' } else { '/persistent:no' }) 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "net use failed: $out"; exit 1 }
Write-Output "$letter\`: mapped to $path for $env:USERNAME (persistent=$p)."
`,
  },
  {
    key: "unmap-network-drive",
    name: "Unmap network drive",
    description: "Removes a mapped drive letter (or all mapped drives) for the signed-in user.",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    runAs: "user",
    risk: "medium",
    parameters: [{ name: "letter", label: "Drive letter (* = all)", type: "string", default: "S" }],
    content: `param([string]$letter = 'S')
if ($env:MW_PARAM_LETTER) { $letter = $env:MW_PARAM_LETTER }
$ErrorActionPreference = 'Continue'
if ($letter -eq '*') { net use * /delete /y 2>&1 | Where-Object { $_ }; Write-Output "All mapped drives removed for $env:USERNAME."; exit 0 }
$letter = $letter.TrimEnd(':').ToUpper()
$out = net use "$letter\`:" /delete /y 2>&1
if ($LASTEXITCODE -eq 0) { Write-Output "$letter\`: unmapped for $env:USERNAME." } else { Write-Output "$letter\`: was not mapped ($(($out | Out-String).Trim()))." }
`,
  },
  {
    key: "reset-user-password",
    name: "Reset local user password",
    description: "Sets a new password for a local account and optionally forces a change at next sign-in. The password is passed once and never stored.",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    risk: "high",
    parameters: [{ name: "username", label: "User name", type: "string", required: true }, { name: "password", label: "New password", type: "secret", required: true }, { name: "mustchange", label: "Must change at next sign-in", type: "boolean", default: true }],
    content: `param([string]$username = $env:MW_PARAM_USERNAME, [string]$password = $env:MW_PARAM_PASSWORD, [string]$mustchange = 'true')
if ($env:MW_PARAM_USERNAME) { $username = $env:MW_PARAM_USERNAME }
if ($env:MW_PARAM_PASSWORD) { $password = $env:MW_PARAM_PASSWORD }
if ($env:MW_PARAM_MUSTCHANGE) { $mustchange = $env:MW_PARAM_MUSTCHANGE }
$ErrorActionPreference = 'Stop'
if (-not $username -or -not $password) { Write-Error "username and password are required"; exit 2 }
if (-not (Get-LocalUser -Name $username -ErrorAction SilentlyContinue)) { Write-Error "Local user '$username' not found"; exit 2 }
$sec = ConvertTo-SecureString $password -AsPlainText -Force
Set-LocalUser -Name $username -Password $sec -PasswordNeverExpires $false
Enable-LocalUser -Name $username
if ($mustchange -match '^(true|1|yes|on)$') { net user $username /logonpasswordchg:yes | Out-Null; Write-Output "Password reset for $username; the user must change it at next sign-in." } else { Write-Output "Password reset for $username." }
`,
  },
  {
    key: "reset-user-password",
    name: "Reset local user password",
    description: "Sets a new password for a local account and optionally forces a change at next sign-in. The password is passed once and never stored.",
    category: "Users & sessions",
    language: "bash",
    platforms: NIX,
    risk: "high",
    parameters: [{ name: "username", label: "User name", type: "string", required: true }, { name: "password", label: "New password", type: "secret", required: true }, { name: "mustchange", label: "Must change at next sign-in", type: "boolean", default: true }],
    content: `#!/usr/bin/env bash
set -uo pipefail
U="\${MW_PARAM_USERNAME:-}"; P="\${MW_PARAM_PASSWORD:-}"
[ -n "$U" ] && [ -n "$P" ] || { echo "username and password are required" >&2; exit 2; }
id "$U" >/dev/null 2>&1 || { echo "User '$U' not found" >&2; exit 2; }
if [ "$(uname)" = "Darwin" ]; then
  dscl . -passwd "/Users/$U" "$P" || { echo "dscl passwd failed" >&2; exit 1; }
  case "\${MW_PARAM_MUSTCHANGE:-true}" in true|1|yes|on) pwpolicy -u "$U" -setpolicy "newPasswordRequired=1" >/dev/null 2>&1 && echo "Password reset for $U; change required at next sign-in.";; *) echo "Password reset for $U.";; esac
  exit 0
fi
printf '%s:%s\\n' "$U" "$P" | chpasswd || { echo "chpasswd failed" >&2; exit 1; }
passwd -u "$U" >/dev/null 2>&1 || true
case "\${MW_PARAM_MUSTCHANGE:-true}" in true|1|yes|on) chage -d 0 "$U" && echo "Password reset for $U; change required at next sign-in.";; *) echo "Password reset for $U.";; esac
`,
  },
  {
    key: "show-message-to-user",
    name: "Show message to user",
    description: "Pops up a message box on the signed-in user's desktop (via msg.exe, falling back to a toast).",
    category: "Users & sessions",
    language: "powershell",
    platforms: WIN,
    parameters: [{ name: "title", label: "Title", type: "string", default: "Message from IT" }, { name: "message", label: "Message", type: "string", required: true }, { name: "seconds", label: "Auto-dismiss after (s, 0 = never)", type: "number", default: 300 }],
    content: `param([string]$title = 'Message from IT', [string]$message = $env:MW_PARAM_MESSAGE, [int]$seconds = 300)
if ($env:MW_PARAM_TITLE) { $title = $env:MW_PARAM_TITLE }
if ($env:MW_PARAM_MESSAGE) { $message = $env:MW_PARAM_MESSAGE }
if ($env:MW_PARAM_SECONDS) { $seconds = [int]$env:MW_PARAM_SECONDS }
$ErrorActionPreference = 'Continue'
if (-not $message) { Write-Error "message is required"; exit 2 }
$sessions = quser 2>$null | Select-Object -Skip 1 | Where-Object { $_ -match '\\sActive\\s' }
if (-not $sessions) { Write-Output "No active interactive session - nobody is at this computer."; exit 0 }
$text = "$title\`r\`n\`r\`n$message"
if (Get-Command msg.exe -ErrorAction SilentlyContinue) { msg * /time:$seconds $text; Write-Output "Message shown to $(@($sessions).Count) active session(s) via msg.exe." }
else {
  $ps = "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('$($message -replace "'","''")','$($title -replace "'","''")')"
  $tn = "MagicWandMessage-$PID"; $u = ($sessions[0].Trim() -split '\\s+')[0] -replace '^>', ''
  schtasks /create /tn $tn /tr "powershell -NoProfile -WindowStyle Hidden -Command \\"$ps\\"" /sc once /st 23:59 /ru $u /it /f | Out-Null; schtasks /run /tn $tn | Out-Null; Start-Sleep 2; schtasks /delete /tn $tn /f | Out-Null
  Write-Output "Message shown to $u via an interactive task."
}
`,
  },
  {
    key: "show-message-to-user",
    name: "Show message to user",
    description: "Shows a desktop notification/dialog to the signed-in user (notify-send / osascript) and writes it to every terminal.",
    category: "Users & sessions",
    language: "bash",
    platforms: NIX,
    parameters: [{ name: "title", label: "Title", type: "string", default: "Message from IT" }, { name: "message", label: "Message", type: "string", required: true }],
    content: `#!/usr/bin/env bash
set -uo pipefail
T="\${MW_PARAM_TITLE:-Message from IT}"; M="\${MW_PARAM_MESSAGE:-}"
[ -n "$M" ] || { echo "message is required" >&2; exit 2; }
shown=0
if [ "$(uname)" = "Darwin" ]; then
  u=$(stat -f %Su /dev/console); uid=$(id -u "$u")
  esc_m=$(printf '%s' "$M" | sed 's/"/\\\\"/g'); esc_t=$(printf '%s' "$T" | sed 's/"/\\\\"/g')
  launchctl asuser "$uid" osascript -e "display dialog \\"$esc_m\\" with title \\"$esc_t\\" buttons {\\"OK\\"} default button 1 giving up after 300" >/dev/null 2>&1 & shown=1
  echo "Dialog shown to $u."
else
  for home in /home/*; do
    u=$(basename "$home"); uid=$(id -u "$u" 2>/dev/null) || continue
    bus="/run/user/$uid/bus"; [ -S "$bus" ] || continue
    sudo -u "$u" DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" DISPLAY="\${DISPLAY:-:0}" notify-send -u critical -t 0 "$T" "$M" 2>/dev/null && { echo "Notification shown to $u."; shown=1; }
  done
fi
printf '%s\\n%s\\n' "$T" "$M" | wall 2>/dev/null && echo "Message written to all terminals."
[ $shown = 1 ] || echo "No graphical session found; message delivered to terminals only."
`,
  },
];
