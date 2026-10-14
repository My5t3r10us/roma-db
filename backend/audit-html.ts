import type {
  AuditData,
  AuditDatabase,
  AuditObject,
  AuditSchema,
} from "./audit";
import type { MatrixEntry, Resource } from "../shared/types";
import {
  abbreviate,
  ancestorsOf,
  computeCell,
  describeSource,
  type Cell,
  type CellContext,
} from "../src/permissions";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
type Grants = { role: string; privilege: string; grantable: boolean }[];

const css = `
:root{--fg:#111;--muted:#666;--line:#d4d4d4;--line2:#ececec;--head:#f3f3f3;--group:#e9edf3;--sub:#f6f7f9;--accent:#1d4ed8;--crit:#b91c1c;--crit-bg:#fdecec;--warn:#9a5b00;--warn-bg:#fff4e0;--info:#1e40af;--info-bg:#eaf0fd;--mono:ui-monospace,Consolas,"Cascadia Mono",monospace}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--fg);font:12.5px/1.45 "Segoe UI",system-ui,sans-serif}
.doc{padding:20px 24px 40px}
h1{font-size:19px;margin:0}h2{font-size:14.5px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--fg)}
h3{font-size:13px;margin:16px 0 6px}h4{font-size:12.5px;margin:12px 0 4px;font-family:var(--mono)}
p{margin:4px 0}.muted{color:var(--muted)}code,.mono{font-family:var(--mono);font-size:11.5px}
.head{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:10px;flex-wrap:wrap}
.head .sub{color:var(--muted);margin-top:2px}
table{border-collapse:collapse;font-size:12px}
th,td{border:1px solid var(--line);padding:3px 7px;text-align:left;vertical-align:top}
th{background:var(--head);font-weight:600}
.meta td:first-child{color:var(--muted);border:0;padding:1px 14px 1px 0}.meta td{border:0;padding:1px 0}
.toc{margin:10px 0 0;color:var(--muted)}.toc a{color:var(--accent);text-decoration:none;margin-right:14px}
.kpi{display:flex;flex-wrap:wrap;border:1px solid var(--line);margin:8px 0}.kpi div{padding:6px 16px;border-right:1px solid var(--line)}.kpi div:last-child{border-right:0}
.kpi b{font-size:16px;margin-right:5px}
.sev{display:inline-block;font-size:11px;font-weight:700;padding:0 6px;border-radius:3px;white-space:nowrap}
.sev.crit{background:var(--crit-bg);color:var(--crit)}.sev.warn{background:var(--warn-bg);color:var(--warn)}.sev.info{background:var(--info-bg);color:var(--info)}
.yes{text-align:center;font-weight:700}.no{text-align:center;color:#bbb}.bad{color:var(--crit)}.att{color:var(--warn)}
.wide{width:100%}
.legend{color:var(--muted);font-size:11.5px;margin:4px 0 6px}.legend code{color:var(--fg);font-weight:700}
.tools{display:flex;gap:10px;align-items:center;margin:6px 0}
.tools input[type=search]{padding:3px 8px;border:1px solid var(--line);font:inherit;width:280px}
.tools label{color:var(--muted)}
/* Access matrix (same look as the app) */
.ic{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.amwrap{overflow:auto;max-height:85vh;border:1px solid #e7e7ec;border-radius:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.am{border-collapse:separate;border-spacing:0;font-size:13px;width:100%}
.am th,.am td{border:0;border-bottom:1px solid #e7e7ec;padding:0;vertical-align:middle}
.am thead th{position:sticky;top:0;z-index:2;background:#fafafb;padding:10px 4px 9px;font-weight:600}
.am th.o,.am td.o{position:sticky;left:0;z-index:1;background:#fff;border-right:1px solid #e7e7ec;text-align:left;min-width:250px;max-width:340px}
.am thead th.o{z-index:3;background:#fafafb;padding:10px 16px;vertical-align:bottom}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9d9daa}
.am th.role{min-width:118px;width:118px}
.am th.role>span:last-child{display:block;max-width:112px;margin:5px auto 0;font-size:12px;color:#18181d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{display:grid;place-items:center;width:24px;height:24px;margin:0 auto;border-radius:50%;font-size:9.5px;font-weight:700}
.av.grp{border-radius:7px}.av.pub{border:1px dashed #d5d5dd;color:#64646f;font-size:11px}
.am td{text-align:center;padding:7px 6px}
.am td.o{padding:5px 10px}
.res{display:flex;align-items:center;gap:10px}
.res .kind{display:grid;place-items:center;width:28px;height:28px;border:1px solid #e7e7ec;border-radius:8px;color:#6447f5;flex:none;background:#fff}
.res .nm{min-width:0}.res b{font-weight:600}.res small{display:block;font-size:11.5px;color:#64646f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.res .rls{color:#b45309;margin-left:5px}
.am tr.db td{background:#f4f2ff}.am tr.db td.o{background:#f4f2ff}
.am tr.sc td.o{padding-left:26px}.am tr.ob td.o{padding-left:44px}
.am tr.ob .res .kind{width:24px;height:24px;color:#64646f}
.am tbody tr:hover td{background:#fafafb}
.am td.err{color:#d12d3b;text-align:left}
.pill{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:24px;min-width:30px;padding:0 8px;border-radius:7px;font-size:11.5px;font-weight:600;white-space:nowrap;border:1.5px solid transparent}
.pill.none{color:#9d9daa;background:transparent;min-width:24px;padding:0}
.pill.l1{background:#dff5e7;color:#166534}.pill.l2{background:#9ee0b5;color:#0f4a26}.pill.l3{background:#1f9d55;color:#fff}
.pill.owner{background:#fdf0d2;color:#8a4b0a}
.pill.indirect{background:transparent;border-style:dashed}
.pill.indirect.l1{border-color:#166534;color:#166534;opacity:.85}
.pill.indirect.l2,.pill.indirect.l3{border-color:#1f9d55;color:#166534}
.pill.admin{background:#efecff;color:#6447f5}.pill.noinh{background:transparent;border-color:#d5d5dd;color:#64646f}
.res .av{margin:0;flex:none}.am.mb tr.ob td.o{padding-left:14px}
.pill .go{color:#d12d3b;font-weight:800;margin-left:1px}
.pill.sw{height:14px;min-width:20px;padding:0;vertical-align:-2px}
.amlegend{display:flex;flex-wrap:wrap;gap:6px 18px;border-top:1px solid #e7e7ec;background:#fafafb;padding:9px 16px;font-size:12px;color:#64646f;position:sticky;left:0}
.amlegend .ic{vertical-align:-2px}
/* Annex */
.obj{margin:0 0 10px 0;page-break-inside:avoid}
.obj .info{color:var(--muted);font-family:inherit;font-weight:400;font-size:11.5px;margin-left:8px}
.cols{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.cols ul{margin:0;padding-left:16px}.cols li{margin:1px 0}
.hidden{display:none}
@media print{.tools,.toc{display:none}.am thead th,.am .o{position:static}.amwrap{overflow:visible;max-height:none}.doc{padding:0}h2{break-after:avoid}@page{size:A4 landscape;margin:10mm}}
`;

