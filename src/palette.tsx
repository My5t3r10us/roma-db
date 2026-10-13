import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CornerDownLeft,
  Layers,
  Moon,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Table2,
  Users,
} from "lucide-react";
import type { Resource } from "../shared/types";
import { resourceKey } from "./permissions";
import { KindIcon, RoleAvatar, cx } from "./ui";
import { useWorkspace } from "./workspace";

interface Item {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}
function score(text: string, query: string) {
  const t = text.toLowerCase();
  if (!query) return 1;
  if (t.startsWith(query)) return 3;
  if (t.includes(query)) return 2;
  let i = 0;
  for (const c of t) if (c === query[i]) i++;
  return i === query.length ? 1 : 0;
}

export function CommandPalette() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => ws.ui.openPalette(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      { id: "p:access", group: "Aller à", label: "Accès", detail: "Grille des droits", icon: <ShieldCheck size={15} />, run: () => ws.go("access") },
      { id: "p:roles", group: "Aller à", label: "Rôles", icon: <Users size={15} />, run: () => ws.go("roles") },
      { id: "p:schemas", group: "Aller à", label: "Schémas", detail: "Structure des tables", icon: <Layers size={15} />, run: () => ws.go("schemas") },
      { id: "p:defaults", group: "Aller à", label: "Droits par défaut", icon: <CalendarClock size={15} />, run: () => ws.go("defaults") },
    ];
    if (ws.pendingCount)
      list.push({ id: "a:review", group: "Actions", label: "Vérifier les modifications", detail: `${ws.pendingCount} en attente`, icon: <CornerDownLeft size={15} />, run: () => ws.ui.openReview() });
    list.push(
      { id: "a:role", group: "Actions", label: "Nouveau rôle", icon: <Plus size={15} />, keywords: "créer utilisateur groupe compte", run: () => ws.go("roles") },
      { id: "a:conn", group: "Actions", label: "Nouvelle connexion", icon: <Plug size={15} />, keywords: "serveur ajouter", run: () => ws.ui.openConnection("new") },
      { id: "a:refresh", group: "Actions", label: "Actualiser", icon: <RefreshCw size={15} />, keywords: "recharger", run: () => void ws.refresh() },
      {
        id: "a:theme",
        group: "Actions",
        label: document.documentElement.dataset.theme === "dark" ? "Thème clair" : "Thème sombre",
        icon: document.documentElement.dataset.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />,
        keywords: "apparence couleur",
        run: () => ws.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
      },
    );
    for (const r of ws.roles.filter((r) => !r.name.startsWith("pg_")))
      list.push({
        id: "r:" + r.name,
        group: "Rôles",
        label: r.name,
        detail: r.login ? "Compte" : "Groupe",
        icon: <RoleAvatar name={r.name} group={!r.login} size={18} />,
        run: () => {
          ws.setSelectedRole(r.name);
          ws.go("roles");
        },
      });
    for (const d of ws.overview?.databases || [])
      list.push({
        id: "d:" + d.name,
        group: "Bases",
        label: d.name,
        detail: d.name === ws.database ? "Base actuelle" : "Changer de base",
        icon: <KindIcon kind="database" size={15} />,
        run: () => ws.selectDatabase(d.name),
      });
    const seen = new Set<string>();
    for (const [key, data] of qc.getQueriesData<Resource[]>({ queryKey: ["resources", ws.profileId, ws.database] })) {
      for (const o of data || []) {
        const id = `${o.kind}:${o.oid}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (o.kind === "schema")
          list.push({
            id: "s:" + id,
            group: "Schémas",
            label: o.name,
            icon: <Layers size={15} className="text-accent" />,
            run: () => {
              ws.setSchemaView({ schema: o.name });
              ws.go("schemas");
            },
          });
        else if (key[3])
          list.push({
            id: "o:" + id,
            group: "Objets",
            label: o.name,
            detail: o.schema,
            icon: <KindIcon kind={o.kind} size={15} />,
            keywords: o.schema,
            run: () => {
              ws.setSchemaView({ schema: o.schema, object: resourceKey(o) });
              ws.go("schemas");
            },
          });
      }
    }
    for (const p of ws.profiles)
      if (p.id !== ws.profileId)
        list.push({
          id: "c:" + p.id,
          group: "Connexions",
          label: p.name,
          detail: `${p.host}:${p.port}`,
          icon: <span className="size-3 rounded-full" style={{ background: p.color }} />,
          run: () => ws.selectProfile(p.id),
        });
    return list;
  }, [ws, qc]);
  const q = query.trim().toLowerCase();
  const results = items
    .map((i) => ({ i, s: Math.max(score(i.label, q), q ? score(i.keywords || "", q) * 0.5 + score(i.detail || "", q) * 0.4 : 0) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => (q ? b.s - a.s : 0))
    .slice(0, 40)
    .map((r) => r.i);
  const groups: [string, Item[]][] = [];
  for (const r of results) {
    const g = groups.find((x) => x[0] === r.group);
    if (g) g[1].push(r);
    else groups.push([r.group, [r]]);
  }
  const flat = groups.flatMap((g) => g[1]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const run = (item?: Item) => {
    if (!item) return;
    close();
    item.run();
  };
  return (
    <dialog
      ref={ref}
      className="dialog !mt-[12vh] !w-[min(600px,calc(100vw-48px))] self-start"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      aria-label="Palette de commandes"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={17} className="text-faint" />
        <input
          autoFocus
          className="h-[52px] flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          placeholder="Rechercher un rôle, une table, une action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(flat[active]);
            }
          }}
        />
        <kbd className="kbd">Échap</kbd>
      </div>
      <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
        {groups.map(([group, list]) => (
          <div key={group} className="mb-1">
            <div className="menu-label">{group}</div>
            {list.map((item) => {
              const index = flat.indexOf(item);
              return (
                <button
                  key={item.id}
                  className={cx("menu-item !min-h-9")}
                  data-active={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(item)}
                >
                  <span className="grid w-5 place-items-center text-muted">{item.icon}</span>
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  {item.detail ? <span className="text-xs text-faint">{item.detail}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length ? (
          <p className="py-10 text-center text-muted">
            <Table2 size={18} className="mx-auto mb-2 text-faint" />
            Aucun résultat pour « {query} »
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
