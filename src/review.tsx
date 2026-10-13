import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  CornerDownLeft,
  Minus,
  Plus,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Change } from "../shared/types";
import { call, isDesktop } from "./api";
import { Sheet } from "./overlay";
import { draftIssues } from "./structure";
import { useToast } from "./toast";
import {
  Badge,
  Button,
  Callout,
  ErrorCallout,
  IconButton,
  KindIcon,
  RoleAvatar,
  Sql,
  Spinner,
  cx,
  kindPlural,
  plural,
} from "./ui";
import { safeOps, useWorkspace } from "./workspace";

export function ChangesBar() {
  const ws = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const elsewhere = ws.changes.length - ws.pending.length;
  if (!ws.pendingCount || ws.ui.review) return null;
  return (
    <div
      className="fixed bottom-5 left-[calc(50%+110px)] z-40 flex items-center gap-3 rounded-[14px] border border-line bg-surface py-2 pr-2 pl-4 shadow-[var(--shadow-lg)]"
      style={{ transform: "translateX(-50%)", animation: "slide-up .2s ease-out" }}
      role="region"
      aria-label="Modifications en attente"
    >
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--pending)] opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-[var(--pending)]" />
      </span>
      <div className="leading-tight">
        <div className="font-semibold">{plural(ws.pendingCount, "modification")} en attente</div>
        <div className="text-xs text-muted">
          Rien n’est appliqué avant votre validation{elsewhere > 0 ? ` · ${elsewhere} dans d’autres bases` : ""}
        </div>
      </div>
      <div className="ml-3 flex items-center gap-1.5">
        {confirm ? (
          <>
            <span className="text-xs text-muted">Tout annuler ?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Non
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                ws.removeChanges((c) => ws.pending.includes(c));
                for (const d of ws.pendingDrafts) ws.putDraft(null, d.key);
                setConfirm(false);
              }}
            >
              Oui, annuler
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={<Undo2 size={15} />} onClick={() => setConfirm(true)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => ws.ui.openReview()}>
              Vérifier et appliquer
              <span className="ml-1 flex gap-0.5 opacity-80">
                <kbd className="kbd !h-4 !border-white/30 !bg-white/15 !text-white !shadow-none">Ctrl</kbd>
                <kbd className="kbd !h-4 !border-white/30 !bg-white/15 !text-white !shadow-none">
                  <CornerDownLeft size={10} />
                </kbd>
              </span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function describe(c: Change) {
  const target = c.defaultOwner
    ? `futures ${kindPlural[c.resource.kind].toLowerCase()} de ${c.defaultOwner}${c.resource.schema ? ` dans ${c.resource.schema}` : ""}`
    : c.resource.schema
      ? `${c.resource.schema}.${c.resource.name}`
      : c.resource.name;
  return target;
}