const script = `
(function(){
const q=document.getElementById('q'),empty=document.getElementById('empty'),rows=[...document.querySelectorAll('#matrix tbody tr')];
function apply(){const v=q.value.trim().toLowerCase(),hide=empty.checked;
rows.forEach(r=>{const ok=(!v||r.dataset.s.includes(v))&&(!hide||r.dataset.any==='1'||!r.classList.contains('ob'));r.classList.toggle('hidden',!ok)})}
q.addEventListener('input',apply);empty.addEventListener('change',apply);
})();
`;

function publicPrivileges(grants: Grants): string[] {
  return grants.filter((g) => g.role === "PUBLIC").map((g) => g.privilege);
}

/** Lucide icons, inlined so the export stays a single offline file. */
const icons: Record<string, string> = {
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  schema:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  table:
    '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  view: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  sequence:
    '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  function:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3"/><path d="M9 11.2h5.7"/>',
  crown:
    '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  branch:
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  lock: '<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
};
const icon = (name: string, size = 12) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? ""}</svg>`;

const kindLabel: Record<string, string> = {
  database: "Base de données",
  schema: "Schéma",
  table: "Table",
  view: "Vue",
  sequence: "Séquence",
  function: "Fonction",
};

/** Same avatar as the app (src/ui.tsx RoleAvatar). */
const avatarHues = [262, 200, 160, 24, 330, 45, 190, 290, 120, 0];
function avatar(name: string, group: boolean): string {
  if (name === "PUBLIC") return `<span class="av pub">∗</span>`;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = avatarHues[h % avatarHues.length];
  const initials = name
    .replace(/^[^a-zA-Z0-9]+/, "")
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return `<span class="av${group ? " grp" : ""}" style="background:hsl(${hue} 70% 92%);color:hsl(${hue} 55% 32%)">${esc(initials || "?")}</span>`;
}

/** Same pill as the app's CellPill (src/pages/access.tsx). */
function pill(cell: Cell): string {
  const d = cell.display;
  if (d.kind === "superuser")
    return `<span class="pill owner">${icon("zap")}Super</span>`;
  if (d.kind === "owner")
    return `<span class="pill owner">${icon("crown")}${d.via ? "Proprio." : "Propriétaire"}</span>`;
  if (d.kind === "none") return `<span class="pill none">•</span>`;
  const publicOnly =
    cell.indirect &&
    cell.future.every((p) => cell.sources[p]?.some((s) => s.type === "public"));
  const rank = d.kind === "level" ? d.level.rank : d.rank;
  const via = cell.indirect ? icon(publicOnly ? "globe" : "branch", 11) : "";
  const grantable = Object.values(cell.direct).some(Boolean)
    ? `<span class="go" title="WITH GRANT OPTION">*</span>`
    : "";
  return `<span class="pill l${rank}${cell.indirect ? " indirect" : ""}">${via}${esc(d.kind === "level" ? d.level.label : abbreviate(d.privileges))}${grantable}</span>`;
}

/** Same tooltip as the app's cellTip. */
function tip(cell: Cell, resource: Resource): string {
  const d = cell.display;
  if (d.kind === "superuser")
    return `${cell.role} est superutilisateur : tous les droits, sans restriction.`;
  if (d.kind === "owner")
    return d.via
      ? `Propriétaire via ${d.via} : tous les droits sur ${resource.name}.`
      : `${cell.role} est propriétaire de ${resource.name} : tous les droits.`;
  if (!cell.future.length)
    return `${cell.role} n’a aucun accès à ${resource.name}.`;
  return cell.future
    .map(
      (p) =>
        `${p} — ${(cell.sources[p] || []).map(describeSource).join(", ") || "direct"}`,
    )
    .join("\n");
}

/** One row of the global matrix: a database, a schema or an object. */
interface Row {
  level: "db" | "sc" | "ob";
  entry: MatrixEntry;
  path: string;
  error?: string;
}

function matrixRows(data: AuditData): Row[] {
  const rows: Row[] = [];
  const entry = (x: {
    resource: Resource;
    grants: Grants;
    effective: Record<string, string[]>;
  }): MatrixEntry => ({
    resource: x.resource,
    grants: x.grants,
    effective: x.effective,
    fingerprint: "",
  });
  for (const d of data.databases) {
    rows.push({
      level: "db",
      entry: entry(d),
      path: d.resource.name,
      error: d.error,
    });
    for (const s of d.schemas) {
      rows.push({
        level: "sc",
        entry: entry(s),
        path: `${d.resource.name}.${s.resource.name}`,
      });
      for (const o of s.objects)
        rows.push({
          level: "ob",
          entry: entry(o),
          path: `${d.resource.name}.${s.resource.name}.${o.resource.name}`,
        });
    }
  }
  return rows;
}

const objectName = (o: AuditObject) =>
  o.resource.kind === "function"
    ? `${o.resource.name}(${o.resource.identity ?? ""})`
    : o.resource.name;

function resourceCell(r: Resource): string {
  const sub =
    r.kind === "function"
      ? `(${r.signature || r.identity || ""})`
      : `${kindLabel[r.kind] ?? r.kind} · ${r.owner}`;
  const rls = r.rls
    ? `<span class="rls" title="Row Level Security activée">${icon("lock")}</span>`
    : "";
  return `<div class="res"><span class="kind">${icon(r.kind, 14)}</span><span class="nm"><b>${esc(r.name)}</b>${rls}<small>${esc(sub)}</small></span></div>`;
}

/** Global roles x (databases, schemas, objects) matrix, rendered like the app's Access page. */
function globalMatrix(data: AuditData, superusers: Set<string>): string {
  const rows = matrixRows(data);
  const roles = new Set<string>();
  let hasPublic = false;
  for (const { entry } of rows) {
    for (const k of Object.keys(entry.effective))
      if (!superusers.has(k)) roles.add(k);
    for (const g of entry.grants)
      if (g.role === "PUBLIC") hasPublic = true;
      else if (!superusers.has(g.role)) roles.add(g.role);
    if (!superusers.has(entry.resource.owner)) roles.add(entry.resource.owner);
  }
  const columns = [
    ...(hasPublic ? ["PUBLIC"] : []),
    ...[...roles].sort((a, b) => a.localeCompare(b)),
  ];
  const byName = new Map(data.roles.map((r) => [r.name, r]));
  const ctx: CellContext = {
    version: data.server.version,
    roles: byName,
    memberships: data.memberships,
    pending: [],
  };
  const head = columns
    .map((c) => {
      const role = byName.get(c);
      const title =
        c === "PUBLIC" ? "PUBLIC : tous les rôles, y compris les futurs" : c;
      return `<th class="role" title="${esc(title)}">${avatar(c, c !== "PUBLIC" && !role?.login)}<span>${esc(c)}</span></th>`;
    })
    .join("");
  const body = rows
    .map((r) => {
      const cells = r.error
        ? [
            `<td class="err" colspan="${columns.length}">Base non inspectée : ${esc(r.error)}</td>`,
          ]
        : columns.map((c) => computeCell(r.entry, c, ctx));
      const any =
        !r.error &&
        (cells as Cell[]).some((c) => c.display.kind !== "none");
      const html = r.error
        ? cells[0]
        : (cells as Cell[])
            .map(
              (c) =>
                `<td title="${esc(tip(c, r.entry.resource))}">${pill(c)}</td>`,
            )
            .join("");
      return `<tr class="${r.level}" data-any="${any ? 1 : 0}" data-s="${esc(`${r.path} ${r.entry.resource.owner}`.toLowerCase())}"><td class="o">${resourceCell(r.entry.resource)}</td>${html}</tr>`;
    })
    .join("");
  const count = rows.length;
  return `<div class="tools"><input id="q" type="search" placeholder="Filtrer (base, schéma, objet, propriétaire)…" aria-label="Filtrer la matrice"><label><input id="empty" type="checkbox"> Masquer les objets sans aucun droit</label></div>
