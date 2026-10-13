import type {
  Change,
  MatrixEntry,
  Membership,
  ObjectKind,
  Resource,
  Role,
} from "../shared/types";

export function uiPrivileges(kind: ObjectKind, version: number) {
  const map: Record<ObjectKind, string[]> = {
    database: ["CONNECT", "TEMPORARY", "CREATE"],
    schema: ["USAGE", "CREATE"],
    table: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
    view: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
    sequence: ["USAGE", "SELECT", "UPDATE"],
    function: ["EXECUTE"],
  };
  return ["table", "view"].includes(kind) && version >= 170000
    ? [...map[kind], "MAINTAIN"]
    : map[kind];
}
const descriptions: Record<string, Record<string, string>> = {
  database: {
    CONNECT: "Se connecter à la base",
    TEMPORARY: "Créer des tables temporaires",
    CREATE: "Créer des schémas",
  },
  schema: {
    USAGE: "Accéder aux objets du schéma",
    CREATE: "Créer des objets dans le schéma",
  },
  table: {
    SELECT: "Lire les lignes",
    INSERT: "Ajouter des lignes",
    UPDATE: "Modifier des lignes",
    DELETE: "Supprimer des lignes",
    TRUNCATE: "Vider entièrement",
    REFERENCES: "Créer des clés étrangères vers elle",
    TRIGGER: "Créer des déclencheurs",
    MAINTAIN: "VACUUM, ANALYZE, REINDEX…",
  },
  sequence: {
    USAGE: "nextval() et currval()",
    SELECT: "currval() uniquement",
    UPDATE: "nextval() et setval()",
  },
  function: { EXECUTE: "Appeler la fonction" },
};
export function privilegeDescription(kind: ObjectKind, privilege: string) {
  return descriptions[kind === "view" ? "table" : kind]?.[privilege] || "";
}

