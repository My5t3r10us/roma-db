import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  Globe,
  Info,
  Layers,
  LockKeyhole,
  Search,
  ShieldCheck,
  Table2,
  Undo2,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { AccessMatrix, MatrixEntry, MatrixScope, ObjectKind, Resource, Role } from "../../shared/types";
import { call } from "../api";
import { Menu, Popover, Sheet, usePopover, type MenuEntry } from "../overlay";
import {
  abbreviate,
  computeCell,
  describeSource,
  levelForRank,
  levels,
  planDirect,
  privilegeDescription,
  resourceKey,
  scopeLevelNames,
  type Cell,
  type CellContext,
} from "../permissions";
import {
  Badge,
  Button,
  Callout,
  Empty,
  ErrorCallout,
  IconButton,
  KindIcon,
  RoleAvatar,
  Segmented,
  Skeleton,
  Switch,
  cx,
  kindLabel,
  kindPlural,
  plural,
} from "../ui";
import { useToast } from "../toast";
import { useWorkspace } from "../workspace";

export function useMatrix(scope: MatrixScope, schema: string, system = false) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ["matrix", ws.profileId, ws.database, scope, scope === "objects" ? schema : "", system],
    queryFn: () =>
      call("matrix", {
        profileId: ws.profileId,
        database: ws.database,
        scope,
        schema: scope === "objects" ? schema : undefined,
        system,
      }),
    enabled: Boolean(ws.profileId && ws.database && (scope !== "objects" || schema)),
    placeholderData: (previous, query) =>
      query && previous && query.queryKey[3] === scope ? previous : undefined,
  });
}
export function useSchemas() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ["resources", ws.profileId, ws.database, ""],
    queryFn: () => call("resources", { profileId: ws.profileId, database: ws.database }),
    enabled: Boolean(ws.profileId && ws.database),
  });
}
export function useCellContext(): CellContext {
  const ws = useWorkspace();
  return useMemo(
    () => ({
      version: ws.version,
      roles: ws.rolesByName,
      memberships: ws.overview?.memberships || [],
      pending: ws.pending,
    }),
    [ws.version, ws.rolesByName, ws.overview?.memberships, ws.pending],
  );
}

interface RoleFilter {
  hidden: string[];
  showPublic: boolean;
  system: boolean;
}
function useRoleFilter(profileId: string) {
  const key = "roma.roleFilter." + profileId;
  const [filter, setFilter] = useState<RoleFilter>(() => {
    try {
      return { hidden: [], showPublic: true, system: false, ...JSON.parse(localStorage.getItem(key) || "{}") };
    } catch {
      return { hidden: [], showPublic: true, system: false };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(filter));
    } catch {
      /* best effort */
    }
  }, [key, filter]);
  return [filter, setFilter] as const;
}
export function sortRoles(names: string[], roles: Map<string, Role>) {
  return [...names].sort((a, b) => {
    const ga = roles.get(a)?.login ? 1 : 0;
    const gb = roles.get(b)?.login ? 1 : 0;
    return ga - gb || a.localeCompare(b);
  });
}