<div class="amwrap"><table class="am" id="matrix"><thead><tr><th class="o"><span class="eyebrow">${count} ligne(s)</span></th>${head}</tr></thead><tbody>${body}</tbody></table>
<div class="amlegend"><span><span class="pill l1 sw"></span> Lecture · Connexion · Utilisation</span><span><span class="pill l2 sw"></span> Écriture</span><span><span class="pill l3 sw"></span> Complet</span><span><span class="pill l1 indirect sw"></span> Hérité d’un groupe (${icon("branch", 11)}) ou de PUBLIC (${icon("globe", 11)})</span><span><span class="pill owner sw"></span> Propriétaire</span><span><b>*</b> délégable (WITH GRANT OPTION)</span><span>Droits partiels : S I U D T R Tg M = SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN · Us USAGE · C CREATE · Co CONNECT · Tmp TEMPORARY · X EXECUTE</span></div></div>`;
}

const legend = `<p class="legend">Droits effectifs, hérités et PUBLIC compris, présentés comme dans l’écran Accès de l’application. Survoler une case pour le détail privilège par privilège et sa provenance.</p>`;

const mark = (on: boolean, cls = "") =>
  on ? `<td class="yes ${cls}">✓</td>` : `<td class="no">—</td>`;

function rolesTable(
  roles: AuditData["roles"],
  memberOf: Map<string, string[]>,
): string {
  return `<table class="wide"><thead><tr><th>Rôle</th><th>LOGIN</th><th>SUPERUSER</th><th>BYPASSRLS</th><th>CREATEROLE</th><th>CREATEDB</th><th>REPLICATION</th><th>INHERIT</th><th>Conn. max</th><th>Expiration</th><th>Membre de</th></tr></thead><tbody>${roles
    .map(
      (r) =>
        `<tr><td class="mono"><b>${esc(r.name)}</b></td>${mark(r.login)}${mark(r.superuser, "bad")}${mark(r.bypassRls, "bad")}${mark(r.createRole, "att")}${mark(r.createDb, "att")}${mark(r.replication, "att")}${mark(r.inherit)}<td>${r.connectionLimit < 0 ? `<span class="muted">illimité</span>` : r.connectionLimit}</td><td>${r.validUntil ? esc(r.validUntil) : `<span class="muted">${r.login ? "jamais" : ""}</span>`}</td><td class="mono">${esc((memberOf.get(r.name) || []).join(", "))}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

/** Roles x groups, in the same visual language as the access matrix. Transitive memberships are shown as inherited. */
function membershipMatrix(data: AuditData): string {
  if (!data.memberships.length)
    return `<p class="muted">Aucune appartenance entre rôles.</p>`;
  const byName = new Map(data.roles.map((r) => [r.name, r]));
  const groups = [...new Set(data.memberships.map((m) => m.role))].sort(
    (a, b) => a.localeCompare(b),
  );
  const members = data.roles
    .filter((r) => !r.name.startsWith("pg_"))
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b));
  const head = groups
    .map((g) => {
      const n = data.memberships.filter((m) => m.role === g).length;
      return `<th class="role" title="${esc(`${g} — ${n} membre(s) direct(s)`)}">${avatar(g, !byName.get(g)?.login)}<span>${esc(g)}</span></th>`;
    })
    .join("");
  const body = members
    .map((member) => {
      const role = byName.get(member);
      const direct = data.memberships.filter((m) => m.member === member);
      const inherited = ancestorsOf(member, data.memberships);
      let any = false;
      const cells = groups
        .map((g) => {
          const m = direct.find((x) => x.role === g);
          if (m) {
            any = true;
            const flags = [
              m.admin && "ADMIN OPTION : peut ajouter ou retirer des membres",
              m.inherit
                ? "hérite des droits du groupe"
                : "n’hérite pas des droits (SET ROLE nécessaire)",
              !m.set && "SET ROLE vers le groupe interdit",
            ].filter(Boolean);
            const tip = `${member} est membre direct de ${g}\n${flags.join("\n")}`;
            const label = m.admin
              ? `<span class="pill admin">${icon("crown")}Admin</span>`
              : m.inherit
                ? `<span class="pill l1">Membre</span>`
                : `<span class="pill noinh">Sans héritage</span>`;
            return `<td title="${esc(tip)}">${label}</td>`;
          }
          if (inherited.includes(g) && g !== member) {
            any = true;
            const via =
              direct.find(
                (d) =>
                  d.inherit && ancestorsOf(d.role, data.memberships).includes(g),
              )?.role ?? "";
            return `<td title="${esc(`${member} hérite des droits de ${g} via ${via}`)}"><span class="pill l1 indirect">${icon("branch", 11)}Via ${esc(via)}</span></td>`;
          }
          return `<td><span class="pill none">•</span></td>`;
        })
        .join("");
      const kind = role?.superuser
        ? "Super-utilisateur"
        : role?.login
          ? "Compte"
          : "Groupe";
      return `<tr class="ob" data-any="${any ? 1 : 0}"><td class="o"><div class="res">${avatar(member, !role?.login)}<span class="nm"><b>${esc(member)}</b><small>${kind} · ${direct.length} groupe(s) direct(s)</small></span></div></td>${cells}</tr>`;
    })
    .join("");
  return `<div class="amwrap"><table class="am mb"><thead><tr><th class="o"><span class="eyebrow">Rôle \\ Groupe</span></th>${head}</tr></thead><tbody>${body}</tbody></table>
<div class="amlegend"><span><span class="pill l1 sw"></span> Membre (hérite des droits)</span><span><span class="pill admin sw"></span> Membre avec ADMIN OPTION</span><span><span class="pill noinh sw"></span> Membre sans héritage (SET ROLE nécessaire)</span><span><span class="pill l1 indirect sw"></span> Hérité par un autre groupe (${icon("branch", 11)})</span><span>• non membre</span></div></div>`;
}

function defaultsTable(data: AuditData): string {
  const rows = data.databases.flatMap((d) =>
    d.defaults.map(
      (g) =>
        `<tr><td class="mono">${esc(d.resource.name)}</td><td class="mono">${esc(g.owner)}</td><td class="mono">${esc(g.schema || "(tous)")}</td><td>${esc(g.kind)}</td><td class="mono">${esc(g.role)}</td><td>${esc(g.privilege)}${g.grantable ? ` <span class="bad">WITH GRANT OPTION</span>` : ""}</td></tr>`,
    ),
  );
  return rows.length
    ? `<table class="wide"><thead><tr><th>Base</th><th>Créateur</th><th>Schéma</th><th>Type</th><th>Bénéficiaire</th><th>Privilège</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<p class="muted">Aucun droit par défaut (ALTER DEFAULT PRIVILEGES) défini.</p>`;
}

function objectHtml(o: AuditObject, schema: string): string {
  const r = o.resource;
  const info = [
    o.label,
    `propriétaire ${r.owner}`,
    r.rls ? (r.forceRls ? "RLS forcée" : "RLS active") : "",
    o.rows !== null ? `≈ ${o.rows.toLocaleString("fr-FR")} lignes` : "",
    o.size ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  const columns = o.columns.length
    ? `<table><thead><tr><th>Colonne</th><th>Type</th><th>Null</th><th>Défaut</th></tr></thead><tbody>${o.columns
        .map(
          (c) =>
            `<tr><td class="mono">${esc(c.name)}</td><td class="mono">${esc(c.type)}</td><td>${c.nullable ? "oui" : "non"}</td><td class="mono">${esc(c.default ?? "")}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";
  const lists: string[] = [];
  if (o.constraints.length)
    lists.push(
      `<div><b>Contraintes</b><ul>${o.constraints
        .map(
          (c) =>
            `<li>${esc({ p: "PK", f: "FK", u: "UNIQUE", c: "CHECK", x: "EXCLUDE" }[c.type] || c.type)} <code>${esc(c.name)}</code> : <code>${esc(c.definition)}</code></li>`,
        )
        .join("")}</ul></div>`,
    );
  if (o.indexes.length)
    lists.push(
      `<div><b>Index</b><ul>${o.indexes.map((i) => `<li><code>${esc(i)}</code></li>`).join("")}</ul></div>`,
    );
  if (o.policies.length)
    lists.push(
      `<div><b>Politiques RLS</b><ul>${o.policies
        .map(
          (p) =>
            `<li><b>${esc(p.name)}</b> (${esc(p.command)}) pour ${esc(p.roles.join(", "))}${p.using ? ` — USING <code>${esc(p.using)}</code>` : ""}${p.check ? ` — CHECK <code>${esc(p.check)}</code>` : ""}</li>`,
        )
        .join("")}</ul></div>`,
    );
  return `<div class="obj"><h4>${esc(schema)}.${esc(objectName(o))}<span class="info">${esc(info)}</span></h4>${
    o.comment ? `<p class="muted">${esc(o.comment)}</p>` : ""
  }<div class="cols">${columns}${lists.join("")}</div></div>`;
}

function schemaAnnex(s: AuditSchema): string {
  // Functions and sequences have no structure worth detailing here; the matrix covers their rights.
  const objects = s.objects.filter((o) =>
    ["table", "view"].includes(o.resource.kind),
  );
  if (!objects.length) return "";
  return objects.map((o) => objectHtml(o, s.resource.name)).join("");
}

function databaseAnnex(d: AuditDatabase, n: string): string {
  const body = d.error
    ? `<p class="bad">Base non inspectée : ${esc(d.error)}</p>`
    : d.schemas.map(schemaAnnex).join("") ||
      `<p class="muted">Aucune table ni vue.</p>`;
  return `<h3>${n} Base ${esc(d.resource.name)} <span class="muted" style="font-weight:400">— propriétaire ${esc(d.resource.owner)}</span></h3>${body}`;
}

export function findings(data: AuditData): { tone: string; text: string }[] {
  const out: { tone: string; text: string }[] = [];
  const names = (list: { name: string }[]) =>
    list.map((r) => r.name).join(", ");
  const supers = data.roles.filter((r) => r.superuser);
  if (supers.length)
    out.push({
      tone: "danger",
      text: `Super-utilisateurs (${supers.length}) : ${names(supers)}`,
    });
  const bypass = data.roles.filter((r) => r.bypassRls && !r.superuser);
  if (bypass.length)
    out.push({
      tone: "danger",
      text: `Rôles qui contournent la RLS : ${names(bypass)}`,
    });
  const priv = data.roles.filter(
    (r) =>
      r.login && !r.superuser && (r.createRole || r.createDb || r.replication),
  );
  if (priv.length)
    out.push({
      tone: "",
      text: `Comptes avec droits d’administration (CREATEROLE / CREATEDB / REPLICATION) : ${priv
        .map(
          (r) =>
            `${r.name} [${[r.createRole && "CREATEROLE", r.createDb && "CREATEDB", r.replication && "REPLICATION"].filter(Boolean).join(", ")}]`,
        )
        .join(", ")}`,
    });
  const noExpiry = data.roles.filter(
    (r) =>
      r.login && !r.superuser && !r.validUntil && !r.name.startsWith("pg_"),
  );
  if (noExpiry.length)
    out.push({
      tone: "info",
      text: `Comptes sans date d’expiration : ${noExpiry.length} (${names(noExpiry)})`,
    });
  for (const d of data.databases) {
    for (const s of d.schemas) {
      if (publicPrivileges(s.grants).includes("CREATE"))
        out.push({
          tone: "",
          text: `${d.resource.name}.${s.resource.name} : PUBLIC peut créer des objets (CREATE).`,
        });
      const open = s.objects.filter(
        (o) =>
          o.resource.kind !== "function" && publicPrivileges(o.grants).length,
      );
      if (open.length)
        out.push({
          tone: "",
          text: `${d.resource.name}.${s.resource.name} : PUBLIC a des droits sur ${open.length} objet(s) (${open
            .slice(0, 5)
            .map((o) => o.resource.name)
            .join(", ")}${open.length > 5 ? "…" : ""}).`,
        });
      const rlsNoPolicy = s.objects.filter(
        (o) => o.resource.rls && !o.policies.length,
      );
      if (rlsNoPolicy.length)
        out.push({
          tone: "",
          text: `${d.resource.name}.${s.resource.name} : RLS active sans politique (accès refusé aux non-propriétaires) sur ${rlsNoPolicy.map((o) => o.resource.name).join(", ")}.`,
        });
    }
    if (d.error)
      out.push({
        tone: "danger",
        text: `Base ${d.resource.name} non inspectée : ${d.error}`,
      });
  }
  return out;
}

const severity: Record<string, [string, string]> = {
  danger: ["Critique", "crit"],
  "": ["Attention", "warn"],
  info: ["Info", "info"],
};

function findingsTable(found: { tone: string; text: string }[]): string {
  if (!found.length)
    return `<p class="muted">Aucun point d’attention détecté.</p>`;
  const order = ["danger", "", "info"];
  return `<table class="wide"><thead><tr><th style="width:36px">N°</th><th style="width:90px">Gravité</th><th>Constat</th></tr></thead><tbody>${[
    ...found,
  ]
    .sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone))
    .map((f, i) => {
      const [label, cls] = severity[f.tone] ?? severity[""];
      return `<tr><td>${i + 1}</td><td><span class="sev ${cls}">${label}</span></td><td>${esc(f.text)}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

export function renderAudit(data: AuditData): string {
  const superusers = new Set(
    data.roles.filter((r) => r.superuser).map((r) => r.name),
  );
  const roles = data.roles.filter((r) => !r.name.startsWith("pg_"));
  const memberOf = new Map<string, string[]>();
  for (const m of data.memberships)
    memberOf.set(m.member, [...(memberOf.get(m.member) || []), m.role]);
  const tableCount = data.databases.reduce(
    (n, d) =>
      n +
      d.schemas.reduce(
        (k, s) =>
          k +
          s.objects.filter((o) => ["table", "view"].includes(o.resource.kind))
            .length,
        0,
      ),
    0,
  );
  const objectCount = data.databases.reduce(
    (n, d) => n + d.schemas.reduce((k, s) => k + s.objects.length, 0),
    0,
  );
  const schemaCount = data.databases.reduce((n, d) => n + d.schemas.length, 0);
  const found = findings(data);
  const date = new Date(data.generatedAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? data.generatedAt
    : date.toLocaleString("fr-FR");
  const kpi = (n: number, label: string) =>
    `<div><b>${n.toLocaleString("fr-FR")}</b>${label}</div>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit des droits — ${esc(data.profileName)}</title><style>${css}</style></head><body><div class="doc">
<div class="head"><div><h1>Audit des rôles et des droits PostgreSQL</h1><div class="sub">${esc(data.profileName)}</div></div>
<table class="meta"><tr><td>Serveur</td><td class="mono">${esc(data.host)}</td></tr><tr><td>Version</td><td>PostgreSQL ${esc(data.server.versionLabel)}</td></tr><tr><td>Connecté en tant que</td><td class="mono">${esc(data.server.currentUser)}</td></tr><tr><td>Généré le</td><td>${esc(dateLabel)}</td></tr></table></div>
<div class="toc"><a href="#s1">1. Synthèse</a><a href="#s2">2. Rôles</a><a href="#s3">3. Appartenances</a><a href="#s4">4. Matrice des droits</a><a href="#s5">5. Droits par défaut</a><a href="#s6">6. Annexe : structure</a></div>

<h2 id="s1">1. Synthèse</h2>
<div class="kpi">${kpi(roles.length, "rôles")}${kpi(roles.filter((r) => r.login).length, "comptes de connexion")}${kpi(superusers.size, "super-utilisateurs")}${kpi(data.databases.length, "bases")}${kpi(schemaCount, "schémas")}${kpi(tableCount, "tables et vues")}${kpi(objectCount, "objets au total")}</div>
${findingsTable(found)}

<h2 id="s2">2. Rôles (hors rôles système pg_*)</h2>
${rolesTable(roles, memberOf)}

<h2 id="s3">3. Appartenances entre rôles</h2>
${membershipMatrix(data)}

<h2 id="s4">4. Matrice des droits : rôles × objets</h2>
${legend}
<p class="legend">Super-utilisateurs exclus (tous les droits partout)${superusers.size ? ` : <span class="mono">${esc([...superusers].join(", "))}</span>` : ""}. Les propriétaires détiennent implicitement tous les droits sur leurs objets.</p>
${globalMatrix(data, superusers)}

<h2 id="s5">5. Droits par défaut (objets futurs)</h2>
${defaultsTable(data)}

<h2 id="s6">6. Annexe : structure des tables et vues</h2>
${data.databases.map((d, i) => databaseAnnex(d, `6.${i + 1}`)).join("")}
</div><script>${script}</script></body></html>`;
}
