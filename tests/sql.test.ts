import test from "node:test";
import assert from "node:assert/strict";
import {
  availablePrivileges,
  changeSql,
  fingerprint,
  literal,
  qi,
  sharedDev,
} from "../backend/sql";
import { roleSql, databaseStatements } from "../backend/postgres";
import { mergeChanges } from "../src/permissions";
import type { Change } from "../shared/types";
const change: Change = {
  id: "1",
  profileId: "test",
  database: "test",
  resource: {
    oid: 1,
    name: 'a"; DROP TABLE x;--',
    schema: "mixed Schema",
    kind: "table",
    owner: "owner",
  },
  role: "reader",
  privilege: "SELECT",
  action: "grant",
  grantOption: false,
  fingerprint: "a".repeat(64),
};
test("SQL identifiers are quoted, including embedded quotes", () => {
  assert.equal(qi('a"b'), '"a""b"');
  assert.throws(() => qi("x\0"));
  assert.throws(() => qi("é".repeat(32)));
  assert.match(changeSql(change), /"a""; DROP TABLE x;--"/);
});
test("password SQL literals escape quotes and backslashes", () => {
  assert.equal(literal("a'\\b"), "E'a''\\\\b'");
  const sql = roleSql(
    "reader",
    {
      name: "reader",
      login: true,
      superuser: false,
      createDb: false,
      createRole: false,
      inherit: true,
      replication: false,
      bypassRls: false,
      connectionLimit: -1,
      password: "a'; DROP ROLE dev;--",
    },
    "create",
  );
  assert.match(sql, /PASSWORD E'a''; DROP ROLE dev;--'/);
});
test("supported privileges track PostgreSQL versions and resource types", () => {
  assert(!availablePrivileges("table", 160000).includes("MAINTAIN"));
  assert(availablePrivileges("table", 170000).includes("MAINTAIN"));
  assert.throws(() => changeSql({ ...change, privilege: "EXECUTE" }));
  assert.throws(() => changeSql({ ...change, privilege: "SELECT;DROP" }));
});
test("PUBLIC cannot receive grant option; revokes restrict cascading", () => {
  assert.throws(() =>
    changeSql({ ...change, role: "PUBLIC", grantOption: true }),
  );
  assert.match(changeSql({ ...change, action: "revoke" }), /RESTRICT;$/);
});
test("grant option can be revoked without removing the privilege", () => {
  assert.match(
    changeSql({ ...change, action: "revoke", grantOption: true }),
    /^REVOKE GRANT OPTION FOR SELECT/,
  );
});
test("functions include authoritative overload identity", () => {
  assert.equal(
    changeSql({
      ...change,
      privilege: "EXECUTE",
      resource: {
        oid: 2,
        name: "calculate",
        schema: "public",
        kind: "function",
        owner: "owner",
        identity: "value integer",
      },
    }),
    'GRANT EXECUTE ON FUNCTION "public"."calculate"(value integer) TO "reader";',
  );
});
test("default privileges distinguish global and per-schema scope", () => {
  assert.match(
    changeSql({
      ...change,
      defaultOwner: "creator",
      resource: { ...change.resource, schema: "" },
    }),
    /^ALTER DEFAULT PRIVILEGES FOR ROLE "creator" GRANT/,
  );
  assert.match(
    changeSql({ ...change, defaultOwner: "creator" }),
    /IN SCHEMA "mixed Schema"/,
  );
});
test("shared server detection covers loopback aliases", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "LOCALHOST."])
    assert(sharedDev({ host, port: 5432 }));
  assert(!sharedDev({ host: "db.example.com", port: 5432 }));
});
test("basket deduplication preserves original snapshot", () => {
  const merged = mergeChanges(
    [change],
    [{ ...change, id: "2", action: "revoke", fingerprint: "b".repeat(64) }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].action, "revoke");
  assert.equal(merged[0].fingerprint, change.fingerprint);
});
test("fingerprint detects changed permission state", () => {
  assert.notEqual(fingerprint({ acl: "a" }), fingerprint({ acl: "b" }));
});
test("database lifecycle SQL is checked without executing CREATE or DROP DATABASE", () => {
  assert.deepEqual(
    databaseStatements({
      kind: "database",
      action: "create",
      name: 'mixed"db',
      owner: "owner",
      connectionLimit: 25,
    }),
    ['CREATE DATABASE "mixed""db" OWNER "owner" CONNECTION LIMIT 25'],
  );
  assert.deepEqual(
    databaseStatements({
      kind: "database",
      action: "update",
      name: "old",
      newName: "new",
      owner: "owner",
      connectionLimit: -1,
    }),
    [
      'ALTER DATABASE "old" OWNER TO "owner"',
      'ALTER DATABASE "old" CONNECTION LIMIT -1',
      'ALTER DATABASE "old" RENAME TO "new"',
    ],
  );
  assert.deepEqual(
    databaseStatements({ kind: "database", action: "delete", name: "target" }),
    ['DROP DATABASE "target"'],
  );
});