export function AccessPage() {
  const ws = useWorkspace();
  const { scope, schema: chosenSchema, focusRole } = ws.access;
  const schemas = useSchemas();
  const schema =
    chosenSchema && schemas.data?.some((s) => s.name === chosenSchema)
      ? chosenSchema
      : schemas.data?.find((s) => s.name === "public")?.name || schemas.data?.[0]?.name || "";
  const [filter, setFilter] = useRoleFilter(ws.profileId);
  const matrix = useMatrix(scope, schema, filter.system);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | ObjectKind>("all");
  const [sheet, setSheet] = useState<MatrixEntry>();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSearch("");
    setKind("all");
  }, [scope, schema, ws.database]);
  const ctx = useCellContext();
  const roleNames = useMemo(() => {
    const names = sortRoles(matrix.data?.roles || [], ws.rolesByName).filter((r) => !filter.hidden.includes(r));
    return filter.showPublic ? [...names, "PUBLIC"] : names;
  }, [matrix.data?.roles, filter, ws.rolesByName]);
  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (matrix.data?.entries || []).filter(
      (e) =>
        (kind === "all" || e.resource.kind === kind) &&
        (!q || `${e.resource.name} ${e.resource.signature || ""} ${e.resource.owner}`.toLowerCase().includes(q)),
    );
  }, [matrix.data, search, kind]);
  const kinds = useMemo(() => {
    const counts = new Map<ObjectKind, number>();
    for (const e of matrix.data?.entries || []) counts.set(e.resource.kind, (counts.get(e.resource.kind) || 0) + 1);
    return counts;
  }, [matrix.data]);
  const schemaMenu = usePopover();
  const scopeOptions = [
    { value: "databases" as const, label: "Bases", icon: <KindIcon kind="database" size={14} className="!text-current" /> },
    { value: "schemas" as const, label: "Schémas", icon: <Layers size={14} /> },
    { value: "objects" as const, label: "Tables & objets", icon: <Table2 size={14} /> },
  ];
  const drill = (e: MatrixEntry) => {
    if (e.resource.kind === "database") {
      if (e.resource.name !== ws.database) ws.selectDatabase(e.resource.name);
      ws.setAccess({ scope: "schemas" });
    } else if (e.resource.kind === "schema") ws.setAccess({ scope: "objects", schema: e.resource.name });
    else setSheet(e);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end gap-4 px-8 pt-7 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Accès</h1>
          <p className="mt-1 text-[13px] text-muted">
            {scope === "databases"
              ? "Qui peut se connecter à chaque base du serveur."
              : scope === "schemas"
                ? `Qui peut utiliser les schémas de ${ws.database}.`
                : `Qui peut lire, écrire ou exécuter dans ${ws.database}.${schema}.`}{" "}
            Cliquez sur une case pour changer un droit.
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-8 pb-3">
        <Segmented label="Périmètre" value={scope} onChange={(v) => ws.setAccess({ scope: v })} options={scopeOptions} />
        {scope === "objects" ? (
          <>
            <ChevronRight size={14} className="text-faint" />
            <button className="btn btn-secondary btn-sm !h-[30px]" onClick={schemaMenu.open} aria-haspopup="menu">
              <Layers size={14} className="text-accent" />
              {schema || "Choisir un schéma"}
              <ChevronDown size={13} className="text-faint" />
            </button>
            {schemaMenu.anchor ? (
              <Menu
                anchor={schemaMenu.anchor}
                onClose={schemaMenu.close}
                items={(schemas.data || []).map((s) => ({
                  label: s.name,
                  icon: <Layers size={14} />,
                  checked: s.name === schema,
                  onSelect: () => ws.setAccess({ schema: s.name }),
                }))}
              />
            ) : null}
          </>
        ) : null}
        <div className="flex-1" />
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            className="input !h-[30px] w-56 !pl-8"
            placeholder={scope === "databases" ? "Filtrer les bases…" : scope === "schemas" ? "Filtrer les schémas…" : "Filtrer les objets…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
          />
        </label>
        <RoleFilterButton
          roles={sortRoles(matrix.data?.roles || [], ws.rolesByName)}
          filter={filter}
          setFilter={setFilter}
        />
      </div>
      {scope === "objects" && kinds.size > 1 ? (
        <div className="flex gap-1.5 px-8 pb-3">
          {(["all", "table", "view", "sequence", "function"] as const)
            .filter((k) => k === "all" || kinds.has(k))
            .map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cx(
                  "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
                  kind === k ? "border-fg bg-fg text-bg" : "border-line-strong text-muted hover:text-fg",
                )}
              >
                {k === "all" ? "Tout" : kindPlural[k]}
                <span className="opacity-60">{k === "all" ? matrix.data?.entries.length : kinds.get(k)}</span>
              </button>
            ))}
        </div>
      ) : null}
      {scope === "objects" && matrix.data ? <SchemaUsageHint matrix={matrix.data} schema={schema} roles={roleNames} /> : null}
      <div className="min-h-0 flex-1 px-8 pb-24">
        {matrix.error ? (
          <ErrorCallout error={matrix.error} />
        ) : scope === "objects" && schemas.isSuccess && !schemas.data.length ? (
          <Empty icon={<Layers size={20} />} title="Aucun schéma dans cette base" />
        ) : (
          <div className="card flex h-full min-h-[240px] flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto">
              {matrix.isPending && !matrix.data ? (
                <MatrixSkeleton />
              ) : (
                <MatrixTable
                  entries={entries}
                  total={matrix.data?.entries.length || 0}
                  roles={roleNames}
                  scope={scope}
                  ctx={ctx}
                  focusRole={focusRole}
                  onOpen={drill}
                  onDetails={setSheet}
                  loading={matrix.isFetching}
                />
              )}
              {matrix.data && !entries.length ? (
                <Empty
                  icon={search ? <Search size={20} /> : <Table2 size={20} />}
                  title={search ? "Aucun résultat" : scope === "objects" ? "Ce schéma est vide" : "Rien à afficher"}
                  action={search ? <Button onClick={() => setSearch("")}>Effacer la recherche</Button> : undefined}
                />
              ) : null}
            </div>
            <Legend />
          </div>
        )}
      </div>
      {sheet ? <ResourceSheet entry={sheet} roles={matrix.data?.roles || []} onClose={() => setSheet(undefined)} /> : null}
    </div>
  );
}

