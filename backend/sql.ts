import { createHash } from "node:crypto";
import { z } from "zod";
import type { Change, ObjectKind, Profile, Resource } from "../shared/types";

export const identifier = z
  .string()
  .min(1)
  .refine(
    (v) => !v.includes("\0") && Buffer.byteLength(v, "utf8") <= 63,
    "Nom PostgreSQL invalide (63 octets maximum).",
  );
export function qi(value: string): string {
  identifier.parse(value);
  return '"' + value.replaceAll('"', '""') + '"';
}
export function literal(value: string): string {
  if (value.includes("\0")) throw new Error("Valeur invalide.");
  return "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function sharedDev(profile: Pick<Profile, "host" | "port">): boolean {
  const host = profile.host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return (
    profile.port === 5432 &&
    ["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"].includes(host)
  );
}
export const privileges: Record<ObjectKind, string[]> = {
  database: ["CONNECT", "CREATE", "TEMPORARY"],
  schema: ["USAGE", "CREATE"],
  table: [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ],
  view: [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ],
  sequence: ["USAGE", "SELECT", "UPDATE"],
  function: ["EXECUTE"],
};
export function availablePrivileges(
  kind: ObjectKind,
  version = 140000,
): string[] {
  return version >= 170000 && ["table", "view"].includes(kind)
    ? [...privileges[kind], "MAINTAIN"]
    : privileges[kind];
}
export function objectSql(resource: Resource): string {
  if (resource.kind === "database" || resource.kind === "schema")
    return qi(resource.name);
  const qualified = `${qi(resource.schema)}.${qi(resource.name)}`;
  if (resource.kind === "function") {
    // identity is obtained exclusively from pg_get_function_identity_arguments after OID resolution.
    if (resource.identity === undefined)
      throw new Error("Signature de fonction manquante.");
    return `${qualified}(${resource.identity})`;
  }
  return qualified;
}
export function changeSql(change: Change, version = 140000): string {
  const allowed = availablePrivileges(change.resource.kind, version);
  if (!allowed.includes(change.privilege))
    throw new Error("Privilège incompatible avec cette ressource.");
  identifier.parse(change.role);
  const recipient = change.role === "PUBLIC" ? "PUBLIC" : qi(change.role);
  if (change.role === "PUBLIC" && change.grantOption)
    throw new Error("PUBLIC ne peut pas recevoir une option de délégation.");
  const action =
    change.action === "grant"
      ? "GRANT"
      : change.action === "revoke"
        ? "REVOKE"
        : null;
  if (!action) throw new Error("Action inconnue.");
  const tail =
    action === "GRANT"
      ? `TO ${recipient}${change.grantOption ? " WITH GRANT OPTION" : ""}`
      : `FROM ${recipient} RESTRICT`;
  if (change.defaultOwner) {
    if (!["table", "sequence", "function"].includes(change.resource.kind))
      throw new Error("Type de privilège par défaut invalide.");
    const plural = {
      table: "TABLES",
      sequence: "SEQUENCES",
      function: "FUNCTIONS",
    }[change.resource.kind as "table" | "sequence" | "function"];
    const scope = change.resource.schema
      ? ` IN SCHEMA ${qi(change.resource.schema)}`
      : "";
    return `ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(change.defaultOwner)}${scope} ${action}${action === "REVOKE" && change.grantOption ? " GRANT OPTION FOR" : ""} ${change.privilege} ON ${plural} ${tail};`;
  }
  const kind =
    change.resource.kind === "view"
      ? "TABLE"
      : change.resource.kind.toUpperCase();
  return `${action}${action === "REVOKE" && change.grantOption ? " GRANT OPTION FOR" : ""} ${change.privilege} ON ${kind} ${objectSql(change.resource)} ${tail};`;
}
export const profileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: identifier,
  maintenanceDb: identifier,
  ssl: z.enum(["disable", "require", "verify-full"]),
  ca: z.string().max(100000),
  cert: z.string().max(100000),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  password: z.string().max(2000).optional(),
  privateKey: z.string().max(20000).optional(),
});
export const resourceSchema = z.object({
  oid: z.number().int().nonnegative(),
  name: identifier,
  schema: z.string().max(63),
  kind: z.enum(["database", "schema", "table", "view", "sequence", "function"]),
  owner: z.string(),
  identity: z.string().optional(),
  signature: z.string().optional(),
  rls: z.boolean().optional(),
  forceRls: z.boolean().optional(),
});
export const changeSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  database: identifier,
  resource: resourceSchema,
  role: identifier,
  privilege: z.string(),
  action: z.enum(["grant", "revoke"]),
  grantOption: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  defaultOwner: identifier.optional(),
});
