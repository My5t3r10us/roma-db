import { execFileSync } from "node:child_process";
import { cp, mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
if (process.platform !== "win32")
  throw new Error("Le paquet portable doit être construit sur Windows.");
execFileSync(process.execPath, ["scripts/build-worker.mjs"], {
  stdio: "inherit",
});
execFileSync("cmd.exe", ["/d", "/s", "/c", "tinyjs build"], {
  stdio: "inherit",
});
await mkdir("dist/companion", { recursive: true });
await cp("companion/worker.cjs", "dist/companion/worker.cjs");
await copyFile(process.execPath, "dist/companion/node.exe");
await mkdir("dist/licenses", { recursive: true });
const nodeLicense = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
);
if (!nodeLicense.ok)
  throw new Error("Impossible de récupérer la licence du runtime Node.js.");
await writeFile("dist/licenses/Node.js.txt", await nodeLicense.text());
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const dependencies = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  const manifest = JSON.parse(
    await readFile(join(path, "package.json"), "utf8"),
  );
  dependencies.push({
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    repository: manifest.repository,
  });
  for (const file of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
    "LICENSE-MIT",
  ]) {
    try {
      await copyFile(
        join(path, file),
        join(
          "dist/licenses",
          path.replaceAll("/", "__") + "-" + file.replaceAll(".", "_") + ".txt",
        ),
      );
      break;
    } catch {}
  }
}
await writeFile(
  "dist/DEPENDENCIES.json",
  JSON.stringify(dependencies, null, 2),
);
await writeFile(
  "dist/LISEZ-MOI.txt",
  "Roma DB\r\nLancez roma-db.exe. Conservez companion/ et launcher.exe à côté.\r\nWindows 10/11 avec WebView2. Aucun Node.js à installer.\r\n",
);
await copyFile("README.md", "dist/README.md");
const metadata = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  "dist/BUILD.json",
  JSON.stringify(
    {
      app: metadata.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2,
  ),
);
console.log("Paquet portable prêt : dist/roma-db.exe");