export interface LevelDef {
  rank: 1 | 2 | 3;
  label: string;
  privileges: string[];
}
export function levels(kind: ObjectKind, version: number): LevelDef[] {
  switch (kind) {
    case "database":
      return [
        { rank: 1, label: "Connexion", privileges: ["CONNECT"] },
        { rank: 2, label: "Connexion + temp.", privileges: ["CONNECT", "TEMPORARY"] },
        { rank: 3, label: "Complet", privileges: ["CONNECT", "TEMPORARY", "CREATE"] },
      ];
    case "schema":
      return [
        { rank: 1, label: "Utilisation", privileges: ["USAGE"] },
        { rank: 3, label: "Complet", privileges: ["USAGE", "CREATE"] },
      ];
    case "sequence":
      return [
        { rank: 1, label: "Lecture", privileges: ["SELECT"] },
        { rank: 2, label: "Utilisation", privileges: ["USAGE", "SELECT"] },
        { rank: 3, label: "Complet", privileges: ["USAGE", "SELECT", "UPDATE"] },
      ];
    case "function":
      return [{ rank: 1, label: "Exécution", privileges: ["EXECUTE"] }];
    default:
      return [
        { rank: 1, label: "Lecture", privileges: ["SELECT"] },
        { rank: 2, label: "Écriture", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
        { rank: 3, label: "Complet", privileges: uiPrivileges(kind, version) },
      ];
  }
}
/** Best level whose rank does not exceed the requested one (bulk actions across kinds). */
export function levelForRank(kind: ObjectKind, version: number, rank: number) {
  return [...levels(kind, version)].reverse().find((l) => l.rank <= rank);
}
export const scopeLevelNames: Record<"databases" | "schemas" | "objects", string[]> = {
  databases: ["Connexion", "Connexion + temp.", "Complet"],
  schemas: ["Utilisation", "Utilisation", "Complet"],
  objects: ["Lecture", "Écriture", "Complet"],
};

export const resourceKey = (r: Resource) => `${r.kind}:${r.oid}`;
export const changeKey = (c: Change) =>
  [
    c.profileId,
    c.database,
    c.defaultOwner || "",
    c.resource.kind,
    c.defaultOwner ? c.resource.schema : c.resource.oid,
    c.role,
    c.privilege,
  ].join("|");
export function mergeChanges(existing: Change[], additions: Change[]) {
  const map = new Map(existing.map((c) => [changeKey(c), c]));
  for (const change of additions) {
    const previous = map.get(changeKey(change));
    map.set(changeKey(change), {
      ...change,
      fingerprint: previous?.fingerprint || change.fingerprint,
    });
  }
  return [...map.values()];
}

/** Groups a role inherits privileges from, transitively (memberships with INHERIT). */
export function ancestorsOf(role: string, memberships: Membership[]) {
  const result: string[] = [];
  const queue = [role];
  while (queue.length) {
    const current = queue.shift()!;
    for (const m of memberships)
      if (m.member === current && m.inherit && !result.includes(m.role) && m.role !== role) {
        result.push(m.role);
        queue.push(m.role);
      }
  }
  return result;
}
/** Roles that inherit from this group, transitively. */
export function descendantsOf(role: string, memberships: Membership[]) {
  const result: string[] = [];
  const queue = [role];
  while (queue.length) {
    const current = queue.shift()!;
    for (const m of memberships)
      if (m.role === current && m.inherit && !result.includes(m.member) && m.member !== role) {
        result.push(m.member);
        queue.push(m.member);
      }
  }
  return result;
}

export type SourceType = "direct" | "inherited" | "public" | "owner" | "superuser" | "other";
export interface Source {
  type: SourceType;
  via?: string;
  grantable?: boolean;
}
export type Display =
  | { kind: "none" }
  | { kind: "superuser" }
  | { kind: "owner"; via?: string }
  | { kind: "level"; level: LevelDef }
  | { kind: "custom"; rank: number; privileges: string[] };
export interface Cell {
  role: string;
  privileges: string[];
  sources: Record<string, Source[]>;
  direct: Record<string, boolean>;
  futureDirect: string[];
  future: string[];
  pending: Change[];
  display: Display;
  /** Every visible privilege comes from elsewhere than a direct grant. */
  indirect: boolean;
  superuser: boolean;
  owner?: string;
}
export interface CellContext {
  version: number;
  roles: Map<string, Role>;
  memberships: Membership[];
  pending: Change[];
}
export function cellPending(pending: Change[], resource: Resource, role: string) {
  return pending.filter(
    (c) =>
      !c.defaultOwner &&
      c.resource.kind === resource.kind &&
      c.resource.oid === resource.oid &&
      c.role === role,
  );
}
export function computeCell(entry: MatrixEntry, role: string, ctx: CellContext): Cell {
  const { resource } = entry;
  const privileges = uiPrivileges(resource.kind, ctx.version);
  const info = ctx.roles.get(role);
  const superuser = Boolean(info?.superuser);
  const ancestors = role === "PUBLIC" ? [] : ancestorsOf(role, ctx.memberships);
  const owner =
    role === resource.owner
      ? role
      : ancestors.includes(resource.owner)
        ? resource.owner
        : undefined;
  const effective = new Set(
    role === "PUBLIC"
      ? entry.grants.filter((g) => g.role === "PUBLIC").map((g) => g.privilege)
      : entry.effective[role] || [],
  );
  const sources: Record<string, Source[]> = {};
  const direct: Record<string, boolean> = {};
  for (const p of privileges) {
    const list: Source[] = [];
    for (const g of entry.grants) {
      if (g.privilege !== p) continue;
      if (g.role === role) {
        direct[p] = g.grantable;
        list.push({ type: "direct", grantable: g.grantable });
      } else if (g.role === "PUBLIC") list.push({ type: "public", via: "PUBLIC" });
      else if (ancestors.includes(g.role)) list.push({ type: "inherited", via: g.role });
    }
    if (owner && owner !== role) list.push({ type: "owner", via: owner });
    if (superuser) list.push({ type: "superuser" });
    if (effective.has(p) && !list.length) list.push({ type: "other" });
    sources[p] = list;
  }
  const pending = cellPending(ctx.pending, resource, role);
  const futureDirect = new Set(Object.keys(direct));
  for (const c of pending) {
    if (c.action === "grant") futureDirect.add(c.privilege);
    else if (!c.grantOption) futureDirect.delete(c.privilege);
  }
  const otherSource = (p: string) =>
    (sources[p] || []).some((s) => s.type !== "direct");
  const future = privileges.filter((p) => futureDirect.has(p) || otherSource(p));
  let display: Display;
  if (superuser) display = { kind: "superuser" };
  else if (owner) display = { kind: "owner", via: owner === role ? undefined : owner };
  else if (!future.length) display = { kind: "none" };
  else {
    const match = levels(resource.kind, ctx.version).find(
      (l) => l.privileges.length === future.length && l.privileges.every((p) => future.includes(p)),
    );
    display = match
      ? { kind: "level", level: match }
      : {
          kind: "custom",
          rank:
            [...levels(resource.kind, ctx.version)]
              .reverse()
              .find((l) => l.privileges.every((p) => future.includes(p)))?.rank || 1,
          privileges: future,
        };
  }
  return {
    role,
    privileges,
    sources,
    direct,
    futureDirect: privileges.filter((p) => futureDirect.has(p)),
    future,
    pending,
    display,
    indirect: future.length > 0 && !future.some((p) => futureDirect.has(p)),
    superuser,
    owner,
  };
}

const abbreviations: Record<string, string> = {
  SELECT: "S",
  INSERT: "I",
  UPDATE: "U",
  DELETE: "D",
  TRUNCATE: "T",
  REFERENCES: "R",
  TRIGGER: "Tg",
  MAINTAIN: "M",
  USAGE: "Us",
  CREATE: "C",
  CONNECT: "Co",
  TEMPORARY: "Tmp",
  EXECUTE: "X",
};
export const abbreviate = (privileges: string[]) =>
  privileges.map((p) => abbreviations[p] || p[0]).join(" ");

/** Changes that turn the cell's current direct grants into the desired set. */
export function planDirect(
  entry: MatrixEntry,
  cell: Cell,
  desired: string[],
  grantOption: boolean,
  base: { profileId: string; database: string },
): Change[] {
  const changes: Change[] = [];
  for (const privilege of cell.privileges) {
    const has = privilege in cell.direct;
    const wants = desired.includes(privilege);
    const upgrade = has && wants && grantOption && !cell.direct[privilege];
    if (has === wants && !upgrade) continue;
    changes.push({
      id: crypto.randomUUID(),
      ...base,
      resource: entry.resource,
      role: cell.role,
      privilege,
      action: wants ? "grant" : "revoke",
      grantOption: wants && grantOption && cell.role !== "PUBLIC",
      fingerprint: entry.fingerprint,
    });
  }
  return changes;
}
export function describeSource(s: Source) {
  switch (s.type) {
    case "direct":
      return s.grantable ? "Direct · délégable" : "Direct";
    case "inherited":
      return `Via ${s.via}`;
    case "public":
      return "Via PUBLIC";
    case "owner":
      return `Propriétaire (${s.via})`;
    case "superuser":
      return "Superutilisateur";
    default:
      return "Rôle prédéfini";
  }
}
