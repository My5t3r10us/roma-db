import type { Client } from "pg";
import type {
  AccessMatrix,
  DefaultGrant,
  Membership,
  ProfileInput,
  Resource,
  Role,
  ServerInfo,
} from "../shared/types";
import * as pg from "./postgres";

export interface AuditColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}
export interface AuditConstraint {
  name: string;
  type: string;
  definition: string;
}
export interface AuditPolicy {
  name: string;
  command: string;
  roles: string[];
  using: string | null;
  check: string | null;
}
export interface AuditObject {
  resource: Resource;
  /** Human label: table, partitioned table, view, materialized view, foreign table, sequence, function. */
  label: string;
  comment: string | null;
  size: string | null;
  rows: number | null;
  columns: AuditColumn[];
  constraints: AuditConstraint[];
  indexes: string[];
  policies: AuditPolicy[];
  grants: { role: string; privilege: string; grantable: boolean }[];
  effective: Record<string, string[]>;
}
export interface AuditSchema {
  resource: Resource;
  grants: { role: string; privilege: string; grantable: boolean }[];
  effective: Record<string, string[]>;
  objects: AuditObject[];
}
export interface AuditDatabase {
  resource: Resource;
  grants: { role: string; privilege: string; grantable: boolean }[];
  effective: Record<string, string[]>;
  /** Set when the database could not be inspected (e.g. no CONNECT privilege). */
  error?: string;
  schemas: AuditSchema[];
  defaults: DefaultGrant[];
}
export interface AuditData {
  generatedAt: string;
  profileName: string;
  host: string;
  server: ServerInfo;
  roles: Role[];
  memberships: Membership[];
  databases: AuditDatabase[];
}

const SYSTEM_SCHEMA = `n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'`;
const key = (schema: string, name: string) => schema + "\0" + name;
const push = <T>(map: Map<string, T[]>, k: string, value: T) =>
  map.set(k, [...(map.get(k) || []), value]);

const kindLabels: Record<string, string> = {
  r: "table",
  p: "table partitionnée",
  v: "vue",
  m: "vue matérialisée",
  f: "table étrangère",
  S: "séquence",
};

async function collectDatabase(
  client: Client,
  profile: ProfileInput,
  base: AuditDatabase,
): Promise<AuditDatabase> {
  const schemaMatrix = await pg.matrix(client, profile, "schemas");
  const defaults = await pg.defaults(client);
  const q = async (sql: string) => (await client.query(sql)).rows;
  const relations = await q(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind, obj_description(c.oid, 'pg_class') AS comment, GREATEST(c.reltuples, 0)::float8 AS rows, CASE WHEN c.relkind IN ('r','p','m') THEN pg_size_pretty(pg_total_relation_size(c.oid)) END AS size FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${SYSTEM_SCHEMA} AND c.relkind IN ('r','p','v','m','f','S')`,
  );
  const columns = await q(
    `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE ${SYSTEM_SCHEMA} AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname, c.relname, a.attnum`,
  );
  const constraints = await q(
    `SELECT n.nspname AS schema, c.relname AS "table", k.conname AS name, k.contype::text AS type, pg_get_constraintdef(k.oid, true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${SYSTEM_SCHEMA} AND k.contype IN ('p','f','u','c','x') ORDER BY n.nspname, c.relname, CASE k.contype WHEN 'p' THEN 0 WHEN 'f' THEN 1 WHEN 'u' THEN 2 ELSE 3 END, k.conname`,
  );
  const indexes = await q(
    `SELECT n.nspname AS schema, c.relname AS "table", pg_get_indexdef(x.indexrelid) AS definition FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${SYSTEM_SCHEMA} ORDER BY n.nspname, c.relname, x.indisprimary DESC, x.indexrelid`,
  );
  const policies = await q(
    `SELECT schemaname AS schema, tablename AS "table", policyname AS name, cmd AS command, roles::text[] AS roles, qual AS using, with_check AS check FROM pg_policies WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' ORDER BY schemaname, tablename, policyname`,
  );
  const byRelation = <T extends { schema: string; table: string }>(
    rows: T[],
  ) => {
    const map = new Map<string, T[]>();
    for (const r of rows) push(map, key(r.schema, r.table), r);
    return map;
  };
  const relationInfo = new Map(
    relations.map((r) => [key(r.schema, r.name), r]),
  );
  const colMap = byRelation(columns);
  const conMap = byRelation(constraints);
  const idxMap = byRelation(indexes);
  const polMap = byRelation(policies);
  const schemas: AuditSchema[] = [];
  for (const entry of schemaMatrix.entries) {
    const objectMatrix: AccessMatrix = await pg.matrix(
      client,
      profile,
      "objects",
      entry.resource.name,
    );
    const objects: AuditObject[] = objectMatrix.entries.map((o) => {
      const k = key(o.resource.schema, o.resource.name);
      const info = relationInfo.get(k);
      return {
        resource: o.resource,
        label:
          o.resource.kind === "function"
            ? "fonction"
            : kindLabels[info?.relkind] || o.resource.kind,
        comment: info?.comment ?? null,
        size: info?.size ?? null,
        rows: info && info.size ? Math.round(info.rows) : null,
        columns: (colMap.get(k) || []).map(
          ({ name, type, nullable, default: d }) => ({
            name,
            type,
            nullable,
            default: d,
          }),
        ),
        constraints: (conMap.get(k) || []).map(
          ({ name, type, definition }) => ({
            name,
            type,
            definition,
          }),
        ),
        indexes: (idxMap.get(k) || []).map((i) => i.definition),
        policies: (polMap.get(k) || []).map(
          ({ name, command, roles, using, check }) => ({
            name,
            command,
            roles,
            using,
            check,
          }),
        ),
        grants: o.grants,
        effective: o.effective,
      };
    });
    schemas.push({
      resource: entry.resource,
      grants: entry.grants,
      effective: entry.effective,
      objects,
    });
  }
  return { ...base, schemas, defaults };
}

export async function collectAudit(
  client: Client,
  profile: ProfileInput,
): Promise<AuditData> {
  const overview = await pg.overview(client, profile);
  const dbMatrix = await pg.matrix(client, profile, "databases");
  const databases: AuditDatabase[] = [];
  for (const entry of dbMatrix.entries) {
    const base: AuditDatabase = {
      resource: entry.resource,
      grants: entry.grants,
      effective: entry.effective,
      schemas: [],
      defaults: [],
    };
    let db: Client | undefined;
    try {
      db = await pg.connect(profile, entry.resource.name, true);
      databases.push(await collectDatabase(db, profile, base));
    } catch (error: any) {
      databases.push({
        ...base,
        error: String(error?.message || error),
      });
    } finally {
      await db?.end().catch(() => {});
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    profileName: profile.name,
    host: `${profile.host}:${profile.port}`,
    server: overview.server,
    roles: overview.roles,
    memberships: overview.memberships,
    databases,
  };
}
