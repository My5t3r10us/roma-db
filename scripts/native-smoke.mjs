import { readFile, writeFile, rm, mkdir, cp } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const env = await readFile(".env.test", "utf8");
const url = new URL(env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim());
if (!url.pathname.endsWith("_test")) throw new Error("Base de test requise.");
const profile = {
  id: "smoke-" + suffix,
  name: "Smoke test",
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  maintenanceDb: decodeURIComponent(url.pathname.slice(1)),
  ssl: "disable",
  ca: "",
  cert: "",
  color: "#7755df",
  privateKey: "x".repeat(6200),
};
await mkdir("artifacts", { recursive: true });
const html = resolve("artifacts/native-smoke.html");
const entry = resolve(".build/app/smoke-entry.js");
let source = await readFile(".build/app/entry.js", "utf8");
source = source
  .replace('id: "com.romadb.desktop"', 'id: "com.romadb.smoke.' + suffix + '"')
  .replace('title: "Roma DB"', 'title: "Roma DB — tests natifs"');
await writeFile(entry, source);
await writeFile(
  html,
  `<!doctype html><html><body><h1>Vérification native Roma DB</h1><pre id="status">En cours…</pre><script>
(async()=>{
const profile=${JSON.stringify(profile)};
const schema='roma_smoke_${suffix}'; const role=schema+'_role'; const database=profile.maintenanceDb;
const input={profileId:profile.id,database};
const results=[]; const api=(method,params)=>tiny.api.call(method,params);
try{
  const saved=await api('saveProfile',profile);
  if(saved.password || saved.privateKey)throw Error('Secret présent dans le profil public');
  results.push('coffre-fort et clé privée segmentée');
  const edited={...saved,name:'Smoke test edited'};await api('saveProfile',edited);
  const info=await api('testConnection',edited);if(!info.sharedDev)throw Error('Protection dev absente');
  results.push('relecture des secrets et connexion PostgreSQL');
  const overview=await api('overview',{profileId:profile.id});if(!overview.databases.some(d=>d.name===database))throw Error('Base absente');
  await api('crud',{...input,operation:{kind:'schema',action:'create',name:schema}});
  const resources=await api('resources',input);const resource=resources.find(r=>r.name===schema);if(!resource)throw Error('Schéma absent');
  const snapshot=await api('access',{...input,resource,role:'PUBLIC'});
  const change={id:'grant',...input,resource,role:'PUBLIC',privilege:'USAGE',action:'grant',grantOption:false,fingerprint:snapshot.fingerprint};
  const sql=await api('preview',{...input,changes:[change]});if(!sql[0].includes('GRANT USAGE'))throw Error('Aperçu absent');
  await api('apply',{...input,changes:[change]});
  const fresh=await api('access',{...input,resource,role:'PUBLIC'});if(!fresh.permissions.some(p=>p.privilege==='USAGE'))throw Error('Droit non appliqué');
  results.push('CRUD, aperçu SQL, transaction et lecture des droits');
  await api('crud',{...input,operation:{kind:'role',action:'create',name:role,role:{name:role,login:false,superuser:false,createDb:false,createRole:false,inherit:true,replication:false,bypassRls:false,connectionLimit:-1}}});
  await api('crud',{...input,operation:{kind:'role',action:'delete',name:role,confirmation:role}});
  results.push('CRUD des rôles via le transport natif');
  await api('crud',{...input,operation:{kind:'schema',action:'delete',name:schema,confirmation:schema}});
  await api('deleteProfile',{id:profile.id});
  results.push('suppression des fixtures et secrets');
  document.getElementById('status').textContent='PASS\\n'+results.join('\\n');
  await tiny.log('ROMA_NATIVE_SMOKE_PASS '+JSON.stringify(results));
}catch(error){document.getElementById('status').textContent='FAIL '+error.message;await tiny.log({nativeSmoke:'FAIL',message:error.message});}
setTimeout(()=>tiny.quit(),500);
})();</script></body></html>`,
);
const home = join(process.env.LOCALAPPDATA, "tinyjs");
const portable = process.argv.includes("--portable");
const portableDir = resolve("artifacts/portable-smoke");
let executable = join(home, "bin", "tjs.exe");
let args = ["run", entry];
let launchEnv = {
  ...process.env,
  TINYJS_HTML: html,
  TINYJS_LAUNCHER: join(home, "native", "launcher-win.exe"),
};
if (portable) {
  await mkdir(join(portableDir, ".compile"), { recursive: true });
  await cp(".build/app", join(portableDir, ".compile/app"), {
    recursive: true,
  });
  await writeFile(join(portableDir, ".compile/app/entry.js"), source);
  await cp(html, join(portableDir, ".compile/app/frontend/index.html"));
  executable = join(portableDir, "roma-db.exe");
  args = [];
  execFileSync(join(home, "bin", "tjs.exe"), ["app", "compile", executable], {
    cwd: join(portableDir, ".compile"),
    stdio: "inherit",
    windowsHide: true,
  });
  await cp("dist/companion", join(portableDir, "companion"), {
    recursive: true,
  });
  await cp("dist/launcher.exe", join(portableDir, "launcher.exe"));
  launchEnv = {
    ...process.env,
    PATH: join(process.env.SystemRoot, "System32"),
  };
  delete launchEnv.TINYJS_HTML;
  delete launchEnv.TINYJS_LAUNCHER;
  await rm(join(portableDir, ".compile/app/frontend/index.html"), {
    force: true,
  });
  console.log("Test du paquet compilé avec Node.js absent du PATH.");
}
const child = spawn(executable, args, {
  cwd: portable ? portableDir : process.cwd(),
  env: launchEnv,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (data) => {
  output += data.toString();
  process.stdout.write(data);
});
child.stderr.on("data", (data) => process.stderr.write(data));
const timer = setTimeout(() => {
  child.kill();
}, 60000);
await new Promise((r) => child.once("exit", r));
clearTimeout(timer);
await rm(html, { force: true });
await rm(entry, { force: true });
if (portable) await rm(executable, { force: true });
if (!output.includes("ROMA_NATIVE_SMOKE_PASS")) {
  throw new Error("La vérification native n’a pas confirmé le succès.");
}
