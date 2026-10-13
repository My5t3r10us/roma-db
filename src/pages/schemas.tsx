import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  CircleCheck,
  Crown,
  Fingerprint,
  Hash,
  KeyRound,
  Layers,
  Link2,
  ListTree,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Table2,
  Trash2,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import type { CrudInput, FkAction, Resource, TableDetail } from "../../shared/types";
import { call } from "../api";
import { Dialog, Menu, usePopover } from "../overlay";
import { resourceKey } from "../permissions";
import {
  columnChanged,
  commonTypes,
  defaultSuggestions,
  draftFromDetail,
  draftIssues,
  integerType,
  newColumn,
  newTableDraft,
  type AddedConstraint,
  type ColumnDraft,
  type TableDraft,
} from "../structure";
import { useToast } from "../toast";
import {
  Badge,
  Button,
  Callout,
  Empty,
  ErrorCallout,
  Field,
  IconButton,
  KindIcon,
  Skeleton,
  Spinner,
  Sql,
  Switch,
  cx,
  kindLabel,
  plural,
} from "../ui";
import { safeOps, useWorkspace } from "../workspace";
import { useSchemas } from "./access";

function useObjects(schema?: string) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ["resources", ws.profileId, ws.database, schema],
    queryFn: () => call("resources", { profileId: ws.profileId, database: ws.database, schema }),
    enabled: Boolean(ws.profileId && ws.database && schema),
  });
}
const kindOrder = { table: 0, view: 1, sequence: 2, function: 3, database: 4, schema: 5 };
const draftKeyOf = (profileId: string, database: string, r: Resource) => `${profileId}|${database}|${resourceKey(r)}`;

