import { useEffect } from "react";
import {
  CalendarClock,
  FileDown,
  ChevronDown,
  ChevronsUpDown,
  Laptop,
  Layers,
  Moon,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Unplug,
  Users,
} from "lucide-react";
import { isDesktop } from "./api";
import { ConnectionDialog, Welcome } from "./connection";
import { useAuditExport } from "./audit";
import { Menu, usePopover } from "./overlay";
import { CommandPalette } from "./palette";
import { ChangesBar, ReviewSheet } from "./review";
import { AccessPage } from "./pages/access";
import { DefaultsPage } from "./pages/defaults";
import { RolesPage } from "./pages/roles";
import { SchemasPage } from "./pages/schemas";
import { SchemaContentDialog } from "./pages/schema-content";
import { Badge, Button, Empty, ErrorCallout, IconButton, Kbd, KindIcon, Skeleton, Spinner, TooltipHost, cx } from "./ui";
import { useWorkspace, type Page } from "./workspace";

const pages: { id: Page; label: string; icon: typeof ShieldCheck; hint: string }[] = [
  { id: "access", label: "Accès", icon: ShieldCheck, hint: "Qui peut faire quoi" },
  { id: "roles", label: "Rôles", icon: Users, hint: "Comptes et groupes" },
  { id: "schemas", label: "Schémas", icon: Layers, hint: "Tables et colonnes" },
  { id: "defaults", label: "Droits par défaut", icon: CalendarClock, hint: "Futurs objets" },
];

