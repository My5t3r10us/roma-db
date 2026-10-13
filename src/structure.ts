import type { Column, ColumnDef, DdlOp, TableDetail } from "../shared/types";

export interface ColumnDraft {
  key: string;
  original?: Column;
  name: string;
  type: string;
  nullable: boolean;
  default: string;
  identity: boolean;
  pk: boolean;
  comment: string;
  dropped: boolean;
}
export type AddedConstraint = Extract<
  DdlOp,
  { op: "addForeignKey" | "addUnique" | "addCheck" | "createIndex" }
> & { key: string };
export interface TableDraft {
  key: string;
  profileId: string;
  database: string;
  schema: string;
  /** Undefined for a table that does not exist yet. */
  base?: TableDetail;
  name: string;
  comment: string;
  owner: string;
  columns: ColumnDraft[];
  dropConstraints: string[];
  dropIndexes: string[];
  added: AddedConstraint[];
  drop: boolean;
}
const uid = () => crypto.randomUUID();
export function columnFrom(c: Column, pk: boolean): ColumnDraft {
  return {
    key: uid(),
    original: c,
    name: c.name,
    type: c.type,
    nullable: c.nullable,
    default: c.default || "",
    identity: c.identity,
    pk,
    comment: c.comment || "",
    dropped: false,
  };
}
export function draftFromDetail(
  key: string,
  profileId: string,
  database: string,
  detail: TableDetail,
): TableDraft {
  const pk = detail.constraints.find((c) => c.type === "primary")?.columns || [];
  return {
    key,
    profileId,
    database,
    schema: detail.resource.schema,
    base: detail,
    name: detail.resource.name,
    comment: detail.comment || "",
    owner: detail.resource.owner,
    columns: detail.columns.map((c) => columnFrom(c, pk.includes(c.name))),
    dropConstraints: [],
    dropIndexes: [],
    added: [],
    drop: false,
  };
}
export function newColumn(partial: Partial<ColumnDraft> = {}): ColumnDraft {
  return {
    key: uid(),
    name: "",
    type: "text",
    nullable: true,
    default: "",
    identity: false,
    pk: false,
    comment: "",
    dropped: false,
    ...partial,
  };
}
export function newTableDraft(
  profileId: string,
  database: string,
  schema: string,
  owner: string,
): TableDraft {
  return {
    key: "new:" + uid(),
    profileId,
    database,
    schema,
    name: "",
    comment: "",
    owner,
    columns: [
      newColumn({ name: "id", type: "bigint", nullable: false, identity: true, pk: true }),
      newColumn({ name: "created_at", type: "timestamp with time zone", nullable: false, default: "now()" }),
    ],
    dropConstraints: [],
    dropIndexes: [],
    added: [],
    drop: false,
  };
}
const norm = (type: string) => type.trim().replace(/\s+/g, " ").toLowerCase();
export function columnChanged(c: ColumnDraft) {
  const o = c.original;
  if (!o) return !c.dropped;
  return (
    c.dropped ||
    c.name !== o.name ||
    norm(c.type) !== norm(o.type) ||
    c.nullable !== o.nullable ||
    (c.default.trim() || null) !== (o.default || null) ||
    c.identity !== o.identity ||
    (c.comment.trim() || null) !== (o.comment || null)
  );
}
function def(c: ColumnDraft): ColumnDef {
  return {
    name: c.name.trim(),
    type: c.type.trim(),
    nullable: c.pk ? false : c.nullable,
    default: c.identity ? null : c.default.trim() || null,
    identity: c.identity,
  };
}
/** Ordered DDL operations that turn the base table into the draft. */
export function draftOps(d: TableDraft): DdlOp[] {
  const schema = d.schema;
  const live = d.columns.filter((c) => !c.dropped);
  const name = d.name.trim();
  if (!d.base) {
    const table = name;
    const ops: DdlOp[] = [
      {
        op: "createTable",
        schema,
        table,
        columns: live.map(def),
        primaryKey: live.filter((c) => c.pk).map((c) => c.name.trim()),
      },
    ];
    if (d.comment.trim()) ops.push({ op: "setComment", schema, table, comment: d.comment.trim() });
    for (const c of live)
      if (c.comment.trim())
        ops.push({ op: "setComment", schema, table, column: c.name.trim(), comment: c.comment.trim() });
    for (const { key: _key, ...op } of d.added) ops.push({ ...op, schema, table } as DdlOp);
    return ops;
  }
  const table = d.base.resource.name;
  if (d.drop) return [{ op: "dropTable", schema, table }];
  const ops: DdlOp[] = [];
  const pkConstraint = d.base.constraints.find((c) => c.type === "primary");
  const before = pkConstraint?.columns || [];
  const after = live.filter((c) => c.pk);
  const pkChanged =
    before.length !== after.length ||
    after.some((c) => !c.original || !before.includes(c.original.name) || c.name !== c.original.name);
  for (const n of d.dropConstraints) ops.push({ op: "dropConstraint", schema, table, name: n });
  if (pkChanged && pkConstraint && !d.dropConstraints.includes(pkConstraint.name))
    ops.push({ op: "dropConstraint", schema, table, name: pkConstraint.name });
  for (const n of d.dropIndexes) ops.push({ op: "dropIndex", schema, table, name: n });
  for (const c of d.columns)
    if (c.original && c.dropped) ops.push({ op: "dropColumn", schema, table, column: c.original.name });
  for (const c of live) {
    const o = c.original;
    if (!o) continue;
    const column = c.name.trim();
    if (column !== o.name) ops.push({ op: "renameColumn", schema, table, column: o.name, newName: column });
    if (norm(c.type) !== norm(o.type)) ops.push({ op: "setType", schema, table, column, type: c.type.trim() });
    if (c.identity !== o.identity && !c.identity)
      ops.push({ op: "setIdentity", schema, table, column, identity: false });
    const dflt = c.identity ? null : c.default.trim() || null;
    if (dflt !== (o.default || null)) ops.push({ op: "setDefault", schema, table, column, default: dflt });
    if (c.identity !== o.identity && c.identity)
      ops.push({ op: "setIdentity", schema, table, column, identity: true });
    if (c.nullable !== o.nullable)
      ops.push({ op: "setNullable", schema, table, column, nullable: c.nullable });
    if ((c.comment.trim() || null) !== (o.comment || null))
      ops.push({ op: "setComment", schema, table, column, comment: c.comment.trim() || null });
  }
  for (const c of live)
    if (!c.original) {
      ops.push({ op: "addColumn", schema, table, column: def(c) });
      if (c.comment.trim())
        ops.push({ op: "setComment", schema, table, column: c.name.trim(), comment: c.comment.trim() });
    }
  if (pkChanged && after.length)
    ops.push({ op: "addPrimaryKey", schema, table, columns: after.map((c) => c.name.trim()) });
  for (const { key: _key, ...op } of d.added) ops.push({ ...op, schema, table } as DdlOp);
  if ((d.comment.trim() || null) !== (d.base.comment || null))
    ops.push({ op: "setComment", schema, table, comment: d.comment.trim() || null });
  if (d.owner && d.owner !== d.base.resource.owner)
    ops.push({ op: "setTableOwner", schema, table, owner: d.owner });
  if (name && name !== table) ops.push({ op: "renameTable", schema, table, newName: name });
  return ops;
}
/** Problems detected before contacting the server. */
export function draftIssues(d: TableDraft): string[] {
  if (d.drop) return [];
  const issues: string[] = [];
  const live = d.columns.filter((c) => !c.dropped);
  if (!d.name.trim()) issues.push("La table doit avoir un nom.");
  if (!live.length) issues.push("La table doit garder au moins une colonne.");
  const names = live.map((c) => c.name.trim());
  if (names.some((n) => !n)) issues.push("Chaque colonne doit avoir un nom.");
  const dup = names.find((n, i) => n && names.indexOf(n) !== i);
  if (dup) issues.push(`La colonne « ${dup} » apparaît deux fois.`);
  if (live.some((c) => !c.type.trim())) issues.push("Chaque colonne doit avoir un type.");
  return issues;
}
export const commonTypes = [
  "bigint",
  "integer",
  "smallint",
  "numeric(12,2)",
  "real",
  "double precision",
  "text",
  "character varying(255)",
  "boolean",
  "uuid",
  "date",
  "timestamp with time zone",
  "timestamp without time zone",
  "time without time zone",
  "interval",
  "jsonb",
  "json",
  "bytea",
  "inet",
  "text[]",
  "integer[]",
];
export const integerType = (type: string) =>
  /^(bigint|integer|int|int4|int8|smallint|int2)$/i.test(type.trim());
export function defaultSuggestions(type: string): string[] {
  const t = type.trim().toLowerCase();
  if (t.startsWith("timestamp")) return ["now()", "CURRENT_TIMESTAMP"];
  if (t === "date") return ["CURRENT_DATE"];
  if (t === "uuid") return ["gen_random_uuid()"];
  if (t === "boolean") return ["false", "true"];
  if (t.startsWith("json")) return ["'{}'::jsonb", "'[]'::jsonb"];
  if (/int|numeric|real|double/.test(t)) return ["0"];
  if (t.includes("text") || t.includes("char")) return ["''"];
  return [];
}
