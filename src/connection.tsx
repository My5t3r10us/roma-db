import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Database,
  KeyRound,
  Lock,
  LockOpen,
  Plug,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Workflow,
  Eye,
} from "lucide-react";
import type { Profile, ProfileInput } from "../shared/types";
import { call, isDesktop } from "./api";
import { Dialog } from "./overlay";
import { Button, Callout, ErrorCallout, Field, cx } from "./ui";
import { useToast } from "./toast";
import { useWorkspace } from "./workspace";

const colors = ["#6447f5", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#db2777"];
const sslModes = [
  {
    value: "disable",
    icon: LockOpen,
    label: "Sans chiffrement",
    detail: "Réseau local ou machine de développement.",
  },
  {
    value: "verify-full",
    icon: ShieldCheck,
    label: "SSL vérifié",
    detail: "Certificat et nom d’hôte vérifiés. Recommandé à distance.",
  },
  {
    value: "require",
    icon: ShieldAlert,
    label: "SSL sans vérification",
    detail: "Chiffré, mais l’identité du serveur n’est pas vérifiée.",
  },
] as const;

export function ConnectionDialog({ profile }: { profile?: Profile }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<ProfileInput>(
    profile || {
      id: crypto.randomUUID(),
      name: "",
      host: "127.0.0.1",
      port: 5432,
      user: "",
      maintenanceDb: "postgres",
      ssl: "disable",
      ca: "",
      cert: "",
      color: colors[0],
    },
  );
  const [busy, setBusy] = useState<"" | "test" | "save" | "delete">("");
  const [error, setError] = useState<unknown>();
  const [tested, setTested] = useState("");
  const [removing, setRemoving] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [advanced, setAdvanced] = useState(Boolean(profile?.ca || profile?.cert));
  const close = () => ws.ui.openConnection(undefined);
  const update = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => {
    setForm((v) => ({ ...v, [key]: value }));
    setTested("");
  };
  const local = ["127.0.0.1", "localhost", "::1"].includes(form.host.trim());
  async function test() {
    setBusy("test");
    setError(undefined);
    try {
      const info = await call("testConnection", form);
      setTested(`PostgreSQL ${info.versionLabel} · connecté en tant que ${info.currentUser}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("save");
    setError(undefined);
    try {
      const saved = await call("saveProfile", {
        ...form,
        name: form.name.trim() || `${form.user}@${form.host}`,
      });
      ws.removeChanges((c) => c.profileId === saved.id);
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      await qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(saved.id) });
      ws.selectProfile(saved.id);
      toast({ title: profile ? "Connexion mise à jour" : "Connexion ajoutée", description: saved.name });
      close();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  if (removing && profile)
    return (
      <Dialog
        title="Supprimer cette connexion ?"
        description="Les identifiants enregistrés sont effacés. Le serveur et ses bases ne sont pas modifiés."
        icon={<Trash2 size={17} className="text-danger" />}
        onClose={close}
        busy={Boolean(busy)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(false)} disabled={Boolean(busy)}>
              Retour
            </Button>
            <div className="flex-1" />
            <Button
              variant="danger"
              icon={<Trash2 size={15} />}
              loading={busy === "delete"}
              disabled={confirmation !== profile.name}
              onClick={async () => {
                setBusy("delete");
                try {
                  await call("deleteProfile", { id: profile.id });
                  ws.removeChanges((c) => c.profileId === profile.id);
                  await qc.invalidateQueries({ queryKey: ["profiles"] });
                  ws.selectProfile("");
                  toast({ title: "Connexion supprimée", description: profile.name });
                  close();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy("");
                }
              }}
            >
              Supprimer
            </Button>
          </>
        }
      >
        <Field label={<>Saisissez <b className="font-mono">{profile.name}</b> pour confirmer</>}>
          {(id) => (
            <input id={id} autoFocus className="input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          )}
        </Field>
        <ErrorCallout error={error} className="mt-4" />
      </Dialog>
    );
  return (
    <Dialog
      title={profile ? "Modifier la connexion" : "Nouvelle connexion"}
      description="Le mot de passe est conservé dans le coffre-fort Windows, jamais en clair."
      icon={<Plug size={17} />}
      onClose={close}
      busy={Boolean(busy)}
      wide
      footer={
        <>
          {profile ? (
            <Button variant="danger-ghost" icon={<Trash2 size={15} />} onClick={() => setRemoving(true)} disabled={Boolean(busy)}>
              Supprimer
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button icon={<Plug size={15} />} loading={busy === "test"} disabled={Boolean(busy)} onClick={test}>
            Tester
          </Button>
          <Button variant="primary" icon={<Check size={15} />} loading={busy === "save"} disabled={Boolean(busy)} type="submit" form="connection-form">
            {profile ? "Enregistrer" : "Ajouter la connexion"}
          </Button>
        </>
      }
    >
      <form
        id="connection-form"
        className="grid grid-cols-[1fr_1fr] gap-x-4 gap-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Nom" className="col-span-2" hint="Comment cette connexion apparaît dans Roma DB.">
          {(id) => (
            <div className="flex gap-3">
              <input
                id={id}
                autoFocus
                className="input flex-1"
                placeholder="Production, staging, local…"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
              <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Couleur">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={form.color === c}
                    aria-label={`Couleur ${c}`}
                    onClick={() => update("color", c)}
                    className={cx(
                      "size-5 rounded-full transition-transform hover:scale-110",
                      form.color === c && "ring-2 ring-offset-2 ring-offset-surface",
                    )}
                    style={{ background: c, ["--tw-ring-color" as string]: c }}
                  />
                ))}
              </div>
            </div>
          )}
        </Field>
        <div className="col-span-2 grid grid-cols-[1fr_110px] gap-3">
          <Field label="Hôte">
            {(id) => (
              <input
                id={id}
                required
                className="input font-mono text-[12.5px]"
                value={form.host}
                onChange={(e) => {
                  const host = e.target.value;
                  setForm((v) => ({
                    ...v,
                    host,
                    ssl: ["127.0.0.1", "localhost", "::1"].includes(host.trim()) ? "disable" : v.ssl === "disable" ? "verify-full" : v.ssl,
                  }));
                  setTested("");
                }}
              />
            )}
          </Field>
          <Field label="Port">
            {(id) => (
              <input
                id={id}
                required
                type="number"
                min={1}
                max={65535}
                className="input font-mono text-[12.5px]"
                value={form.port}
                onChange={(e) => update("port", Number(e.target.value))}
              />
            )}
          </Field>
        </div>
        <Field label="Utilisateur">
          {(id) => (
            <input id={id} required autoComplete="off" className="input" value={form.user} onChange={(e) => update("user", e.target.value)} />
          )}
        </Field>
        <Field label="Mot de passe" hint={profile ? "Laisser vide pour conserver l’actuel." : undefined}>
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              className="input"
              placeholder={profile ? "••••••••" : ""}
              value={form.password || ""}
              onChange={(e) => update("password", e.target.value || undefined)}
            />
          )}
        </Field>
        <Field label="Base de maintenance" className="col-span-2" hint="Base toujours accessible, utilisée pour lire les rôles et les bases du serveur.">
          {(id) => (
            <input id={id} required className="input" value={form.maintenanceDb} onChange={(e) => update("maintenanceDb", e.target.value)} />
          )}
        </Field>
        <div className="col-span-2">
          <span className="label">Chiffrement</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Chiffrement">
            {sslModes.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={form.ssl === m.value}
                onClick={() => update("ssl", m.value)}
                className={cx(
                  "rounded-[10px] border p-3 text-left transition-colors",
                  form.ssl === m.value ? "border-accent bg-accent-soft/60 shadow-[var(--ring)]" : "border-line-strong hover:bg-raised",
                )}
              >
                <m.icon size={16} className={form.ssl === m.value ? "text-accent" : "text-muted"} />
                <div className="mt-1.5 font-semibold">{m.label}</div>
                <div className="mt-0.5 text-xs text-muted">{m.detail}</div>
              </button>
            ))}
          </div>
          {form.ssl === "disable" && !local ? (
            <Callout tone="warn" className="mt-3">
              Le mot de passe circulera en clair sur le réseau.
            </Callout>
          ) : null}
        </div>
        {form.ssl !== "disable" ? (
          <div className="col-span-2">
            <button type="button" className="flex items-center gap-1.5 font-semibold text-muted hover:text-fg" onClick={() => setAdvanced((v) => !v)}>
              <ChevronRight size={14} className={cx("transition-transform", advanced && "rotate-90")} />
              Certificats personnalisés
            </button>
            {advanced ? (
              <div className="mt-3 grid gap-3">
                <Field label="Autorité de certification (PEM)" hint="Pour vérifier un certificat auto-signé.">
                  {(id) => <textarea id={id} rows={3} className="input" value={form.ca} onChange={(e) => update("ca", e.target.value)} />}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Certificat client (PEM)">
                    {(id) => <textarea id={id} rows={3} className="input" value={form.cert} onChange={(e) => update("cert", e.target.value)} />}
                  </Field>
                  <Field label="Clé privée client (PEM)" hint="Stockée dans le coffre-fort.">
                    {(id) => (
                      <textarea
                        id={id}
                        rows={3}
                        className="input"
                        placeholder={profile ? "Laisser vide pour conserver" : ""}
                        value={form.privateKey || ""}
                        onChange={(e) => update("privateKey", e.target.value || undefined)}
                      />
                    )}
                  </Field>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="col-span-2 grid gap-3 empty:hidden">
          {tested ? (
            <Callout tone="ok" title="Connexion réussie">
              {tested}
            </Callout>
          ) : null}
          <ErrorCallout error={error} />
          {profile && ws.changes.some((c) => c.profileId === profile.id) ? (
            <Callout tone="warn">Enregistrer abandonne les modifications de droits en attente sur cette connexion.</Callout>
          ) : null}
          {!isDesktop() ? <Callout tone="info">Mode démonstration : la connexion est simulée.</Callout> : null}
        </div>
      </form>
    </Dialog>
  );
}

export function Welcome() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-bg p-8">
      <div className="w-full max-w-[540px] text-center">
        <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-accent text-white shadow-[0_12px_32px_-8px_var(--accent)]">
          <Database size={26} />
        </div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">Qui a accès à vos bases ?</h1>
        <p className="mx-auto mt-3 max-w-[420px] text-[14px] text-muted">
          Roma DB affiche les droits PostgreSQL en une grille lisible, vous laisse les modifier en quelques clics et édite la structure de vos schémas.
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <Button variant="primary" size="lg" icon={<Plus size={17} />} onClick={() => ws.ui.openConnection("new")}>
            Ajouter une connexion
          </Button>
          {isDesktop() && import.meta.env.DEV ? (
            <Button
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const p = await call("devProfile", undefined);
                  if (!p) {
                    toast({ tone: "info", title: "Aucune base devdb trouvée", description: "Lancez devdb create --pg puis devdb env --write." });
                    return;
                  }
                  const saved = await call("saveProfile", p);
                  await qc.invalidateQueries({ queryKey: ["profiles"] });
                  ws.selectProfile(saved.id);
                } catch (e) {
                  toast({ tone: "error", title: "Connexion devdb impossible", description: String((e as Error).message) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Utiliser la base devdb
            </Button>
          ) : null}
        </div>
        <div className="mt-12 grid grid-cols-3 gap-3 text-left">
          {[
            { icon: Eye, title: "Tout voir", text: "Rôles × ressources, droits directs, hérités et PUBLIC." },
            { icon: Workflow, title: "Modifier sans risque", text: "Chaque changement est relu en SQL puis appliqué en une transaction." },
            { icon: KeyRound, title: "Identifiants protégés", text: "Mots de passe et clés dans le coffre-fort Windows." },
          ].map((f) => (
            <div key={f.title} className="card p-4">
              <f.icon size={17} className="text-accent" />
              <div className="mt-2 font-semibold">{f.title}</div>
              <div className="mt-1 text-xs text-muted">{f.text}</div>
            </div>
          ))}
        </div>
        <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-faint">
          <Lock size={12} /> Tout reste sur ce poste : aucun service en ligne.
        </p>
      </div>
    </div>
  );
}
