import { profileSchema } from "./sql-lite";
import type { Profile, ProfileInput } from "../shared/types";
declare const tjs: any;
type App = any;
const enc = new TextEncoder();
let child: any;
let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
let nextId = 0;
let writeQueue = Promise.resolve();
const pending = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function failPending(message: string) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
}
async function startWorker(app: App) {
  if (child) return;
  const exe = String(tjs.exePath).replaceAll("\\", "/");
  const built = /\/roma-db\.exe$/i.test(exe);
  const root = built
    ? exe.slice(0, exe.lastIndexOf("/"))
    : String(tjs.cwd).replaceAll("\\", "/");
  const node = built ? `${root}/companion/node.exe` : "node";
  child = app.spawnHidden([node, `${root}/companion/worker.cjs`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    cwd: root,
    env: { ...tjs.env, ROMA_DEV: built ? "0" : "1" },
  });
  writer = child.stdin.getWriter();
  const process = child;
  void (async () => {
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          const reply = JSON.parse(line);
          const p = pending.get(reply.id);
          if (!p) continue;
          clearTimeout(p.timer);
          pending.delete(reply.id);
          if (reply.error)
            p.reject(
              new Error(
                [reply.error.message, reply.error.detail, reply.error.hint]
                  .filter(Boolean)
                  .join(" — "),
              ),
            );
          else p.resolve(reply.result);
        }
      }
    } catch {
      /* reject all calls if the transport fails */
    } finally {
      if (child === process) {
        child = undefined;
        writer = undefined;
        failPending(
          "Le processus PostgreSQL s’est arrêté. Réessayez pour le relancer.",
        );
      }
    }
  })();
}
async function worker(
  method: string,
  input: any,
  app: App,
  profile?: ProfileInput,
  timeoutMs = 120000,
) {
  await startWorker(app);
  const id = ++nextId;
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error("Délai dépassé. Actualisez les données avant de réessayer."),
      );
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const bytes = enc.encode(
      JSON.stringify({ id, method, input, profile }) + "\n",
    );
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        await writer!.write(bytes);
      });
    void writeQueue.catch(() => {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error("Communication PostgreSQL interrompue."));
    });
  });
}
async function list(app: App): Promise<Profile[]> {
  return (await app.store.get("profiles")) || [];
}
async function credentials(app: App, id: string) {
  const ref = ((await app.store.get("secretRefs")) || {})[id];
  if (!ref) return {};
  const password = await app.secrets.get(ref + "-password");
  const count = Number((await app.secrets.get(ref + "-key-count")) || 0);
  const chunks: string[] = [];
  for (let i = 0; i < count; i++)
    chunks.push((await app.secrets.get(ref + "-key-" + i)) || "");
  return {
    password: password ?? undefined,
    privateKey: chunks.join("") || undefined,
  };
}
async function removeSecrets(app: App, ref: string) {
  const count = Number((await app.secrets.get(ref + "-key-count")) || 0);
  for (let i = 0; i < count; i++) await app.secrets.delete(ref + "-key-" + i);
  await app.secrets.delete(ref + "-key-count");
  await app.secrets.delete(ref + "-password");
}
async function profileWithSecrets(app: App, id: string): Promise<ProfileInput> {
  const profile = (await list(app)).find((p) => p.id === id);
  if (!profile) throw new Error("Profil introuvable.");
  return { ...profile, ...(await credentials(app, id)) };
}
const remoteMethods = [
  "overview",
  "resources",
  "access",
  "defaults",
  "defaultAccess",
  "preview",
  "apply",
  "crud",
  "dependencies",
  "membership",
  "matrix",
  "tableDetail",
  "types",
  "ddlPreview",
  "ddlApply",
  "crudPreview",
];
export const api: Record<string, (input: any, app: App) => Promise<any>> = {
  profiles: async (_input, app) => list(app),
  saveProfile: async (input: ProfileInput, app) => {
    const validated = profileSchema(input);
    const previous = await credentials(app, input.id);
    const password =
      input.password === undefined ? previous.password : input.password;
    const key =
      input.privateKey === undefined ? previous.privateKey : input.privateKey;
    const refs = (await app.store.get("secretRefs")) || {};
    const oldRef = refs[input.id];
    const ref =
      input.id + "-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    try {
      if (password) await app.secrets.set(ref + "-password", password);
      // Keep each value below Credential Manager's 2560-byte limit, including non-ASCII PEM input.
      const chunks: string[] = [];
      let chunk = "";
      for (const character of key || "") {
        if (enc.encode(chunk + character).length > 2000) {
          chunks.push(chunk);
          chunk = "";
        }
        chunk += character;
      }
      if (chunk) chunks.push(chunk);
      await app.secrets.set(ref + "-key-count", String(chunks.length));
      for (let i = 0; i < chunks.length; i++)
        await app.secrets.set(ref + "-key-" + i, chunks[i]);
      refs[input.id] = ref;
      await app.store.set("secretRefs", refs);
      const profiles = await list(app);
      await app.store.set("profiles", [
        ...profiles.filter((p) => p.id !== input.id),
        validated,
      ]);
    } catch (error) {
      if (oldRef) refs[input.id] = oldRef;
      else delete refs[input.id];
      await app.store.set("secretRefs", refs);
      await removeSecrets(app, ref).catch(() => {});
      throw error;
    }
    if (oldRef) await removeSecrets(app, oldRef).catch(() => {});
    return validated;
  },
  deleteProfile: async ({ id }: { id: string }, app) => {
    const refs = (await app.store.get("secretRefs")) || {};
    if (refs[id]) await removeSecrets(app, refs[id]);
    delete refs[id];
    await app.store.set("secretRefs", refs);
    await app.store.set(
      "profiles",
      (await list(app)).filter((p) => p.id !== id),
    );
    return true;
  },
  testConnection: async (input: ProfileInput, app) => {
    const safe = profileSchema(input);
    const existing = (await list(app)).some((p) => p.id === input.id)
      ? await credentials(app, input.id)
      : {};
    return worker("testConnection", {}, app, {
      ...safe,
      ...existing,
      ...(input.password !== undefined ? { password: input.password } : {}),
      ...(input.privateKey !== undefined
        ? { privateKey: input.privateKey }
        : {}),
    });
  },
  auditExport: async ({ profileId, path }: { profileId: string; path: string }, app) => {
    if (typeof path !== "string" || !/.html?$/i.test(path))
      throw new Error("Choisissez un fichier .html.");
    const { html } = await worker(
      "auditExport",
      {},
      app,
      await profileWithSecrets(app, profileId),
      600000,
    );
    await tjs.writeFile(path, enc.encode(html));
    return { path };
  },
  preference: async (input, app) => {
    if (input?.theme && ["light", "dark", "system"].includes(input.theme))
      await app.store.set("theme", input.theme);
    return { theme: (await app.store.get("theme")) || "system" };
  },
  devProfile: async (_input, app) => worker("devProfile", {}, app),
};
for (const method of remoteMethods)
  api[method] = async (input, app) =>
    worker(method, input, app, await profileWithSecrets(app, input.profileId));
let storageQueue = Promise.resolve();
for (const method of ["saveProfile", "deleteProfile", "preference"]) {
  const handler = api[method];
  api[method] = (input, app) => {
    const task = storageQueue.catch(() => {}).then(() => handler(input, app));
    storageQueue = task.then(
      () => {},
      () => {},
    );
    return task;
  };
}
export function init(app: App) {
  app.window("main").setMinSize(1050, 700);
}
export function onWindowClosed(_id: string) {
  void writer?.close().catch(() => {});
}
