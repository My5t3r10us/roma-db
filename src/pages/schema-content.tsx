import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles, Table2 } from "lucide-react";
import type { Change } from "../../shared/types";
import { call } from "../api";
import { Dialog } from "../overlay";
import { computeCell, levels, planDirect, type LevelDef } from "../permissions";
import { useToast } from "../toast";
import { Button, Callout, ErrorCallout, KindIcon, RoleAvatar, Skeleton, Switch, cx, errorMessage, plural } from "../ui";
import { useWorkspace } from "../workspace";
import { useCellContext, useMatrix } from "./access";

type Group = "table" | "sequence" | "function";
const groups: { id: Group; label: string; kinds: string[] }[] = [
  { id: "table", label: "Tables et vues", kinds: ["table", "view"] },
  { id: "sequence", label: "Séquences", kinds: ["sequence"] },
  { id: "function", label: "Fonctions", kinds: ["function"] },
];

/** After access to a schema is granted: open up its objects, now and in the future. */
export function SchemaContentDialog({ schema, role }: { schema: string; role: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const ctx = useCellContext();
  const matrix = useMatrix("objects", schema);
  const schemas = useMatrix("schemas", "");
  const close = () => ws.ui.openSchemaContent(undefined);
  const [choice, setChoice] = useState<Record<Group, number>>({ table: 1, sequence: 0, function: 0 });
  const [future, setFuture] = useState(true);
  const schemaOwner = schemas.data?.entries.find((e) => e.resource.name === schema)?.resource.owner;
  const currentUser = ws.overview?.server.currentUser;
  const [creators, setCreators] = useState<string[] | undefined>();
  const chosenCreators = creators ?? [...new Set([schemaOwner, currentUser].filter(Boolean) as string[])];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const counts = useMemo(() => {
    const map: Record<Group, number> = { table: 0, sequence: 0, function: 0 };
    for (const e of matrix.data?.entries || [])
      for (const g of groups) if (g.kinds.includes(e.resource.kind)) map[g.id]++;
    return map;
  }, [matrix.data]);
  const levelOf = (g: Group): LevelDef | undefined => levels(g, ws.version).find((l) => l.rank === choice[g]);
  const anything = groups.some((g) => choice[g.id] > 0);
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const base = { profileId: ws.profileId, database: ws.database };
      const changes: Change[] = [];
      for (const e of matrix.data?.entries || []) {
        const g = groups.find((x) => x.kinds.includes(e.resource.kind));
        const level = g && levelOf(g.id);
        if (!level) continue;
        const cell = computeCell(e, role, ctx);
        if (cell.display.kind === "superuser" || cell.display.kind === "owner") continue;
        // Additive: existing direct privileges are kept.
        changes.push(...planDirect(e, cell, [...new Set([...cell.futureDirect, ...level.privileges])], false, base));
      }
      if (future)
        for (const owner of chosenCreators)
          for (const g of groups) {
            const level = levelOf(g.id);
            if (!level) continue;
            const snapshot = await qc.fetchQuery({
              queryKey: ["defaultAccess", ws.profileId, ws.database, owner, schema, g.id],
              queryFn: () => call("defaultAccess", { ...base, owner, schema, kind: g.id }),
              staleTime: 0,
            });
            const existing = snapshot.grants.filter((x) => x.role === role).map((x) => x.privilege);
            for (const privilege of level.privileges.filter((p) => !existing.includes(p)))
              changes.push({
                id: crypto.randomUUID(),
                ...base,
                resource: { oid: 0, name: "futurs_objets", schema, kind: g.id, owner },
                role,
                privilege,
                action: "grant",
                grantOption: false,
                fingerprint: snapshot.fingerprint,
                defaultOwner: owner,
              });
          }
      ws.addChanges(changes);
      toast({
        tone: "info",
        title: changes.length ? `${plural(changes.length, "changement")} préparé${changes.length > 1 ? "s" : ""}` : "Aucun changement nécessaire",
        description: changes.length ? "Vérifiez puis appliquez depuis la barre en bas de l’écran." : `${role} a déjà ces droits.`,
      });
      close();
    } catch (e) {
      setError(new Error(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Accès au contenu de « ${schema} »`}
      description={
        <span className="flex items-center gap-1.5">
          Pour <RoleAvatar name={role} group={!ws.rolesByName.get(role)?.login} size={16} /> <b className="text-fg">{role}</b> · USAGE seul
          ne donne accès à aucune donnée.
        </span>
      }
      icon={<Table2 size={17} />}
      onClose={close}
      busy={busy}
      wide
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close} disabled={busy}>
            Plus tard
          </Button>
          <Button variant="primary" icon={<Check size={15} />} loading={busy} disabled={!anything || !matrix.data || (future && !chosenCreators.length)} onClick={submit}>
            Préparer les droits
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <section>
          <h3 className="eyebrow mb-2">Droits à donner</h3>
          {matrix.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="card divide-y divide-line">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-3 px-4 py-3">
                  <KindIcon kind={g.id} size={15} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{g.label}</span>
                    <span className="block text-xs text-muted">{plural(counts[g.id], "objet existant", "objets existants")}</span>
                  </span>
                  <div className="segmented" role="group" aria-label={g.label}>
                    {[{ rank: 0, label: "Aucun" } as { rank: number; label: string }, ...levels(g.id, ws.version)].map((l) => (
                      <button key={l.label} type="button" aria-pressed={choice[g.id] === l.rank} onClick={() => setChoice((c) => ({ ...c, [g.id]: l.rank }))}>
                        {l.rank ? <span className={`pill l${l.rank} !h-2.5 !min-w-3.5 !p-0`} /> : null}
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="hint mt-2">Les droits sont ajoutés aux droits actuels, jamais retirés. « Aucun » laisse ce type d’objet inchangé.</p>
          <ErrorCallout error={matrix.error} className="mt-2" />
        </section>
        <section className={cx("rounded-xl border p-4", future ? "border-accent/40 bg-accent-soft/40" : "border-line")}>
          <label className="flex items-start gap-3">
            <Sparkles size={17} className="mt-0.5 text-accent" />
            <span className="flex-1">
              <span className="block font-semibold">Appliquer aussi aux objets créés à l’avenir</span>
              <span className="block text-[12.5px] text-muted">
                Chaque nouvelle table, vue, séquence ou fonction de « {schema} » recevra automatiquement ces droits.
              </span>
            </span>
            <Switch label="Appliquer aux futurs objets" checked={future} onChange={setFuture} />
          </label>
          {future ? (
            <div className="mt-3 pl-8">
              <div className="mb-1.5 text-[12px] font-semibold text-muted">Pour les objets créés par</div>
              <div className="flex flex-wrap gap-1.5">
                {ws.roles
                  .filter((r) => !r.name.startsWith("pg_") && r.name !== role)
                  .map((r) => {
                    const on = chosenCreators.includes(r.name);
                    return (
                      <button
                        key={r.oid}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCreators(on ? chosenCreators.filter((x) => x !== r.name) : [...chosenCreators, r.name])}
                        className={cx(
                          "flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-[12px]",
                          on ? "border-accent bg-surface font-semibold text-accent" : "border-line text-muted hover:bg-raised",
                        )}
                      >
                        <RoleAvatar name={r.name} group={!r.login} size={18} />
                        {r.name}
                        {r.name === schemaOwner ? <span className="text-[10.5px] text-faint">propriétaire</span> : null}
                      </button>
                    );
                  })}
              </div>
              <p className="hint mt-2">
                PostgreSQL attache ces règles au rôle qui crée l’objet : cochez les rôles qui créent des tables dans ce schéma (souvent le
                propriétaire et le compte de migration).
              </p>
            </div>
          ) : null}
        </section>
        {!anything ? <Callout tone="info">Choisissez au moins un niveau.</Callout> : null}
        <ErrorCallout error={error} />
      </div>
    </Dialog>
  );
}
