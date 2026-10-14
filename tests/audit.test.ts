import test from "node:test";
import assert from "node:assert/strict";
import { esc, findings, renderAudit } from "../backend/audit-html";
import type { AuditData } from "../backend/audit";

const role = (name: string, extra = {}) => ({
  oid: 1,
  name,
  login: true,
  superuser: false,
  createDb: false,
  createRole: false,
  inherit: true,
  replication: false,
  bypassRls: false,
  connectionLimit: -1,
  validUntil: null,
  ...extra,
});
const evil = '<script>alert(1)</script>"';
const data: AuditData = {
  generatedAt: "2026-10-14T10:00:00Z",
  profileName: evil,
  host: "h:5432",
  server: {
    version: 180000,
    versionLabel: "18.0",
    currentUser: "dev",
    superuser: true,
    createDb: true,
    createRole: true,
    sharedDev: false,
  },
  roles: [
    role("root", { superuser: true }),
    role("app"),
    role(evil, { login: false }),
  ],
  memberships: [
    { role: evil, member: "app", admin: false, inherit: true, set: true },
  ],
  databases: [
    {
      resource: {
        oid: 1,
        name: "shop",
        schema: "",
        kind: "database",
        owner: "root",
      },
      grants: [{ role: "PUBLIC", privilege: "CONNECT", grantable: false }],
      effective: { app: ["CONNECT"] },
      defaults: [],
      schemas: [
        {
          resource: {
            oid: 2,
            name: "public",
            schema: "",
            kind: "schema",
            owner: "root",
          },
          grants: [{ role: "PUBLIC", privilege: "CREATE", grantable: false }],
          effective: { app: ["USAGE", "CREATE"] },
          objects: [
            {
              resource: {
                oid: 3,
                name: evil,
                schema: "public",
                kind: "table",
                owner: "root",
                rls: true,
              },
              label: "table",
              comment: evil,
              size: "8 kB",
              rows: 12,
              columns: [
                { name: "id", type: "integer", nullable: false, default: null },
              ],
              constraints: [
                { name: "pk", type: "p", definition: "PRIMARY KEY (id)" },
              ],
              indexes: ["CREATE UNIQUE INDEX pk ON t (id)"],
              policies: [],
              grants: [{ role: "app", privilege: "SELECT", grantable: false }],
              effective: { app: ["SELECT"] },
            },
          ],
        },
      ],
    },
    {
      resource: {
        oid: 9,
        name: "locked",
        schema: "",
        kind: "database",
        owner: "root",
      },
      grants: [],
      effective: {},
      schemas: [],
      defaults: [],
      error: "permission denied",
    },
  ],
};

test("esc neutralises HTML metacharacters", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});
test("report escapes identifiers and never emits injected markup", () => {
  const html = renderAudit(data);
  assert.ok(!html.includes(evil));
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(
    html.includes("shop") &&
      html.includes("locked") &&
      html.includes("permission denied"),
  );
  assert.ok(html.includes("PRIMARY KEY (id)"));
});
test("findings flag superusers, PUBLIC CREATE, RLS without policy and unreadable databases", () => {
  const text = findings(data)
    .map((f) => f.text)
    .join("\n");
  assert.match(text, /Super-utilisateurs.*root/);
  assert.match(text, /PUBLIC peut créer/);
  assert.match(text, /RLS active sans politique/);
  assert.match(text, /locked non inspectée/);
});
