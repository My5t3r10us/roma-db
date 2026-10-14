// Browser preview only: an in-memory PostgreSQL look-alike with fictitious data.
// Nothing here reaches a server; the desktop app uses the real backend.
import type {
  AccessMatrix,
  ApiMethods,
  Change,
  Column,
  CrudInput,
  DdlOp,
  MatrixEntry,
  Membership,
  ObjectKind,
  Overview,
  Profile,
  Resource,
  Role,
  TableConstraint,
  TableDetail,
  TableIndex,
} from "../shared/types";
import { ancestorsOf, uiPrivileges } from "./permissions";

type Acl = { role: string; privilege: string; grantable: boolean }[] | null;
interface Obj extends Resource {
  acl: Acl;
  database: string;
  columns?: Column[];
  constraints?: TableConstraint[];
  indexes?: TableIndex[];
  comment?: string | null;
  rows?: number;
  definition?: string;
}
const VERSION = 170000;
const role = (name: string, patch: Partial<Role> = {}): Role => ({
  oid: 0,
  name,
  login: false,
  superuser: false,
  createDb: false,
  createRole: false,
  inherit: true,
  replication: false,
  bypassRls: false,
  connectionLimit: -1,
  validUntil: null,
  ...patch,
});
let oid = 16000;
const next = () => ++oid;
const roles: Role[] = [
  role("postgres", { login: true, superuser: true, createDb: true, createRole: true, replication: true, bypassRls: true }),
  role("roma_admin", { login: true, createDb: true, createRole: true }),
  role("app_owner"),
  role("app_reader"),
  role("app_writer"),
  role("analysts"),
  role("service_api", { login: true, connectionLimit: 20 }),
  role("claire_martin", { login: true }),
  role("etl_job", { login: true, validUntil: "2026-12-31 00:00:00+01" }),
].map((r) => ({ ...r, oid: next() }));
const memberships: Membership[] = [
  { role: "app_reader", member: "app_writer", admin: false, inherit: true, set: true },
  { role: "app_writer", member: "service_api", admin: false, inherit: true, set: true },
  { role: "app_reader", member: "analysts", admin: false, inherit: true, set: true },
  { role: "analysts", member: "claire_martin", admin: false, inherit: true, set: true },
  { role: "app_writer", member: "etl_job", admin: false, inherit: true, set: true },
  { role: "app_owner", member: "roma_admin", admin: true, inherit: true, set: true },
];
const profiles: Profile[] = [
  {
    id: "demo",
    name: "Production",
    host: "db.roma.example",
    port: 5432,
    user: "roma_admin",
    maintenanceDb: "roma",
    ssl: "verify-full",
    ca: "",
    cert: "",
    color: "#6447f5",
  },
  {
    id: "demo-staging",
    name: "Staging",
    host: "staging.roma.example",
    port: 5432,
    user: "roma_admin",
    maintenanceDb: "roma",
    ssl: "require",
    ca: "",
    cert: "",
    color: "#ca8a04",
  },
];
const g = (role: string, ...privileges: string[]) => privileges.map((privilege) => ({ role, privilege, grantable: false }));
const col = (name: string, type: string, patch: Partial<Column> = {}): Column => ({
  name,
  type,
  nullable: true,
  default: null,
  identity: false,
  generated: null,
  comment: null,
  ...patch,
});
const objects: Obj[] = [];
function add(o: Omit<Obj, "oid">) {
  const created = { ...o, oid: next() } as Obj;
  objects.push(created);
  return created;
}
const databases = ["roma", "roma_staging", "reporting"];
for (const d of databases)
  add({
    database: d,
    name: d,
    schema: "",
    kind: "database",
    owner: "roma_admin",
    connectionLimit: -1,
    acl:
      d === "reporting"
        ? [...g("roma_admin", "CONNECT", "TEMPORARY", "CREATE"), ...g("analysts", "CONNECT"), ...g("etl_job", "CONNECT", "TEMPORARY")]
        : null,
  });
