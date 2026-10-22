import { createInterface } from "node:readline";
import * as pg from "./postgres";
import type { ProfileInput } from "../shared/types";
import { identifier, resourceSchema } from "./sql";
import { connectionError } from "./connection";
import { collectAudit } from "./audit";
import { renderAudit } from "./audit-html";
import { hbaApply, hbaRead } from "./hba";

export async function dispatch(
  method: string,
  input: Record<string, any>,
  profile?: ProfileInput,
): Promise<unknown> {
  if (method === "devProfile") return pg.devProfile();
  if (!profile) throw new Error("Connexion manquante.");
  if (input.database) identifier.parse(input.database);
  // Database CRUD uses the maintenance connection, not the database being renamed/dropped.
  const database =
    method === "overview" ||
    method === "testConnection" ||
    method === "hba" ||
    method === "hbaApply" ||
    ((method === "crud" || method === "crudPreview") &&
      input.operation?.kind === "database")
      ? undefined
      : input.database;
  const client = await pg.connect(profile, database, true);
  try {
    switch (method) {
      case "testConnection":
        return await pg.serverInfo(client, profile);
      case "overview":
        return await pg.overview(client, profile);
      case "resources":
        return await pg.resources(client, input.schema);
      case "access":
        return await pg.access(
          client,
          profile,
          resourceSchema.parse(input.resource),
          input.role,
        );
      case "defaults":
        return await pg.defaults(client);
      case "defaultAccess":
        return await pg.defaultAccess(
          client,
          input.owner,
          input.schema,
          input.kind,
        );
      case "preview":
        return await pg.preview(client, profile, input.database, input.changes);
      case "apply":
        return await pg.apply(client, profile, input.database, input.changes);
      case "crud":
        return await pg.crud(client, profile, input.operation);
      case "dependencies":
        return await pg.dependencies(client, input.kind, input.name);
      case "matrix":
        return await pg.matrix(
          client,
          profile,
          input.scope,
          input.schema,
          Boolean(input.system),
        );
      case "tableDetail":
        return await pg.tableDetail(client, resourceSchema.parse(input.resource));
      case "types":
        return await pg.types(client);
      case "ddlPreview":
        return pg.ddlPreview(input.ops);
      case "ddlApply":
        return await pg.ddlApply(client, input.ops);
      case "crudPreview":
        return await pg.crudPreview(client, profile, input.operation);
      case "auditExport":
        return { html: renderAudit(await collectAudit(client, profile)) };
      case "hba":
        return await hbaRead(client, profile);
      case "hbaApply":
        return await hbaApply(client, profile, input as any);
      case "membership":
        return await pg.membership(client, profile, input.operation);
      default:
        throw new Error("Opération inconnue.");
    }
  } finally {
    await client.end();
  }
}
// A socket error outside a request must not take the whole worker down.
const logError = (error: unknown) =>
  process.stderr.write(String((error as Error)?.stack || error) + "\n");
process.on("uncaughtException", logError);
process.on("unhandledRejection", logError);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let active = 0;
const queue: (() => Promise<void>)[] = [];
const running = new Set<Promise<void>>();
function pump() {
  while (active < 4 && queue.length) {
    active++;
    const task = queue.shift()!();
    running.add(task);
    void task.finally(() => {
      active--;
      running.delete(task);
      pump();
    });
  }
}
lines.on("line", (line) => {
  queue.push(async () => {
    let request: any;
    try {
      if (Buffer.byteLength(line) > 2_000_000)
        throw new Error("Requête trop volumineuse.");
      request = JSON.parse(line);
      const result = await dispatch(
        request.method,
        request.input || {},
        request.profile,
      );
      process.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
    } catch (error: any) {
      const message =
        error?.name === "ZodError"
          ? "Paramètres invalides : " +
            error.issues.map((i: any) => i.message).join(" ; ")
          : connectionError(error);
      process.stdout.write(
        JSON.stringify({
          id: request?.id,
          error: {
            message,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
          },
        }) + "\n",
      );
    }
  });
  pump();
});
lines.on("close", () => {
  const finish = () => {
    if (!active && !queue.length) process.exit(0);
    else setTimeout(finish, 100);
  };
  finish();
});
