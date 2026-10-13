import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import type { Change, DefaultGrant } from "../../shared/types";
import { call } from "../api";
import { Dialog } from "../overlay";
import { levels, uiPrivileges } from "../permissions";
import { useToast } from "../toast";
import { Badge, Button, Callout, Empty, ErrorCallout, IconButton, RoleAvatar, Skeleton, cx, errorMessage, plural } from "../ui";
import { useWorkspace } from "../workspace";
import { useSchemas } from "./access";

type DefaultKind = "table" | "sequence" | "function";
const kinds: Record<DefaultKind, { one: string; many: string }> = {
  table: { one: "table", many: "tables et vues" },
  sequence: { one: "séquence", many: "séquences" },
  function: { one: "fonction", many: "fonctions" },
};
interface Rule {
  owner: string;
  schema: string;
  kind: DefaultKind;
  role: string;
  privileges: string[];
  pending: Change[];
}

export function DefaultsPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const grants = useQuery({
    queryKey: ["defaults", ws.profileId, ws.database],
    queryFn: () => call("defaults", { profileId: ws.profileId, database: ws.database }),
    enabled: Boolean(ws.profileId && ws.database),
  });
  const rules = useMemo(() => {
    const map = new Map<string, Rule>();
    const id = (g: { owner: string; schema: string; kind: string; role: string }) => [g.owner, g.schema, g.kind, g.role].join("\0");
    for (const g of (grants.data || []) as DefaultGrant[]) {
      const k = id(g);
      const rule = map.get(k) || { owner: g.owner, schema: g.schema, kind: g.kind, role: g.role, privileges: [], pending: [] };
      if (!rule.privileges.includes(g.privilege)) rule.privileges.push(g.privilege);
      map.set(k, rule);
    }
    for (const c of ws.pending.filter((c) => c.defaultOwner)) {
      const g = { owner: c.defaultOwner!, schema: c.resource.schema, kind: c.resource.kind, role: c.role };
      const k = id(g);
      const rule = map.get(k) || { ...g, kind: g.kind as DefaultKind, privileges: [], pending: [] };
      rule.pending.push(c);
      map.set(k, rule);
    }
    return [...map.values()].sort((a, b) => a.owner.localeCompare(b.owner) || a.schema.localeCompare(b.schema) || a.role.localeCompare(b.role));
  }, [grants.data, ws.pending]);
  const removeRule = async (rule: Rule) => {
    try {
      const snapshot = await qc.fetchQuery({
        queryKey: ["defaultAccess", ws.profileId, ws.database, rule.owner, rule.schema, rule.kind],
        queryFn: () => call("defaultAccess", { profileId: ws.profileId, database: ws.database, owner: rule.owner, schema: rule.schema, kind: rule.kind }),
        staleTime: 0,
      });
      ws.addChanges(
        rule.privileges.map((privilege) => ({
          id: crypto.randomUUID(),
          profileId: ws.profileId,
          database: ws.database,
          resource: { oid: 0, name: "futurs_objets", schema: rule.schema, kind: rule.kind, owner: rule.owner },
          role: rule.role,
          privilege,
          action: "revoke" as const,
          grantOption: false,
          fingerprint: snapshot.fingerprint,
          defaultOwner: rule.owner,
        })),
      );
    } catch (e) {
      toast({ tone: "error", title: "Impossible de préparer le retrait", description: errorMessage(e) });
    }
  };
  return (
    <div className="mx-auto max-w-[920px] px-10 py-8 pb-28">
      <header className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Droits par défaut</h1>
          <p className="mt-1 text-[13px] text-muted">
            Les droits donnés automatiquement aux objets <b className="text-fg">créés à l’avenir</b> dans {ws.database}. Les objets existants ne
            changent pas.
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)} disabled={!ws.overview}>
          Nouvelle règle
        </Button>
      </header>
      <div className="mt-7 grid gap-2.5">
        {grants.isPending ? (
          <Skeleton className="h-32" />
        ) : grants.error ? (
          <ErrorCallout error={grants.error} />
        ) : !rules.length ? (
          <div className="card">
            <Empty
              icon={<CalendarClock size={20} />}
              title="Aucune règle"
              action={
                <Button icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                  Créer une règle
                </Button>
              }
            >
              Exemple : « quand <i>app_owner</i> crée une table, <i>app_reader</i> peut la lire ». Évite d’oublier les droits des nouvelles tables.
            </Empty>
          </div>
        ) : (
          rules.map((rule) => {
            const grantsAfter = new Set(rule.privileges);
            for (const c of rule.pending) {
              if (c.action === "grant") grantsAfter.add(c.privilege);
              else if (!c.grantOption) grantsAfter.delete(c.privilege);
            }
            const removed = rule.privileges.length > 0 && grantsAfter.size === 0;
            return (
              <div
                key={[rule.owner, rule.schema, rule.kind, rule.role].join("|")}
                className={cx("card group flex items-center gap-4 px-5 py-4", rule.pending.length > 0 && "!border-[var(--pending)]")}
              >
                <Sparkles size={17} className="flex-none text-accent" />
                <p className={cx("m-0 min-w-0 flex-1 leading-relaxed", removed && "line-through opacity-60")}>
                  Quand <Name>{rule.owner}</Name> crée des <b>{kinds[rule.kind].many}</b>{" "}
                  {rule.schema ? (
                    <>
                      dans <Name schema>{rule.schema}</Name>
                    </>
                  ) : (
                    "dans n’importe quel schéma"
                  )}
                  , <Name role>{rule.role}</Name> reçoit{" "}
                  {[...grantsAfter].map((p) => (
                    <code
                      key={p}
                      className={cx(
                        "mx-0.5 rounded bg-raised px-1.5 py-0.5 text-[11.5px]",
                        !rule.privileges.includes(p) && "bg-ok-soft text-ok",
                      )}
                    >
                      {p}
                    </code>
                  ))}
                  {rule.privileges
                    .filter((p) => !grantsAfter.has(p))
                    .map((p) => (
                      <code key={p} className="mx-0.5 rounded bg-danger-soft px-1.5 py-0.5 text-[11.5px] text-danger line-through">
                        {p}
                      </code>
                    ))}
                  .
                </p>
                {rule.pending.length ? <Badge tone="warn">en attente</Badge> : null}
                {rule.pending.length ? (
                  <IconButton label="Rétablir" small onClick={() => ws.removeChanges((c) => rule.pending.includes(c))}>
                    <Undo2 size={14} />
                  </IconButton>
                ) : rule.privileges.length ? (
                  <IconButton label="Supprimer la règle" small className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => removeRule(rule)}>
                    <Trash2 size={14} />
                  </IconButton>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <Callout tone="info" className="mt-6">
        Une règle ne vaut que pour les objets créés par son rôle créateur. Les règles d’un schéma s’ajoutent aux règles globales.
      </Callout>
      {creating ? <RuleDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
function Name({ children, role, schema }: { children: string; role?: boolean; schema?: boolean }) {
  const ws = useWorkspace();
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 align-middle font-semibold">
      {role || !schema ? <RoleAvatar name={children} group={children !== "PUBLIC" && !ws.rolesByName.get(children)?.login} size={16} /> : null}
      {children}
    </span>
  );
}

function RuleDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const schemas = useSchemas();
  const roles = ws.roles.filter((r) => !r.name.startsWith("pg_"));
  const [owner, setOwner] = useState(ws.overview?.server.currentUser || roles[0]?.name || "");
  const [schema, setSchema] = useState("");
  const [kind, setKind] = useState<DefaultKind>("table");
  const [role, setRole] = useState(roles.find((r) => !r.login && r.name !== owner)?.name || "PUBLIC");
  const [privileges, setPrivileges] = useState<string[]>(["SELECT"]);
  const current = useQuery({
    queryKey: ["defaultAccess", ws.profileId, ws.database, owner, schema, kind],
    queryFn: () => call("defaultAccess", { profileId: ws.profileId, database: ws.database, owner, schema, kind }),
    enabled: Boolean(owner),
  });
  const all = uiPrivileges(kind, ws.version);
  const existing = current.data?.grants.filter((g) => g.role === role).map((g) => g.privilege) || [];
  const select = "input !inline-block !h-8 !w-auto align-middle font-semibold";
  return (
    <Dialog
      title="Nouvelle règle"
      description="Complétez la phrase."
      icon={<Sparkles size={16} />}
      onClose={onClose}
      wide
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={<Check size={15} />}
            disabled={!privileges.length || !current.data}
            onClick={() => {
              const additions = privileges
                .filter((p) => !existing.includes(p))
                .map((privilege) => ({
                  id: crypto.randomUUID(),
                  profileId: ws.profileId,
                  database: ws.database,
                  resource: { oid: 0, name: "futurs_objets", schema, kind, owner },
                  role,
                  privilege,
                  action: "grant" as const,
                  grantOption: false,
                  fingerprint: current.data!.fingerprint,
                  defaultOwner: owner,
                }));
              ws.addChanges(additions);
              toast({
                tone: "info",
                title: additions.length ? `${plural(additions.length, "changement")} préparé${additions.length > 1 ? "s" : ""}` : "Cette règle existe déjà",
              });
              onClose();
            }}
          >
            Préparer la règle
          </Button>
        </>
      }
    >
      <p className="m-0 text-[15px] leading-[2.6]">
        Quand{" "}
        <select className={select} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Rôle créateur">
          {roles.map((r) => (
            <option key={r.oid}>{r.name}</option>
          ))}
        </select>{" "}
        crée des{" "}
        <select
          className={select}
          value={kind}
          aria-label="Type d’objet"
          onChange={(e) => {
            setKind(e.target.value as DefaultKind);
            setPrivileges([e.target.value === "function" ? "EXECUTE" : "SELECT"]);
          }}
        >
          {(Object.keys(kinds) as DefaultKind[]).map((k) => (
            <option key={k} value={k}>
              {kinds[k].many}
            </option>
          ))}
        </select>{" "}
        dans{" "}
        <select className={select} value={schema} onChange={(e) => setSchema(e.target.value)} aria-label="Schéma">
          <option value="">n’importe quel schéma</option>
          {schemas.data?.map((s) => (
            <option key={s.oid} value={s.name}>
              le schéma {s.name}
            </option>
          ))}
        </select>
        ,{" "}
        <select className={select} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Destinataire">
          {roles.map((r) => (
            <option key={r.oid}>{r.name}</option>
          ))}
          <option>PUBLIC</option>
        </select>{" "}
        reçoit :
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {levels(kind, ws.version).map((l) => {
          const active = l.privileges.length === privileges.length && l.privileges.every((p) => privileges.includes(p));
          return (
            <button
              key={l.label}
              onClick={() => setPrivileges(l.privileges)}
              className={cx(
                "flex h-9 items-center gap-2 rounded-lg border px-3 font-semibold",
                active ? "border-accent bg-accent-soft text-accent" : "border-line-strong hover:bg-raised",
              )}
            >
              <span className={`pill l${l.rank} !h-3 !min-w-5 !p-0`} />
              {l.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {all.map((p) => (
          <label key={p} className="flex items-center gap-2 font-mono text-[12px]">
            <input
              type="checkbox"
              className="checkbox"
              checked={privileges.includes(p)}
              onChange={(e) => setPrivileges((v) => (e.target.checked ? [...v, p] : v.filter((x) => x !== p)))}
            />
            {p}
          </label>
        ))}
      </div>
      {existing.length ? (
        <Callout tone="info" className="mt-4">
          {role} reçoit déjà {existing.join(", ")} par cette règle.
        </Callout>
      ) : null}
      <ErrorCallout error={current.error} className="mt-4" />
    </Dialog>
  );
}