function MatrixSkeleton() {
  return (
    <div className="grid gap-3 p-5">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-48" />
          {Array.from({ length: 6 }, (_, j) => (
            <Skeleton key={j} className="h-6 w-20" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line bg-sunken px-4 py-2.5 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="pill l1 !h-4 !min-w-5" /> Lecture
      </span>
      <span className="flex items-center gap-1.5">
        <span className="pill l2 !h-4 !min-w-5" /> Écriture
      </span>
      <span className="flex items-center gap-1.5">
        <span className="pill l3 !h-4 !min-w-5" /> Complet
      </span>
      <span className="flex items-center gap-1.5">
        <span className="pill l1 indirect !h-4 !min-w-5" /> Hérité d’un groupe ou de PUBLIC
      </span>
      <span className="flex items-center gap-1.5">
        <span className="pill owner !h-4 !min-w-5" /> Propriétaire
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[var(--pending)]" /> Modifié, pas encore appliqué
      </span>
    </div>
  );
}

export function RoleHeader({ name, role, compact }: { name: string; role?: Role; compact?: boolean }) {
  const group = name !== "PUBLIC" && !role?.login;
  return (
    <span className="flex min-w-0 flex-col items-center gap-1.5">
      <RoleAvatar name={name} group={group} size={compact ? 20 : 24} />
      <span className="flex max-w-full items-center gap-1 text-[12px] font-semibold text-fg">
        <span className="truncate">{name}</span>
        {role?.superuser ? <Zap size={11} className="flex-none text-warn" /> : null}
      </span>
    </span>
  );
}

function MatrixTable({
  entries,
  total,
  roles,
  scope,
  ctx,
  focusRole,
  onOpen,
  onDetails,
  loading,
}: {
  entries: MatrixEntry[];
  total: number;
  roles: string[];
  scope: MatrixScope;
  ctx: CellContext;
  focusRole?: string;
  onOpen: (e: MatrixEntry) => void;
  onDetails: (e: MatrixEntry) => void;
  loading: boolean;
}) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<{ anchor: HTMLElement; entry: MatrixEntry; role: string }>();
  const [column, setColumn] = useState<{ anchor: HTMLElement; role: string }>();
  const headRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!focusRole) return;
    const th = headRef.current?.querySelector(`[data-role="${CSS.escape(focusRole)}"]`);
    th?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [focusRole, roles.length]);
  if (!entries.length) return null;
  return (
    <>
      <table className={cx("matrix transition-opacity", loading && "opacity-70")}>
        <thead>
          <tr ref={headRef}>
            <th className="sticky-col w-[300px] min-w-[260px] px-4 pb-2.5 text-left">
              <span className="eyebrow">
                {plural(entries.length, scope === "databases" ? "base" : scope === "schemas" ? "schéma" : "objet")}
                {entries.length !== total ? ` sur ${total}` : ""}
              </span>
            </th>
            {roles.map((r) => (
              <th key={r} data-role={r} className={cx("w-[120px] min-w-[120px] px-1 pb-2", r === focusRole && "col-focus")}>
                <button
                  className="mx-auto flex w-full max-w-[112px] justify-center rounded-lg px-1 py-1.5 hover:bg-raised"
                  onClick={(e) => setColumn({ anchor: e.currentTarget, role: r })}
                  data-tip={r === "PUBLIC" ? "PUBLIC : tous les rôles, y compris les futurs" : undefined}
                >
                  <RoleHeader name={r} role={ws.rolesByName.get(r)} />
                </button>
              </th>
            ))}
            <th className="w-full" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={resourceKey(e.resource)}>
              <td className="sticky-col px-2 py-1">
                <ResourceCell entry={e} onOpen={() => onOpen(e)} onDetails={() => onDetails(e)} />
              </td>
              {roles.map((r) => (
                <td key={r} className={cx("text-center", r === focusRole && "col-focus")}>
                  <CellButton
                    cell={computeCell(e, r, ctx)}
                    resource={e.resource}
                    onClick={(anchor) => setEditing({ anchor, entry: e, role: r })}
                    active={editing?.entry === e && editing.role === r}
                  />
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <CellEditor
          anchor={editing.anchor}
          entry={editing.entry}
          role={editing.role}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {column ? (
        <ColumnMenu anchor={column.anchor} role={column.role} entries={entries} scope={scope} onClose={() => setColumn(undefined)} />
      ) : null}
    </>
  );
}

function ResourceCell({ entry, onOpen, onDetails }: { entry: MatrixEntry; onOpen: () => void; onDetails: () => void }) {
  const ws = useWorkspace();
  const r = entry.resource;
  const container = r.kind === "database" || r.kind === "schema";
  return (
    <div className="group flex items-center gap-1">
      <button className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised" onClick={onOpen}>
        <span className="grid size-7 flex-none place-items-center rounded-lg border border-line bg-surface">
          <KindIcon kind={r.kind} size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{r.name}</span>
            {r.kind === "database" && r.name === ws.database ? <Badge tone="accent">actuelle</Badge> : null}
            {r.rls ? (
              <span data-tip="Row Level Security activée : des politiques filtrent les lignes." className="text-warn">
                <LockKeyhole size={12} />
              </span>
            ) : null}
          </span>
          <span className="block truncate text-[11.5px] text-muted">
            {r.kind === "function" ? `(${r.signature || ""})` : `${kindLabel[r.kind]} · ${r.owner}`}
          </span>
        </span>
        {container ? <ChevronRight size={14} className="flex-none text-faint opacity-0 group-hover:opacity-100" /> : null}
      </button>
      <IconButton label="Qui a accès ?" small className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={onDetails}>
        <Info size={14} />
      </IconButton>
    </div>
  );
}

function cellTip(cell: Cell, resource: Resource) {
  const d = cell.display;
  if (d.kind === "superuser") return `${cell.role} est superutilisateur : tous les droits, sans restriction.`;
  if (d.kind === "owner")
    return d.via
      ? `Propriétaire via ${d.via} : tous les droits sur ${resource.name}.`
      : `${cell.role} est propriétaire de ${resource.name} : tous les droits.`;
  if (!cell.future.length) return `${cell.role} n’a aucun accès à ${resource.name}.`;
  const lines = cell.future.map((p) => {
    const sources = (cell.sources[p] || []).map(describeSource);
    const staged = cell.futureDirect.includes(p) && !(p in cell.direct) ? ["à accorder"] : [];
    return `${p} — ${[...staged, ...sources].join(", ") || "direct"}`;
  });
  const removed = cell.pending.filter((c) => c.action === "revoke").map((c) => `${c.privilege} — à retirer`);
  return [...lines, ...removed].join("\n");
}

export function CellPill({ cell }: { cell: Cell }) {
  const d = cell.display;
  const pending = cell.pending.length > 0;
  if (d.kind === "superuser")
    return (
      <span className={cx("pill owner", pending && "pending")}>
        <Zap size={12} />
        Super
      </span>
    );
  if (d.kind === "owner")
    return (
      <span className={cx("pill owner", pending && "pending")}>
        <Crown size={12} />
        {d.via ? "Proprio." : "Propriétaire"}
      </span>
    );
  if (d.kind === "none")
    return (
      <span className={cx("pill none", pending && "pending")}>
        <span className="size-1 rounded-full bg-current" />
      </span>
    );
  const publicOnly = cell.indirect && cell.future.every((p) => cell.sources[p]?.some((s) => s.type === "public"));
  return (
    <span className={cx("pill", `l${d.kind === "level" ? d.level.rank : d.rank}`, cell.indirect && "indirect", pending && "pending")}>
      {cell.indirect ? publicOnly ? <Globe size={11} /> : <GitBranch size={11} /> : null}
      {d.kind === "level" ? d.level.label : abbreviate(d.privileges)}
    </span>
  );
}

function CellButton({
  cell,
  resource,
  onClick,
  active,
}: {
  cell: Cell;
  resource: Resource;
  onClick: (anchor: HTMLElement) => void;
  active: boolean;
}) {
  return (
    <button
      className={cx("cell-btn", active && "[&_.pill]:shadow-[var(--ring)]")}
      data-tip={cellTip(cell, resource)}
      aria-label={`${cell.role} sur ${resource.name}`}
      onClick={(e) => onClick(e.currentTarget)}
    >
      <CellPill cell={cell} />
    </button>
  );
}

export function CellEditor({
  anchor,
  entry,
  role,
  onClose,
}: {
  anchor: HTMLElement;
  entry: MatrixEntry;
  role: string;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const ctx = useCellContext();
  const cell = computeCell(entry, role, ctx);
  const r = entry.resource;
  const [grantOption, setGrantOption] = useState(false);
  const base = { profileId: ws.profileId, database: ws.database };
  const sameCell = (c: { defaultOwner?: string; resource: Resource; role: string; profileId: string; database: string }) =>
    !c.defaultOwner &&
    c.profileId === ws.profileId &&
    c.database === ws.database &&
    c.resource.kind === r.kind &&
    c.resource.oid === r.oid &&
    c.role === role;
  const setDesired = (desired: string[]) => {
    ws.addChanges(planDirect(entry, cell, desired, grantOption, base), sameCell);
    // Granting access to a schema: offer to open up its content right away.
    if (r.kind === "schema" && role !== "PUBLIC" && desired.includes("USAGE") && !cell.futureDirect.includes("USAGE")) {
      onClose();
      ws.ui.openSchemaContent({ schema: r.name, role });
    }
  };
  const levelList = levels(r.kind, ws.version);
  const roleInfo = ws.rolesByName.get(role);
  const fixed = cell.display.kind === "superuser" || (cell.display.kind === "owner" && !cell.display.via);
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} label={`Droits de ${role} sur ${r.name}`}>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <RoleAvatar name={role} group={role !== "PUBLIC" && !roleInfo?.login} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{role}</div>
          <div className="flex items-center gap-1 truncate text-xs text-muted">
            <KindIcon kind={r.kind} size={12} />
            {r.schema ? `${r.schema}.` : ""}
            {r.name}
          </div>
        </div>
        <CellPill cell={cell} />
      </div>
      {fixed ? (
        <div className="p-4">
          <Callout tone="info">
            {cell.display.kind === "superuser"
              ? "Un superutilisateur contourne toutes les vérifications de droits. Retirez l’attribut SUPERUSER dans Rôles pour le limiter."
              : "Le propriétaire a implicitement tous les droits. Changez le propriétaire depuis Schémas pour les lui retirer."}
          </Callout>
        </div>
      ) : (
        <div className="p-3">
          <div className="mb-1.5 px-1 text-xs font-semibold text-muted">Accès direct</div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${levelList.length + 1}, minmax(0, 1fr))` }}>
            {[{ rank: 0, label: "Aucun", privileges: [] as string[] }, ...levelList].map((l) => {
              const selected =
                l.privileges.length === cell.futureDirect.length && l.privileges.every((p) => cell.futureDirect.includes(p));
              return (
                <button
                  key={l.label}
                  onClick={() => setDesired(l.privileges)}
                  className={cx(
                    "flex h-[52px] flex-col items-center justify-center gap-1 rounded-lg border text-[11.5px] font-semibold transition-colors",
                    selected ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-line-strong hover:bg-raised",
                  )}
                >
                  <span className={cx("pill !h-3 !min-w-6 !p-0", l.rank ? `l${l.rank}` : "none border border-dashed !border-line-strong")} />
                  {l.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 mb-1 px-1 text-xs font-semibold text-muted">Détail des privilèges</div>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {cell.privileges.map((p) => {
              const checked = cell.futureDirect.includes(p);
              const changed = checked !== p in cell.direct;
              const others = (cell.sources[p] || []).filter((s) => s.type !== "direct");
              return (
                <li key={p}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-raised">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setDesired(e.target.checked ? [...cell.futureDirect, p] : cell.futureDirect.filter((x) => x !== p))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] font-semibold">{p}</span>
                        {changed ? <span className="size-1.5 rounded-full bg-[var(--pending)]" data-tip="Modifié, pas encore appliqué" /> : null}
                        {cell.direct[p] ? <Badge tone="info" tip="Peut transmettre ce droit (WITH GRANT OPTION)">délégable</Badge> : null}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted">{privilegeDescription(r.kind, p)}</span>
                    </span>
                    {others.length ? (
                      <span
                        className="flex max-w-[120px] items-center gap-1 truncate rounded-md bg-raised px-1.5 py-0.5 text-[11px] text-muted"
                        data-tip={others.map(describeSource).join("\n")}
                      >
                        {others[0].type === "public" ? <Globe size={10} /> : <GitBranch size={10} />}
                        <span className="truncate">{others[0].type === "public" ? "PUBLIC" : others[0].via || "autre"}</span>
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
          {cell.future.some((p) => !cell.futureDirect.includes(p)) ? (
            <p className="mx-1 mt-2 text-[11.5px] text-muted">
              Les droits marqués <GitBranch size={10} className="inline" /> restent actifs même sans accès direct : retirez l’appartenance
              au groupe (ou le droit de PUBLIC) pour les supprimer.
            </p>
          ) : null}
          {role !== "PUBLIC" ? (
            <label className="mt-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[12px] hover:bg-raised">
              <span>
                Autoriser la délégation
                <span className="block text-[11px] text-muted">S’applique aux droits accordés depuis ce panneau.</span>
              </span>
              <Switch label="Autoriser la délégation" checked={grantOption} onChange={setGrantOption} />
            </label>
          ) : null}
        </div>
      )}
      {r.kind === "schema" && role !== "PUBLIC" ? (
        <button
          className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[12.5px] font-medium text-accent hover:bg-raised"
          onClick={() => {
            onClose();
            ws.ui.openSchemaContent({ schema: r.name, role });
          }}
        >
          <Table2 size={14} />
          <span className="flex-1">Accès aux tables, vues, séquences et fonctions…</span>
          <ChevronRight size={14} />
        </button>
      ) : null}
      {cell.pending.length ? (
        <div className="flex items-center gap-2 border-t border-line bg-sunken px-4 py-2.5 text-[12px]">
          <span className="size-2 rounded-full bg-[var(--pending)]" />
          <span className="flex-1 text-muted">{plural(cell.pending.length, "changement")} en attente</span>
          <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => ws.removeChanges((c) => sameCell(c))}>
            Rétablir
          </Button>
        </div>
      ) : null}
    </Popover>
  );
}

function ColumnMenu({
  anchor,
  role,
  entries,
  scope,
  onClose,
}: {
  anchor: HTMLElement;
  role: string;
  entries: MatrixEntry[];
  scope: MatrixScope;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const ctx = useCellContext();
  const toast = useToast();
  const info = ws.rolesByName.get(role);
  const apply = (rank: number) => {
    const base = { profileId: ws.profileId, database: ws.database };
    const touched = new Set<string>();
    const changes = entries.flatMap((e) => {
      const cell = computeCell(e, role, ctx);
      if (cell.display.kind === "superuser" || (cell.display.kind === "owner" && !cell.display.via)) return [];
      touched.add(resourceKey(e.resource));
      return planDirect(e, cell, levelForRank(e.resource.kind, ws.version, rank)?.privileges || [], false, base);
    });
    ws.addChanges(
      changes,
      (c) => !c.defaultOwner && c.role === role && c.profileId === ws.profileId && c.database === ws.database && touched.has(resourceKey(c.resource)),
    );
    toast({
      tone: "info",
      title: changes.length ? `${plural(changes.length, "changement")} préparé${changes.length > 1 ? "s" : ""}` : "Aucun changement nécessaire",
      description: changes.length ? "Vérifiez puis appliquez depuis la barre en bas de l’écran." : undefined,
    });
  };
  const names = scopeLevelNames[scope];
  const items: MenuEntry[] = [
    ...(role !== "PUBLIC"
      ? [
          {
            label: "Ouvrir la fiche du rôle",
            icon: info?.login ? <UserRound size={14} /> : <Users size={14} />,
            onSelect: () => {
              ws.setSelectedRole(role);
              ws.go("roles");
            },
          },
          "separator" as const,
        ]
      : []),
    { section: `Accès direct sur les ${plural(entries.length, "ligne")} affichée${entries.length > 1 ? "s" : ""}` },
    ...[1, 2, 3]
      .filter((rank) => scope !== "schemas" || rank !== 2)
      .map((rank) => ({
        label: names[rank - 1],
        icon: <span className={`pill l${rank} !h-3 !min-w-4 !p-0`} />,
        onSelect: () => apply(rank),
      })),
    { label: "Retirer l’accès direct", icon: <X size={14} />, danger: true, onSelect: () => apply(0) },
  ];
  return <Menu anchor={anchor} onClose={onClose} items={items} placement="bottom" width={270} />;
}

function SchemaUsageHint({ matrix, schema, roles }: { matrix: AccessMatrix; schema: string; roles: string[] }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const ctx = useCellContext();
  const toast = useToast();
  const blocked = roles.filter((r) => {
    if (matrix.schemaUsage[r] || ws.rolesByName.get(r)?.superuser) return false;
    const staged = ws.pending.some((c) => c.resource.kind === "schema" && c.resource.name === schema && c.role === r && c.privilege === "USAGE" && c.action === "grant");
    if (staged) return false;
    return matrix.entries.some((e) => (r === "PUBLIC" ? e.grants.some((g) => g.role === "PUBLIC") : (e.effective[r] || []).length));
  });
  if (!blocked.length) return null;
  return (
    <div className="px-8 pb-3">
      <Callout
        tone="warn"
        title={`${blocked.slice(0, 3).join(", ")}${blocked.length > 3 ? ` et ${blocked.length - 3} autre(s)` : ""} : droits inutilisables`}
        action={
          <Button
            size="sm"
            onClick={async () => {
              try {
                const schemas = await qc.fetchQuery({
                  queryKey: ["matrix", ws.profileId, ws.database, "schemas", "", false],
                  queryFn: () => call("matrix", { profileId: ws.profileId, database: ws.database, scope: "schemas" }),
                });
                const entry = schemas.entries.find((e) => e.resource.name === schema);
                if (!entry) return;
                ws.addChanges(
                  blocked.flatMap((r) => {
                    const cell = computeCell(entry, r, ctx);
                    return planDirect(entry, cell, [...new Set([...cell.futureDirect, "USAGE"])], false, {
                      profileId: ws.profileId,
                      database: ws.database,
                    });
                  }),
                );
              } catch (e) {
                toast({ tone: "error", title: "Impossible de préparer USAGE", description: (e as Error).message });
              }
            }}
          >
            Accorder USAGE sur {schema}
          </Button>
        }
      >
        Sans le droit USAGE sur le schéma « {schema} », ces rôles ne peuvent atteindre aucun objet, malgré les droits affichés.
      </Callout>
    </div>
  );
}

function RoleFilterButton({
  roles,
  filter,
  setFilter,
}: {
  roles: string[];
  filter: RoleFilter;
  setFilter: (f: RoleFilter) => void;
}) {
  const ws = useWorkspace();
  const pop = usePopover();
  const [q, setQ] = useState("");
  const visible = roles.filter((r) => !filter.hidden.includes(r)).length + (filter.showPublic ? 1 : 0);
  const total = roles.length + 1;
  const quick = (pred: (r: Role | undefined) => boolean) =>
    setFilter({ ...filter, hidden: roles.filter((r) => !pred(ws.rolesByName.get(r))) });
  return (
    <>
      <button className={cx("btn btn-secondary btn-sm !h-[30px]", visible < total && "!border-accent !text-accent")} onClick={pop.open}>
        <Filter size={13} />
        Rôles
        <span className="text-faint tabular-nums">
          {visible}/{total}
        </span>
      </button>
      {pop.anchor ? (
        <Popover anchor={pop.anchor} onClose={pop.close} placement="bottom-end" width={290} label="Rôles affichés">
          <div className="border-b border-line p-2.5">
            <input autoFocus className="input !h-8" placeholder="Rechercher un rôle…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => quick(() => true)}>
                Tous
              </Button>
              <Button size="sm" variant="ghost" onClick={() => quick((r) => !r?.login)}>
                Groupes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => quick((r) => Boolean(r?.login))}>
                Comptes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => quick(() => false)}>
                Aucun
              </Button>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1.5">
            {[...roles, "PUBLIC"]
              .filter((r) => r.toLowerCase().includes(q.toLowerCase()))
              .map((r) => {
                const shown = r === "PUBLIC" ? filter.showPublic : !filter.hidden.includes(r);
                const info = ws.rolesByName.get(r);
                return (
                  <label key={r} className="menu-item cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={shown}
                      onChange={() =>
                        setFilter(
                          r === "PUBLIC"
                            ? { ...filter, showPublic: !shown }
                            : { ...filter, hidden: shown ? [...filter.hidden, r] : filter.hidden.filter((x) => x !== r) },
                        )
                      }
                    />
                    <RoleAvatar name={r} group={r !== "PUBLIC" && !info?.login} size={20} />
                    <span className="min-w-0 flex-1 truncate">{r}</span>
                    <span className="text-[11px] text-faint">{r === "PUBLIC" ? "tous" : info?.login ? "compte" : "groupe"}</span>
                  </label>
                );
              })}
          </div>
          <label className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5 text-[12px]">
            <span className="flex items-center gap-2">
              {filter.system ? <Eye size={13} /> : <EyeOff size={13} />}
              Rôles système (pg_*)
            </span>
            <Switch label="Afficher les rôles système" checked={filter.system} onChange={(v) => setFilter({ ...filter, system: v })} />
          </label>
        </Popover>
      ) : null}
    </>
  );
}

export function ResourceSheet({ entry, roles, onClose }: { entry: MatrixEntry; roles: string[]; onClose: () => void }) {
  const ws = useWorkspace();
  const ctx = useCellContext();
  const r = entry.resource;
  const [editing, setEditing] = useState<{ anchor: HTMLElement; role: string }>();
  const policies = useQuery({
    queryKey: ["access", ws.profileId, ws.database, resourceKey(r), r.owner],
    queryFn: () => call("access", { profileId: ws.profileId, database: ws.database, resource: r, role: r.owner }),
    enabled: r.kind === "table" || r.kind === "view",
  });
  const cells = [...roles, "PUBLIC"].map((name) => computeCell(entry, name, ctx));
  const rank = (c: Cell) =>
    c.display.kind === "superuser" ? 5 : c.display.kind === "owner" ? 4 : c.display.kind === "level" ? c.display.level.rank : c.display.kind === "custom" ? c.display.rank : 0;
  const withAccess = cells.filter((c) => c.display.kind !== "none").sort((a, b) => rank(b) - rank(a) || a.role.localeCompare(b.role));
  const without = cells.filter((c) => c.display.kind === "none");
  return (
    <Sheet
      title={
        <span className="flex items-center gap-2">
          <KindIcon kind={r.kind} size={16} />
          {r.schema ? <span className="text-muted">{r.schema}.</span> : null}
          {r.name}
        </span>
      }
      description={`${kindLabel[r.kind]} · propriétaire ${r.owner}`}
      onClose={onClose}
      footer={
        r.kind === "table" || r.kind === "view" || r.kind === "sequence" || r.kind === "function" ? (
          <>
            <div className="flex-1" />
            <Button
              icon={<ArrowRight size={15} />}
              onClick={() => {
                ws.setSchemaView({ schema: r.schema, object: resourceKey(r) });
                ws.go("schemas");
                onClose();
              }}
            >
              Ouvrir la structure
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="px-6 py-5">
        <h3 className="eyebrow mb-2.5 flex items-center gap-2">
          <ShieldCheck size={13} /> {plural(withAccess.length, "rôle")} avec accès
        </h3>
        <ul className="m-0 grid list-none gap-1 p-0">
          {withAccess.map((c) => (
            <li key={c.role}>
              <button
                className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-raised"
                onClick={(e) => setEditing({ anchor: e.currentTarget, role: c.role })}
              >
                <RoleAvatar name={c.role} group={c.role !== "PUBLIC" && !ws.rolesByName.get(c.role)?.login} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.role}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {c.display.kind === "superuser"
                      ? "Superutilisateur"
                      : c.display.kind === "owner"
                        ? c.display.via
                          ? `Hérite du propriétaire ${c.display.via}`
                          : "Propriétaire"
                        : c.future
                            .map((p) => {
                              const s = (c.sources[p] || []).find((x) => x.type !== "direct");
                              return c.futureDirect.includes(p) || !s ? p : `${p} (${s.type === "public" ? "PUBLIC" : s.via || "autre"})`;
                            })
                            .join(" · ")}
                  </span>
                </span>
                <CellPill cell={c} />
              </button>
            </li>
          ))}
        </ul>
        {without.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-muted hover:text-fg">
              {plural(without.length, "rôle")} sans accès
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {without.map((c) => (
                <button
                  key={c.role}
                  className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pr-2.5 pl-0.5 text-[12px] hover:bg-raised"
                  onClick={(e) => setEditing({ anchor: e.currentTarget, role: c.role })}
                >
                  <RoleAvatar name={c.role} group={c.role !== "PUBLIC" && !ws.rolesByName.get(c.role)?.login} size={20} />
                  {c.role}
                </button>
              ))}
            </div>
          </details>
        ) : null}
        {r.kind === "table" || r.kind === "view" ? (
          <section className="mt-7">
            <h3 className="eyebrow mb-2.5 flex items-center gap-2">
              <LockKeyhole size={13} /> Sécurité au niveau des lignes
            </h3>
            {!r.rls ? (
              <p className="text-[12.5px] text-muted">RLS désactivée : un rôle qui peut lire la table voit toutes ses lignes.</p>
            ) : policies.isPending ? (
              <Skeleton className="h-14" />
            ) : policies.data?.policies.length ? (
              <div className="grid gap-2">
                <p className="text-[12.5px] text-muted">
                  RLS activée{r.forceRls ? " (forcée, y compris pour le propriétaire)" : ""} : les droits ci-dessus ne donnent accès qu’aux lignes
                  autorisées par ces politiques.
                </p>
                {policies.data.policies.map((p) => (
                  <div key={p.name} className="card p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.name}</span>
                      <Badge>{p.command}</Badge>
                      <span className="flex-1" />
                      <span className="text-xs text-muted">{p.roles.join(", ")}</span>
                    </div>
                    {p.using ? <code className="mt-2 block text-[11.5px] text-muted">USING ({p.using})</code> : null}
                    {p.check ? <code className="mt-1 block text-[11.5px] text-muted">WITH CHECK ({p.check})</code> : null}
                  </div>
                ))}
              </div>
            ) : (
              <Callout tone="warn">RLS activée sans politique : aucune ligne n’est visible, sauf pour le propriétaire.</Callout>
            )}
          </section>
        ) : null}
      </div>
      {editing ? <CellEditor anchor={editing.anchor} entry={entry} role={editing.role} onClose={() => setEditing(undefined)} /> : null}
    </Sheet>
  );
}
