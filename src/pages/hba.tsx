import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileLock2,
  Hash,
  ListTree,
  Lock,
  Plus,
  RefreshCw,
  Text,
  Trash2,
  Undo2,
} from "lucide-react";
import type { HbaFile } from "../../shared/types";
import {
  diffLines,
  entryText,
  parseHba,
  serializeHba,
  shadowedBy,
  suggestions,
  validateRule,
  type CompletionContext,
  type HbaEntry,
  type HbaField,
  type HbaRule,
  type Suggestion,
} from "../../shared/hba";
import { call } from "../api";
import { Dialog, Menu, Popover, usePopover } from "../overlay";
import { useToast } from "../toast";
import { Badge, Button, Callout, Empty, ErrorCallout, IconButton, Segmented, Skeleton, Switch, cx, errorMessage, plural } from "../ui";
import { useWorkspace } from "../workspace";

// Drafts survive page switches, per connection and per file version.
const drafts = new Map<string, { fingerprint: string; entries: HbaEntry[] }>();
type Rule = Extract<HbaEntry, { kind: "rule" }>;
const ruleFields: { field: HbaField; label: string; placeholder: string; separator?: "," | " " }[] = [
  { field: "type", label: "Type", placeholder: "host" },
  { field: "database", label: "Base", placeholder: "all", separator: "," },
  { field: "user", label: "Utilisateur", placeholder: "all", separator: "," },
  { field: "address", label: "Adresse", placeholder: "0.0.0.0/0" },
  { field: "method", label: "Méthode", placeholder: "scram-sha-256" },
  { field: "options", label: "Options", placeholder: "aucune", separator: " " },
];
const grid = "grid grid-cols-[34px_112px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)_138px_minmax(0,1.15fr)_96px] items-center gap-1";
const normalize = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");

export function HbaPage() {
  const ws = useWorkspace();
  const file = useQuery({
    queryKey: ["hba", ws.profileId],
    queryFn: () => call("hba", { profileId: ws.profileId }),
    enabled: Boolean(ws.profileId),
  });
  if (file.isPending)
    return (
      <div className="mx-auto grid max-w-[1180px] gap-4 px-10 py-8">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="mt-4 h-[360px]" />
      </div>
    );
  if (file.error)
    return (
      <Empty
        icon={<Lock size={20} />}
        title="pg_hba.conf inaccessible"
        className="h-full"
        action={
          <Button icon={<RefreshCw size={15} />} loading={file.isFetching} onClick={() => void file.refetch()}>
            Réessayer
          </Button>
        }
      >
        <span className="block max-w-lg select-text">{errorMessage(file.error)}</span>
      </Empty>
    );
  return <HbaEditor key={ws.profileId + file.data.fingerprint} file={file.data} refetching={file.isFetching} refetch={() => void file.refetch()} />;
}

