import test from "node:test";
import assert from "node:assert/strict";
import {
  diffLines,
  formatRule,
  parseHba,
  serializeHba,
  shadowedBy,
  suggestions,
  validateRule,
  type HbaEntry,
} from "../shared/hba";

const sample = `# TYPE  DATABASE  USER  ADDRESS  METHOD

local   all   postgres   peer   # admin
host    "my db",app   +writers   192.168.1.0 255.255.255.0   md5
hostssl all   all   0.0.0.0/0   ldap ldapserver=ldap.example ldapprefix="cn=" ldapsuffix=", dc=example"
include_if_exists extra.conf
host all all all reject
`;
const rule = (e: HbaEntry) => {
  assert.equal(e.kind, "rule");
  return e as Extract<HbaEntry, { kind: "rule" }>;
};
test("pg_hba parsing keeps untouched lines byte for byte", () => {
  const entries = parseHba(sample);
  assert.equal(serializeHba(entries), sample);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["comment", "blank", "rule", "rule", "rule", "include", "rule"],
  );
  const local = rule(entries[2]);
  assert.equal(local.address, "");
  assert.equal(local.method, "peer");
  assert.equal(local.comment, "admin");
  const masked = rule(entries[3]);
  assert.equal(masked.database, '"my db",app');
  assert.equal(masked.address, "192.168.1.0 255.255.255.0");
  assert.equal(rule(entries[4]).options, 'ldapserver=ldap.example ldapprefix="cn=" ldapsuffix=", dc=example"');
  assert.equal(entries[2].line, 3);
});
test("pg_hba continuation lines form one rule", () => {
  const [entry] = parseHba("host all all \\\n  10.0.0.0/8 scram-sha-256\n");
  assert.equal(rule(entry).address, "10.0.0.0/8");
  assert.equal(entry.raw, "host all all \\\n  10.0.0.0/8 scram-sha-256");
});
test("edited pg_hba rules are re-aligned, local rules drop the address", () => {
  const base = { database: "all", user: "all", method: "trust", options: "", comment: "" };
  assert.equal(formatRule({ ...base, type: "local", address: "x" }).split(/\s+/).length, 4);
  assert.match(formatRule({ ...base, type: "host", address: "::1/128", comment: "ipv6" }), /^host +all +all +::1\/128 +trust  # ipv6$/);
});
test("pg_hba validation flags each field", () => {
  const ok = { type: "hostssl", database: "all", user: "+g", address: "10.0.0.0/8", method: "cert", options: "clientname=DN map=m", comment: "" };
  assert.deepEqual(validateRule(ok), {});
  const bad = validateRule({ ...ok, type: "hosts", database: "a,,b", user: "", address: "10.0.0.1", method: "peer", options: "nope=1" });
  assert.deepEqual(Object.keys(bad).sort(), ["address", "database", "method", "options", "type", "user"]);
  assert.match(validateRule({ ...ok, address: "10.0.0.0/33" }).address!, /CIDR/);
  assert.match(validateRule({ ...ok, type: "host" }).method!, /hostssl/);
  assert.equal(validateRule({ ...ok, type: "host", method: "md5", options: "", address: "db.example.com" }).address, undefined);
  assert.equal(validateRule({ ...ok, address: "fe80::1/64" }).address, undefined);
  assert.match(validateRule({ ...ok, method: "ldap", options: "ldaptls=yes" }).options!, /0 ou 1/);
  assert.match(validateRule({ ...ok, database: "/^app" }, 150000).database!, /PostgreSQL 16/);
  assert.match(validateRule({ ...ok, comment: "", options: "map=a\u0001" }).options!, /contrôle/);
});
test("pg_hba completion follows the token and the method", () => {
  const ctx = { databases: ["roma", "Big Data"], roles: [{ name: "app", login: false }], identMaps: ["omicron"], clientAddress: "10.1.2.3" };
  const r = { type: "host", database: "", user: "", address: "", method: "ldap", options: "ldapserver=x", comment: "" };
  assert.ok(suggestions("database", r, "", ctx).some((s) => s.value === '"Big Data"'));
  assert.equal(suggestions("user", r, "+", ctx)[0].value, "+app");
  assert.equal(suggestions("address", r, "", ctx)[0].value, "10.1.2.3/32");
  const keys = suggestions("options", r, "ldap", ctx).map((s) => s.value);
  assert.ok(keys.includes("ldapport=") && !keys.includes("ldapserver="));
  assert.deepEqual(suggestions("options", { ...r, method: "ident" }, "map=", ctx).map((s) => s.value), ["map=omicron"]);
  assert.ok(!suggestions("method", r, "", ctx).some((s) => s.value === "peer"));
});
test("pg_hba shadowed rules and line diff", () => {
  const entries = parseHba("host all all all md5\nhostssl app bob 10.0.0.0/8 md5\nhost replication all all md5\n");
  assert.equal(shadowedBy(entries, 1), entries[0]);
  assert.equal(shadowedBy(entries, 2), undefined);
  assert.deepEqual(
    diffLines("a\nb\nc\n", "a\nc\nd\n").map((d) => d.kind[0] + d.text),
    ["sa", "db", "sc", "ad"],
  );
});
