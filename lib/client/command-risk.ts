/**
 * Heuristic risk classification for ad-hoc commands, shown BEFORE a technician presses Enter. It is a guard
 * rail, not a sandbox: it catches the classic "I meant the other directory" mistakes across PowerShell, cmd
 * and POSIX shells and asks for an explicit confirmation on anything destructive.
 */
export type RiskLevel = "safe" | "caution" | "destructive";
export interface RiskAssessment { level: RiskLevel; reasons: string[] }

const DESTRUCTIVE: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, "recursive forced delete (rm -rf)"],
  [/\brm\s+-[a-z]*r\b.*\s(\/|~|\*|\$HOME)\s*$/i, "recursive delete of a root, home or wildcard path"],
  [/remove-item\b[^|\n]*-recurse/i, "recursive delete (Remove-Item -Recurse)"],
  [/\b(rd|rmdir)\s+\/s\b/i, "recursive directory delete (rd /s)"],
  [/\bdel\s+[^|\n]*\/[sq]\b/i, "bulk delete (del /s or /q)"],
  [/\b(format|mkfs(\.\w+)?|diskpart|wipefs|fdisk|parted)\b/i, "disk formatting / partitioning"],
  [/\bdd\s+if=/i, "raw disk write (dd)"],
  [/\b(shutdown|reboot|halt|poweroff)\b|\b(stop|restart)-computer\b/i, "power action - prefer the Reboot/Shutdown actions, which are tracked"],
  [/\breg(\.exe)?\s+delete\b/i, "registry key deletion"],
  [/remove-itemproperty\b[^|\n]*HK(LM|CR|CC)/i, "registry value deletion under a machine hive"],
  [/\bnet\s+user\b[^|\n]*\/delete/i, "local user deletion"],
  [/\b(userdel|groupdel)\b/i, "local user/group deletion"],
  [/\bchmod\s+-R\s+0?777\b/i, "world-writable recursive permissions"],
  [/\bchown\s+-R\b[^|\n]*\s\/\s*$/i, "recursive ownership change on /"],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, "fork bomb"],
  [/\b(curl|wget|iwr|invoke-webrequest)\b[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b/i, "piping a download straight into a shell"],
  [/\b(iex|invoke-expression)\b[^|\n]*(downloadstring|invoke-webrequest|iwr|net\.webclient)/i, "executing downloaded code (IEX)"],
  [/set-executionpolicy\b[^|\n]*(unrestricted|bypass)/i, "weakening PowerShell execution policy"],
  [/netsh\s+advfirewall\s+set\s+\w+\s+state\s+off/i, "disabling the Windows firewall"],
  [/set-mppreference\b[^|\n]*-disablerealtimemonitoring\s*\$?true/i, "disabling Defender real-time protection"],
  [/\b(ufw\s+disable|systemctl\s+(stop|disable)\s+(firewalld|ufw))\b/i, "disabling the firewall"],
  [/\bkill\s+-9\s+-1\b|\bpkill\s+-9\s+\.\b/i, "killing every process"],
  [/\btaskkill\b[^|\n]*\/f[^|\n]*\/im\s+(csrss|winlogon|lsass|services|svchost)/i, "killing a critical Windows process"],
  [/\b(wevtutil\s+cl|clear-eventlog)\b/i, "clearing event logs (destroys audit evidence)"],
  [/\b(bcdedit|bootrec|cipher\s+\/w)\b/i, "boot configuration / secure wipe"],
  [/\bsystemctl\s+(stop|disable)\s+(sshd?|NetworkManager|networking)\b/i, "stopping remote access or networking"],
  [/\b(magicwand-agent\s+uninstall|sc\s+(stop|delete)\s+magicwand|systemctl\s+(stop|disable)\s+magicwand)/i, "stopping or removing the management agent"],
  [/\bdrop\s+(database|table)\b/i, "dropping a database object"],
];

const CAUTION: [RegExp, string][] = [
  [/\b(restart|stop)-service\b|\bsystemctl\s+(restart|stop)\b|\bsc\s+stop\b|\bnet\s+stop\b/i, "stops or restarts a service"],
  [/\b(stop-process|taskkill|kill|pkill|killall)\b/i, "terminates processes"],
  [/\b(apt(-get)?\s+(upgrade|dist-upgrade|remove|purge)|dnf\s+(upgrade|remove)|yum\s+(update|remove)|winget\s+(upgrade|uninstall)|choco\s+(upgrade|uninstall)|brew\s+(upgrade|uninstall))\b/i, "changes installed software"],
  [/\b(install|uninstall)-(package|module|windowsfeature)\b|\bmsiexec\b/i, "installs or removes software"],
  [/\bset-itemproperty\b|\breg(\.exe)?\s+add\b|\bnew-itemproperty\b/i, "writes to the registry"],
  [/\b(netsh|iptables|nft|ufw|route\s+(add|delete))\b/i, "changes network configuration"],
  [/\bnet\s+(user|localgroup)\b|\buseradd\b|\busermod\b|\bpasswd\b|\bset-localuser\b|\badd-localgroupmember\b/i, "changes local accounts"],
  [/\b(gpupdate|secedit|auditpol)\b/i, "changes security policy"],
  [/\bremove-item\b|\brm\s|\bdel\s|\berase\s/i, "deletes files"],
  [/\b(chmod|chown|icacls|takeown)\b/i, "changes permissions or ownership"],
  [/\bmount\b|\bumount\b|\bdiskmgmt\b/i, "changes mounted storage"],
  [/\b(schtasks|crontab|register-scheduledtask)\b/i, "changes scheduled tasks"],
  [/\bsudo\s+su\b|\bsu\s+-\b/i, "switches to root"],
];

export function assessCommand(command: string): RiskAssessment {
  const c = command.trim();
  if (!c) return { level: "safe", reasons: [] };
  const destructive = DESTRUCTIVE.filter(([re]) => re.test(c)).map(([, why]) => why);
  if (destructive.length) return { level: "destructive", reasons: [...new Set(destructive)] };
  const caution = CAUTION.filter(([re]) => re.test(c)).map(([, why]) => why);
  if (caution.length) return { level: "caution", reasons: [...new Set(caution)] };
  return { level: "safe", reasons: [] };
}