function HbaEditor({ file, refetching, refetch }: { file: HbaFile; refetching: boolean; refetch: () => void }) {
  const ws = useWorkspace();
  const draftKey = ws.profileId;
  const [entries, setEntriesState] = useState<HbaEntry[]>(() => {
    const draft = drafts.get(draftKey);
    return draft?.fingerprint === file.fingerprint ? draft.entries : parseHba(file.content);
  });
  const [view, setView] = useState<"rules" | "text">("rules");
  const [text, setText] = useState("");
  const [comments, setComments] = useState(false);
  const [review, setReview] = useState(false);
  const [focus, setFocus] = useState<string>();
  const add = usePopover();
  const readOnly = !file.writable;
  const newline = file.content.includes("\r\n") ? "\r\n" : "\n";
  const original = useMemo(() => file.content.replace(/\r\n?/g, "\n").split("\n"), [file.content]);
  const setEntries = (next: HbaEntry[]) => {
    setEntriesState(next);
    drafts.set(draftKey, { fingerprint: file.fingerprint, entries: next });
  };
  const content = serializeHba(entries, newline);
  const changed = useMemo(() => diffLines(file.content, content).filter((d) => d.kind !== "same").length, [file.content, content]);
  const dirty = normalize(content) !== normalize(file.content);
  const ctx: CompletionContext = {
    databases: ws.overview?.databases.map((d) => d.name) || [],
    roles: ws.roles.filter((r) => !r.name.startsWith("pg_")),
    identMaps: file.identMaps,
    clientAddress: file.clientAddress,
  };
  const problems = entries.flatMap((e, i) =>
    e.kind === "rule" ? Object.values(validateRule(e, ws.version)).map((message) => ({ index: i, message })) : [],
  );
  // Line numbers in the file as it will be written.
  const lineOf = useMemo(() => {
    const lines: number[] = [];
    let n = 1;
    for (const e of entries) {
      lines.push(n);
      n += entryText(e).split("\n").length;
    }
    return lines;
  }, [entries]);
  const visible = (e: HbaEntry) => e.kind === "rule" || e.kind === "include" || (comments && e.kind === "comment");
  const update = (id: string, patch: Partial<Rule> | { raw: string } | { path: string }) =>
    setEntries(
      entries.map((e) => {
        if (e.id !== id) return e;
        // A comment line is edited through its raw text, everything else is re-formatted.
        if (e.kind === "comment") return { ...e, ...patch } as HbaEntry;
        return { ...e, ...patch, edited: true } as HbaEntry;
      }),
    );
  const move = (index: number, dir: -1 | 1) => {
    let j = index + dir;
    while (j >= 0 && j < entries.length && !visible(entries[j])) j += dir;
    if (j < 0 || j >= entries.length) return;
    const next = [...entries];
    [next[index], next[j]] = [next[j], next[index]];
    setEntries(next);
  };
  const insert = (entry: HbaEntry, at = entries.length) => {
    const next = [...entries];
    next.splice(at, 0, entry);
    setEntries(next);
    setFocus(entry.id);
  };
  const newRule = (patch: Partial<HbaRule>): HbaEntry => ({
    id: crypto.randomUUID(),
    raw: "",
    line: 0,
    edited: true,
    kind: "rule",
    type: "host",
    database: "all",
    user: "all",
    address: "0.0.0.0/0",
    method: "scram-sha-256",
    options: "",
    comment: "",
    ...patch,
  });
  const mine = file.clientAddress ? `${file.clientAddress}/${file.clientAddress.includes(":") ? 128 : 32}` : "samenet";
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-10 py-8 pb-10">
          <header className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-[22px] font-bold tracking-tight">Authentification</h1>
              <p className="mt-1 truncate text-[13px] text-muted" data-tip={file.path}>
                Qui peut se connecter, d’où et comment · <code className="font-mono text-[12px] select-text">{file.path}</code>
              </p>
            </div>
            <Segmented
              label="Affichage"
              value={view}
              onChange={(v) => {
                if (v === "text") setText(content.replace(/\r\n/g, "\n"));
                setView(v);
              }}
              options={[
                { value: "rules", label: "Règles", icon: <ListTree size={14} /> },
                { value: "text", label: "Texte", icon: <Text size={14} /> },
              ]}
            />
            <IconButton label="Relire le fichier" onClick={refetch} disabled={refetching}>
              <RefreshCw size={15} className={refetching ? "animate-spin" : undefined} />
            </IconButton>
            {view === "rules" ? (
              <Button variant="primary" icon={<Plus size={15} />} onClick={add.open} disabled={readOnly}>
                Ajouter
              </Button>
            ) : null}
            {add.anchor ? (
              <Menu
                anchor={add.anchor}
                onClose={add.close}
                placement="bottom-end"
                width={300}
                items={[
                  { section: "Nouvelle règle" },
                  { label: "Depuis votre adresse", hint: mine, icon: <Plus size={14} />, onSelect: () => insert(newRule({ address: mine })) },
                  { label: "Réseau, SSL obligatoire", hint: "hostssl", icon: <Lock size={14} />, onSelect: () => insert(newRule({ type: "hostssl" })) },
                  {
                    label: `Base ${ws.database} uniquement`,
                    hint: "samenet",
                    icon: <Plus size={14} />,
                    onSelect: () => insert(newRule({ database: ws.database || "all", address: "samenet" })),
                  },
                  { label: "Socket local", hint: "local", icon: <Plus size={14} />, onSelect: () => insert(newRule({ type: "local", address: "", method: "peer" })) },
                  { label: "Tout refuser", hint: "reject", icon: <Plus size={14} />, onSelect: () => insert(newRule({ address: "all", method: "reject" })) },
                  "separator",
                  {
                    label: "Commentaire",
                    icon: <Hash size={14} />,
                    onSelect: () => {
                      setComments(true);
                      insert({ id: crypto.randomUUID(), raw: "# ", line: 0, kind: "comment" });
                    },
                  },
                ]}
              />
            ) : null}
          </header>
          {file.readOnlyReason ? (
            <Callout tone="warn" className="mt-5" title="Lecture seule">
              {file.readOnlyReason}
            </Callout>
          ) : null}
          {file.errors.length ? (
            <Callout tone="danger" className="mt-5" title="PostgreSQL signale des erreurs dans ce fichier">
              {file.errors.map((e) => (
                <div key={e.line + e.message}>
                  Ligne {e.line} : {e.message}
                </div>
              ))}
            </Callout>
          ) : null}
          {view === "text" ? (
            <div className="mt-6">
              <textarea
                className="input !h-[62vh] !text-[12.5px] !leading-relaxed"
                spellCheck={false}
                value={text}
                readOnly={readOnly}
                aria-label="Contenu de pg_hba.conf"
                onChange={(e) => {
                  setText(e.target.value);
                  setEntries(parseHba(e.target.value));
                }}
              />
              {problems.length ? (
                <Callout tone="danger" className="mt-3">
                  {problems.slice(0, 8).map((p) => (
                    <div key={p.index + p.message}>
                      Ligne {lineOf[p.index]} : {p.message}
                    </div>
                  ))}
                </Callout>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mt-6 flex items-center gap-3 text-[12.5px] text-muted">
                <span className="flex-1">
                  Lues de haut en bas : la première règle qui correspond au type de connexion, à la base, à l’utilisateur et à l’adresse décide. Sans
                  règle, la connexion est refusée.
                </span>
                <label className="flex flex-none items-center gap-2">
                  <Switch label="Afficher les commentaires" checked={comments} onChange={setComments} />
                  Commentaires
                </label>
              </div>
              <div className="card mt-3">
                <div className={cx(grid, "border-b border-line px-2 py-2 text-[11.5px] font-semibold text-faint")}>
                  <span className="text-right">#</span>
                  {ruleFields.map((f) => (
                    <span key={f.field} className="px-2">
                      {f.label}
                    </span>
                  ))}
                  <span />
                </div>
                {entries.map((entry, index) => {
                  if (!visible(entry)) return null;
                  const actions = (
                    <span className="flex justify-end opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                      <IconButton label="Monter" small disabled={readOnly} onClick={() => move(index, -1)}>
                        <ArrowUp size={14} />
                      </IconButton>
                      <IconButton label="Descendre" small disabled={readOnly} onClick={() => move(index, 1)}>
                        <ArrowDown size={14} />
                      </IconButton>
                      {entry.kind === "rule" ? (
                        <IconButton
                          label="Dupliquer"
                          small
                          disabled={readOnly}
                          onClick={() => insert({ ...entry, id: crypto.randomUUID(), line: 0, edited: true }, index + 1)}
                        >
                          <Copy size={13} />
                        </IconButton>
                      ) : null}
                      <IconButton label="Supprimer" small disabled={readOnly} onClick={() => setEntries(entries.filter((e) => e.id !== entry.id))}>
                        <Trash2 size={13} />
                      </IconButton>
                    </span>
                  );
                  const number = <span className="text-right font-mono text-[11px] text-faint tabular-nums">{lineOf[index]}</span>;
                  const row = "group border-b border-line px-2 py-1 last:border-0 hover:bg-sunken";
                  if (entry.kind === "comment")
                    return (
                      <div key={entry.id} className={cx(grid, row)}>
                        {number}
                        <input
                          className="input-bare col-span-6 font-mono text-[12px] text-muted italic"
                          value={entry.raw}
                          disabled={readOnly}
                          aria-label="Commentaire"
                          autoFocus={focus === entry.id}
                          onChange={(e) => update(entry.id, { raw: e.target.value.replace(/^(?!\s*#)/, "# ") })}
                        />
                        {actions}
                      </div>
                    );
                  if (entry.kind === "include")
                    return (
                      <div key={entry.id} className={cx(grid, row)}>
                        {number}
                        <span className="px-2 font-mono text-[12px] font-semibold text-info">{entry.directive}</span>
                        <input
                          className="input-bare col-span-5 font-mono text-[12px]"
                          value={entry.path}
                          disabled={readOnly}
                          aria-label="Fichier inclus"
                          onChange={(e) => update(entry.id, { path: e.target.value })}
                        />
                        {actions}
                      </div>
                    );
                  if (entry.kind !== "rule") return null;
                  const issues = validateRule(entry, ws.version);
                  // PostgreSQL numbers lines of the file on disk: only an untouched line still matches.
                  const serverError =
                    !entry.edited && original[entry.line - 1] === entry.raw.split("\n")[0]
                      ? file.errors.find((e) => e.line === entry.line)
                      : undefined;
                  const shadow = shadowedBy(entries, index);
                  const state = entry.line === 0 ? "new" : entry.edited ? "changed" : "";
                  return (
                    <div key={entry.id} className={cx(grid, row, serverError && "bg-danger-soft")} data-tip={serverError?.message}>
                      <span className="flex items-center justify-end gap-1.5">
                        <span
                          className={cx("h-5 w-1 rounded-full", state === "new" && "bg-ok", state === "changed" && "bg-[var(--pending)]")}
                          data-tip={state === "new" ? "Nouvelle règle" : state === "changed" ? "Règle modifiée" : undefined}
                        />
                        <span className="font-mono text-[11px] text-faint tabular-nums">{lineOf[index]}</span>
                      </span>
                      {ruleFields.map((f) =>
                        f.field === "address" && entry.type === "local" ? (
                          <span key={f.field} className="px-2 text-[12px] text-faint">
                            socket
                          </span>
                        ) : (
                          <TokenInput
                            key={f.field}
                            label={f.label}
                            value={entry[f.field]}
                            placeholder={f.field === "options" ? f.placeholder : undefined}
                            separator={f.separator}
                            invalid={issues[f.field]}
                            disabled={readOnly}
                            autoFocus={focus === entry.id && f.field === "type"}
                            className={cx(
                              f.field === "method" && entry.method === "trust" && entry.type !== "local" && "text-warn",
                              f.field === "method" && entry.method === "reject" && "text-danger",
                              (f.field === "type" || f.field === "method") && "font-semibold",
                            )}
                            suggest={(token) => suggestions(f.field, entry, token, ctx)}
                            onChange={(value) => update(entry.id, { [f.field]: value })}
                          />
                        ),
                      )}
                      <span className="flex items-center justify-end">
                        {shadow ? (
                          <span className="group-hover:hidden group-focus-within:hidden">
                            <Badge tone="warn" tip={`Jamais atteinte : la ligne ${lineOf[entries.indexOf(shadow)]} correspond avant elle`}>
                              masquée
                            </Badge>
                          </span>
                        ) : null}
                        <span className={cx(shadow && "hidden group-hover:flex group-focus-within:flex")}>{actions}</span>
                      </span>
                    </div>
                  );
                })}
                {!entries.some((e) => e.kind === "rule") ? (
                  <Empty icon={<FileLock2 size={20} />} title="Aucune règle">
                    Toute connexion sera refusée.
                  </Empty>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      {dirty ? (
        <div className="flex flex-none items-center gap-3 border-t border-line bg-surface px-6 py-3">
          <span className="size-2 rounded-full bg-[var(--pending)]" />
          <span className="font-medium">{plural(changed, "ligne modifiée", "lignes modifiées")}</span>
          {problems.length ? <Badge tone="danger">{plural(problems.length, "erreur")}</Badge> : null}
          <div className="flex-1" />
          <Button
            variant="ghost"
            icon={<Undo2 size={15} />}
            onClick={() => {
              drafts.delete(draftKey);
              setEntriesState(parseHba(file.content));
              setText(file.content.replace(/\r\n/g, "\n"));
            }}
          >
            Tout annuler
          </Button>
          <Button variant="primary" icon={<Check size={15} />} disabled={readOnly || problems.length > 0} onClick={() => setReview(true)}>
            Vérifier et appliquer
          </Button>
        </div>
      ) : null}
      {review ? (
        <ReviewDialog
          file={file}
          content={content}
          entries={entries}
          onClose={() => setReview(false)}
          onApplied={() => drafts.delete(draftKey)}
        />
      ) : null}
    </div>
  );
}

function ReviewDialog({
  file,
  content,
  entries,
  onClose,
  onApplied,
}: {
  file: HbaFile;
  content: string;
  entries: HbaEntry[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const apply = useMutation({
    mutationFn: () => call("hbaApply", { profileId: ws.profileId, content, fingerprint: file.fingerprint }),
    onSuccess: (next) => {
      onApplied();
      qc.setQueryData(["hba", ws.profileId], next);
      toast({ title: "pg_hba.conf enregistré et rechargé", description: next.backup ? `Ancienne version : ${next.backup}` : undefined });
      onClose();
    },
  });
  const diff = diffLines(file.content, content);
  // Unchanged lines farther than 2 lines from a change are folded.
  const near = diff.map((_, i) => diff.slice(Math.max(0, i - 2), i + 3).some((d) => d.kind !== "same"));
  const rules = entries.filter((e): e is Rule => e.kind === "rule");
  const trust = rules.filter((r) => r.method === "trust" && r.type !== "local");
  const shadowed = entries.filter((e, i) => e.kind === "rule" && shadowedBy(entries, i)).length;
  return (
    <Dialog
      title="Appliquer pg_hba.conf"
      description="Le fichier est écrit sur le serveur, vérifié par PostgreSQL, puis rechargé."
      icon={<FileLock2 size={16} />}
      onClose={onClose}
      busy={apply.isPending}
      wide
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>
            Annuler
          </Button>
          <Button variant="primary" icon={<Check size={15} />} loading={apply.isPending} onClick={() => apply.mutate()}>
            Écrire et recharger
          </Button>
        </>
      }
    >
      <div className="grid gap-2.5">
        {trust.length ? (
          <Callout tone="warn">
            {plural(trust.length, "règle réseau")} en <b>trust</b> : connexion sans mot de passe pour {trust.map((r) => r.address).join(", ")}.
          </Callout>
        ) : null}
        {shadowed ? <Callout tone="warn">{plural(shadowed, "règle n’est jamais atteinte", "règles ne sont jamais atteintes")} : une règle plus haut correspond avant.</Callout> : null}
        {!rules.some((r) => r.method !== "reject") ? <Callout tone="danger">Aucune règle n’autorise de connexion.</Callout> : null}
        <div className="sql max-h-[46vh] overflow-auto !p-0 font-mono text-[12px]">
          {diff.map((d, i) =>
            near[i] ? (
              <div
                key={i}
                className={cx(
                  "px-3 whitespace-pre",
                  d.kind === "add" && "bg-ok-soft text-ok",
                  d.kind === "del" && "bg-danger-soft text-danger line-through decoration-1",
                  d.kind === "same" && "text-muted",
                )}
              >
                {d.kind === "add" ? "+ " : d.kind === "del" ? "− " : "  "}
                {d.text || " "}
              </div>
            ) : i > 0 && near[i - 1] ? (
              <div key={i} className="px-3 text-faint">
                ⋯
              </div>
            ) : null,
          )}
        </div>
        <p className="m-0 text-[12px] text-muted">
          Une copie de l’ancien fichier est gardée à côté (<code className="font-mono">.roma-backup</code>). Si PostgreSQL refuse le fichier, ou si Roma DB
          ne peut plus se connecter avec les nouvelles règles, l’ancien fichier est restauré automatiquement. Les sessions déjà ouvertes ne sont pas
          coupées.
        </p>
        <ErrorCallout error={apply.error} />
      </div>
    </Dialog>
  );
}

/** Text input with completion of the token under the caret (comma or space separated lists). */
function TokenInput({
  value,
  onChange,
  suggest,
  separator,
  invalid,
  label,
  placeholder,
  disabled,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  suggest: (token: string) => Suggestion[];
  separator?: "," | " ";
  invalid?: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [typed, setTyped] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const start = separator ? value.lastIndexOf(separator, caret - 1) + 1 : 0;
  const after = separator ? value.indexOf(separator, caret) : -1;
  const end = after < 0 ? value.length : after;
  const token = value.slice(start, caret);
  const items = anchor ? suggest(typed ? token : "").slice(0, 50) : [];
  useEffect(() => setActive(0), [token, typed]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const sync = () => setCaret(ref.current?.selectionStart ?? value.length);
  const accept = (s: Suggestion) => {
    // Without typing, a single-value field is replaced; a list gets the token under the caret replaced.
    const from = typed || separator ? start : 0;
    const to = typed || separator ? end : value.length;
    const next = value.slice(0, from) + s.value + value.slice(to);
    const pos = from + s.value.length;
    onChange(next);
    setCaret(pos);
    setTyped(Boolean(s.partial));
    if (!s.partial) setAnchor(null);
    requestAnimationFrame(() => ref.current?.setSelectionRange(pos, pos));
  };
  return (
    <>
      <input
        ref={ref}
        className={cx("input-bare font-mono text-[12px]", invalid && "!border-danger", className)}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={Boolean(invalid)}
        aria-autocomplete="list"
        aria-expanded={items.length > 0}
        data-tip={invalid}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
        onFocus={(e) => {
          setAnchor(e.currentTarget);
          setTyped(false);
          setCaret(e.currentTarget.selectionStart ?? value.length);
        }}
        onBlur={() => setAnchor(null)}
        onClick={(e) => {
          setAnchor(e.currentTarget);
          sync();
        }}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) sync();
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setTyped(true);
          setAnchor(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!anchor) return setAnchor(e.currentTarget);
            const n = items.length || 1;
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            accept(items[active]);
          } else if (e.key === "Tab" && typed && items[active] && !e.shiftKey) {
            if (items[active].partial) e.preventDefault();
            accept(items[active]);
          } else if (e.key === "Escape" && anchor) {
            e.preventDefault();
            e.stopPropagation();
            setAnchor(null);
          }
        }}
      />
      {anchor && items.length ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(280, anchor.offsetWidth)} label={`Suggestions : ${label}`}>
          <div ref={listRef} role="listbox" className="max-h-[288px] overflow-y-auto p-1.5">
            {items.map((s, i) => (
              <button
                key={s.value}
                type="button"
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                tabIndex={-1}
                className="menu-item !min-h-[30px]"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => accept(s)}
              >
                <span className="min-w-0 truncate font-mono text-[12px] font-semibold">{s.value}</span>
                {s.detail ? <span className="ml-auto truncate pl-3 text-[11.5px] text-faint">{s.detail}</span> : null}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
