import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
const cli = join(process.env.LOCALAPPDATA || "", "App Viewer", "appv.exe");
if (existsSync(cli)) {
  const apps = JSON.parse(
    execFileSync(cli, ["list", "--json"], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
  const registered = apps.find(
    (app) => resolve(app.path).toLowerCase() === resolve(".").toLowerCase(),
  );
  if (registered) {
    execFileSync(cli, ["open", registered.id, "--timeout", "30"], {
      stdio: "inherit",
      windowsHide: true,
    });
    process.exit(0);
  }
}
const child = spawn(
  process.platform === "win32" ? "cmd.exe" : "npm",
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run dev:frontend"]
    : ["run", "dev:frontend"],
  { stdio: "inherit", windowsHide: true },
);
child.once("exit", (code) => process.exit(code || 0));
