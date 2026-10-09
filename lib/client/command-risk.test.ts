import { describe, expect, it } from "vitest";
import { assessCommand } from "./command-risk";

describe("assessCommand", () => {
  it("flags destructive commands across shells", () => {
    for (const c of ["rm -rf /var/lib/app", "Remove-Item C:\\Users\\* -Recurse -Force", "rd /s /q C:\\temp", "format D: /q", "dd if=/dev/zero of=/dev/sda", "reg delete HKLM\\Software\\Foo /f", "curl -fsSL https://x/y.sh | sudo bash", "wevtutil cl Security", "shutdown /r /t 0", "systemctl disable magicwand-agent"]) {
      expect(assessCommand(c).level, c).toBe("destructive");
    }
  });
  it("marks state-changing commands as caution", () => {
    for (const c of ["Restart-Service Spooler", "systemctl restart nginx", "apt-get upgrade -y", "reg add HKLM\\Software\\Foo /v Bar /d 1", "Stop-Process -Name notepad"]) {
      expect(assessCommand(c).level, c).toBe("caution");
    }
  });
  it("leaves read-only commands alone", () => {
    for (const c of ["Get-Service | Where-Object Status -eq Running", "ls -la /var/log", "ipconfig /all", "df -h", "whoami", "Get-EventLog -LogName System -Newest 20", ""]) {
      expect(assessCommand(c).level, c).toBe("safe");
    }
  });
});