export default function App() {
  const ws = useWorkspace();
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ws.ui.openPalette(!ws.ui.palette);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && ws.pendingCount) {
        e.preventDefault();
        ws.ui.openReview();
      } else if (e.altKey && /^[1-4]$/.test(e.key) && ws.profile) {
        e.preventDefault();
        ws.go(pages[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [ws]);
  const noProfile = !ws.profilesLoading && !ws.profiles.length;
  return (
    <div className="flex h-full">
      {noProfile ? (
        <main className="flex-1">
          <ErrorCallout error={ws.profilesError} className="m-4" />
          <Welcome />
        </main>
      ) : (
        <>
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col bg-bg">
            <Topbar />
            <main className="min-h-0 flex-1">
              <Content />
            </main>
          </div>
          <ChangesBar />
        </>
      )}
      {ws.ui.connection ? (
        <ConnectionDialog key={ws.ui.connection === "new" ? "new" : ws.ui.connection.id} profile={ws.ui.connection === "new" ? undefined : ws.ui.connection} />
      ) : null}
      {ws.ui.review ? <ReviewSheet /> : null}
      {ws.ui.palette ? <CommandPalette /> : null}
      {ws.ui.schemaContent ? <SchemaContentDialog key={ws.ui.schemaContent.schema + ws.ui.schemaContent.role} {...ws.ui.schemaContent} /> : null}
      <TooltipHost />
    </div>
  );
}

function Content() {
  const ws = useWorkspace();
  const q = ws.overviewQuery;
  if (ws.profilesLoading || (q.isPending && ws.profileId))
    return (
      <div className="grid gap-4 p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="mt-4 h-[360px]" />
      </div>
    );
  if (q.isError)
    return (
      <Empty
        icon={<Unplug size={20} />}
        title="Connexion impossible"
        className="h-full"
        action={
          <div className="flex gap-2">
            <Button icon={<RefreshCw size={15} />} loading={q.isFetching} onClick={() => void q.refetch()}>
              Réessayer
            </Button>
            <Button variant="primary" icon={<Pencil size={15} />} onClick={() => ws.ui.openConnection(ws.profile)}>
              Modifier la connexion
            </Button>
          </div>
        }
      >
        <span className="block max-w-lg select-text">{(q.error as Error).message}</span>
      </Empty>
    );
  if (ws.page === "roles") return <RolesPage />;
  if (ws.page === "schemas") return <SchemasPage />;
  if (ws.page === "defaults") return <DefaultsPage />;
  return <AccessPage />;
}

function Sidebar() {
  const ws = useWorkspace();
  const conn = usePopover();
  const theme = usePopover();
  const server = ws.overview?.server;
  const p = ws.profile;
  return (
    <aside className="flex w-[220px] flex-none flex-col border-r border-line bg-panel">
      <div className="p-2.5">
        <button className="flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-raised" onClick={conn.open} aria-haspopup="menu">
          <span className="grid size-8 flex-none place-items-center rounded-[9px] text-[13px] font-bold text-white" style={{ background: p?.color || "var(--accent)" }}>
            {(p?.name || "R").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{p?.name || "Roma DB"}</span>
            <span className="block truncate text-[11.5px] text-muted">{p ? `${p.host}:${p.port}` : "…"}</span>
          </span>
          <ChevronsUpDown size={14} className="flex-none text-faint" />
        </button>
        {conn.anchor ? (
          <Menu
            anchor={conn.anchor}
            onClose={conn.close}
            width={260}
            items={[
              { section: "Connexions" },
              ...ws.profiles.map((x) => ({
                label: x.name,
                icon: <span className="size-2.5 rounded-full" style={{ background: x.color }} />,
                hint: x.host,
                checked: x.id === ws.profileId,
                onSelect: () => ws.selectProfile(x.id),
              })),
              "separator",
              { label: "Modifier cette connexion", icon: <Pencil size={14} />, disabled: !p, onSelect: () => ws.ui.openConnection(p) },
              { label: "Nouvelle connexion", icon: <Plus size={14} />, onSelect: () => ws.ui.openConnection("new") },
            ]}
          />
        ) : null}
      </div>
      <nav className="grid gap-0.5 px-2.5 pt-1" aria-label="Navigation">
        {pages.map((page, i) => (
          <button
            key={page.id}
            className="nav-item"
            aria-current={ws.page === page.id ? "page" : undefined}
            onClick={() => ws.go(page.id)}
            data-tip={`${page.hint} · Alt+${i + 1}`}
          >
            <page.icon size={16} />
            <span className="flex-1 text-left">{page.label}</span>
            {page.id === "roles" && ws.overview ? (
              <span className="text-[11px] text-faint tabular-nums">{ws.roles.filter((r) => !r.name.startsWith("pg_")).length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="grid gap-2 border-t border-line p-3">
        {server?.sharedDev ? (
          <div className="rounded-lg bg-warn-soft px-2.5 py-2 text-[11.5px] text-warn" data-tip="Création et suppression de bases réservées à devdb">
            Serveur de dev partagé
          </div>
        ) : null}
        <div className="flex items-center gap-2 px-1">
          <span className={cx("size-2 flex-none rounded-full", server ? "bg-ok" : ws.overviewQuery.isError ? "bg-danger" : "bg-faint")} />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted" data-tip={server ? `PostgreSQL ${server.versionLabel}\nConnecté en tant que ${server.currentUser}` : undefined}>
            {server ? `PostgreSQL ${server.versionLabel.split(" ")[0]} · ${server.currentUser}` : ws.overviewQuery.isError ? "Déconnecté" : "Connexion…"}
          </span>
          <IconButton label="Thème" small onClick={theme.open}>
            {ws.theme === "dark" ? <Moon size={14} /> : ws.theme === "light" ? <Sun size={14} /> : <Laptop size={14} />}
          </IconButton>
          {theme.anchor ? (
            <Menu
              anchor={theme.anchor}
              onClose={theme.close}
              width={180}
              items={[
                { label: "Système", icon: <Laptop size={14} />, checked: ws.theme === "system", onSelect: () => ws.setTheme("system") },
                { label: "Clair", icon: <Sun size={14} />, checked: ws.theme === "light", onSelect: () => ws.setTheme("light") },
                { label: "Sombre", icon: <Moon size={14} />, checked: ws.theme === "dark", onSelect: () => ws.setTheme("dark") },
              ]}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const ws = useWorkspace();
  const dbMenu = usePopover();
  const page = pages.find((p) => p.id === ws.page)!;
  const audit = useAuditExport();
  return (
    <header className="flex h-[52px] flex-none items-center gap-2 border-b border-line bg-surface px-4">
      <button
        className="btn btn-ghost !h-8 !px-2 !text-fg"
        onClick={dbMenu.open}
        disabled={!ws.overview}
        aria-haspopup="menu"
        data-tip="Base de données de travail"
      >
        <KindIcon kind="database" size={15} />
        <span className="font-semibold">{ws.database || "…"}</span>
        <ChevronDown size={13} className="text-faint" />
      </button>
      {dbMenu.anchor && ws.overview ? (
        <Menu
          anchor={dbMenu.anchor}
          onClose={dbMenu.close}
          width={250}
          items={[
            { section: `Bases de ${ws.profile?.name}` },
            ...ws.overview.databases.map((d) => ({
              label: d.name,
              icon: <KindIcon kind="database" size={14} />,
              hint: ws.changes.some((c) => c.database === d.name && c.profileId === ws.profileId) ? "modifs" : d.owner,
              checked: d.name === ws.database,
              onSelect: () => ws.selectDatabase(d.name),
            })),
          ]}
        />
      ) : null}
      <span className="text-faint">/</span>
      <span className="flex items-center gap-1.5 px-1 font-medium text-muted">
        <page.icon size={14} />
        {page.label}
      </span>
      <div className="flex-1" />
      {!isDesktop() ? (
        <Badge tone="warn" tip="Aperçu web : données fictives, rien n’est envoyé à un serveur">
          Démo
        </Badge>
      ) : null}
      <button
        className="flex h-8 w-[260px] items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 text-left text-muted hover:border-line-strong"
        onClick={() => ws.ui.openPalette()}
      >
        <Search size={14} />
        <span className="flex-1">Rechercher…</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>
      <IconButton label="Exporter l’audit (HTML)" onClick={() => void audit.run()} disabled={!ws.overview || audit.busy}>
        {audit.busy ? <Spinner /> : <FileDown size={15} />}
      </IconButton>
      <IconButton label="Actualiser" onClick={() => void ws.refresh()} disabled={!ws.overview}>
        {ws.overviewQuery.isFetching ? <Spinner /> : <RefreshCw size={15} />}
      </IconButton>
      {ws.overviewQuery.isError ? (
        <IconButton label="Modifier la connexion" onClick={() => ws.ui.openConnection(ws.profile)}>
          <Plug size={15} />
        </IconButton>
      ) : null}
    </header>
  );
}