export function SchemasPage() {
  const ws = useWorkspace();
  const schemas = useSchemas();
  const { schema, object } = ws.schemaView;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [schemaDialog, setSchemaDialog] = useState<{ mode: SchemaMode; schema?: Resource }>();
  useEffect(() => {
    if (schema) setExpanded((e) => (e.has(schema) ? e : new Set([...e, schema])));
  }, [schema]);
  useEffect(() => {
    if (!schema && schemas.data?.length) {
      const first = schemas.data.find((s) => s.name === "public") || schemas.data[0];
      ws.setSchemaView({ schema: first.name });
    }
  }, [schema, schemas.data]);
  const selectedSchema = schemas.data?.find((s) => s.name === schema);
  const newTable = (s: string) => {
    const draft = newTableDraft(ws.profileId, ws.database, s, ws.overview?.server.currentUser || "");
    ws.putDraft(draft);
    ws.setSchemaView({ schema: s, object: draft.key });
  };
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[280px] flex-none flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 px-5 pt-6 pb-3">
          <h1 className="m-0 flex-1 text-[22px] font-bold tracking-tight">Schémas</h1>
          <IconButton label="Nouveau schéma" onClick={() => setSchemaDialog({ mode: "create" })}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="px-4 pb-2">
          <label className="relative block">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
            <input className="input !h-8 !pl-8" placeholder="Filtrer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4" aria-label="Schémas et objets">
          {schemas.isPending ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mx-2 my-2 h-6" />) : null}
          <ErrorCallout error={schemas.error} />
          {schemas.data?.map((s) => (
            <SchemaNode
              key={s.oid}
              schema={s}
              open={expanded.has(s.name) || Boolean(search)}
              search={search}
              onToggle={() =>
                setExpanded((e) => {
                  const next = new Set(e);
                  if (next.has(s.name)) next.delete(s.name);
                  else next.add(s.name);
                  return next;
                })
              }
              onNewTable={() => newTable(s.name)}
            />
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {object && object.startsWith("new:") && ws.drafts[object] ? (
          <TableDesigner key={object} draftKey={object} />
        ) : object && selectedSchema ? (
          <ObjectView key={object} schema={selectedSchema.name} objectKey={object} />
        ) : selectedSchema ? (
          <SchemaOverview
            schema={selectedSchema}
            onNewTable={() => newTable(selectedSchema.name)}
            onAction={(mode) => setSchemaDialog({ mode, schema: selectedSchema })}
          />
        ) : schemas.data && !schemas.data.length ? (
          <Empty
            icon={<Layers size={20} />}
            title="Aucun schéma"
            action={
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setSchemaDialog({ mode: "create" })}>
                Créer un schéma
              </Button>
            }
          >
            Un schéma regroupe des tables, vues et fonctions.
          </Empty>
        ) : null}
      </main>
      {schemaDialog ? <SchemaDialog {...schemaDialog} onClose={() => setSchemaDialog(undefined)} /> : null}
    </div>
  );
}

function SchemaNode({
  schema,
  open,
  search,
  onToggle,
  onNewTable,
}: {
  schema: Resource;
  open: boolean;
  search: string;
  onToggle: () => void;
  onNewTable: () => void;
}) {
  const ws = useWorkspace();
  const objects = useObjects(open ? schema.name : undefined);
  const selected = ws.schemaView.schema === schema.name;
  const drafts = Object.values(ws.drafts).filter((d) => d.profileId === ws.profileId && d.database === ws.database && d.schema === schema.name);
  const q = search.trim().toLowerCase();
  const list = (objects.data || [])
    .filter((o) => !q || o.name.toLowerCase().includes(q))
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name));
  const fresh = drafts.filter((d) => !d.base && (!q || d.name.toLowerCase().includes(q)));
  if (q && objects.data && !list.length && !fresh.length && !schema.name.toLowerCase().includes(q)) return null;
  return (
    <div>
      <div className="group relative">
        <button
          className="tree-item pr-8"
          aria-selected={selected && !ws.schemaView.object}
          aria-expanded={open}
          onClick={() => {
            ws.setSchemaView({ schema: schema.name });
            if (!open || selected) onToggle();
          }}
        >
          <ChevronRight size={13} className={cx("flex-none text-faint transition-transform", open && "rotate-90")} />
          <Layers size={14} className="flex-none text-accent" />
          <span className="min-w-0 flex-1 truncate">{schema.name}</span>
          {drafts.length ? <span className="size-1.5 rounded-full bg-[var(--pending)]" /> : null}
        </button>
        <IconButton
          label={`Nouvelle table dans ${schema.name}`}
          small
          className="absolute top-0.5 right-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={onNewTable}
        >
          <Plus size={14} />
        </IconButton>
      </div>
      {open ? (
        <div className="ml-[15px] border-l border-line pl-1.5">
          {objects.isPending ? <Skeleton className="mx-2 my-1.5 h-5" /> : null}
          {fresh.map((d) => (
            <button
              key={d.key}
              className="tree-item"
              aria-selected={ws.schemaView.object === d.key}
              onClick={() => ws.setSchemaView({ schema: schema.name, object: d.key })}
            >
              <Plus size={13} className="flex-none text-ok" />
              <span className={cx("min-w-0 flex-1 truncate italic", !d.name && "text-faint")}>{d.name || "nouvelle table"}</span>
            </button>
          ))}
          {list.map((o) => {
            const draft = ws.drafts[draftKeyOf(ws.profileId, ws.database, o)];
            return (
              <button
                key={resourceKey(o)}
                className="tree-item"
                aria-selected={ws.schemaView.object === resourceKey(o)}
                onClick={() => ws.setSchemaView({ schema: schema.name, object: resourceKey(o) })}
              >
                <KindIcon kind={o.kind} size={13} className="flex-none" />
                <span className={cx("min-w-0 flex-1 truncate", draft?.drop && "text-danger line-through")}>
                  {o.name}
                  {o.kind === "function" ? <span className="text-faint">()</span> : null}
                </span>
                {draft ? <span className={cx("size-1.5 flex-none rounded-full", draft.drop ? "bg-danger" : "bg-[var(--pending)]")} /> : null}
              </button>
            );
          })}
          {objects.data && !list.length && !fresh.length ? <p className="px-2 py-1 text-[12px] text-faint">Vide</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function SchemaOverview({
  schema,
  onNewTable,
  onAction,
}: {
  schema: Resource;
  onNewTable: () => void;
  onAction: (mode: SchemaMode) => void;
}) {
  const ws = useWorkspace();
  const objects = useObjects(schema.name);
  const menu = usePopover();
  const system = schema.name === "public" ? false : schema.name.startsWith("pg_");
  const groups = useMemo(() => {
    const map = new Map<string, Resource[]>();
    for (const o of objects.data || []) map.set(o.kind, [...(map.get(o.kind) || []), o]);
    return [...map.entries()].sort((a, b) => kindOrder[a[0] as "table"] - kindOrder[b[0] as "table"]);
  }, [objects.data]);
  return (
    <div className="mx-auto max-w-[920px] px-10 py-8">
      <header className="flex items-start gap-4">
        <div className="grid size-12 place-items-center rounded-2xl border border-line bg-surface">
          <Layers size={22} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Schéma · {ws.database}</div>
          <h2 className="m-0 mt-0.5 text-[22px] font-bold tracking-tight">{schema.name}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            <Crown size={12} /> Propriétaire : <b className="text-fg">{schema.owner}</b>
          </p>
        </div>
        <Button
          icon={<ShieldCheck size={15} />}
          onClick={() => {
            ws.setAccess({ scope: "objects", schema: schema.name });
            ws.go("access");
          }}
        >
          Accès
        </Button>
        <Button variant="primary" icon={<Plus size={15} />} onClick={onNewTable}>
          Nouvelle table
        </Button>
        <IconButton label="Plus d’actions" onClick={menu.open} disabled={system}>
          <MoreHorizontal size={17} />
        </IconButton>
        {menu.anchor ? (
          <Menu
            anchor={menu.anchor}
            onClose={menu.close}
            placement="bottom-end"
            items={[
              { label: "Renommer", icon: <Pencil size={14} />, onSelect: () => onAction("rename") },
              { label: "Changer le propriétaire", icon: <Crown size={14} />, onSelect: () => onAction("owner") },
              "separator",
              { label: "Supprimer le schéma", icon: <Trash2 size={14} />, danger: true, onSelect: () => onAction("delete") },
            ]}
          />
        ) : null}
      </header>
      <div className="mt-8">
        {objects.isPending ? (
          <Skeleton className="h-40" />
        ) : !objects.data?.length ? (
          <div className="card">
            <Empty
              icon={<Table2 size={20} />}
              title="Ce schéma est vide"
              action={
                <Button variant="primary" icon={<Plus size={15} />} onClick={onNewTable}>
                  Créer une table
                </Button>
              }
            >
              Créez une première table : vous définissez ses colonnes, Roma DB écrit le SQL.
            </Empty>
          </div>
        ) : (
          <div className="grid gap-5">
            {groups.map(([kind, list]) => (
              <section key={kind} className="card overflow-hidden">
                <h3 className="m-0 flex items-center gap-2 border-b border-line bg-sunken px-4 py-2.5 text-[12.5px] font-semibold">
                  <KindIcon kind={kind as "table"} size={14} />
                  {plural(list.length, kindLabel[kind as "table"].toLowerCase())}
                </h3>
                <ul className="m-0 list-none p-1.5">
                  {list.map((o) => (
                    <li key={resourceKey(o)}>
                      <button
                        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-raised"
                        onClick={() => ws.setSchemaView({ schema: schema.name, object: resourceKey(o) })}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {o.name}
                          {o.kind === "function" ? <span className="text-muted">({o.signature})</span> : null}
                        </span>
                        {o.rls ? <Badge tone="warn">RLS</Badge> : null}
                        <span className="text-[12px] text-muted">{o.owner}</span>
                        <ChevronRight size={14} className="text-faint opacity-0 group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectView({ schema, objectKey }: { schema: string; objectKey: string }) {
  const ws = useWorkspace();
  const objects = useObjects(schema);
  const resource = objects.data?.find((o) => resourceKey(o) === objectKey);
  if (objects.isPending) return <div className="p-10"><Skeleton className="h-64" /></div>;
  if (!resource)
    return (
      <Empty
        icon={<Table2 size={20} />}
        title="Objet introuvable"
        action={<Button onClick={() => ws.setSchemaView({ schema })}>Retour au schéma</Button>}
      >
        Il a peut-être été renommé ou supprimé.
      </Empty>
    );
  if (resource.kind === "table") return <TableDesigner draftKey={draftKeyOf(ws.profileId, ws.database, resource)} resource={resource} />;
  return <DefinitionView resource={resource} />;
}

function useDetail(resource?: Resource) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ["tableDetail", ws.profileId, ws.database, resource && resourceKey(resource), resource?.name],
    queryFn: () => call("tableDetail", { profileId: ws.profileId, database: ws.database, resource: resource! }),
    enabled: Boolean(resource),
  });
}

function DefinitionView({ resource }: { resource: Resource }) {
  const detail = useDetail(resource);
  const ws = useWorkspace();
  return (
    <div className="mx-auto max-w-[920px] px-10 py-8">
      <ObjectHeader resource={resource} detail={detail.data} />
      <ErrorCallout error={detail.error} className="mt-6" />
      {detail.data?.columns.length ? (
        <section className="card mt-6 overflow-hidden">
          <h3 className="m-0 border-b border-line bg-sunken px-4 py-2.5 text-[12.5px] font-semibold">Colonnes</h3>
          <table className="w-full border-collapse text-left">
            <tbody>
              {detail.data.columns.map((c) => (
                <tr key={c.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-mono text-[12.5px] font-semibold">{c.name}</td>
                  <td className="px-4 py-2 font-mono text-[12px] text-muted">{c.type}</td>
                  <td className="px-4 py-2 text-[12px] text-muted">{c.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {detail.data?.definition ? (
        <section className="card mt-6">
          <h3 className="m-0 border-b border-line bg-sunken px-4 py-2.5 text-[12.5px] font-semibold">Définition</h3>
          <div className="max-h-[480px] overflow-auto p-4">
            <Sql code={detail.data.definition} />
          </div>
        </section>
      ) : detail.isPending ? (
        <Skeleton className="mt-6 h-40" />
      ) : null}
      <p className="mt-4 text-[12px] text-faint">
        {kindLabel[resource.kind]} en lecture seule dans Roma DB. Ses droits se gèrent depuis{" "}
        <button
          className="text-accent hover:underline"
          onClick={() => {
            ws.setAccess({ scope: "objects", schema: resource.schema });
            ws.go("access");
          }}
        >
          Accès
        </button>
        .
      </p>
    </div>
  );
}

function ObjectHeader({ resource, detail, children }: { resource: Resource; detail?: TableDetail; children?: React.ReactNode }) {
  return (
    <header className="flex items-start gap-4">
      <div className="grid size-12 flex-none place-items-center rounded-2xl border border-line bg-surface">
        <KindIcon kind={resource.kind} size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">
          {kindLabel[resource.kind]} · {resource.schema}
        </div>
        <h2 className="m-0 mt-0.5 truncate text-[22px] font-bold tracking-tight">{resource.name}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-muted">
          <span className="flex items-center gap-1">
            <Crown size={12} /> {resource.owner}
          </span>
          {detail && resource.kind !== "function" && resource.kind !== "sequence" ? (
            <span>≈ {Math.round(detail.rows).toLocaleString("fr-FR")} lignes</span>
          ) : null}
          {detail?.size ? <span>{detail.size}</span> : null}
          {detail?.comment ? <span className="text-fg">{detail.comment}</span> : null}
        </p>
      </div>
      {children}
    </header>
  );
}

type Tab = "columns" | "constraints" | "indexes";
function TableDesigner({ draftKey, resource }: { draftKey: string; resource?: Resource }) {
  const ws = useWorkspace();
  const detail = useDetail(resource);
  const [tab, setTab] = useState<Tab>("columns");
  const [dialog, setDialog] = useState<"fk" | "unique" | "check" | "index">();
  const menu = usePopover();
  const stored = ws.drafts[draftKey];
  const base = useMemo(
    () => (detail.data && resource ? draftFromDetail(draftKey, ws.profileId, ws.database, detail.data) : undefined),
    [detail.data, draftKey],
  );
  const draft = stored || base;
  if (!draft) {
    if (detail.error) return <div className="p-10"><ErrorCallout error={detail.error} /></div>;
    return (
      <div className="mx-auto max-w-[1100px] px-10 py-8">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-8 h-72" />
      </div>
    );
  }
  const update = (fn: (d: TableDraft) => TableDraft) => ws.putDraft(fn(draft));
  const ops = safeOps(draft);
  const issues = draftIssues(draft);
  const isNew = !draft.base;
  const live = draft.columns.filter((c) => !c.dropped);
  const setColumn = (key: string, patch: Partial<ColumnDraft>) =>
    update((d) => ({ ...d, columns: d.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const constraints = draft.base?.constraints || [];
  const indexes = draft.base?.indexes || [];
  const addedConstraints = draft.added.filter((a) => a.op !== "createIndex");
  const addedIndexes = draft.added.filter((a) => a.op === "createIndex");
  const removeAdded = (key: string) => update((d) => ({ ...d, added: d.added.filter((a) => a.key !== key) }));
  const toggle = (list: "dropConstraints" | "dropIndexes", name: string) =>
    update((d) => ({ ...d, [list]: d[list].includes(name) ? d[list].filter((n) => n !== name) : [...d[list], name] }));
  return (
    <div className="mx-auto max-w-[1100px] px-10 py-8 pb-28">
      <header className="flex items-start gap-4">
        <div className="grid size-12 flex-none place-items-center rounded-2xl border border-line bg-surface">
          <Table2 size={22} className="text-info" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow flex items-center gap-2">
            {isNew ? "Nouvelle table" : "Table"} · {draft.schema}
            {draft.base && !isNew ? (
              <span className="font-normal normal-case">
                · ≈ {Math.round(draft.base.rows).toLocaleString("fr-FR")} lignes · {draft.base.size}
              </span>
            ) : null}
          </div>
          <input
            className="input-bare -ml-[8px] !h-9 w-full max-w-[520px] font-mono !text-[20px] font-bold"
            placeholder="nom_de_la_table"
            autoFocus={isNew}
            aria-label="Nom de la table"
            value={draft.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
            disabled={draft.drop}
          />
          <input
            className="input-bare -ml-[8px] mt-0.5 !h-7 w-full max-w-[620px] text-[12.5px] text-muted"
            placeholder="Ajouter une description…"
            aria-label="Description de la table"
            value={draft.comment}
            onChange={(e) => update((d) => ({ ...d, comment: e.target.value }))}
            disabled={draft.drop}
          />
        </div>
        <OwnerButton value={draft.owner} onChange={(owner) => update((d) => ({ ...d, owner }))} disabled={draft.drop} />
        {!isNew && resource ? (
          <Button
            icon={<ShieldCheck size={15} />}
            onClick={() => {
              ws.setAccess({ scope: "objects", schema: draft.schema });
              ws.go("access");
            }}
          >
            Accès
          </Button>
        ) : null}
        <IconButton label="Plus d’actions" onClick={menu.open}>
          <MoreHorizontal size={17} />
        </IconButton>
        {menu.anchor ? (
          <Menu
            anchor={menu.anchor}
            onClose={menu.close}
            placement="bottom-end"
            items={[
              {
                label: isNew ? "Abandonner cette table" : "Annuler les modifications",
                icon: <Undo2 size={14} />,
                disabled: !stored,
                onSelect: () => {
                  ws.putDraft(null, draftKey);
                  if (isNew) ws.setSchemaView({ schema: draft.schema });
                },
              },
              ...(!isNew
                ? [
                    "separator" as const,
                    {
                      label: "Supprimer la table",
                      icon: <Trash2 size={14} />,
                      danger: true,
                      disabled: draft.drop,
                      onSelect: () => update((d) => ({ ...d, drop: true })),
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
      </header>
      {draft.drop ? (
        <Callout
          tone="danger"
          className="mt-6"
          title="Cette table sera supprimée"
          action={
            <Button size="sm" icon={<Undo2 size={13} />} onClick={() => update((d) => ({ ...d, drop: false }))}>
              Annuler la suppression
            </Button>
          }
        >
          Ses données et ses droits seront perdus à l’application. La suppression échoue si une vue ou une clé étrangère en dépend.
        </Callout>
      ) : null}
      <div className={cx("mt-6", draft.drop && "pointer-events-none opacity-50")}>
        <div className="flex items-center border-b border-line" role="tablist">
          {(
            [
              ["columns", "Colonnes", live.length],
              ["constraints", "Contraintes", constraints.length + addedConstraints.length],
              ["indexes", "Index", indexes.length + addedIndexes.length],
            ] as const
          ).map(([id, label, count]) => (
            <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>
              {label}
              <span className="text-[11px] text-faint">{count}</span>
            </button>
          ))}
          <div className="flex-1" />
          {stored && ops.length ? (
            <span className="flex items-center gap-1.5 pb-1 text-[12px] text-muted">
              <span className="size-1.5 rounded-full bg-[var(--pending)]" />
              {plural(ops.length, "opération")} en attente
            </span>
          ) : null}
        </div>
        {tab === "columns" ? (
          <ColumnsEditor draft={draft} setColumn={setColumn} update={update} />
        ) : tab === "constraints" ? (
          <div className="mt-4 grid gap-2">
            {constraints.map((c) => {
              const dropped = draft.dropConstraints.includes(c.name);
              const Icon = c.type === "primary" ? KeyRound : c.type === "foreign" ? Link2 : c.type === "unique" ? Fingerprint : CircleCheck;
              return (
                <div key={c.name} className={cx("card flex items-center gap-3 px-4 py-3", dropped && "opacity-60")}>
                  <Icon size={16} className={c.type === "primary" ? "text-warn" : "text-muted"} />
                  <div className="min-w-0 flex-1">
                    <div className={cx("flex items-center gap-2", dropped && "line-through")}>
                      <span className="font-semibold">
                        {c.type === "primary"
                          ? "Clé primaire"
                          : c.type === "foreign"
                            ? "Clé étrangère"
                            : c.type === "unique"
                              ? "Unicité"
                              : c.type === "check"
                                ? "Vérification"
                                : "Exclusion"}
                      </span>
                      <code className="text-[11.5px] text-faint">{c.name}</code>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-muted">
                      {c.references
                        ? `${c.columns.join(", ")} → ${c.references.schema}.${c.references.table} (${c.references.columns.join(", ")})`
                        : c.definition}
                    </div>
                  </div>
                  {dropped ? <Badge tone="danger">sera supprimée</Badge> : null}
                  {c.type === "primary" ? (
                    <span className="text-[11.5px] text-faint">Modifiable depuis les colonnes</span>
                  ) : (
                    <IconButton label={dropped ? "Conserver" : "Supprimer"} small onClick={() => toggle("dropConstraints", c.name)}>
                      {dropped ? <Undo2 size={14} /> : <Trash2 size={14} />}
                    </IconButton>
                  )}
                </div>
              );
            })}
            {addedConstraints.map((a) => (
              <AddedRow key={a.key} added={a} onRemove={() => removeAdded(a.key)} />
            ))}
            {!constraints.length && !addedConstraints.length ? (
              <p className="py-6 text-center text-muted">Aucune contrainte.</p>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" icon={<Link2 size={13} />} onClick={() => setDialog("fk")}>
                Clé étrangère
              </Button>
              <Button size="sm" icon={<Fingerprint size={13} />} onClick={() => setDialog("unique")}>
                Unicité
              </Button>
              <Button size="sm" icon={<CircleCheck size={13} />} onClick={() => setDialog("check")}>
                Vérification
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-2">
            {indexes.map((i) => {
              const dropped = draft.dropIndexes.includes(i.name);
              return (
                <div key={i.name} className={cx("card flex items-center gap-3 px-4 py-3", dropped && "opacity-60")}>
                  <ListTree size={16} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className={cx("flex items-center gap-2", dropped && "line-through")}>
                      <span className="font-mono text-[12.5px] font-semibold">{i.name}</span>
                      {i.primary ? <Badge tone="warn">clé primaire</Badge> : i.unique ? <Badge tone="info">unique</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">{i.definition}</div>
                  </div>
                  {i.constraint ? (
                    <span className="text-[11.5px] text-faint">Lié à une contrainte</span>
                  ) : (
                    <IconButton label={dropped ? "Conserver" : "Supprimer"} small onClick={() => toggle("dropIndexes", i.name)}>
                      {dropped ? <Undo2 size={14} /> : <Trash2 size={14} />}
                    </IconButton>
                  )}
                </div>
              );
            })}
            {addedIndexes.map((a) => (
              <AddedRow key={a.key} added={a} onRemove={() => removeAdded(a.key)} />
            ))}
            {!indexes.length && !addedIndexes.length ? <p className="py-6 text-center text-muted">Aucun index.</p> : null}
            <div className="mt-2">
              <Button size="sm" icon={<Plus size={13} />} onClick={() => setDialog("index")}>
                Index
              </Button>
            </div>
          </div>
        )}
        {stored && issues.length ? (
          <Callout tone="warn" className="mt-5" title="À compléter">
            {issues.join(" ")}
          </Callout>
        ) : null}
        {isNew ? (
          <p className="mt-5 text-[12.5px] text-muted">
            La table est créée quand vous appliquez les modifications (barre en bas de l’écran). Vous pourrez ensuite gérer ses droits dans Accès.
          </p>
        ) : null}
      </div>
      {dialog ? (
        <ConstraintDialog
          type={dialog}
          draft={draft}
          onClose={() => setDialog(undefined)}
          onAdd={(a) => update((d) => ({ ...d, added: [...d.added, a] }))}
        />
      ) : null}
    </div>
  );
}

function AddedRow({ added, onRemove }: { added: AddedConstraint; onRemove: () => void }) {
  const text =
    added.op === "addForeignKey"
      ? `Clé étrangère · ${added.columns.join(", ")} → ${added.refSchema}.${added.refTable} (${added.refColumns.join(", ")}) · ON DELETE ${added.onDelete}`
      : added.op === "addUnique"
        ? `Unicité · ${added.columns.join(", ")}`
        : added.op === "addCheck"
          ? `Vérification · ${added.expression}`
          : `${added.unique ? "Index unique" : "Index"} · ${added.columns.join(", ")}`;
  return (
    <div className="card flex items-center gap-3 border-dashed !border-ok px-4 py-3">
      <Plus size={16} className="text-ok" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{text}</span>
      <Badge tone="ok">nouveau</Badge>
      <IconButton label="Retirer" small onClick={onRemove}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

function OwnerButton({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const ws = useWorkspace();
  const pop = usePopover();
  return (
    <>
      <Button icon={<Crown size={14} className="text-warn" />} onClick={pop.open} disabled={disabled} data-tip="Propriétaire : tous les droits sur la table">
        {value || "Propriétaire"}
      </Button>
      {pop.anchor ? (
        <Menu
          anchor={pop.anchor}
          onClose={pop.close}
          placement="bottom-end"
          items={[
            { section: "Propriétaire" },
            ...ws.roles
              .filter((r) => !r.name.startsWith("pg_"))
              .map((r) => ({ label: r.name, checked: r.name === value, onSelect: () => onChange(r.name) })),
          ]}
        />
      ) : null}
    </>
  );
}

function ColumnsEditor({
  draft,
  setColumn,
  update,
}: {
  draft: TableDraft;
  setColumn: (key: string, patch: Partial<ColumnDraft>) => void;
  update: (fn: (d: TableDraft) => TableDraft) => void;
}) {
  const ws = useWorkspace();
  const types = useQuery({
    queryKey: ["types", ws.profileId, ws.database],
    queryFn: () => call("types", { profileId: ws.profileId, database: ws.database }),
    staleTime: 60000,
  });
  const allTypes = [...commonTypes, ...(types.data || [])];
  const grid = "grid grid-cols-[6px_minmax(130px,1fr)_minmax(190px,1.35fr)_80px_minmax(150px,1.1fr)_40px_minmax(110px,0.9fr)_32px] items-center gap-x-2";
  return (
    <div className="mt-4">
      <datalist id="pg-types">
        {allTypes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="card overflow-hidden">
        <div className={cx(grid, "border-b border-line bg-sunken px-2 py-2 text-[11.5px] font-semibold text-muted")}>
          <span />
          <span className="px-2">Nom</span>
          <span className="px-2">Type</span>
          <span className="text-center" data-tip="NOT NULL : une valeur est obligatoire">
            Obligatoire
          </span>
          <span className="px-2">Valeur par défaut</span>
          <span className="text-center" data-tip="Clé primaire">
            Clé
          </span>
          <span className="px-2">Description</span>
          <span />
        </div>
        {draft.columns.map((c) => {
          const state = !c.original ? "new" : c.dropped ? "dropped" : columnChanged(c) ? "changed" : "";
          const generated = c.original?.generated;
          return (
            <div
              key={c.key}
              className={cx(grid, "group border-b border-line px-2 py-1.5 last:border-0 hover:bg-sunken", c.dropped && "opacity-55")}
            >
              <span
                className={cx(
                  "h-6 w-1 rounded-full",
                  state === "new" && "bg-ok",
                  state === "changed" && "bg-[var(--pending)]",
                  state === "dropped" && "bg-danger",
                )}
                data-tip={state === "new" ? "Nouvelle colonne" : state === "changed" ? "Colonne modifiée" : state === "dropped" ? "Sera supprimée" : undefined}
              />
              <input
                className={cx("input-bare font-mono text-[12.5px] font-semibold", c.dropped && "line-through")}
                value={c.name}
                placeholder="nom"
                aria-label="Nom de la colonne"
                disabled={c.dropped}
                onChange={(e) => setColumn(c.key, { name: e.target.value })}
                autoFocus={!c.original && !c.name && draft.columns.length > 2}
              />
              <input
                className="input-bare font-mono text-[12px]"
                list="pg-types"
                value={c.type}
                aria-label="Type"
                disabled={c.dropped || Boolean(generated)}
                onChange={(e) => setColumn(c.key, { type: e.target.value })}
              />
              <span className="flex justify-center">
                <Switch
                  label="Obligatoire"
                  checked={c.pk || !c.nullable}
                  disabled={c.dropped || c.pk}
                  onChange={(v) => setColumn(c.key, { nullable: !v })}
                />
              </span>
              {generated ? (
                <span className="truncate px-2 font-mono text-[11.5px] text-muted" data-tip={`GENERATED ALWAYS AS (${generated})`}>
                  généré · {generated}
                </span>
              ) : c.identity ? (
                <span className="flex px-1">
                  <span className="flex items-center gap-1 rounded-md bg-info-soft py-0.5 pr-1 pl-2 text-[11.5px] font-semibold text-info">
                    <Zap size={11} /> auto-incrément
                    <button
                      className="grid size-4 place-items-center rounded hover:bg-info/15"
                      aria-label="Retirer l’auto-incrément"
                      disabled={c.dropped}
                      onClick={() => setColumn(c.key, { identity: false })}
                    >
                      <X size={11} />
                    </button>
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <input
                    className="input-bare font-mono text-[12px]"
                    list={`defaults-${c.key}`}
                    placeholder="aucune"
                    value={c.default}
                    aria-label="Valeur par défaut"
                    disabled={c.dropped}
                    onChange={(e) => setColumn(c.key, { default: e.target.value })}
                  />
                  <datalist id={`defaults-${c.key}`}>
                    {defaultSuggestions(c.type).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  {integerType(c.type) && !c.dropped ? (
                    <IconButton
                      label="Auto-incrément (identité)"
                      small
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => setColumn(c.key, { identity: true, default: "" })}
                    >
                      <Hash size={13} />
                    </IconButton>
                  ) : null}
                </span>
              )}
              <span className="flex justify-center">
                <button
                  aria-pressed={c.pk}
                  aria-label="Clé primaire"
                  data-tip={c.pk ? "Fait partie de la clé primaire" : "Ajouter à la clé primaire"}
                  disabled={c.dropped}
                  onClick={() => setColumn(c.key, { pk: !c.pk, nullable: c.pk ? c.nullable : false })}
                  className={cx(
                    "grid size-7 place-items-center rounded-lg transition-colors",
                    c.pk ? "bg-warn-soft text-warn" : "text-faint hover:bg-raised hover:text-muted",
                  )}
                >
                  <KeyRound size={14} />
                </button>
              </span>
              <input
                className="input-bare text-[12px]"
                placeholder="—"
                value={c.comment}
                aria-label="Description de la colonne"
                disabled={c.dropped}
                onChange={(e) => setColumn(c.key, { comment: e.target.value })}
              />
              <span className="flex justify-center">
                {c.dropped ? (
                  <IconButton label="Restaurer" small onClick={() => setColumn(c.key, { dropped: false })}>
                    <Undo2 size={14} />
                  </IconButton>
                ) : (
                  <IconButton
                    label="Supprimer la colonne"
                    small
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() =>
                      c.original
                        ? setColumn(c.key, { dropped: true, pk: false })
                        : update((d) => ({ ...d, columns: d.columns.filter((x) => x.key !== c.key) }))
                    }
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </span>
            </div>
          );
        })}
        <button
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-muted hover:bg-sunken hover:text-fg"
          onClick={() => update((d) => ({ ...d, columns: [...d.columns, newColumn()] }))}
        >
          <Plus size={14} /> Ajouter une colonne
        </button>
      </div>
      {draft.base && draft.columns.some((c) => !c.original && !c.nullable && !c.default && !c.identity && !c.dropped) && draft.base.rows > 0 ? (
        <Callout tone="warn" className="mt-3">
          Une nouvelle colonne obligatoire sans valeur par défaut échouera si la table contient déjà des lignes.
        </Callout>
      ) : null}
    </div>
  );
}

const fkActions: { value: FkAction; label: string }[] = [
  { value: "NO ACTION", label: "Bloquer (par défaut)" },
  { value: "RESTRICT", label: "Bloquer immédiatement" },
  { value: "CASCADE", label: "Supprimer aussi ces lignes" },
  { value: "SET NULL", label: "Mettre à NULL" },
  { value: "SET DEFAULT", label: "Remettre la valeur par défaut" },
];
function ConstraintDialog({
  type,
  draft,
  onClose,
  onAdd,
}: {
  type: "fk" | "unique" | "check" | "index";
  draft: TableDraft;
  onClose: () => void;
  onAdd: (a: AddedConstraint) => void;
}) {
  const schemas = useSchemas();
  const columns = draft.columns.filter((c) => !c.dropped && c.name.trim()).map((c) => c.name.trim());
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [unique, setUnique] = useState(false);
  const [refSchema, setRefSchema] = useState(draft.schema);
  const [refTable, setRefTable] = useState("");
  const [refColumn, setRefColumn] = useState("");
  const [onDelete, setOnDelete] = useState<FkAction>("NO ACTION");
  const refObjects = useObjects(type === "fk" ? refSchema : undefined);
  const refResource = refObjects.data?.find((o) => o.kind === "table" && o.name === refTable);
  const refDetail = useDetail(refResource);
  const refCandidates = refDetail.data?.columns.map((c) => c.name) || [];
  const refPk = refDetail.data?.constraints.find((c) => c.type === "primary")?.columns[0];
  useEffect(() => {
    if (refPk) setRefColumn(refPk);
  }, [refPk]);
  const key = crypto.randomUUID();
  const common = { key, schema: draft.schema, table: draft.name, ...(name.trim() ? { name: name.trim() } : {}) };
  const valid =
    type === "check" ? Boolean(expression.trim()) : type === "fk" ? Boolean(selected[0] && refTable && refColumn) : selected.length > 0;
  const title = { fk: "Nouvelle clé étrangère", unique: "Nouvelle contrainte d’unicité", check: "Nouvelle vérification", index: "Nouvel index" }[type];
  const description = {
    fk: "Chaque valeur doit exister dans la table référencée.",
    unique: "Interdit les doublons sur ces colonnes.",
    check: "Une condition que chaque ligne doit respecter.",
    index: "Accélère les recherches et les tris sur ces colonnes.",
  }[type];
  const toggleColumn = (c: string) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={<Check size={15} />}
            disabled={!valid}
            onClick={() => {
              if (type === "fk")
                onAdd({
                  ...common,
                  op: "addForeignKey",
                  columns: [selected[0]],
                  refSchema,
                  refTable,
                  refColumns: [refColumn],
                  onDelete,
                  onUpdate: "NO ACTION",
                });
              else if (type === "unique") onAdd({ ...common, op: "addUnique", columns: selected });
              else if (type === "check") onAdd({ ...common, op: "addCheck", expression: expression.trim() });
              else onAdd({ ...common, op: "createIndex", columns: selected, unique });
              onClose();
            }}
          >
            Ajouter
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {type === "fk" ? (
          <>
            <Field label="Colonne">
              {(id) => (
                <select id={id} className="input" value={selected[0] || ""} onChange={(e) => setSelected([e.target.value])}>
                  <option value="">Choisir…</option>
                  {columns.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Schéma référencé">
                {(id) => (
                  <select
                    id={id}
                    className="input"
                    value={refSchema}
                    onChange={(e) => {
                      setRefSchema(e.target.value);
                      setRefTable("");
                    }}
                  >
                    {schemas.data?.map((s) => (
                      <option key={s.oid}>{s.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Table">
                {(id) => (
                  <select id={id} className="input" value={refTable} onChange={(e) => setRefTable(e.target.value)}>
                    <option value="">Choisir…</option>
                    {refObjects.data
                      ?.filter((o) => o.kind === "table")
                      .map((o) => (
                        <option key={o.oid}>{o.name}</option>
                      ))}
                  </select>
                )}
              </Field>
              <Field label="Colonne référencée">
                {(id) => (
                  <select id={id} className="input" value={refColumn} onChange={(e) => setRefColumn(e.target.value)} disabled={!refTable}>
                    <option value="">{refDetail.isFetching ? "Chargement…" : "Choisir…"}</option>
                    {refCandidates.map((c) => (
                      <option key={c} value={c}>
                        {c}
                        {c === refPk ? " (clé primaire)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label="Quand la ligne référencée est supprimée">
              {(id) => (
                <select id={id} className="input" value={onDelete} onChange={(e) => setOnDelete(e.target.value as FkAction)}>
                  {fkActions.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label} · {a.value}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        ) : type === "check" ? (
          <Field label="Condition" hint="Expression SQL, par exemple : price >= 0 ou end_date > start_date">
            {(id) => (
              <input id={id} autoFocus className="input font-mono text-[12.5px]" value={expression} onChange={(e) => setExpression(e.target.value)} />
            )}
          </Field>
        ) : (
          <div>
            <span className="label">Colonnes {type === "index" ? "(dans l’ordre de sélection)" : ""}</span>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => {
                const i = selected.indexOf(c);
                return (
                  <button
                    key={c}
                    onClick={() => toggleColumn(c)}
                    className={cx(
                      "flex h-8 items-center gap-1.5 rounded-lg border px-3 font-mono text-[12px]",
                      i >= 0 ? "border-accent bg-accent-soft text-accent" : "border-line-strong hover:bg-raised",
                    )}
                  >
                    {i >= 0 ? <span className="grid size-4 place-items-center rounded bg-accent text-[10px] text-white">{i + 1}</span> : null}
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {type === "index" ? (
          <label className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
            <span>
              <span className="block font-medium">Index unique</span>
              <span className="block text-xs text-muted">Interdit aussi les doublons.</span>
            </span>
            <Switch label="Index unique" checked={unique} onChange={setUnique} />
          </label>
        ) : null}
        <Field label="Nom" hint="Facultatif : PostgreSQL en génère un.">
          {(id) => <input id={id} className="input font-mono text-[12.5px]" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

type SchemaMode = "create" | "rename" | "owner" | "delete";
function SchemaDialog({ mode, schema, onClose }: { mode: SchemaMode; schema?: Resource; onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(mode === "rename" ? schema!.name : "");
  const [owner, setOwner] = useState(schema?.owner || "");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const deps = useQuery({
    queryKey: ["dependencies", ws.profileId, ws.database, "schema", schema?.name],
    queryFn: () => call("dependencies", { profileId: ws.profileId, database: ws.database, kind: "schema", name: schema!.name }),
    enabled: mode === "delete",
  });
  const operation: CrudInput | undefined =
    mode === "create"
      ? name.trim()
        ? { kind: "schema", action: "create", name: name.trim(), owner: owner || undefined }
        : undefined
      : mode === "rename"
        ? name.trim() && name.trim() !== schema!.name
          ? { kind: "schema", action: "update", name: schema!.name, newName: name.trim() }
          : undefined
        : mode === "owner"
          ? owner && owner !== schema!.owner
            ? { kind: "schema", action: "update", name: schema!.name, owner }
            : undefined
          : { kind: "schema", action: "delete", name: schema!.name, confirmation };
  const preview = useQuery({
    queryKey: ["crudPreview", ws.profileId, ws.database, operation],
    queryFn: () => call("crudPreview", { profileId: ws.profileId, database: ws.database, operation: operation! }),
    enabled: Boolean(operation),
    retry: false,
  });
  const titles = {
    create: "Nouveau schéma",
    rename: `Renommer ${schema?.name}`,
    owner: `Propriétaire de ${schema?.name}`,
    delete: `Supprimer ${schema?.name} ?`,
  };
  const blocked = mode === "delete" && (deps.isPending || Boolean(deps.data?.length) || confirmation !== schema?.name);
  return (
    <Dialog
      title={titles[mode]}
      description={mode === "delete" ? "Le schéma doit être vide. Rien n’est supprimé en cascade." : `Dans la base ${ws.database}.`}
      icon={mode === "delete" ? <Trash2 size={16} className="text-danger" /> : <Layers size={16} />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant={mode === "delete" ? "danger" : "primary"}
            loading={busy}
            disabled={!operation || blocked || Boolean(preview.error)}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await call("crud", { profileId: ws.profileId, database: ws.database, operation: operation! });
                await ws.refresh();
                if (mode === "delete") ws.setSchemaView({});
                else if (mode !== "owner") ws.setSchemaView({ schema: name.trim() });
                toast({
                  title: { create: "Schéma créé", rename: "Schéma renommé", owner: "Propriétaire modifié", delete: "Schéma supprimé" }[mode],
                  description: mode === "delete" ? schema!.name : name.trim() || schema!.name,
                });
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {{ create: "Créer", rename: "Renommer", owner: "Enregistrer", delete: "Supprimer" }[mode]}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {mode === "create" || mode === "rename" ? (
          <Field label="Nom">
            {(id) => (
              <input id={id} autoFocus className="input font-mono" placeholder="ventes, analytics…" value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
        ) : null}
        {mode === "create" || mode === "owner" ? (
          <Field label="Propriétaire" hint="Il pourra tout faire dans le schéma.">
            {(id) => (
              <select id={id} className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {mode === "create" ? <option value="">Compte connecté ({ws.overview?.server.currentUser})</option> : null}
                {ws.roles
                  .filter((r) => !r.name.startsWith("pg_"))
                  .map((r) => (
                    <option key={r.oid}>{r.name}</option>
                  ))}
              </select>
            )}
          </Field>
        ) : null}
        {mode === "delete" ? (
          deps.isPending ? (
            <div className="flex items-center gap-2 text-muted">
              <Spinner /> Recherche des objets du schéma…
            </div>
          ) : deps.data?.length ? (
            <Callout tone="warn" title={`Le schéma contient ${plural(deps.data.length, "objet")}`}>
              <ul className="m-0 mt-1 max-h-40 list-disc overflow-y-auto pl-4">
                {deps.data.slice(0, 30).map((d, i) => (
                  <li key={i}>{d.description}</li>
                ))}
              </ul>
              <p className="mt-2">Supprimez ou déplacez-les d’abord.</p>
            </Callout>
          ) : (
            <Field label={<>Saisissez <b className="font-mono">{schema!.name}</b> pour confirmer</>}>
              {(id) => <input id={id} autoFocus className="input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />}
            </Field>
          )
        ) : null}
        {operation && preview.data ? (
          <div className="rounded-[10px] border border-line bg-sunken p-3">
            <Sql code={preview.data.join("\n")} />
          </div>
        ) : null}
        <ErrorCallout error={preview.error || deps.error || error} />
      </div>
    </Dialog>
  );
}

