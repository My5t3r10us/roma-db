import { Client, Pool } from "pg";
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { z } from "zod";
import { sslOptions } from "./connection";
import { ddlSql } from "./ddl";
import type {
  Access,
  AccessMatrix,
  DdlOp,
  TableDetail,
  Change,
  CrudInput,
  DefaultGrant,
  Dependency,
  Grant,
  MembershipInput,
  Overview,
  Permission,
  ProfileInput,
  Resource,
  Role,
  ServerInfo,
} from "../shared/types";
import {
  availablePrivileges,
  changeSchema,
  changeSql,
  fingerprint,
  identifier,
  literal,
  profileSchema,
  qi,
  sharedDev,
} from "./sql";

const pools = new Map<string, Pool>();
export async function connect(
  profile: ProfileInput,
  database?: string,
  pooled = false,
): Promise<Client> {
  profileSchema.parse(profile);
  if (database) identifier.parse(database);
  const config = {
    host: profile.host,
    port: profile.port,
    user: profile.user,
    password: profile.password,
    database: database || profile.maintenanceDb,
    application_name: "Roma DB",
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
    lock_timeout: 4000,
    ssl: sslOptions(profile),
  };
  if (pooled) {
    const key = fingerprint(config);
    let pool = pools.get(key);
    if (!pool) {
      if (pools.size >= 6) {
        const oldest = pools.entries().next().value!;
        pools.delete(oldest[0]);
        void oldest[1].end();
      }
      pool = new Pool({
        ...config,
        max: 4,
        idleTimeoutMillis: 20000,
        allowExitOnIdle: true,
      });
      pool.on("error", () => {});
      pools.set(key, pool);
    }
    const acquired = await pool.connect();
    // A dropped socket emits "error" on the checked-out client; without a listener it kills the worker.
    acquired.on("error", () => {});
    try {
      await acquired.query("SET search_path TO pg_catalog");
    } catch (error) {
      acquired.release(true);
      throw error;
    }
    return {
      query: acquired.query.bind(acquired),
      on: acquired.on.bind(acquired),
      off: acquired.off.bind(acquired),
      end: async () => {
        acquired.release();
      },
    } as unknown as Client;
  }
  const client = new Client(config);
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query("SET search_path TO pg_catalog");
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}
async function protectedServer(profile: ProfileInput): Promise<boolean> {
  if (sharedDev(profile)) return true;
  if (profile.port !== 5432) return false;
  try {
    return (await lookup(profile.host, { all: true })).some(
      (a) => a.address === "127.0.0.1" || a.address === "::1",
    );
  } catch {
    return false;
  }
}
export async function serverInfo(
  client: Client,
  profile: ProfileInput,
): Promise<ServerInfo> {
  const {
    rows: [row],
  } = await client.query(
    `SELECT current_setting('server_version_num')::int AS version, current_setting('server_version') AS "versionLabel", current_user AS "currentUser", rolsuper AS superuser, rolcreatedb AS "createDb", rolcreaterole AS "createRole" FROM pg_roles WHERE rolname=current_user`,
  );
  if (row.version < 140000)
    throw new Error("PostgreSQL 14 ou supérieur est nécessaire.");
  return { ...row, sharedDev: await protectedServer(profile) };
}
export async function roles(client: Client): Promise<Role[]> {
  return (
    await client.query(
      `SELECT oid::int, rolname AS name, rolcanlogin AS login, rolsuper AS superuser, rolcreatedb AS "createDb", rolcreaterole AS "createRole", rolinherit AS inherit, rolreplication AS replication, rolbypassrls AS "bypassRls", rolconnlimit AS "connectionLimit", rolvaliduntil::text AS "validUntil" FROM pg_roles ORDER BY rolname`,
    )
  ).rows;
}
export async function overview(
  client: Client,
  profile: ProfileInput,
): Promise<Overview> {
  const server = await serverInfo(client, profile);
  const databases = (
    await client.query(
      `SELECT d.oid::int, datname AS name, '' AS schema, 'database' AS kind, pg_get_userbyid(datdba) AS owner, datconnlimit AS "connectionLimit" FROM pg_database d WHERE NOT datistemplate ORDER BY datname`,
    )
  ).rows;
  const memberships = (
    await client.query(
      `SELECT r.rolname AS role, m.rolname AS member, a.admin_option AS admin, ${server.version >= 160000 ? "a.inherit_option" : "m.rolinherit"} AS inherit, ${server.version >= 160000 ? "a.set_option" : "true"} AS set FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member ORDER BY r.rolname,m.rolname,a.grantor`,
    )
  ).rows;
  return { server, databases, roles: await roles(client), memberships };
}
export async function resources(
  client: Client,
  schema?: string,
  oid?: number,
): Promise<Resource[]> {
  if (schema !== undefined) identifier.parse(schema);
  if (!schema)
    return (
      await client.query(
        `SELECT n.oid::int, nspname AS name, '' AS schema, 'schema' AS kind, pg_get_userbyid(nspowner) AS owner FROM pg_namespace n WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' AND ($1::oid IS NULL OR n.oid=$1) ORDER BY nspname`,
        [oid ?? null],
      )
    ).rows;
  const tables = (
    await client.query(
      `SELECT c.oid::int, relname AS name, n.nspname AS schema, CASE WHEN relkind='S' THEN 'sequence' WHEN relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind, pg_get_userbyid(relowner) AS owner, relrowsecurity AS rls, relforcerowsecurity AS "forceRls" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f','S') AND ($2::oid IS NULL OR c.oid=$2) ORDER BY c.relname`,
      [schema, oid ?? null],
    )
  ).rows;
  const functions = (
    await client.query(
      `SELECT p.oid::int, proname AS name, n.nspname AS schema, 'function' AS kind, pg_get_userbyid(proowner) AS owner, pg_get_function_identity_arguments(p.oid) AS identity, pg_get_function_identity_arguments(p.oid) AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND prokind IN ('f','w') AND ($2::oid IS NULL OR p.oid=$2) ORDER BY proname,p.oid`,
      [schema, oid ?? null],
    )
  ).rows;
  return [...tables, ...functions];
}
export async function resolveResource(
  client: Client,
  target: Resource,
): Promise<Resource> {
  let candidates: Resource[];
  if (target.kind === "database")
    candidates = (
      await client.query(
        `SELECT oid::int, datname AS name, '' AS schema, 'database' AS kind, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE oid=$1`,
        [target.oid],
      )
    ).rows;
  else
    candidates = await resources(
      client,
      target.kind === "schema" ? undefined : target.schema,
      target.oid,
    );
  const resource = candidates.find(
    (r) =>
      r.oid === target.oid &&
      r.kind === target.kind &&
      r.name === target.name &&
      r.schema === target.schema,
  );
  if (!resource)
    throw new Error(
      "La ressource a été supprimée ou renommée. Actualisez la vue.",
    );
  return resource;
}
async function roleContext(client: Client) {
  return {
    roles: await roles(client),
    memberships: (
      await client.query(
        "SELECT roleid, member, grantor, admin_option, to_jsonb(a)->>'inherit_option' AS inherit, to_jsonb(a)->>'set_option' AS set FROM pg_auth_members a ORDER BY roleid,member,grantor",
      )
    ).rows,
  };
}
async function objectGrants(
  client: Client,
  resource: Resource,
): Promise<{ grants: Grant[]; acl: unknown }> {
  const settings = {
    database: ["pg_database", "datacl", "datdba", "d"],
    schema: ["pg_namespace", "nspacl", "nspowner", "n"],
    table: ["pg_class", "relacl", "relowner", "r"],
    view: ["pg_class", "relacl", "relowner", "r"],
    sequence: ["pg_class", "relacl", "relowner", "s"],
    function: ["pg_proc", "proacl", "proowner", "f"],
  }[resource.kind];
  const [catalog, acl, owner, type] = settings;
  const {
    rows: [row],
  } = await client.query(
    `SELECT ${acl}::text AS acl, ${owner}::text AS owner FROM ${catalog} WHERE oid=$1`,
    [resource.oid],
  );
  const grants = (
    await client.query(
      `SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role, a.privilege_type AS privilege, a.is_grantable AS grantable, pg_get_userbyid(a.grantor) AS grantor FROM ${catalog} o CROSS JOIN LATERAL aclexplode(COALESCE(o.${acl}, acldefault('${type}',o.${owner}))) a WHERE o.oid=$1 ORDER BY a.grantee,a.privilege_type,a.grantor`,
      [resource.oid],
    )
  ).rows;
  return { grants, acl: row };
}
export async function access(
  client: Client,
  profile: ProfileInput,
  target: Resource,
  role: string,
): Promise<Access> {
  identifier.parse(role);
  const resource = await resolveResource(client, target);
  const context = await roleContext(client);
  const selected = context.roles.find((r) => r.name === role);
  if (role !== "PUBLIC" && !selected) throw new Error("Rôle introuvable.");
  const { grants, acl } = await objectGrants(client, resource);
  const version = (await serverInfo(client, profile)).version;
  const inherited =
    role === "PUBLIC"
      ? []
      : (
          await client.query(
            `SELECT rolname AS name FROM pg_roles WHERE oid<>$1 AND pg_has_role($1::oid,oid,'USAGE')`,
            [selected!.oid],
          )
        ).rows.map((r) => r.name);
  const permissions: Permission[] = [];
  const hasFn = {
    database: "has_database_privilege",
    schema: "has_schema_privilege",
    table: "has_table_privilege",
    view: "has_table_privilege",
    sequence: "has_sequence_privilege",
    function: "has_function_privilege",
  }[resource.kind];
  const checks = selected
    ? (
        await client.query(
          `SELECT p AS privilege, ${hasFn}($1::oid,$2::oid,p) AS allowed, ${hasFn}(current_user,$2::oid,p || ' WITH GRANT OPTION') AS manageable FROM unnest($3::text[]) p`,
          [
            selected.oid,
            resource.oid,
            availablePrivileges(resource.kind, version),
          ],
        )
      ).rows
    : (
        await client.query(
          `SELECT p AS privilege, ${hasFn}(current_user,$1::oid,p || ' WITH GRANT OPTION') AS manageable FROM unnest($2::text[]) p`,
          [resource.oid, availablePrivileges(resource.kind, version)],
        )
      ).rows;
  for (const privilege of availablePrivileges(resource.kind, version)) {
    const relevant = grants.filter(
      (g) =>
        g.privilege === privilege &&
        (g.role === role || g.role === "PUBLIC" || inherited.includes(g.role)),
    );
    for (const grant of relevant)
      permissions.push({
        ...grant,
        source:
          grant.role === role
            ? "direct"
            : grant.role === "PUBLIC"
              ? "public"
              : "inherited",
        via: grant.role,
      });
    if (selected) {
      const effective = checks.find((c) => c.privilege === privilege)?.allowed;
      if (effective && selected.superuser)
        permissions.push({
          role,
          privilege,
          grantable: true,
          grantor: role,
          source: "superuser",
        });
      else if (
        effective &&
        (role === resource.owner || inherited.includes(resource.owner))
      )
        permissions.push({
          role,
          privilege,
          grantable: true,
          grantor: resource.owner,
          source: "owner",
          via: resource.owner,
        });
    }
  }
  const schemaUsage =
    !resource.schema ||
    (role === "PUBLIC"
      ? (
          await client.query(
            `SELECT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname=$1 AND a.grantee=0 AND a.privilege_type='USAGE') AS allowed`,
            [resource.schema],
          )
        ).rows[0].allowed
      : (
          await client.query(
            `SELECT has_schema_privilege($1,$2,'USAGE') AS allowed`,
            [role, resource.schema],
          )
        ).rows[0].allowed);
  const policies = ["table", "view"].includes(resource.kind)
    ? (
        await client.query(
          `SELECT policyname AS name, cmd AS command, roles::text[] AS roles, qual AS using, with_check AS check FROM pg_policies WHERE schemaname=$1 AND tablename=$2 ORDER BY policyname`,
          [resource.schema, resource.name],
        )
      ).rows
    : [];
  return {
    grants,
    permissions,
    manageable: checks.filter((c) => c.manageable).map((c) => c.privilege),
    schemaUsage,
    policies,
    fingerprint: resourceFingerprint(
      resource,
      (acl as { acl: string | null }).acl,
      fingerprint(context),
      policies,
    ),
  };
}
// Shared by access() and matrix(): the snapshot a staged change is checked against.
function resourceFingerprint(
  resource: Resource,
  acl: string | null,
  context: string,
  policies: unknown[],
) {
  return fingerprint({
    resource: [
      resource.kind,
      resource.oid,
      resource.schema,
      resource.name,
      resource.identity ?? null,
      resource.owner,
    ],
    acl,
    context,
    policies,
  });
}
const policySql = `SELECT tablename AS "table", policyname AS name, cmd AS command, roles::text[] AS roles, qual AS using, with_check AS check FROM pg_policies WHERE schemaname=$1 ORDER BY tablename, policyname`;
export async function matrix(
  client: Client,
  profile: ProfileInput,
  scope: "databases" | "schemas" | "objects",
  schema?: string,
  system = false,
): Promise<AccessMatrix> {
  z.enum(["databases", "schemas", "objects"]).parse(scope);
  if (scope === "objects") identifier.parse(schema);
  const version = (await serverInfo(client, profile)).version;
  const context = fingerprint(await roleContext(client));
  const roleNames: string[] = (
    await client.query(
      `SELECT rolname FROM pg_roles WHERE $1 OR rolname !~ '^pg_' ORDER BY rolname`,
      [system],
    )
  ).rows.map((r) => r.rolname);
  type Row = Resource & { acl: string | null };
  let rows: Row[] = [];
  let grantRows: {
    oid: number;
    fn?: boolean;
    role: string;
    privilege: string;
    grantable: boolean;
  }[] = [];
  let effectiveRows: {
    oid: number;
    fn?: boolean;
    role: string;
    privileges: string[];
  }[] = [];
  const policies = new Map<string, unknown[]>();
  let schemaUsage: Record<string, boolean> = {};
  const roleFilter = `($2 OR r.rolname !~ '^pg_')`;
  const grantee = `CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role, a.privilege_type AS privilege, a.is_grantable AS grantable`;
  if (scope === "databases") {
    const privs = availablePrivileges("database", version);
    rows = (
      await client.query(
        `SELECT d.oid::int, datname AS name, '' AS schema, 'database' AS kind, pg_get_userbyid(datdba) AS owner, datconnlimit AS "connectionLimit", datacl::text AS acl FROM pg_database d WHERE NOT datistemplate ORDER BY datname`,
      )
    ).rows;
    grantRows = (
      await client.query(
        `SELECT d.oid::int, ${grantee} FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE NOT d.datistemplate`,
      )
    ).rows;
    effectiveRows = (
      await client.query(
        `SELECT d.oid::int, r.rolname AS role, array_agg(p) AS privileges FROM pg_database d CROSS JOIN pg_roles r CROSS JOIN unnest($1::text[]) p WHERE NOT d.datistemplate AND ${roleFilter} AND has_database_privilege(r.oid, d.oid, p) GROUP BY 1, 2`,
        [privs, system],
      )
    ).rows;
  } else if (scope === "schemas") {
    const privs = availablePrivileges("schema", version);
    const where = `n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'`;
    rows = (
      await client.query(
        `SELECT n.oid::int, nspname AS name, '' AS schema, 'schema' AS kind, pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl FROM pg_namespace n WHERE ${where} ORDER BY nspname`,
      )
    ).rows;
    grantRows = (
      await client.query(
        `SELECT n.oid::int, ${grantee} FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a WHERE ${where}`,
      )
    ).rows;
    effectiveRows = (
      await client.query(
        `SELECT n.oid::int, r.rolname AS role, array_agg(p) AS privileges FROM pg_namespace n CROSS JOIN pg_roles r CROSS JOIN unnest($1::text[]) p WHERE ${where} AND ${roleFilter} AND has_schema_privilege(r.oid, n.oid, p) GROUP BY 1, 2`,
        [privs, system],
      )
    ).rows;
  } else {
    const relation = `c.relkind IN ('r','p','v','m','f','S')`;
    const tablePrivs = availablePrivileges("table", version);
    const sequencePrivs = availablePrivileges("sequence", version);
    rows = [
      ...(
        await client.query(
          `SELECT c.oid::int, relname AS name, n.nspname AS schema, CASE WHEN relkind='S' THEN 'sequence' WHEN relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind, pg_get_userbyid(relowner) AS owner, relrowsecurity AS rls, relforcerowsecurity AS "forceRls", relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND ${relation} ORDER BY c.relname`,
          [schema],
        )
      ).rows,
      ...(
        await client.query(
          `SELECT p.oid::int, proname AS name, n.nspname AS schema, 'function' AS kind, pg_get_userbyid(proowner) AS owner, pg_get_function_identity_arguments(p.oid) AS identity, pg_get_function_identity_arguments(p.oid) AS signature, proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND prokind IN ('f','w') ORDER BY proname, p.oid`,
          [schema],
        )
      ).rows,
    ];
    grantRows = [
      ...(
        await client.query(
          `SELECT c.oid::int, ${grantee} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END::"char", c.relowner))) a WHERE n.nspname=$1 AND ${relation}`,
          [schema],
        )
      ).rows,
      ...(
        await client.query(
          `SELECT p.oid::int, true AS fn, ${grantee} FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE n.nspname=$1 AND prokind IN ('f','w')`,
          [schema],
        )
      ).rows,
    ];
    effectiveRows = [
      ...(
        await client.query(
          `SELECT c.oid::int, r.rolname AS role, array_agg(p) AS privileges FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r CROSS JOIN LATERAL unnest(CASE WHEN c.relkind='S' THEN $4::text[] ELSE $3::text[] END) p WHERE n.nspname=$1 AND ${relation} AND ${roleFilter} AND (CASE WHEN c.relkind='S' THEN has_sequence_privilege(r.oid, c.oid, p) ELSE has_table_privilege(r.oid, c.oid, p) END) GROUP BY 1, 2`,
          [schema, system, tablePrivs, sequencePrivs],
        )
      ).rows,
      ...(
        await client.query(
          `SELECT p.oid::int, true AS fn, r.rolname AS role, ARRAY['EXECUTE'] AS privileges FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname=$1 AND prokind IN ('f','w') AND ${roleFilter} AND has_function_privilege(r.oid, p.oid, 'EXECUTE')`,
          [schema, system],
        )
      ).rows,
    ];
    for (const { table, ...policy } of (await client.query(policySql, [schema]))
      .rows) {
      policies.set(table, [...(policies.get(table) || []), policy]);
    }
    for (const row of (
      await client.query(
        `SELECT r.rolname AS role, has_schema_privilege(r.oid, n.oid, 'USAGE') AS allowed FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname=$1 AND ${roleFilter}`,
        [schema, system],
      )
    ).rows)
      schemaUsage[row.role] = row.allowed;
    schemaUsage.PUBLIC = (
      await client.query(
        `SELECT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a WHERE n.nspname=$1 AND a.grantee=0 AND a.privilege_type='USAGE') AS allowed`,
        [schema],
      )
    ).rows[0].allowed;
  }
  // pg_class and pg_proc OIDs come from one counter, but rows are still matched by catalog.
  const id = (oid: number, fn: boolean | undefined) => (fn ? "f" : "r") + oid;
  const group = <T extends { oid: number; fn?: boolean }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of list) {
      const k = id(row.oid, row.fn);
      map.set(k, [...(map.get(k) || []), row]);
    }
    return map;
  };
  const grantsByResource = group(grantRows);
  const effectiveByResource = group(effectiveRows);
  const entries = rows.map(({ acl, ...resource }) => {
    const k = id(resource.oid, resource.kind === "function");
    const grantsFor = grantsByResource.get(k) || [];
    const merged = new Map<
      string,
      { role: string; privilege: string; grantable: boolean }
    >();
    for (const g of grantsFor) {
      const grantKey = g.role + "\0" + g.privilege;
      const previous = merged.get(grantKey);
      merged.set(grantKey, {
        role: g.role,
        privilege: g.privilege,
        grantable: Boolean(previous?.grantable || g.grantable),
      });
    }
    const effective: Record<string, string[]> = {};
    const order = availablePrivileges(resource.kind, version);
    for (const e of effectiveByResource.get(k) || [])
      effective[e.role] = order.filter((p) => e.privileges.includes(p));
    return {
      resource: resource as Resource,
      grants: [...merged.values()],
      effective,
      fingerprint: resourceFingerprint(
        resource as Resource,
        acl,
        context,
        ["table", "view"].includes(resource.kind)
          ? policies.get(resource.name) || []
          : [],
      ),
    };
  });
  return { roles: roleNames, entries, schemaUsage };
}
export async function defaults(client: Client): Promise<DefaultGrant[]> {
  return (
    await client.query(
      `SELECT pg_get_userbyid(d.defaclrole) AS owner, COALESCE(n.nspname,'') AS schema, CASE d.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'function' END AS kind, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role, a.privilege_type AS privilege, a.is_grantable AS grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclobjtype IN ('r','S','f') ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.grantee,a.privilege_type`,
    )
  ).rows;
}
export async function defaultAccess(
  client: Client,
  owner: string,
  schema: string,
  kind: "table" | "sequence" | "function",
) {
  identifier.parse(owner);
  if (schema) identifier.parse(schema);
  z.enum(["table", "sequence", "function"]).parse(kind);
  const type = { table: "r", sequence: "S", function: "f" }[kind];
  const {
    rows: [r],
  } = await client.query(
    `SELECT r.oid, COALESCE(d.defaclacl, CASE WHEN $2='' THEN acldefault($3::"char",r.oid) ELSE '{}'::aclitem[] END)::text AS acl FROM pg_roles r LEFT JOIN pg_namespace n ON n.nspname=$2 LEFT JOIN pg_default_acl d ON d.defaclrole=r.oid AND d.defaclobjtype=$3::"char" AND d.defaclnamespace=COALESCE(n.oid,0) WHERE r.rolname=$1 AND ($2='' OR n.oid IS NOT NULL)`,
    [owner, schema, type],
  );
  if (!r) throw new Error("Propriétaire ou schéma introuvable.");
  const grants =
    r.acl === "{}"
      ? []
      : (
          await client.query(
            `SELECT CASE WHEN grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee) END AS role, privilege_type AS privilege, is_grantable AS grantable, pg_get_userbyid(grantor) AS grantor FROM aclexplode($1::aclitem[]) ORDER BY grantee,privilege_type,grantor`,
            [r.acl],
          )
        ).rows;
  return {
    grants: grants as Grant[],
    fingerprint: fingerprint({
      owner,
      schema,
      kind,
      r,
      context: await roleContext(client),
    }),
  };
}
async function normalizedChanges(
  client: Client,
  profile: ProfileInput,
  database: string,
  changes: Change[],
): Promise<Change[]> {
  if (!changes.length || changes.length > 500)
    throw new Error("Le lot doit contenir entre 1 et 500 modifications.");
  const version = (await serverInfo(client, profile)).version;
  const result: Change[] = [];
  for (const input of changes) {
    const change = changeSchema.parse(input);
    if (change.profileId !== profile.id || change.database !== database)
      throw new Error("Un lot ne peut viser qu’une seule connexion et base.");
    if (change.defaultOwner)
      await defaultAccess(
        client,
        change.defaultOwner,
        change.resource.schema,
        change.resource.kind as "table" | "sequence" | "function",
      );
    else change.resource = await resolveResource(client, change.resource);
    if (
      change.role !== "PUBLIC" &&
      !(
        await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
          change.role,
        ])
      ).rowCount
    )
      throw new Error("Rôle introuvable.");
    changeSql(change, version);
    result.push(change);
  }
  return result;
}
export async function preview(
  client: Client,
  profile: ProfileInput,
  database: string,
  changes: Change[],
) {
  const list = await normalizedChanges(client, profile, database, changes);
  const version = (await serverInfo(client, profile)).version;
  return list.map((c) => changeSql(c, version));
}
export async function apply(
  client: Client,
  profile: ProfileInput,
  database: string,
  changes: Change[],
) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const list = await normalizedChanges(client, profile, database, changes);
    const version = (await serverInfo(client, profile)).version;
    // Check all snapshots BEFORE executing anything: changes on the same resource share a snapshot.
    for (const change of list) {
      const current = change.defaultOwner
        ? await defaultAccess(
            client,
            change.defaultOwner,
            change.resource.schema,
            change.resource.kind as "table" | "sequence" | "function",
          )
        : await access(client, profile, change.resource, change.role);
      if (current.fingerprint !== change.fingerprint)
        throw new Error(
          "Conflit : les droits ou appartenances ont changé. Actualisez puis préparez à nouveau ce lot.",
        );
    }
    const warnings: string[] = [];
    const onNotice = (notice: { severity?: string; message?: string }) => {
      if (notice.severity === "WARNING")
        warnings.push(notice.message || "Opération non appliquée.");
    };
    client.on("notice", onNotice);
    try {
      for (const change of list) await client.query(changeSql(change, version));
      if (warnings.length)
        throw new Error(
          "PostgreSQL a refusé une partie du lot : " + warnings.join(" ; "),
        );
    } finally {
      client.off("notice", onNotice);
    }
    await client.query("COMMIT");
    return { count: list.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
export async function dependencies(
  client: Client,
  kind: "database" | "schema" | "role",
  name: string,
): Promise<Dependency[]> {
  identifier.parse(name);
  if (kind === "role")
    return (
      await client.query(
        `SELECT d.datname AS database, CASE WHEN s.dbid=0 OR s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) THEN pg_describe_object(s.classid,s.objid,s.objsubid) ELSE 'Dépendance dans une autre base (OID '||s.objid||')' END AS description FROM pg_shdepend s LEFT JOIN pg_database d ON d.oid=s.dbid WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=(SELECT oid FROM pg_roles WHERE rolname=$1) ORDER BY s.dbid,s.objid`,
        [name],
      )
    ).rows;
  if (kind === "schema")
    return (
      await client.query(
        `SELECT current_database() AS database, pg_describe_object(d.classid,d.objid,d.objsubid) AS description FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY d.classid,d.objid`,
        [name],
      )
    ).rows;
  return (
    await client.query(
      `SELECT datname AS database, 'Session active : PID '||pid||' ('||COALESCE(usename,'')||')' AS description FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
      [name],
    )
  ).rows;
}
const roleSchema = z.object({
  name: identifier,
  login: z.boolean(),
  superuser: z.boolean(),
  createDb: z.boolean(),
  createRole: z.boolean(),
  inherit: z.boolean(),
  replication: z.boolean(),
  bypassRls: z.boolean(),
  connectionLimit: z.number().int().min(-1),
  password: z.string().max(2000).optional(),
  validUntil: z.string().nullable().optional(),
});
const crudSchema = z.object({
  kind: z.enum(["database", "schema", "role"]),
  action: z.enum(["create", "update", "delete"]),
  name: identifier,
  newName: identifier.optional(),
  owner: identifier.optional(),
  connectionLimit: z.number().int().min(-1).optional(),
  role: roleSchema.optional(),
  confirmation: z.string().optional(),
});
export function databaseStatements(operation: CrudInput): string[] {
  const op = crudSchema.parse(operation);
  if (op.kind !== "database") throw new Error("Opération de base attendue.");
  if (op.action === "delete") return [`DROP DATABASE ${qi(op.name)}`];
  if (op.action === "create")
    return [
      `CREATE DATABASE ${qi(op.name)}${op.owner ? ` OWNER ${qi(op.owner)}` : ""}${op.connectionLimit !== undefined ? ` CONNECTION LIMIT ${op.connectionLimit}` : ""}`,
    ];
  const sql: string[] = [];
  if (op.owner)
    sql.push(`ALTER DATABASE ${qi(op.name)} OWNER TO ${qi(op.owner)}`);
  if (op.connectionLimit !== undefined)
    sql.push(
      `ALTER DATABASE ${qi(op.name)} CONNECTION LIMIT ${op.connectionLimit}`,
    );
  if (op.newName && op.newName !== op.name)
    sql.push(`ALTER DATABASE ${qi(op.name)} RENAME TO ${qi(op.newName)}`);
  return sql;
}
export function roleSql(
  name: string,
  input: z.infer<typeof roleSchema>,
  action: "create" | "update",
  previous?: Role,
): string {
  const flags: [boolean, string, keyof Role][] = [
    [input.login, "LOGIN", "login"],
    [input.superuser, "SUPERUSER", "superuser"],
    [input.createDb, "CREATEDB", "createDb"],
    [input.createRole, "CREATEROLE", "createRole"],
    [input.inherit, "INHERIT", "inherit"],
    [input.replication, "REPLICATION", "replication"],
    [input.bypassRls, "BYPASSRLS", "bypassRls"],
  ];
  // On update, only changed attributes are sent: PostgreSQL requires SUPERUSER to even
  // mention SUPERUSER, REPLICATION or BYPASSRLS, including when the value is unchanged.
  const changed = flags.filter(
    ([value, , key]) => !previous || previous[key] !== value,
  );
  const password =
    input.password !== undefined && input.password !== ""
      ? ` PASSWORD ${literal(input.password)}`
      : "";
  const validity =
    input.validUntil === undefined
      ? ""
      : ` VALID UNTIL ${literal(input.validUntil || "infinity")}`;
  return `${action === "create" ? "CREATE" : "ALTER"} ROLE ${qi(name)} WITH ${changed.map(([value, flag]) => (value ? flag : "NO" + flag)).join(" ")}${changed.length ? " " : ""}CONNECTION LIMIT ${input.connectionLimit}${password}${validity}`;
}
async function guardCrud(
  client: Client,
  profile: ProfileInput,
  op: z.infer<typeof crudSchema>,
) {
  if (
    op.kind === "database" &&
    ["create", "delete"].includes(op.action) &&
    (await protectedServer(profile))
  )
    throw new Error(
      "Serveur de développement partagé : création et suppression de bases exclusivement via devdb.",
    );
  if (
    op.name.startsWith("pg_") ||
    [
      "template0",
      "template1",
      "postgres",
      "information_schema",
      "dev",
    ].includes(op.name)
  )
    throw new Error("Cette ressource système est protégée.");
  if (
    op.kind === "role" &&
    op.action === "delete" &&
    op.name === (await serverInfo(client, profile)).currentUser
  )
    throw new Error("Impossible de supprimer le compte connecté.");
}
async function crudStatements(
  client: Client,
  op: z.infer<typeof crudSchema>,
): Promise<string[]> {
  if (op.action === "delete")
    return [
      op.kind === "database"
        ? databaseStatements(op)[0]
        : `DROP ${op.kind.toUpperCase()} ${qi(op.name)}${op.kind === "schema" ? " RESTRICT" : ""}`,
    ];
  const statements: string[] = [];
  const kind = op.kind.toUpperCase();
  if (op.kind === "database") statements.push(...databaseStatements(op));
  else if (op.kind === "role") {
    if (!op.role) throw new Error("Attributs du rôle manquants.");
    const previous =
      op.action === "update"
        ? (await roles(client)).find((r) => r.name === op.name)
        : undefined;
    if (op.action === "update" && !previous)
      throw new Error("Rôle introuvable. Actualisez la vue.");
    statements.push(roleSql(op.name, op.role, op.action, previous));
  } else if (op.action === "create") {
    statements.push(
      `CREATE SCHEMA ${qi(op.name)}${op.owner ? ` AUTHORIZATION ${qi(op.owner)}` : ""}`,
    );
  } else if (op.owner)
    statements.push(`ALTER ${kind} ${qi(op.name)} OWNER TO ${qi(op.owner)}`);
  if (
    op.kind !== "database" &&
    op.newName &&
    op.newName !== op.name &&
    op.action === "update"
  )
    statements.push(`ALTER ${kind} ${qi(op.name)} RENAME TO ${qi(op.newName)}`);
  return statements;
}
export async function crudPreview(
  client: Client,
  profile: ProfileInput,
  operation: CrudInput,
): Promise<string[]> {
  const op = crudSchema.parse(operation);
  await guardCrud(client, profile, op);
  const masked = op.role?.password
    ? { ...op, role: { ...op.role, password: "********" } }
    : op;
  return (await crudStatements(client, masked)).map((sql) =>
    sql.replace("PASSWORD E'********'", "PASSWORD '********'") + ";",
  );
}
export async function crud(
  client: Client,
  profile: ProfileInput,
  operation: CrudInput,
): Promise<boolean> {
  const op = crudSchema.parse(operation);
  await guardCrud(client, profile, op);
  if (op.action === "delete") {
    if (op.confirmation !== op.name)
      throw new Error("Saisissez le nom exact pour confirmer la suppression.");
    const deps = await dependencies(client, op.kind, op.name);
    if (deps.length)
      throw new Error(
        "Suppression bloquée : résolvez les dépendances ou sessions actives avant de réessayer.",
      );
    await client.query((await crudStatements(client, op))[0]);
    return true;
  }
  const statements = await crudStatements(client, op);
  const transactional = !(op.kind === "database" && op.action === "create");
  if (transactional) await client.query("BEGIN");
  try {
    for (const sql of statements) await client.query(sql);
    if (transactional) await client.query("COMMIT");
  } catch (error) {
    if (transactional) await client.query("ROLLBACK");
    throw error;
  }
  return true;
}
export async function membership(
  client: Client,
  profile: ProfileInput,
  input: MembershipInput,
) {
  const op = z
    .object({
      role: identifier,
      member: identifier,
      action: z.enum(["grant", "revoke"]),
      admin: z.boolean(),
      inherit: z.boolean(),
      set: z.boolean(),
    })
    .parse(input);
  if (op.role === op.member)
    throw new Error("Un rôle ne peut pas être membre de lui-même.");
  const version = (await serverInfo(client, profile)).version;
  if (op.action === "revoke")
    await client.query(`REVOKE ${qi(op.role)} FROM ${qi(op.member)} RESTRICT`);
  else {
    const options =
      version >= 160000
        ? ` WITH ADMIN ${op.admin ? "TRUE" : "FALSE"}, INHERIT ${op.inherit ? "TRUE" : "FALSE"}, SET ${op.set ? "TRUE" : "FALSE"}`
        : op.admin
          ? " WITH ADMIN OPTION"
          : "";
    await client.query("BEGIN");
    try {
      await client.query(`GRANT ${qi(op.role)} TO ${qi(op.member)}${options}`);
      if (version < 160000 && !op.admin)
        await client.query(
          `REVOKE ADMIN OPTION FOR ${qi(op.role)} FROM ${qi(op.member)} RESTRICT`,
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  return true;
}
export async function devProfile(): Promise<ProfileInput | null> {
  if (process.env.ROMA_DEV !== "1") return null;
  try {
    const env = await readFile(".env.local", "utf8");
    const url = new URL(env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() || "");
    return {
      id: "local-dev",
      name: "Développement local",
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      maintenanceDb: decodeURIComponent(url.pathname.slice(1)),
      ssl: "disable",
      ca: "",
      cert: "",
      color: "#8b5cf6",
    };
  } catch {
    return null;
  }
}
export async function tableDetail(
  client: Client,
  target: Resource,
): Promise<TableDetail> {
  const resource = await resolveResource(client, target);
  if (["database", "schema"].includes(resource.kind))
    throw new Error("Choisissez une table, une vue, une séquence ou une fonction.");
  if (resource.kind === "function") {
    const {
      rows: [row],
    } = await client.query(
      `SELECT pg_get_functiondef($1) AS definition, obj_description($1, 'pg_proc') AS comment`,
      [resource.oid],
    );
    return {
      resource,
      columns: [],
      constraints: [],
      indexes: [],
      comment: row.comment,
      rows: 0,
      size: "",
      definition: row.definition,
    };
  }
  const columns = (
    await client.query(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable, CASE WHEN a.attgenerated = '' THEN pg_get_expr(d.adbin, d.adrelid) END AS default, a.attidentity <> '' AS identity, CASE WHEN a.attgenerated <> '' THEN pg_get_expr(d.adbin, d.adrelid) END AS generated, col_description(a.attrelid, a.attnum) AS comment FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [resource.oid],
    )
  ).rows;
  const keyColumns = (array: string, rel: string) =>
    `ARRAY(SELECT a.attname FROM unnest(${array}) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = ${rel} AND a.attnum = k.n ORDER BY k.i)::text[]`;
  const constraints = (
    await client.query(
      `SELECT c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid, true) AS definition, ${keyColumns("c.conkey", "c.conrelid")} AS columns, rn.nspname AS "refSchema", rc.relname AS "refTable", ${keyColumns("c.confkey", "c.confrelid")} AS "refColumns" FROM pg_constraint c LEFT JOIN pg_class rc ON rc.oid = c.confrelid LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace WHERE c.conrelid = $1 AND c.contype IN ('p','f','u','c','x') ORDER BY CASE c.contype WHEN 'p' THEN 0 WHEN 'f' THEN 1 WHEN 'u' THEN 2 ELSE 3 END, c.conname`,
      [resource.oid],
    )
  ).rows.map((c) => ({
    name: c.name,
    type: (
      {
        p: "primary",
        f: "foreign",
        u: "unique",
        c: "check",
        x: "exclusion",
      } as const
    )[c.type as "p"],
    columns: c.columns,
    definition: c.definition,
    ...(c.type === "f"
      ? {
          references: {
            schema: c.refSchema,
            table: c.refTable,
            columns: c.refColumns,
          },
        }
      : {}),
  }));
  const indexes = (
    await client.query(
      `SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS definition, x.indisunique AS unique, x.indisprimary AS primary, EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid AND c.conrelid = x.indrelid AND c.contype IN ('p','u','x')) AS constraint, ARRAY(SELECT COALESCE(a.attname, '(expression)') FROM unnest(x.indkey::int2[]) WITH ORDINALITY k(n, i) LEFT JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.n WHERE k.i <= x.indnkeyatts ORDER BY k.i)::text[] AS columns FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = $1 ORDER BY x.indisprimary DESC, i.relname`,
      [resource.oid],
    )
  ).rows;
  const {
    rows: [stats],
  } = await client.query(
    `SELECT obj_description(c.oid, 'pg_class') AS comment, GREATEST(c.reltuples, 0)::float8 AS rows, pg_size_pretty(pg_total_relation_size(c.oid)) AS size, CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) WHEN c.relkind = 'S' THEN (SELECT format('START %s · INCREMENT %s · MIN %s · MAX %s%s', seqstart, seqincrement, seqmin, seqmax, CASE WHEN seqcycle THEN ' · CYCLE' ELSE '' END) FROM pg_sequence WHERE seqrelid = c.oid) END AS definition FROM pg_class c WHERE c.oid = $1`,
    [resource.oid],
  );
  return {
    resource,
    columns,
    constraints,
    indexes,
    comment: stats.comment,
    rows: stats.rows,
    size: stats.size,
    definition: stats.definition,
  };
}
export async function types(client: Client): Promise<string[]> {
  return (
    await client.query(
      `SELECT format_type(t.oid, NULL) AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND t.typtype IN ('b','c','d','e','r','m') AND t.typcategory <> 'A' AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c') ORDER BY 1`,
    )
  ).rows.map((r) => r.name);
}
export function ddlPreview(ops: DdlOp[]): string[] {
  if (!Array.isArray(ops) || !ops.length || ops.length > 300)
    throw new Error("Le lot doit contenir entre 1 et 300 opérations.");
  return ops.map(ddlSql);
}
export async function ddlApply(client: Client, ops: DdlOp[]) {
  const statements = ddlPreview(ops);
  await client.query("BEGIN");
  try {
    // Unqualified names in expressions and types resolve in the edited schema, then public.
    await client.query(`SELECT set_config('search_path', $1, true)`, [
      [...new Set([ops[0].schema, "public"])].map(qi).join(", "),
    ]);
    // Extended protocol: one statement per call, even if an expression contains a semicolon.
    for (const text of statements)
      await client.query({ text, queryMode: "extended" } as any);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { count: statements.length };
}
