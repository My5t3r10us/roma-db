import test from "node:test";
import assert from "node:assert/strict";
import { ddlSql } from "../backend/ddl";
import { draftOps, draftFromDetail, newColumn } from "../src/structure";
import type { TableDetail } from "../shared/types";

const on = { schema: "public", table: "items" };
test("column types accept PostgreSQL spellings and refuse injected SQL", () => {
  for (const type of [
    "bigint",
    "character varying(255)",
    "numeric(10,2)",
    "timestamp with time zone",
    "timestamp(3) without time zone",
    "double precision",
    "text[]",
    "public.order_status",
    '"Mixed Type"',
  ])
    assert.match(ddlSql({ op: "setType", ...on, column: "c", type }), /ALTER COLUMN "c" TYPE/, type);
  for (const type of ["text; DROP TABLE x", "int) ; --", "text -- x", "a b c d"])
    assert.throws(() => ddlSql({ op: "setType", ...on, column: "c", type }), type);
});
test("identifiers are quoted and system schemas are read-only", () => {
  assert.equal(
    ddlSql({ op: "renameColumn", ...on, column: 'a"b', newName: "c" }),
    'ALTER TABLE "public"."items" RENAME COLUMN "a""b" TO "c";',
  );
  assert.throws(() => ddlSql({ op: "dropTable", schema: "pg_catalog", table: "pg_class" }));
  assert.throws(() => ddlSql({ op: "dropTable", schema: "information_schema", table: "x" }));
});
test("identity columns cannot also carry a default", () => {
  assert.throws(() =>
    ddlSql({
      op: "addColumn",
      ...on,
      column: { name: "id", type: "bigint", nullable: false, default: "1", identity: true },
    }),
  );
});
test("comments are SQL literals", () => {
  assert.equal(
    ddlSql({ op: "setComment", ...on, comment: "l'article" }),
    `COMMENT ON TABLE "public"."items" IS E'l''article';`,
  );
});
test("table drafts produce ordered operations", () => {
  const detail: TableDetail = {
    resource: { oid: 1, name: "items", schema: "public", kind: "table", owner: "app" },
    columns: [
      { name: "id", type: "bigint", nullable: false, default: null, identity: true, generated: null, comment: null },
      { name: "label", type: "text", nullable: true, default: null, identity: false, generated: null, comment: null },
      { name: "old", type: "text", nullable: true, default: null, identity: false, generated: null, comment: null },
    ],
    constraints: [{ name: "items_pkey", type: "primary", columns: ["id"], definition: "PRIMARY KEY (id)" }],
    indexes: [],
    comment: null,
    rows: 0,
    size: "8 kB",
    definition: null,
  };
  const draft = draftFromDetail("k", "p", "d", detail);
  assert.deepEqual(draftOps(draft), []);
  draft.name = "articles";
  draft.columns[1] = { ...draft.columns[1], name: "title", nullable: false };
  draft.columns[2] = { ...draft.columns[2], dropped: true };
  draft.columns.push(newColumn({ name: "price", type: "numeric(10,2)" }));
  assert.deepEqual(
    draftOps(draft).map((o) => o.op),
    ["dropColumn", "renameColumn", "setNullable", "addColumn", "renameTable"],
  );
  const nullable = draftOps(draft).find((o) => o.op === "setNullable");
  assert.equal(nullable && "column" in nullable && nullable.column, "title");
});
