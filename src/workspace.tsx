import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Change,
  MatrixScope,
  Overview,
  Profile,
  Role,
  Theme,
} from "../shared/types";
import { call } from "./api";
import { mergeChanges } from "./permissions";
import { draftOps, type TableDraft } from "./structure";
import { useToast } from "./toast";

export type Page = "access" | "roles" | "schemas" | "defaults" | "hba";
export interface AccessView {
  scope: MatrixScope;
  schema: string;
  focusRole?: string;
}
export interface SchemaView {
  schema?: string;
  /** resourceKey of an existing object, or a draft key ("new:…"). */
  object?: string;
}
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("roma." + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem("roma." + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences are best effort */
  }
}

interface Workspace {
  profiles: Profile[];
  profilesLoading: boolean;
  profilesError: unknown;
  profile?: Profile;
  profileId: string;
  selectProfile: (id: string) => void;
  overview?: Overview;
  overviewQuery: ReturnType<typeof useOverview>;
  database: string;
  selectDatabase: (name: string) => void;
  version: number;
  roles: Role[];
  rolesByName: Map<string, Role>;
  page: Page;
  go: (page: Page) => void;
  access: AccessView;
  setAccess: (patch: Partial<AccessView>) => void;
  selectedRole?: string;
  setSelectedRole: (name?: string) => void;
  schemaView: SchemaView;
  setSchemaView: (view: SchemaView) => void;
  /** Permission changes for every connection/database. */
  changes: Change[];
  pending: Change[];
  addChanges: (additions: Change[], replace?: (c: Change) => boolean) => void;
  removeChanges: (predicate: (c: Change) => boolean) => void;
  drafts: Record<string, TableDraft>;
  pendingDrafts: TableDraft[];
  putDraft: (draft: TableDraft | null, key?: string) => void;
  pendingCount: number;
  refresh: () => Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  ui: {
    connection?: Profile | "new";
    openConnection: (profile?: Profile | "new") => void;
    review: boolean;
    openReview: (open?: boolean) => void;
    palette: boolean;
    openPalette: (open?: boolean) => void;
    schemaContent?: { schema: string; role: string };
    openSchemaContent: (target?: { schema: string; role: string }) => void;
  };
}
const Ctx = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(Ctx);
  if (!value) throw new Error("Workspace manquant.");
  return value;
}
function useOverview(id: string) {
  return useQuery({
    queryKey: ["overview", id],
    queryFn: () => call("overview", { profileId: id }),
    enabled: Boolean(id),
  });
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: () => call("profiles", undefined),
  });
  const profiles = profilesQuery.data || [];
  const [profileId, setProfileId] = useState<string>(() => read("profile", ""));
  const profile = profiles.find((p) => p.id === profileId) || profiles[0];
  const id = profile?.id || "";
  const overviewQuery = useOverview(id);
  const overview = overviewQuery.data;
  const [databases, setDatabases] = useState<Record<string, string>>(() =>
    read("databases", {}),
  );
  const database =
    (overview?.databases.some((d) => d.name === databases[id]) && databases[id]) ||
    overview?.databases.find((d) => d.name === profile?.maintenanceDb)?.name ||
    overview?.databases[0]?.name ||
    "";
  const [page, setPage] = useState<Page>(() => read("page", "access"));
  const [access, setAccessState] = useState<AccessView>(() => ({
    scope: "schemas",
    schema: "",
    ...read<Partial<AccessView>>("access", {}),
    focusRole: undefined,
  }));
  const [selectedRole, setSelectedRole] = useState<string>();
  const [schemaView, setSchemaView] = useState<SchemaView>({});
  const [changes, setChanges] = useState<Change[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({});
  const [theme, setThemeState] = useState<Theme>(() => read("theme", "system"));
  const [connection, setConnection] = useState<Profile | "new">();
  const [review, setReview] = useState(false);
  const [palette, setPalette] = useState(false);
  const [schemaContent, setSchemaContent] = useState<{ schema: string; role: string }>();

  useEffect(() => {
    void call("preference", {})
      .then((p) => setThemeState(p.theme))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    write("theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => write("page", page), [page]);
  useEffect(() => write("access", { scope: access.scope, schema: access.schema }), [access.scope, access.schema]);

  const pending = useMemo(
    () => changes.filter((c) => c.profileId === id && c.database === database),
    [changes, id, database],
  );
  const pendingDrafts = useMemo(
    () =>
      Object.values(drafts).filter(
        (d) => d.profileId === id && d.database === database,
      ),
    [drafts, id, database],
  );
  const pendingCount =
    pending.length + pendingDrafts.reduce((n, d) => n + safeOps(d).length, 0);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (changes.length || Object.keys(drafts).length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [changes.length, drafts]);

  const roles = overview?.roles || [];
  const rolesByName = useMemo(() => new Map(roles.map((r) => [r.name, r])), [roles]);
  const refresh = useCallback(async () => {
    await qc.invalidateQueries({
      predicate: (q) => !["preview", "ddlPreview", "crudPreview"].includes(String(q.queryKey[0])),
    });
  }, [qc]);

  const value: Workspace = {
    profiles,
    profilesLoading: profilesQuery.isPending,
    profilesError: profilesQuery.error,
    profile,
    profileId: id,
    selectProfile: (next) => {
      setProfileId(next);
      write("profile", next);
      setAccessState({ scope: "schemas", schema: "" });
      setSelectedRole(undefined);
      setSchemaView({});
    },
    overview,
    overviewQuery,
    database,
    selectDatabase: (name) => {
      const next = { ...databases, [id]: name };
      setDatabases(next);
      write("databases", next);
      setAccessState((a) => ({
        scope: a.scope === "databases" ? "databases" : "schemas",
        schema: "",
        focusRole: a.focusRole,
      }));
      setSchemaView({});
    },
    version: overview?.server.version || 140000,
    roles,
    rolesByName,
    page,
    go: setPage,
    access,
    setAccess: (patch) => setAccessState((a) => ({ ...a, ...patch })),
    selectedRole,
    setSelectedRole,
    schemaView,
    setSchemaView,
    changes,
    pending,
    addChanges: (additions, replace) => {
      setChanges((list) =>
        mergeChanges(replace ? list.filter((c) => !replace(c)) : list, additions),
      );
    },
    removeChanges: (predicate) => setChanges((list) => list.filter((c) => !predicate(c))),
    drafts,
    pendingDrafts,
    putDraft: (draft, key) =>
      setDrafts((all) => {
        const next = { ...all };
        const k = draft?.key || key!;
        if (!draft || (draft.base && !safeOps(draft).length && !draft.drop)) delete next[k];
        else next[k] = draft;
        return next;
      }),
    pendingCount,
    refresh,
    theme,
    setTheme: (next) => {
      setThemeState(next);
      void call("preference", { theme: next }).catch((e) =>
        toast({ tone: "error", title: "Préférence non enregistrée", description: String(e?.message || e) }),
      );
    },
    ui: {
      connection,
      openConnection: setConnection,
      review,
      openReview: (open = true) => setReview(open),
      palette,
      openPalette: (open = true) => setPalette(open),
      schemaContent,
      openSchemaContent: setSchemaContent,
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function safeOps(draft: TableDraft) {
  try {
    return draftOps(draft);
  } catch {
    return [];
  }
}
