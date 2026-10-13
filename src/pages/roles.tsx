import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  KeyRound,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { CrudInput, MatrixEntry, Membership, Role, RoleInput } from "../../shared/types";
import { call } from "../api";
import { Dialog, Menu, Popover, usePopover } from "../overlay";
import { ancestorsOf, computeCell, descendantsOf } from "../permissions";
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
  RoleAvatar,
  Segmented,
  Skeleton,
  Spinner,
  Sql,
  Switch,
  cx,
  errorMessage,
  plural,
} from "../ui";
import { useWorkspace } from "../workspace";
import { CellEditor, CellPill, useCellContext, useMatrix } from "./access";

type Kind = "all" | "groups" | "users";
const attributes: { key: keyof RoleInput; sql: string; label: string; detail: string; risky?: boolean }[] = [
  { key: "login", sql: "LOGIN", label: "Peut se connecter", detail: "Un compte utilisable par une personne ou une application." },
  { key: "inherit", sql: "INHERIT", label: "Hérite des droits de ses groupes", detail: "Sinon, il doit faire SET ROLE pour les utiliser." },
  { key: "createDb", sql: "CREATEDB", label: "Créer des bases", detail: "CREATE DATABASE sur ce serveur." },
  { key: "createRole", sql: "CREATEROLE", label: "Gérer les rôles", detail: "Créer, modifier et supprimer des rôles." },
  { key: "bypassRls", sql: "BYPASSRLS", label: "Ignorer la sécurité des lignes", detail: "Voit toutes les lignes malgré les politiques RLS.", risky: true },
  { key: "replication", sql: "REPLICATION", label: "Réplication", detail: "Connexions de réplication et sauvegardes physiques.", risky: true },
  { key: "superuser", sql: "SUPERUSER", label: "Superutilisateur", detail: "Contourne toutes les vérifications de droits.", risky: true },
];
const toInput = (r: Role): RoleInput => ({
  name: r.name,
  login: r.login,
  superuser: r.superuser,
  createDb: r.createDb,
  createRole: r.createRole,
  inherit: r.inherit,
  replication: r.replication,
  bypassRls: r.bypassRls,
  connectionLimit: r.connectionLimit,
});
const dateOf = (v: string | null) => (v && v !== "infinity" ? v.slice(0, 10) : "");