function seed(database: string) {
  const all = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
  add({ database, name: "public", schema: "", kind: "schema", owner: "app_owner", acl: [...g("app_owner", "USAGE", "CREATE"), ...g("PUBLIC", "USAGE")] });
  add({ database, name: "sales", schema: "", kind: "schema", owner: "app_owner", acl: [...g("app_owner", "USAGE", "CREATE"), ...g("app_reader", "USAGE")] });
  add({ database, name: "analytics", schema: "", kind: "schema", owner: "app_owner", acl: [...g("app_owner", "USAGE", "CREATE"), ...g("analysts", "USAGE")] });
  add({ database, name: "audit", schema: "", kind: "schema", owner: "roma_admin", acl: null });
  const table = (schema: string, name: string, columns: Column[], acl: Acl, extra: Partial<Obj> = {}) =>
    add({
      database,
      name,
      schema,
      kind: "table",
      owner: "app_owner",
      acl,
      columns,
      rows: Math.round(Math.random() * 90000),
      constraints: [{ name: `${name}_pkey`, type: "primary", columns: [columns[0].name], definition: `PRIMARY KEY (${columns[0].name})` }],
      indexes: [
        { name: `${name}_pkey`, definition: `CREATE UNIQUE INDEX ${name}_pkey ON ${schema}.${name} USING btree (${columns[0].name})`, unique: true, primary: true, constraint: true, columns: [columns[0].name] },
      ],
      comment: null,
      ...extra,
    });
  const id = col("id", "bigint", { nullable: false, identity: true });
  const created = col("created_at", "timestamp with time zone", { nullable: false, default: "now()" });
  table(
    "public",
    "customers",
    [id, col("email", "text", { nullable: false, comment: "Adresse de connexion" }), col("full_name", "text"), col("tenant_id", "uuid", { nullable: false }), created],
    [...g("app_owner", ...all), ...g("app_reader", "SELECT"), ...g("app_writer", "INSERT", "UPDATE", "DELETE")],
    { rls: true, comment: "Clients de la plateforme" },
  );
  const orders = table(
    "public",
    "orders",
    [id, col("customer_id", "bigint", { nullable: false }), col("status", "text", { nullable: false, default: "'pending'::text" }), col("total", "numeric(12,2)"), created],
    [...g("app_owner", ...all), ...g("app_reader", "SELECT"), ...g("app_writer", "INSERT", "UPDATE")],
  );
  orders.constraints!.push(
    {
      name: "orders_customer_id_fkey",
      type: "foreign",
      columns: ["customer_id"],
      definition: "FOREIGN KEY (customer_id) REFERENCES public.customers(id)",
      references: { schema: "public", table: "customers", columns: ["id"] },
    },
    { name: "orders_total_check", type: "check", columns: ["total"], definition: "CHECK (total >= 0::numeric)" },
  );
  orders.indexes!.push({ name: "orders_status_idx", definition: "CREATE INDEX orders_status_idx ON public.orders USING btree (status)", unique: false, primary: false, constraint: false, columns: ["status"] });
  table(
    "public",
    "products",
    [id, col("sku", "character varying(64)", { nullable: false }), col("label", "text"), col("price", "numeric(10,2)", { nullable: false, default: "0" })],
    [...g("app_owner", ...all), ...g("app_reader", "SELECT"), ...g("PUBLIC", "SELECT")],
  );
  table("public", "api_tokens", [id, col("token_hash", "bytea", { nullable: false }), col("expires_at", "timestamp with time zone")], [...g("app_owner", ...all), ...g("service_api", "SELECT", "INSERT", "DELETE")]);
  add({ database, name: "orders_id_seq", schema: "public", kind: "sequence", owner: "app_owner", acl: [...g("app_owner", "USAGE", "SELECT", "UPDATE"), ...g("app_writer", "USAGE", "SELECT")], definition: "START 1 · INCREMENT 1 · MIN 1 · MAX 9223372036854775807" });
  add({
    database,
    name: "active_customers",
    schema: "public",
    kind: "view",
    owner: "app_owner",
    acl: [...g("app_owner", ...all), ...g("analysts", "SELECT")],
    columns: [col("id", "bigint"), col("email", "text")],
    definition: " SELECT c.id,\n    c.email\n   FROM customers c\n  WHERE (EXISTS ( SELECT 1\n           FROM orders o\n          WHERE o.customer_id = c.id));",
  });
  add({
    database,
    name: "order_total",
    schema: "public",
    kind: "function",
    owner: "app_owner",
    identity: "order_id bigint",
    signature: "order_id bigint",
    acl: null,
    definition: "CREATE OR REPLACE FUNCTION public.order_total(order_id bigint)\n RETURNS numeric\n LANGUAGE sql\n STABLE\nAS $function$\n  SELECT total FROM orders WHERE id = order_id\n$function$",
  });
  table("sales", "invoices", [id, col("order_id", "bigint"), col("amount", "numeric(12,2)", { nullable: false }), col("issued_on", "date", { default: "CURRENT_DATE" })], [...g("app_owner", ...all), ...g("app_reader", "SELECT"), ...g("etl_job", "SELECT", "INSERT")]);
  table("sales", "refunds", [id, col("invoice_id", "bigint"), col("reason", "text")], [...g("app_owner", ...all)]);
  table("analytics", "daily_revenue", [col("day", "date", { nullable: false }), col("revenue", "numeric(14,2)")], [...g("app_owner", ...all), ...g("analysts", "SELECT"), ...g("etl_job", "INSERT", "UPDATE", "DELETE", "TRUNCATE")]);
  table("audit", "events", [id, col("actor", "text"), col("payload", "jsonb"), created], [...g("roma_admin", ...all)], { owner: "roma_admin" });
}
for (const d of databases.slice(0, 2)) seed(d);
seed("reporting");
let defaults = [
  { owner: "app_owner", schema: "public", kind: "table" as const, role: "app_reader", privilege: "SELECT", grantable: false },
  { owner: "app_owner", schema: "sales", kind: "table" as const, role: "app_reader", privilege: "SELECT", grantable: false },
];
const hash = "a".repeat(64);
const strip = ({ acl: _a, database: _d, columns: _c, constraints: _k, indexes: _i, comment: _m, rows: _r, definition: _f, ...r }: Obj): Resource => r;
const find = (database: string, r: Resource) =>
  objects.find((o) => o.oid === r.oid && (o.kind === "database" || o.database === database));