export function ReviewSheet() {
  const ws = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const ops = useMemo(() => ws.pendingDrafts.flatMap((d) => safeOps(d)), [ws.pendingDrafts]);
  const issues = ws.pendingDrafts.flatMap((d) => draftIssues(d).map((i) => `${d.schema}.${d.name || "nouvelle table"} : ${i}`));
  const ddl = useQuery({
    queryKey: ["ddlPreview", ws.profileId, ws.database, ops],
    queryFn: () => call("ddlPreview", { profileId: ws.profileId, database: ws.database, ops }),
    enabled: ops.length > 0 && !issues.length,
    retry: false,
  });
  const grants = useQuery({
    queryKey: ["preview", ws.profileId, ws.database, ws.pending],
    queryFn: () => call("preview", { profileId: ws.profileId, database: ws.database, changes: ws.pending }),
    enabled: ws.pending.length > 0,
    retry: false,
  });
  const byRole = useMemo(() => {
    const map = new Map<string, Change[]>();
    for (const c of ws.pending) map.set(c.role, [...(map.get(c.role) || []), c]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ws.pending]);
  const sql = [...(ops.length ? ["-- Structure", ...(ddl.data || [])] : []), ...(ws.pending.length ? ["-- Permissions", ...(grants.data || [])] : [])].join("\n");
  const close = () => ws.ui.openReview(false);
  const ready =
    ws.pendingCount > 0 &&
    !issues.length &&
    (!ops.length || ddl.isSuccess) &&
    (!ws.pending.length || grants.isSuccess);
  async function apply() {
    setBusy(true);
    setError(undefined);
    let structureDone = false;
    try {
      if (ops.length) {
        await call("ddlApply", { profileId: ws.profileId, database: ws.database, ops });
        structureDone = true;
        for (const d of ws.pendingDrafts) ws.putDraft(null, d.key);
      }
      if (ws.pending.length) {
        const applied = ws.pending;
        await call("apply", { profileId: ws.profileId, database: ws.database, changes: applied });
        ws.removeChanges((c) => applied.includes(c));
      }
      toast({ title: "Modifications appliquées", description: `${plural(ws.pendingCount, "modification")} sur ${ws.database}` });
      await ws.refresh();
      close();
    } catch (e) {
      setError(
        structureDone
          ? new Error(`La structure a été appliquée, mais pas les permissions : ${(e as Error).message}`)
          : e,
      );
      if (structureDone) await ws.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="Vérifier les modifications"
      description={
        <span>
          {plural(ws.pendingCount, "modification")} sur <b className="text-fg">{ws.database}</b> · {ws.profile?.name}
        </span>
      }
      onClose={close}
      busy={busy}
      width={620}
      footer={
        <>
          <Button
            variant="danger-ghost"
            icon={<Trash2 size={15} />}
            disabled={busy || !ws.pendingCount}
            onClick={() => {
              ws.removeChanges((c) => ws.pending.includes(c));
              for (const d of ws.pendingDrafts) ws.putDraft(null, d.key);
              close();
            }}
          >
            Tout abandonner
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close} disabled={busy}>
            Fermer
          </Button>
          <Button variant="primary" icon={<Check size={15} />} loading={busy} disabled={!ready} onClick={apply}>
            Appliquer {plural(ws.pendingCount, "modification")}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 px-6 py-5">
        {!ws.pendingCount ? (
          <p className="py-10 text-center text-muted">Aucune modification en attente sur cette base.</p>
        ) : null}
        {ws.pendingDrafts.length ? (
          <section>
            <h3 className="eyebrow mb-2.5">Structure</h3>
            <div className="grid gap-2">
              {ws.pendingDrafts.map((d) => (
                <div key={d.key} className="card flex items-center gap-3 px-3.5 py-2.5">
                  <Table2 size={16} className="text-info" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {d.schema}.{d.name || "nouvelle table"}
                    </div>
                    <div className="text-xs text-muted">
                      {d.drop
                        ? "Suppression de la table"
                        : !d.base
                          ? `Création · ${plural(d.columns.filter((c) => !c.dropped).length, "colonne")}`
                          : plural(safeOps(d).length, "opération")}
                    </div>
                  </div>
                  {d.drop ? <Badge tone="danger">Suppression</Badge> : !d.base ? <Badge tone="ok">Nouvelle</Badge> : <Badge tone="warn">Modifiée</Badge>}
                  <IconButton
                    label="Ouvrir dans l’éditeur"
                    small
                    onClick={() => {
                      ws.setSchemaView({ schema: d.schema, object: d.base ? `${d.base.resource.kind}:${d.base.resource.oid}` : d.key });
                      ws.go("schemas");
                      close();
                    }}
                  >
                    <ArrowRight size={14} />
                  </IconButton>
                  <IconButton label="Abandonner ces modifications" small onClick={() => ws.putDraft(null, d.key)} disabled={busy}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
            {issues.length ? (
              <Callout tone="danger" className="mt-3" title="À corriger avant d’appliquer">
                <ul className="m-0 list-disc pl-4">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
            <ErrorCallout error={ddl.error} className="mt-3" />
          </section>
        ) : null}
        {byRole.length ? (
          <section>
            <h3 className="eyebrow mb-2.5">Permissions</h3>
            <div className="grid gap-3">
              {byRole.map(([role, list]) => (
                <div key={role} className="card overflow-hidden">
                  <div className="flex items-center gap-2.5 border-b border-line bg-sunken px-3.5 py-2">
                    <RoleAvatar name={role} group={!ws.rolesByName.get(role)?.login} size={22} />
                    <span className="font-semibold">{role}</span>
                    <span className="text-xs text-muted">{plural(list.length, "changement")}</span>
                  </div>
                  <ul className="m-0 list-none p-1.5">
                    {list.map((c) => (
                      <li key={c.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-raised">
                        <span
                          className={cx(
                            "grid size-5 flex-none place-items-center rounded-md",
                            c.action === "grant" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
                          )}
                        >
                          {c.action === "grant" ? <Plus size={12} strokeWidth={3} /> : <Minus size={12} strokeWidth={3} />}
                        </span>
                        <span className="font-mono text-[12px] font-semibold">{c.privilege}</span>
                        {c.grantOption ? (
                          <Badge tone="info" tip={c.action === "grant" ? "Peut transmettre ce droit (WITH GRANT OPTION)" : "Retire seulement la délégation"}>
                            délégation
                          </Badge>
                        ) : null}
                        <span className="text-faint">{c.action === "grant" ? "sur" : "de"}</span>
                        <KindIcon kind={c.resource.kind} size={13} />
                        <span className="min-w-0 flex-1 truncate">{describe(c)}</span>
                        <IconButton
                          label="Retirer ce changement"
                          small
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                          disabled={busy}
                          onClick={() => ws.removeChanges((x) => x.id === c.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <ErrorCallout error={grants.error} className="mt-3" />
          </section>
        ) : null}
        {ws.pendingCount ? (
          <section>
            <div className="flex items-center">
              <button className="flex items-center gap-1.5 font-semibold text-muted hover:text-fg" onClick={() => setShowSql((v) => !v)}>
                <ChevronRight size={14} className={cx("transition-transform", showSql && "rotate-90")} />
                <Code2 size={14} />
                SQL exécuté
              </button>
              <div className="flex-1" />
              {showSql ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={copied ? <Check size={13} /> : <Copy size={13} />}
                  onClick={async () => {
                    await navigator.clipboard.writeText(sql).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copié" : "Copier"}
                </Button>
              ) : null}
            </div>
            {showSql ? (
              <div className="mt-2 max-h-[340px] overflow-auto rounded-[10px] border border-line bg-sunken p-3.5">
                {ddl.isFetching || grants.isFetching ? <Spinner /> : <Sql code={sql} />}
              </div>
            ) : null}
          </section>
        ) : null}
        {ws.pendingCount ? (
          <Callout tone="info">
            Les droits sont relus juste avant l’exécution : si quelqu’un les a modifiés entre-temps, rien n’est appliqué. Structure et permissions
            s’exécutent chacune dans une transaction.
          </Callout>
        ) : null}
        {!isDesktop() ? <Callout tone="warn">Mode démonstration : les modifications s’appliquent à des données fictives.</Callout> : null}
        <ErrorCallout error={error} />
      </div>
    </Sheet>
  );
}