export function RolesPage() {
  const ws = useWorkspace();
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [system, setSystem] = useState(false);
  const [creating, setCreating] = useState(false);
  const memberships = ws.overview?.memberships || [];
  const all = ws.roles.filter((r) => system || !r.name.startsWith("pg_"));
  const list = all
    .filter((r) => (kind === "all" ? true : kind === "users" ? r.login : !r.login))
    .filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(a.login) - Number(b.login) || a.name.localeCompare(b.name));
  const selected = ws.roles.find((r) => r.name === ws.selectedRole) || list[0];
  const canManage = Boolean(ws.overview?.server.createRole || ws.overview?.server.superuser);
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] flex-none flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 px-5 pt-6 pb-3">
          <h1 className="m-0 flex-1 text-[22px] font-bold tracking-tight">Rôles</h1>
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)} disabled={!canManage}>
            Nouveau
          </Button>
        </div>
        <div className="grid gap-2 px-4 pb-3">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
            <input className="input !h-8 !pl-8" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <Segmented
            label="Type de rôle"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Tous", count: all.length },
              { value: "groups", label: "Groupes", count: all.filter((r) => !r.login).length },
              { value: "users", label: "Comptes", count: all.filter((r) => r.login).length },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3" role="listbox" aria-label="Rôles">
          {!ws.overview
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mx-2 my-2 h-10" />)
            : list.map((r) => {
                const groups = memberships.filter((m) => m.member === r.name).map((m) => m.role);
                const members = memberships.filter((m) => m.role === r.name).length;
                return (
                  <button
                    key={r.oid}
                    role="option"
                    aria-selected={selected?.name === r.name}
                    onClick={() => ws.setSelectedRole(r.name)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                      selected?.name === r.name ? "bg-accent-soft" : "hover:bg-raised",
                    )}
                  >
                    <RoleAvatar name={r.name} group={!r.login} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cx("truncate font-semibold", selected?.name === r.name && "text-accent")}>{r.name}</span>
                        {r.superuser ? <Zap size={12} className="flex-none text-warn" /> : null}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted">
                        {r.login ? "Compte" : "Groupe"}
                        {!r.login && members ? ` · ${plural(members, "membre")}` : ""}
                        {groups.length ? ` · ${groups.join(", ")}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
          {ws.overview && !list.length ? <p className="px-3 py-6 text-center text-muted">Aucun rôle.</p> : null}
        </div>
        <label className="flex items-center justify-between border-t border-line px-5 py-3 text-[12px] text-muted">
          Rôles système (pg_*)
          <Switch label="Afficher les rôles système" checked={system} onChange={setSystem} />
        </label>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <RoleDetail key={selected.name} role={selected} canManage={canManage} />
        ) : ws.overview ? (
          <Empty icon={<Users size={20} />} title="Aucun rôle sélectionné" />
        ) : null}
      </main>
      {creating ? <CreateRoleDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function RoleDetail({ role, canManage }: { role: Role; canManage: boolean }) {
  const ws = useWorkspace();
  const menu = usePopover();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const memberships = ws.overview?.memberships || [];
  const protectedRole = role.name.startsWith("pg_");
  const current = ws.overview?.server.currentUser === role.name;
  const inherited = ancestorsOf(role.name, memberships);
  const direct = memberships.filter((m) => m.member === role.name).map((m) => m.role);
  return (
    <div className="mx-auto max-w-[920px] px-10 py-8">
      <header className="flex items-start gap-4">
        <RoleAvatar name={role.name} group={!role.login} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex items-center gap-2 text-[22px] font-bold tracking-tight">
            <span className="truncate">{role.name}</span>
            {current ? <Badge tone="accent">vous</Badge> : null}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={role.login ? "info" : undefined}>
              {role.login ? <UserRound size={11} /> : <Users size={11} />}
              {role.login ? "Compte de connexion" : "Groupe"}
            </Badge>
            {attributes
              .filter((a) => a.key !== "login" && a.key !== "inherit" && role[a.key as keyof Role])
              .map((a) => (
                <Badge key={a.key} tone={a.risky ? "warn" : undefined} tip={a.detail}>
                  {a.sql}
                </Badge>
              ))}
            {!role.inherit ? <Badge tip="Doit utiliser SET ROLE pour exercer les droits de ses groupes">NOINHERIT</Badge> : null}
            {role.validUntil && role.validUntil !== "infinity" ? <Badge tone="warn">expire le {dateOf(role.validUntil)}</Badge> : null}
          </div>
          {inherited.length ? (
            <p className="mt-2.5 text-[12.5px] text-muted">
              Hérite des droits de{" "}
              {inherited.map((g, i) => (
                <span key={g}>
                  {i ? ", " : ""}
                  <button className="font-semibold text-fg hover:underline" onClick={() => ws.setSelectedRole(g)}>
                    {g}
                  </button>
                  {!direct.includes(g) ? <span className="text-faint"> (indirect)</span> : null}
                </span>
              ))}
              .
            </p>
          ) : null}
        </div>
        <Button
          icon={<ArrowRight size={15} />}
          onClick={() => {
            ws.setAccess({ focusRole: role.name });
            ws.go("access");
          }}
        >
          Voir dans la grille
        </Button>
        <IconButton label="Plus d’actions" onClick={menu.open} disabled={!canManage || protectedRole}>
          <MoreHorizontal size={17} />
        </IconButton>
        {menu.anchor ? (
          <Menu
            anchor={menu.anchor}
            onClose={menu.close}
            placement="bottom-end"
            items={[
              { label: "Renommer", icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
              "separator",
              { label: "Supprimer le rôle", icon: <Trash2 size={14} />, danger: true, disabled: current, onSelect: () => setDeleting(true) },
            ]}
          />
        ) : null}
      </header>
      <div className="mt-8 grid gap-6">
        <MembershipSection role={role} canManage={canManage && !protectedRole} />
        <DatabaseAccess role={role} />
        <AttributesSection role={role} canManage={canManage && !protectedRole} />
      </div>
      {renaming ? <RenameRoleDialog role={role} onClose={() => setRenaming(false)} /> : null}
      {deleting ? <DeleteRoleDialog role={role} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
          {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function useMembership() {
  const ws = useWorkspace();
  const toast = useToast();
  const run = async (m: Omit<Membership, "inherit" | "set" | "admin"> & Partial<Membership>, action: "grant" | "revoke", undo?: () => void) => {
    try {
      await call("membership", {
        profileId: ws.profileId,
        database: ws.database,
        operation: { role: m.role, member: m.member, action, admin: m.admin ?? false, inherit: m.inherit ?? true, set: m.set ?? true },
      });
      await ws.refresh();
      toast({
        title: action === "grant" ? `${m.member} ajouté à ${m.role}` : `${m.member} retiré de ${m.role}`,
        action: undo ? { label: "Annuler", run: undo } : undefined,
      });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Appartenance non modifiée", description: errorMessage(e) });
      return false;
    }
  };
  return run;
}

function MembershipSection({ role, canManage }: { role: Role; canManage: boolean }) {
  const ws = useWorkspace();
  const run = useMembership();
  const memberships = ws.overview?.memberships || [];
  const groups = memberships.filter((m) => m.member === role.name);
  const members = memberships.filter((m) => m.role === role.name);
  const addGroup = usePopover();
  const addMember = usePopover();
  const [editing, setEditing] = useState<{ anchor: HTMLElement; m: Membership }>();
  const forbiddenGroups = new Set([role.name, ...groups.map((m) => m.role), ...descendantsOf(role.name, memberships)]);
  const forbiddenMembers = new Set([role.name, ...members.map((m) => m.member), ...ancestorsOf(role.name, memberships)]);
  const chip = (m: Membership, other: string) => (
    <button
      key={m.role + m.member}
      disabled={!canManage}
      onClick={(e) => setEditing({ anchor: e.currentTarget, m })}
      className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 hover:border-line-strong hover:bg-raised disabled:cursor-default"
    >
      <RoleAvatar name={other} group={!ws.rolesByName.get(other)?.login} size={22} />
      <span className="font-semibold">{other}</span>
      {m.admin ? <Badge tone="accent">admin</Badge> : null}
      {!m.inherit ? <Badge tip="Droits non hérités automatiquement (SET ROLE nécessaire)">sans héritage</Badge> : null}
    </button>
  );
  return (
    <Section title="Groupes et membres" description="Un membre reçoit les droits de ses groupes. C’est la façon la plus simple de gérer les accès.">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="mb-2.5 text-[12px] font-semibold text-muted">Membre de</div>
          <div className="flex flex-wrap gap-2">
            {groups.map((m) => chip(m, m.role))}
            {canManage ? (
              <button className="btn btn-sm btn-ghost !h-8 !rounded-full border border-dashed border-line-strong" onClick={addGroup.open}>
                <Plus size={13} /> Ajouter à un groupe
              </button>
            ) : null}
            {!groups.length && !canManage ? <span className="text-muted">Aucun groupe.</span> : null}
          </div>
        </div>
        <div>
          <div className="mb-2.5 text-[12px] font-semibold text-muted">Membres</div>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => chip(m, m.member))}
            {canManage ? (
              <button className="btn btn-sm btn-ghost !h-8 !rounded-full border border-dashed border-line-strong" onClick={addMember.open}>
                <UserPlus size={13} /> Ajouter un membre
              </button>
            ) : null}
            {!members.length && !canManage ? <span className="text-muted">Aucun membre.</span> : null}
          </div>
        </div>
      </div>
      {addGroup.anchor ? (
        <RolePicker
          anchor={addGroup.anchor}
          onClose={addGroup.close}
          exclude={forbiddenGroups}
          preferGroups
          onPick={(g) => void run({ role: g, member: role.name }, "grant", () => void run({ role: g, member: role.name }, "revoke"))}
        />
      ) : null}
      {addMember.anchor ? (
        <RolePicker
          anchor={addMember.anchor}
          onClose={addMember.close}
          exclude={forbiddenMembers}
          onPick={(member) => void run({ role: role.name, member }, "grant", () => void run({ role: role.name, member }, "revoke"))}
        />
      ) : null}
      {editing ? <MembershipEditor anchor={editing.anchor} membership={editing.m} onClose={() => setEditing(undefined)} /> : null}
    </Section>
  );
}

function RolePicker({
  anchor,
  onClose,
  exclude,
  onPick,
  preferGroups,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  exclude: Set<string>;
  onPick: (name: string) => void;
  preferGroups?: boolean;
}) {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const options = ws.roles
    .filter((r) => !exclude.has(r.name) && !r.name.startsWith("pg_") && r.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (preferGroups ? Number(a.login) - Number(b.login) : 0) || a.name.localeCompare(b.name));
  return (
    <Popover anchor={anchor} onClose={onClose} width={280} label="Choisir un rôle">
      <div className="border-b border-line p-2">
        <input
          autoFocus
          className="input !h-8"
          placeholder="Rechercher un rôle…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, options.length - 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            if (e.key === "Enter" && options[active]) {
              onClose();
              onPick(options[active].name);
            }
          }}
        />
      </div>
      <div className="max-h-[280px] overflow-y-auto p-1.5">
        {options.map((r, i) => (
          <button
            key={r.oid}
            className="menu-item"
            data-active={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              onPick(r.name);
            }}
          >
            <RoleAvatar name={r.name} group={!r.login} size={20} />
            <span className="flex-1 truncate">{r.name}</span>
            <span className="text-[11px] text-faint">{r.login ? "compte" : "groupe"}</span>
          </button>
        ))}
        {!options.length ? <p className="px-3 py-4 text-center text-muted">Aucun rôle disponible.</p> : null}
      </div>
    </Popover>
  );
}

function MembershipEditor({ anchor, membership, onClose }: { anchor: HTMLElement; membership: Membership; onClose: () => void }) {
  const ws = useWorkspace();
  const run = useMembership();
  const [admin, setAdmin] = useState(membership.admin);
  const [inherit, setInherit] = useState(membership.inherit);
  const [set, setSet] = useState(membership.set);
  const [busy, setBusy] = useState(false);
  const modern = ws.version >= 160000;
  const changed = admin !== membership.admin || inherit !== membership.inherit || set !== membership.set;
  const rows = [
    { label: "Administrateur du groupe", detail: "Peut ajouter ou retirer des membres.", value: admin, set: setAdmin, enabled: true },
    { label: "Hérite des droits", detail: "Sans cela, SET ROLE est nécessaire.", value: inherit, set: setInherit, enabled: modern },
    { label: "Peut devenir le groupe", detail: "Autorise SET ROLE vers ce groupe.", value: set, set: setSet, enabled: modern },
  ];
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} label="Appartenance">
      <div className="border-b border-line px-4 py-3">
        <div className="font-semibold">
          {membership.member} <span className="font-normal text-muted">dans</span> {membership.role}
        </div>
      </div>
      <div className="grid gap-1 p-2">
        {rows.map((r) => (
          <label key={r.label} className={cx("flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-raised", !r.enabled && "opacity-60")}>
            <span className="flex-1">
              <span className="block text-[12.5px] font-medium">{r.label}</span>
              <span className="block text-[11.5px] text-muted">{r.detail}</span>
            </span>
            <Switch label={r.label} checked={r.value} onChange={r.set} disabled={!r.enabled} />
          </label>
        ))}
        {!modern ? <p className="px-2 text-[11.5px] text-muted">Héritage et SET par appartenance : PostgreSQL 16 ou plus.</p> : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-sunken px-3 py-2.5">
        <Button
          size="sm"
          variant="danger-ghost"
          icon={<X size={13} />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const m = membership;
            if (await run(m, "revoke", () => void run(m, "grant"))) onClose();
            setBusy(false);
          }}
        >
          Retirer
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          disabled={!changed}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            if (await run({ ...membership, admin, inherit, set }, "grant")) onClose();
            setBusy(false);
          }}
        >
          Enregistrer
        </Button>
      </div>
    </Popover>
  );
}

function DatabaseAccess({ role }: { role: Role }) {
  const ws = useWorkspace();
  const ctx = useCellContext();
  const databases = useMatrix("databases", "");
  const schemas = useMatrix("schemas", "");
  const [editing, setEditing] = useState<{ anchor: HTMLElement; entry: MatrixEntry }>();
  const row = (e: MatrixEntry, onOpen: () => void) => {
    const cell = computeCell(e, role.name, ctx);
    return (
      <div key={e.resource.kind + e.resource.oid} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raised">
        <KindIcon kind={e.resource.kind} size={14} />
        <button className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={onOpen}>
          {e.resource.name}
        </button>
        <button onClick={(ev) => setEditing({ anchor: ev.currentTarget, entry: e })} aria-label={`Modifier l’accès à ${e.resource.name}`}>
          <CellPill cell={cell} />
        </button>
      </div>
    );
  };
  return (
    <Section
      title="Accès"
      description={`Ce que ${role.name} peut atteindre, droits hérités compris. Cliquez sur un niveau pour le modifier.`}
    >
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-muted">
            <KindIcon kind="database" size={13} /> Bases du serveur
          </div>
          {databases.data ? (
            databases.data.entries.map((e) =>
              row(e, () => {
                ws.selectDatabase(e.resource.name);
                ws.setAccess({ scope: "schemas", focusRole: role.name });
                ws.go("access");
              }),
            )
          ) : (
            <Skeleton className="h-24" />
          )}
          <ErrorCallout error={databases.error} />
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-muted">
            <Layers size={13} className="text-accent" /> Schémas de {ws.database}
          </div>
          {schemas.data ? (
            schemas.data.entries.map((e) =>
              row(e, () => {
                ws.setAccess({ scope: "objects", schema: e.resource.name, focusRole: role.name });
                ws.go("access");
              }),
            )
          ) : (
            <Skeleton className="h-24" />
          )}
          <ErrorCallout error={schemas.error} />
        </div>
      </div>
      {editing ? <CellEditor anchor={editing.anchor} entry={editing.entry} role={role.name} onClose={() => setEditing(undefined)} /> : null}
    </Section>
  );
}

function useCrudPreview(operation: CrudInput | undefined) {
  const ws = useWorkspace();
  const [debounced, setDebounced] = useState(operation);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(operation), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(operation)]);
  return useQuery({
    queryKey: ["crudPreview", ws.profileId, ws.database, debounced],
    queryFn: () => call("crudPreview", { profileId: ws.profileId, database: ws.database, operation: debounced! }),
    enabled: Boolean(debounced),
    retry: false,
  });
}

function AttributesSection({ role, canManage }: { role: Role; canManage: boolean }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [form, setForm] = useState<RoleInput>(toInput(role));
  const [password, setPassword] = useState("");
  const [validUntil, setValidUntil] = useState(dateOf(role.validUntil));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [showSql, setShowSql] = useState(false);
  const isSuper = Boolean(ws.overview?.server.superuser);
  const dirty =
    attributes.some((a) => form[a.key] !== toInput(role)[a.key]) ||
    form.connectionLimit !== role.connectionLimit ||
    password !== "" ||
    validUntil !== dateOf(role.validUntil);
  const operation: CrudInput | undefined = dirty
    ? {
        kind: "role",
        action: "update",
        name: role.name,
        role: {
          ...form,
          password: password || undefined,
          validUntil: validUntil !== dateOf(role.validUntil) ? validUntil || null : undefined,
        },
      }
    : undefined;
  const preview = useCrudPreview(showSql ? operation : undefined);
  const reset = () => {
    setForm(toInput(role));
    setPassword("");
    setValidUntil(dateOf(role.validUntil));
    setError(undefined);
  };
  return (
    <Section title="Attributs" description="Capacités du rôle sur tout le serveur.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {attributes.map((a) => {
          const locked = !canManage || (["superuser", "replication", "bypassRls"].includes(a.key) && !isSuper);
          return (
            <label
              key={a.key}
              className={cx("flex items-center gap-3 rounded-lg px-2 py-2", !locked && "hover:bg-raised")}
              data-tip={locked && canManage ? "Réservé aux superutilisateurs" : undefined}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                  {a.label}
                  <code className="text-[10.5px] text-faint">{a.sql}</code>
                </span>
                <span className="block text-[11.5px] text-muted">{a.detail}</span>
              </span>
              <Switch
                label={a.label}
                checked={Boolean(form[a.key])}
                disabled={locked}
                onChange={(v) => setForm((f) => ({ ...f, [a.key]: v }))}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4">
        <Field label="Nouveau mot de passe" hint={form.login ? "Laisser vide pour le conserver." : "Utile seulement pour un compte."}>
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              className="input"
              disabled={!canManage}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Expiration du mot de passe" hint="Vide : jamais.">
          {(id) => (
            <input id={id} type="date" className="input" disabled={!canManage} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          )}
        </Field>
        <Field label="Connexions simultanées" hint="-1 : illimité.">
          {(id) => (
            <input
              id={id}
              type="number"
              min={-1}
              className="input"
              disabled={!canManage}
              value={form.connectionLimit}
              onChange={(e) => setForm((f) => ({ ...f, connectionLimit: Number(e.target.value) }))}
            />
          )}
        </Field>
      </div>
      {form.superuser && !role.superuser ? (
        <Callout tone="warn" className="mt-4">
          Un superutilisateur peut tout lire, tout modifier et tout supprimer sur le serveur.
        </Callout>
      ) : null}
      {dirty ? (
        <div className="mt-4 rounded-[10px] border border-line bg-sunken p-3">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-fg" onClick={() => setShowSql((v) => !v)}>
              <ChevronRight size={13} className={cx("transition-transform", showSql && "rotate-90")} />
              <Code2 size={13} /> SQL
            </button>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
              Annuler
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Check size={13} />}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  await call("crud", { profileId: ws.profileId, database: ws.database, operation: operation! });
                  setPassword("");
                  await ws.refresh();
                  toast({ title: "Rôle mis à jour", description: role.name });
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Enregistrer
            </Button>
          </div>
          {showSql ? (
            <div className="mt-2.5 border-t border-line pt-2.5">
              {preview.data ? <Sql code={preview.data.join("\n")} /> : preview.error ? <ErrorCallout error={preview.error} /> : <Spinner />}
            </div>
          ) : null}
          <ErrorCallout error={error} className="mt-2.5" />
        </div>
      ) : null}
    </Section>
  );
}

function CreateRoleDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [type, setType] = useState<"user" | "group">("user");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [attrs, setAttrs] = useState<RoleInput>({
    name: "",
    login: true,
    superuser: false,
    createDb: false,
    createRole: false,
    inherit: true,
    replication: false,
    bypassRls: false,
    connectionLimit: -1,
  });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const picker = usePopover();
  const isSuper = Boolean(ws.overview?.server.superuser);
  const exists = ws.roles.some((r) => r.name === name.trim());
  const operation: CrudInput | undefined = name.trim()
    ? {
        kind: "role",
        action: "create",
        name: name.trim(),
        role: { ...attrs, name: name.trim(), login: type === "user", password: type === "user" ? password || undefined : undefined },
      }
    : undefined;
  const preview = useCrudPreview(operation);
  const sql = [
    ...(preview.data || []),
    ...groups.map((g) => `GRANT "${g.replaceAll('"', '""')}" TO "${name.trim().replaceAll('"', '""')}";`),
  ].join("\n");
  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      await call("crud", { profileId: ws.profileId, database: ws.database, operation: operation! });
      for (const g of groups)
        await call("membership", {
          profileId: ws.profileId,
          database: ws.database,
          operation: { role: g, member: name.trim(), action: "grant", admin: false, inherit: true, set: true },
        });
      await ws.refresh();
      ws.setSelectedRole(name.trim());
      toast({ title: type === "user" ? "Compte créé" : "Groupe créé", description: name.trim() });
      onClose();
    } catch (e) {
      setError(e);
      await ws.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Nouveau rôle"
      description="Les rôles sont partagés par toutes les bases du serveur."
      icon={<UserPlus size={17} />}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" icon={<Check size={15} />} loading={busy} disabled={!operation || exists || Boolean(preview.error)} onClick={create}>
            Créer {type === "user" ? "le compte" : "le groupe"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Type de rôle">
          {[
            { v: "user" as const, icon: UserRound, title: "Compte", text: "Une personne ou une application qui se connecte." },
            { v: "group" as const, icon: Users, title: "Groupe", text: "Un ensemble de droits à donner à plusieurs comptes." },
          ].map((o) => (
            <button
              key={o.v}
              role="radio"
              aria-checked={type === o.v}
              onClick={() => setType(o.v)}
              className={cx(
                "flex items-start gap-3 rounded-xl border p-3.5 text-left",
                type === o.v ? "border-accent bg-accent-soft/60 shadow-[var(--ring)]" : "border-line-strong hover:bg-raised",
              )}
            >
              <o.icon size={18} className={type === o.v ? "text-accent" : "text-muted"} />
              <span>
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-xs text-muted">{o.text}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nom" error={exists ? "Ce rôle existe déjà." : undefined}>
            {(id) => (
              <input
                id={id}
                autoFocus
                className="input font-mono text-[12.5px]"
                placeholder={type === "user" ? "jeanne_dupont, api_service…" : "lecteurs, equipe_data…"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          {type === "user" ? (
            <Field label="Mot de passe">
              {(id) => (
                <input id={id} type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
          ) : (
            <div />
          )}
        </div>
        <div>
          <span className="label">{type === "user" ? "Membre des groupes" : "Membre d’autres groupes"}</span>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <span key={g} className="flex items-center gap-2 rounded-full border border-line py-1 pr-1.5 pl-1">
                <RoleAvatar name={g} group={!ws.rolesByName.get(g)?.login} size={20} />
                <span className="font-semibold">{g}</span>
                <IconButton label={`Retirer ${g}`} small onClick={() => setGroups((v) => v.filter((x) => x !== g))}>
                  <X size={12} />
                </IconButton>
              </span>
            ))}
            <button className="btn btn-sm btn-ghost !h-[30px] !rounded-full border border-dashed border-line-strong" onClick={picker.open}>
              <Plus size={13} /> Ajouter un groupe
            </button>
          </div>
          <p className="hint mt-1.5">Le nouveau rôle hérite immédiatement des droits de ces groupes.</p>
        </div>
        <div>
          <button className="flex items-center gap-1.5 font-semibold text-muted hover:text-fg" onClick={() => setAdvanced((v) => !v)}>
            <ChevronRight size={14} className={cx("transition-transform", advanced && "rotate-90")} />
            <Settings2 size={14} /> Attributs avancés
          </button>
          {advanced ? (
            <div className="mt-2 grid grid-cols-2 gap-x-4">
              {attributes
                .filter((a) => a.key !== "login")
                .map((a) => {
                  const locked = ["superuser", "replication", "bypassRls"].includes(a.key) && !isSuper;
                  return (
                    <label key={a.key} className={cx("flex items-center gap-3 rounded-lg px-2 py-2", !locked && "hover:bg-raised")}>
                      <span className="flex-1">
                        <span className="block text-[12.5px] font-medium">{a.label}</span>
                        <span className="block text-[11.5px] text-muted">{a.detail}</span>
                      </span>
                      <Switch label={a.label} checked={Boolean(attrs[a.key])} disabled={locked} onChange={(v) => setAttrs((x) => ({ ...x, [a.key]: v }))} />
                    </label>
                  );
                })}
            </div>
          ) : null}
        </div>
        {operation ? (
          <div className="rounded-[10px] border border-line bg-sunken p-3">
            <div className="eyebrow mb-1.5 flex items-center gap-1.5">
              <KeyRound size={12} /> SQL exécuté
            </div>
            {preview.error ? <ErrorCallout error={preview.error} /> : <Sql code={sql || "…"} />}
          </div>
        ) : null}
        <ErrorCallout error={error} />
      </div>
      {picker.anchor ? (
        <RolePicker
          anchor={picker.anchor}
          onClose={picker.close}
          exclude={new Set(groups)}
          preferGroups
          onPick={(g) => setGroups((v) => [...v, g])}
        />
      ) : null}
    </Dialog>
  );
}

function RenameRoleDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(role.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Dialog
      title={`Renommer ${role.name}`}
      onClose={onClose}
      busy={busy}
      icon={<Pencil size={16} />}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim() || name.trim() === role.name}
            onClick={async () => {
              setBusy(true);
              try {
                await call("crud", {
                  profileId: ws.profileId,
                  database: ws.database,
                  operation: { kind: "role", action: "update", name: role.name, newName: name.trim(), role: toInput(role) },
                });
                ws.removeChanges((c) => c.role === role.name);
                await ws.refresh();
                ws.setSelectedRole(name.trim());
                toast({ title: "Rôle renommé", description: `${role.name} → ${name.trim()}` });
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Renommer
          </Button>
        </>
      }
    >
      <Field label="Nouveau nom" hint={role.login ? "Un mot de passe MD5 est effacé lors d’un renommage." : undefined}>
        {(id) => <input id={id} autoFocus className="input font-mono" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <ErrorCallout error={error} className="mt-4" />
    </Dialog>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const deps = useQuery({
    queryKey: ["dependencies", ws.profileId, ws.database, "role", role.name],
    queryFn: () => call("dependencies", { profileId: ws.profileId, database: ws.database, kind: "role", name: role.name }),
  });
  const blocked = Boolean(deps.data?.length);
  return (
    <Dialog
      title={`Supprimer ${role.name} ?`}
      description="Cette action est définitive."
      icon={<Trash2 size={16} className="text-danger" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={confirmation !== role.name || deps.isPending || blocked || Boolean(deps.error)}
            onClick={async () => {
              setBusy(true);
              try {
                await call("crud", {
                  profileId: ws.profileId,
                  database: ws.database,
                  operation: { kind: "role", action: "delete", name: role.name, confirmation },
                });
                ws.removeChanges((c) => c.role === role.name);
                ws.setSelectedRole(undefined);
                await ws.refresh();
                toast({ title: "Rôle supprimé", description: role.name });
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Supprimer
          </Button>
        </>
      }
    >
      {deps.isPending ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> Recherche des dépendances…
        </div>
      ) : blocked ? (
        <Callout tone="warn" title={`${plural(deps.data!.length, "élément dépend", "éléments dépendent")} de ce rôle`}>
          <ul className="m-0 mt-1 max-h-40 list-disc overflow-y-auto pl-4">
            {deps.data!.map((d, i) => (
              <li key={i}>
                {d.database ? <b>{d.database} · </b> : null}
                {d.description}
              </li>
            ))}
          </ul>
          <p className="mt-2">Retirez ses droits et changez le propriétaire de ses objets avant de le supprimer.</p>
        </Callout>
      ) : (
        <>
          <p className="mb-4 text-muted">Aucune dépendance détectée. PostgreSQL vérifie à nouveau au moment de la suppression.</p>
          <Field label={<>Saisissez <b className="font-mono">{role.name}</b> pour confirmer</>}>
            {(id) => <input id={id} autoFocus className="input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />}
          </Field>
        </>
      )}
      <ErrorCallout error={deps.error || error} className="mt-4" />
    </Dialog>
  );
}