function defaultAcl(o: Obj): NonNullable<Acl> {
  const own = uiPrivileges(o.kind, VERSION).map((privilege) => ({ role: o.owner, privilege, grantable: false }));
  if (o.kind === "database") return [...own, ...g("PUBLIC", "CONNECT", "TEMPORARY")];
  if (o.kind === "function") return [...own, ...g("PUBLIC", "EXECUTE")];
  return own;
}
const acl = (o: Obj) => o.acl ?? defaultAcl(o);
function effective(o: Obj, name: string): string[] {
  const r = roles.find((x) => x.name === name);
  const privileges = uiPrivileges(o.kind, VERSION);
  if (!r) return [];
  if (r.superuser) return privileges;
  const chain = [name, ...ancestorsOf(name, memberships)];
  if (chain.includes(o.owner)) return privileges;
  return privileges.filter((p) => acl(o).some((x) => x.privilege === p && (x.role === "PUBLIC" || chain.includes(x.role))));
}
const overview = (): Overview => ({
  server: { version: VERSION, versionLabel: "17.4", currentUser: "roma_admin", superuser: false, createDb: true, createRole: true, sharedDev: false },
  databases: objects.filter((o) => o.kind === "database").map(strip),
  roles: [...roles].sort((a, b) => a.name.localeCompare(b.name)),
  memberships,
});
function matrix(database: string, scope: string, schema?: string, system?: boolean): AccessMatrix {
  const names = roles.filter((r) => system || !r.name.startsWith("pg_")).map((r) => r.name).sort();
  const list = objects.filter((o) =>
    scope === "databases" ? o.kind === "database" : scope === "schemas" ? o.kind === "schema" && o.database === database : o.database === database && o.schema === schema && o.kind !== "schema",
  );
  const entries: MatrixEntry[] = list
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => ({
      resource: strip(o),
      grants: acl(o),
      effective: Object.fromEntries(names.map((n) => [n, effective(o, n)]).filter(([, v]) => v.length)),
      fingerprint: hash,
    }));
  const schemaObj = objects.find((o) => o.kind === "schema" && o.database === database && o.name === schema);
  const schemaUsage: Record<string, boolean> = {};
  if (schemaObj) {
    for (const n of names) schemaUsage[n] = effective(schemaObj, n).includes("USAGE");
    schemaUsage.PUBLIC = acl(schemaObj).some((x) => x.role === "PUBLIC" && x.privilege === "USAGE");
  }
  return { roles: names, entries, schemaUsage };
}
const q = (v: string) => (/^[a-z_][a-z0-9_]*$/.test(v) ? v : `"${v.replaceAll('"', '""')}"`);
function changeSql(c: Change) {
  const to = c.role === "PUBLIC" ? "PUBLIC" : q(c.role);
  const tail = c.action === "grant" ? `TO ${to}${c.grantOption ? " WITH GRANT OPTION" : ""}` : `FROM ${to}`;
  const verb = c.action === "grant" ? "GRANT" : "REVOKE";
  if (c.defaultOwner)
    return `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(c.defaultOwner)}${c.resource.schema ? ` IN SCHEMA ${q(c.resource.schema)}` : ""} ${verb} ${c.privilege} ON ${c.resource.kind.toUpperCase()}S ${tail};`;
  const kind = c.resource.kind === "view" ? "TABLE" : c.resource.kind.toUpperCase();
  const name = c.resource.schema ? `${q(c.resource.schema)}.${q(c.resource.name)}` : q(c.resource.name);
  return `${verb} ${c.privilege} ON ${kind} ${name}${c.resource.kind === "function" ? `(${c.resource.identity})` : ""} ${tail};`;
}
function ddlSql(op: DdlOp): string {
  const t = `${q(op.schema)}.${q(op.table)}`;
  const coldef = (c: { name: string; type: string; nullable: boolean; default: string | null; identity: boolean }) =>
    [q(c.name), c.type, c.identity && "GENERATED BY DEFAULT AS IDENTITY", !c.nullable && "NOT NULL", c.default && `DEFAULT ${c.default}`].filter(Boolean).join(" ");
  switch (op.op) {
    case "createTable":
      return `CREATE TABLE ${t} (\n${[...op.columns.map((c) => "  " + coldef(c)), ...(op.primaryKey.length ? [`  PRIMARY KEY (${op.primaryKey.map(q).join(", ")})`] : [])].join(",\n")}\n);`;
    case "renameTable":
      return `ALTER TABLE ${t} RENAME TO ${q(op.newName)};`;
    case "dropTable":
      return `DROP TABLE ${t} RESTRICT;`;
    case "setTableOwner":
      return `ALTER TABLE ${t} OWNER TO ${q(op.owner)};`;
    case "addColumn":
      return `ALTER TABLE ${t} ADD COLUMN ${coldef(op.column)};`;
    case "dropColumn":
      return `ALTER TABLE ${t} DROP COLUMN ${q(op.column)} RESTRICT;`;
    case "renameColumn":
      return `ALTER TABLE ${t} RENAME COLUMN ${q(op.column)} TO ${q(op.newName)};`;
    case "setType":
      return `ALTER TABLE ${t} ALTER COLUMN ${q(op.column)} TYPE ${op.type} USING ${q(op.column)}::${op.type};`;
    case "setNullable":
      return `ALTER TABLE ${t} ALTER COLUMN ${q(op.column)} ${op.nullable ? "DROP" : "SET"} NOT NULL;`;
    case "setDefault":
      return `ALTER TABLE ${t} ALTER COLUMN ${q(op.column)} ${op.default ? `SET DEFAULT ${op.default}` : "DROP DEFAULT"};`;
    case "setIdentity":
      return `ALTER TABLE ${t} ALTER COLUMN ${q(op.column)} ${op.identity ? "ADD GENERATED BY DEFAULT AS IDENTITY" : "DROP IDENTITY IF EXISTS"};`;
    case "addPrimaryKey":
      return `ALTER TABLE ${t} ADD PRIMARY KEY (${op.columns.map(q).join(", ")});`;
    case "addUnique":
      return `ALTER TABLE ${t} ADD ${op.name ? `CONSTRAINT ${q(op.name)} ` : ""}UNIQUE (${op.columns.map(q).join(", ")});`;
    case "addCheck":
      return `ALTER TABLE ${t} ADD ${op.name ? `CONSTRAINT ${q(op.name)} ` : ""}CHECK (${op.expression});`;
    case "addForeignKey":
      return `ALTER TABLE ${t} ADD ${op.name ? `CONSTRAINT ${q(op.name)} ` : ""}FOREIGN KEY (${op.columns.map(q).join(", ")}) REFERENCES ${q(op.refSchema)}.${q(op.refTable)} (${op.refColumns.map(q).join(", ")}) ON DELETE ${op.onDelete} ON UPDATE ${op.onUpdate};`;
    case "dropConstraint":
      return `ALTER TABLE ${t} DROP CONSTRAINT ${q(op.name)} RESTRICT;`;
    case "createIndex":
      return `CREATE ${op.unique ? "UNIQUE " : ""}INDEX ${op.name ? q(op.name) + " " : ""}ON ${t} (${op.columns.map(q).join(", ")});`;
    case "dropIndex":
      return `DROP INDEX ${q(op.schema)}.${q(op.name)} RESTRICT;`;
    case "setComment":
      return `COMMENT ON ${op.column ? `COLUMN ${t}.${q(op.column)}` : `TABLE ${t}`} IS ${op.comment ? `'${op.comment.replaceAll("'", "''")}'` : "NULL"};`;
  }
}
function applyDdl(database: string, op: DdlOp) {
  const table = objects.find((o) => o.database === database && o.kind === "table" && o.schema === op.schema && o.name === op.table);
  if (op.op === "createTable") {
    if (table) throw new Error(`La relation « ${op.table} » existe déjà.`);
    if (!objects.some((o) => o.database === database && o.kind === "schema" && o.name === op.schema)) throw new Error("Schéma introuvable.");
    add({
      database,
      name: op.table,
      schema: op.schema,
      kind: "table",
      owner: "roma_admin",
      acl: null,
      rows: 0,
      comment: null,
      columns: op.columns.map((c) => col(c.name, c.type, { nullable: c.nullable && !op.primaryKey.includes(c.name), default: c.default, identity: c.identity })),
      constraints: op.primaryKey.length ? [{ name: `${op.table}_pkey`, type: "primary", columns: op.primaryKey, definition: `PRIMARY KEY (${op.primaryKey.join(", ")})` }] : [],
      indexes: op.primaryKey.length
        ? [{ name: `${op.table}_pkey`, definition: `CREATE UNIQUE INDEX ${op.table}_pkey ON ${op.schema}.${op.table} USING btree (${op.primaryKey.join(", ")})`, unique: true, primary: true, constraint: true, columns: op.primaryKey }]
        : [],
    });
    return;
  }
  if (!table) throw new Error(`La relation « ${op.schema}.${op.table} » n’existe pas.`);
  const column = (name: string) => {
    const c = table.columns!.find((x) => x.name === name);
    if (!c) throw new Error(`La colonne « ${name} » n’existe pas.`);
    return c;
  };
  switch (op.op) {
    case "renameTable":
      table.name = op.newName;
      break;
    case "dropTable":
      objects.splice(objects.indexOf(table), 1);
      break;
    case "setTableOwner":
      table.owner = op.owner;
      break;
    case "addColumn":
      if (!op.column.nullable && !op.column.default && !op.column.identity && (table.rows || 0) > 0)
        throw new Error(`La colonne « ${op.column.name} » contient des valeurs NULL (la table n’est pas vide).`);
      table.columns!.push(col(op.column.name, op.column.type, { nullable: op.column.nullable, default: op.column.default, identity: op.column.identity }));
      break;
    case "dropColumn":
      table.columns = table.columns!.filter((c) => c.name !== op.column);
      break;
    case "renameColumn":
      column(op.column).name = op.newName;
      break;
    case "setType":
      column(op.column).type = op.type;
      break;
    case "setNullable":
      column(op.column).nullable = op.nullable;
      break;
    case "setDefault":
      column(op.column).default = op.default;
      break;
    case "setIdentity":
      column(op.column).identity = op.identity;
      break;
    case "setComment":
      if (op.column) column(op.column).comment = op.comment;
      else table.comment = op.comment;
      break;
    case "addPrimaryKey":
      table.constraints!.unshift({ name: `${table.name}_pkey`, type: "primary", columns: op.columns, definition: `PRIMARY KEY (${op.columns.join(", ")})` });
      for (const c of op.columns) column(c).nullable = false;
      break;
    case "addUnique":
    case "addCheck":
    case "addForeignKey": {
      const name = op.name || `${table.name}_${op.op === "addCheck" ? "check" : (op.columns.join("_") + (op.op === "addUnique" ? "_key" : "_fkey"))}`;
      table.constraints!.push({
        name,
        type: op.op === "addUnique" ? "unique" : op.op === "addCheck" ? "check" : "foreign",
        columns: op.op === "addCheck" ? [] : op.columns,
        definition: ddlSql(op).replace(/^.* ADD (CONSTRAINT \S+ )?/, "").replace(/;$/, ""),
        ...(op.op === "addForeignKey" ? { references: { schema: op.refSchema, table: op.refTable, columns: op.refColumns } } : {}),
      });
      break;
    }
    case "dropConstraint":
      table.constraints = table.constraints!.filter((c) => c.name !== op.name);
      table.indexes = table.indexes!.filter((i) => i.name !== op.name);
      break;
    case "createIndex": {
      const name = op.name || `${table.name}_${op.columns.join("_")}_idx`;
      table.indexes!.push({ name, definition: ddlSql(op), unique: op.unique, primary: false, constraint: false, columns: op.columns });
      break;
    }
    case "dropIndex":
      table.indexes = table.indexes!.filter((i) => i.name !== op.name);
      break;
  }
}
function roleStatements(op: CrudInput) {
  if (op.action === "delete") return [`DROP ${op.kind.toUpperCase()} ${q(op.name)};`];
  if (op.kind === "role") {
    const r = op.role!;
    const flags = (["login", "superuser", "createDb", "createRole", "inherit", "replication", "bypassRls"] as const).map((k) =>
      (r[k] ? "" : "NO") + { login: "LOGIN", superuser: "SUPERUSER", createDb: "CREATEDB", createRole: "CREATEROLE", inherit: "INHERIT", replication: "REPLICATION", bypassRls: "BYPASSRLS" }[k],
    );
    return [
      `${op.action === "create" ? "CREATE" : "ALTER"} ROLE ${q(op.name)} WITH ${flags.join(" ")} CONNECTION LIMIT ${r.connectionLimit}${r.password ? " PASSWORD '********'" : ""}${r.validUntil !== undefined ? ` VALID UNTIL '${r.validUntil || "infinity"}'` : ""};`,
      ...(op.newName && op.newName !== op.name ? [`ALTER ROLE ${q(op.name)} RENAME TO ${q(op.newName)};`] : []),
    ];
  }
  if (op.action === "create") return [`CREATE ${op.kind.toUpperCase()} ${q(op.name)}${op.owner ? ` AUTHORIZATION ${q(op.owner)}` : ""};`];
  return [
    ...(op.owner ? [`ALTER ${op.kind.toUpperCase()} ${q(op.name)} OWNER TO ${q(op.owner)};`] : []),
    ...(op.newName && op.newName !== op.name ? [`ALTER ${op.kind.toUpperCase()} ${q(op.name)} RENAME TO ${q(op.newName)};`] : []),
  ];
}
function crud(database: string, op: CrudInput) {
  if (op.kind === "role") {
    const existing = roles.find((r) => r.name === op.name);
    if (op.action === "create") {
      if (existing) throw new Error(`Le rôle « ${op.name} » existe déjà.`);
      roles.push({ ...role(op.name), ...op.role!, oid: next(), validUntil: op.role!.validUntil || null });
    } else if (!existing) throw new Error("Rôle introuvable.");
    else if (op.action === "delete") {
      if (objects.some((o) => o.owner === op.name || (o.acl || []).some((a) => a.role === op.name)))
        throw new Error("Suppression bloquée : des objets dépendent de ce rôle.");
      roles.splice(roles.indexOf(existing), 1);
      for (let i = memberships.length - 1; i >= 0; i--) if (memberships[i].role === op.name || memberships[i].member === op.name) memberships.splice(i, 1);
    } else {
      const { password: _p, name: _n, validUntil, ...attrs } = op.role!;
      Object.assign(existing, attrs, validUntil !== undefined ? { validUntil } : {});
      if (op.newName && op.newName !== op.name) {
        for (const m of memberships) {
          if (m.role === op.name) m.role = op.newName;
          if (m.member === op.name) m.member = op.newName;
        }
        for (const o of objects) {
          if (o.owner === op.name) o.owner = op.newName;
          for (const a of o.acl || []) if (a.role === op.name) a.role = op.newName;
        }
        existing.name = op.newName;
      }
    }
    return true;
  }
  if (op.kind === "schema") {
    const schema = objects.find((o) => o.kind === "schema" && o.database === database && o.name === op.name);
    if (op.action === "create") add({ database, name: op.name, schema: "", kind: "schema", owner: op.owner || "roma_admin", acl: null });
    else if (!schema) throw new Error("Schéma introuvable.");
    else if (op.action === "delete") {
      if (objects.some((o) => o.database === database && o.schema === op.name)) throw new Error("Le schéma n’est pas vide.");
      objects.splice(objects.indexOf(schema), 1);
    } else {
      if (op.owner) schema.owner = op.owner;
      if (op.newName) {
        for (const o of objects) if (o.database === database && o.schema === op.name) o.schema = op.newName;
        schema.name = op.newName;
      }
    }
    return true;
  }
  throw new Error("Démonstration : la gestion des bases n’est pas simulée.");
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function demoCall<K extends keyof ApiMethods>(method: K, input: any): Promise<any> {
  await wait(method === "matrix" ? 220 : 120);
  const db: string = input?.database;
  switch (method) {
    case "auditExport":
      throw new Error("L’export d’audit nécessite l’application de bureau.");
    case "profiles":
      return profiles;
    case "saveProfile": {
      const { password: _p, privateKey: _k, ...p } = input;
      const i = profiles.findIndex((x) => x.id === p.id);
      if (i >= 0) profiles[i] = p;
      else profiles.push(p);
      return p;
    }
    case "deleteProfile":
      profiles.splice(profiles.findIndex((x) => x.id === input.id), 1);
      return true;
    case "testConnection":
      return overview().server;
    case "overview":
      return overview();
    case "resources":
      return objects
        .filter((o) => o.database === db && (input.schema ? o.schema === input.schema && o.kind !== "schema" : o.kind === "schema"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(strip);
    case "matrix":
      return matrix(db, input.scope, input.schema, input.system);
    case "access": {
      const o = find(db, input.resource)!;
      return {
        grants: acl(o).map((a) => ({ ...a, grantor: o.owner })),
        permissions: [],
        fingerprint: hash,
        schemaUsage: true,
        manageable: uiPrivileges(o.kind, VERSION),
        policies: o.rls
          ? [{ name: "tenant_isolation", command: "ALL", roles: ["service_api", "app_reader"], using: "(tenant_id = (current_setting('app.tenant_id'::text))::uuid)", check: null }]
          : [],
      };
    }
    case "tableDetail": {
      const o = find(db, input.resource);
      if (!o) throw new Error("La ressource a été supprimée ou renommée. Actualisez la vue.");
      const detail: TableDetail = {
        resource: strip(o),
        columns: structuredClone(o.columns || []),
        constraints: structuredClone(o.constraints || []),
        indexes: structuredClone(o.indexes || []),
        comment: o.comment ?? null,
        rows: o.rows || 0,
        size: o.kind === "table" ? `${Math.max(16, Math.round((o.rows || 0) / 90))} kB` : "",
        definition: o.definition || null,
      };
      return detail;
    }
    case "types":
      return ["public.order_status", "public.email"];
    case "defaults":
      return defaults;
    case "defaultAccess":
      return {
        grants: defaults
          .filter((d) => d.owner === input.owner && d.schema === input.schema && d.kind === input.kind)
          .map((d) => ({ role: d.role, privilege: d.privilege, grantable: d.grantable, grantor: d.owner })),
        fingerprint: hash,
      };
    case "preview":
      return (input.changes as Change[]).map(changeSql);
    case "apply": {
      for (const c of input.changes as Change[]) {
        if (c.defaultOwner) {
          const match = (d: (typeof defaults)[number]) =>
            d.owner === c.defaultOwner && d.schema === c.resource.schema && d.kind === c.resource.kind && d.role === c.role && d.privilege === c.privilege;
          defaults = defaults.filter((d) => !match(d));
          if (c.action === "grant")
            defaults.push({ owner: c.defaultOwner, schema: c.resource.schema, kind: c.resource.kind as "table", role: c.role, privilege: c.privilege, grantable: c.grantOption });
          continue;
        }
        const o = find(db, c.resource);
        if (!o) throw new Error("La ressource a été supprimée ou renommée. Actualisez la vue.");
        const list = [...acl(o)];
        const i = list.findIndex((a) => a.role === c.role && a.privilege === c.privilege);
        if (c.action === "grant") {
          if (i >= 0) list[i] = { ...list[i], grantable: list[i].grantable || c.grantOption };
          else list.push({ role: c.role, privilege: c.privilege, grantable: c.grantOption });
        } else if (i >= 0) {
          if (c.grantOption) list[i] = { ...list[i], grantable: false };
          else list.splice(i, 1);
        }
        o.acl = list;
      }
      return { count: input.changes.length };
    }
    case "ddlPreview":
      return (input.ops as DdlOp[]).map(ddlSql);
    case "ddlApply": {
      const snapshot = structuredClone(objects);
      try {
        for (const op of input.ops as DdlOp[]) applyDdl(db, op);
      } catch (e) {
        objects.splice(0, objects.length, ...snapshot);
        throw e;
      }
      return { count: input.ops.length };
    }
    case "crudPreview":
      return roleStatements(input.operation);
    case "crud":
      return crud(db, input.operation);
    case "dependencies": {
      if (input.kind === "schema")
        return objects
          .filter((o) => o.database === db && o.schema === input.name)
          .map((o) => ({ database: db, description: `${({ table: "table", view: "vue", sequence: "séquence", function: "fonction" } as Record<ObjectKind, string>)[o.kind]} ${o.schema}.${o.name}` }));
      if (input.kind === "role")
        return objects
          .filter((o) => o.owner === input.name || (o.acl || []).some((a) => a.role === input.name))
          .slice(0, 12)
          .map((o) => ({ database: o.database, description: `${o.owner === input.name ? "propriétaire de" : "droits sur"} ${o.schema ? o.schema + "." : ""}${o.name}` }));
      return [];
    }
    case "membership": {
      const op = input.operation;
      const i = memberships.findIndex((m) => m.role === op.role && m.member === op.member);
      if (op.action === "revoke") {
        if (i >= 0) memberships.splice(i, 1);
      } else {
        if (ancestorsOf(op.role, memberships).includes(op.member)) throw new Error("Cette appartenance créerait une boucle.");
        const m = { role: op.role, member: op.member, admin: op.admin, inherit: op.inherit, set: op.set };
        if (i >= 0) memberships[i] = m;
        else memberships.push(m);
      }
      return true;
    }
    case "preference":
      return { theme: input?.theme || "system" };
    case "devProfile":
      return null;
    default:
      throw new Error("Opération non disponible en démonstration.");
  }
}
