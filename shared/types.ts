export type ObjectKind =
  "database" | "schema" | "table" | "view" | "sequence" | "function";
export interface Profile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  maintenanceDb: string;
  ssl: "disable" | "require" | "verify-full";
  ca: string;
  cert: string;
  color: string;
}
export interface ProfileInput extends Profile {
  password?: string;
  privateKey?: string;
}
export interface Role {
  oid: number;
  name: string;
  login: boolean;
  superuser: boolean;
  createDb: boolean;
  createRole: boolean;
  inherit: boolean;
  replication: boolean;
  bypassRls: boolean;
  connectionLimit: number;
  validUntil: string | null;
}
export interface Membership {
  role: string;
  member: string;
  admin: boolean;
  inherit: boolean;
  set: boolean;
}
export interface Resource {
  oid: number;
  name: string;
  schema: string;
  kind: ObjectKind;
  owner: string;
  signature?: string;
  identity?: string;
  rls?: boolean;
  forceRls?: boolean;
  connectionLimit?: number;
}
export interface Grant {
  role: string;
  privilege: string;
  grantable: boolean;
  grantor: string;
}
export interface Permission extends Grant {
  source: "direct" | "inherited" | "public" | "owner" | "superuser";
  via?: string;
}
export interface Access {
  grants: Grant[];
  permissions: Permission[];
  fingerprint: string;
  schemaUsage: boolean;
  manageable: string[];
  policies: {
    name: string;
    command: string;
    roles: string[];
    using: string | null;
    check: string | null;
  }[];
}
export interface ServerInfo {
  version: number;
  versionLabel: string;
  currentUser: string;
  superuser: boolean;
  createDb: boolean;
  createRole: boolean;
  sharedDev: boolean;
}
export interface Overview {
  server: ServerInfo;
  databases: Resource[];
  roles: Role[];
  memberships: Membership[];
}
export interface DefaultGrant {
  owner: string;
  schema: string;
  kind: "table" | "sequence" | "function";
  role: string;
  privilege: string;
  grantable: boolean;
}
export interface Change {
  id: string;
  profileId: string;
  database: string;
  resource: Resource;
  role: string;
  privilege: string;
  action: "grant" | "revoke";
  grantOption: boolean;
  fingerprint: string;
  defaultOwner?: string;
}
export interface Dependency {
  database: string | null;
  description: string;
}
export interface RoleInput {
  name: string;
  login: boolean;
  superuser: boolean;
  createDb: boolean;
  createRole: boolean;
  inherit: boolean;
  replication: boolean;
  bypassRls: boolean;
  connectionLimit: number;
  password?: string;
  validUntil?: string | null;
}
export interface CrudInput {
  kind: "database" | "schema" | "role";
  action: "create" | "update" | "delete";
  name: string;
  newName?: string;
  owner?: string;
  connectionLimit?: number;
  role?: RoleInput;
  confirmation?: string;
}
export interface MembershipInput {
  role: string;
  member: string;
  action: "grant" | "revoke";
  admin: boolean;
  inherit: boolean;
  set: boolean;
}
export type Theme = "light" | "dark" | "system";
export type MatrixScope = "databases" | "schemas" | "objects";
export interface MatrixEntry {
  resource: Resource;
  /** Explicit ACL entries, PostgreSQL defaults included when the ACL is NULL. */
  grants: { role: string; privilege: string; grantable: boolean }[];
  /** Effective privileges per role (has_*_privilege); roles without access are omitted. */
  effective: Record<string, string[]>;
  /** Same value as Access.fingerprint for this resource. */
  fingerprint: string;
}
export interface AccessMatrix {
  roles: string[];
  entries: MatrixEntry[];
  /** Objects scope only: role -> effective USAGE on the schema (PUBLIC included). */
  schemaUsage: Record<string, boolean>;
}
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  identity: boolean;
  generated: string | null;
  comment: string | null;
}
export interface TableConstraint {
  name: string;
  type: "primary" | "foreign" | "unique" | "check" | "exclusion";
  columns: string[];
  definition: string;
  references?: { schema: string; table: string; columns: string[] };
}
export interface TableIndex {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
  constraint: boolean;
  columns: string[];
}
export interface TableDetail {
  resource: Resource;
  columns: Column[];
  constraints: TableConstraint[];
  indexes: TableIndex[];
  comment: string | null;
  rows: number;
  size: string;
  definition: string | null;
}
export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  identity: boolean;
}
export type FkAction =
  "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
type On = { schema: string; table: string };
export type DdlOp =
  | (On & { op: "createTable"; columns: ColumnDef[]; primaryKey: string[] })
  | (On & { op: "renameTable"; newName: string })
  | (On & { op: "dropTable" })
  | (On & { op: "setTableOwner"; owner: string })
  | (On & { op: "addColumn"; column: ColumnDef })
  | (On & { op: "dropColumn"; column: string })
  | (On & { op: "renameColumn"; column: string; newName: string })
  | (On & { op: "setType"; column: string; type: string })
  | (On & { op: "setNullable"; column: string; nullable: boolean })
  | (On & { op: "setDefault"; column: string; default: string | null })
  | (On & { op: "setIdentity"; column: string; identity: boolean })
  | (On & { op: "addPrimaryKey"; columns: string[] })
  | (On & { op: "addUnique"; columns: string[]; name?: string })
  | (On & { op: "addCheck"; expression: string; name?: string })
  | (On & {
      op: "addForeignKey";
      columns: string[];
      refSchema: string;
      refTable: string;
      refColumns: string[];
      onDelete: FkAction;
      onUpdate: FkAction;
      name?: string;
    })
  | (On & { op: "dropConstraint"; name: string })
  | (On & {
      op: "createIndex";
      columns: string[];
      unique: boolean;
      name?: string;
    })
  | (On & { op: "dropIndex"; name: string })
  | (On & { op: "setComment"; column?: string; comment: string | null });
export interface ApiMethods {
  profiles: { input: undefined; output: Profile[] };
  saveProfile: { input: ProfileInput; output: Profile };
  deleteProfile: { input: { id: string }; output: boolean };
  testConnection: { input: ProfileInput; output: ServerInfo };
  overview: { input: { profileId: string }; output: Overview };
  resources: {
    input: { profileId: string; database: string; schema?: string };
    output: Resource[];
  };
  access: {
    input: {
      profileId: string;
      database: string;
      resource: Resource;
      role: string;
    };
    output: Access;
  };
  defaults: {
    input: { profileId: string; database: string };
    output: DefaultGrant[];
  };
  defaultAccess: {
    input: {
      profileId: string;
      database: string;
      owner: string;
      schema: string;
      kind: "table" | "sequence" | "function";
    };
    output: { fingerprint: string; grants: Grant[] };
  };
  preview: {
    input: { profileId: string; database: string; changes: Change[] };
    output: string[];
  };
  apply: {
    input: { profileId: string; database: string; changes: Change[] };
    output: { count: number };
  };
  crud: {
    input: { profileId: string; database: string; operation: CrudInput };
    output: boolean;
  };
  dependencies: {
    input: {
      profileId: string;
      database: string;
      kind: "database" | "schema" | "role";
      name: string;
    };
    output: Dependency[];
  };
  membership: {
    input: { profileId: string; database: string; operation: MembershipInput };
    output: boolean;
  };
  matrix: {
    input: {
      profileId: string;
      database: string;
      scope: MatrixScope;
      schema?: string;
      system?: boolean;
    };
    output: AccessMatrix;
  };
  tableDetail: {
    input: { profileId: string; database: string; resource: Resource };
    output: TableDetail;
  };
  types: {
    input: { profileId: string; database: string };
    output: string[];
  };
  ddlPreview: {
    input: { profileId: string; database: string; ops: DdlOp[] };
    output: string[];
  };
  ddlApply: {
    input: { profileId: string; database: string; ops: DdlOp[] };
    output: { count: number };
  };
  crudPreview: {
    input: { profileId: string; database: string; operation: CrudInput };
    output: string[];
  };
  preference: {
    input: { theme?: Theme };
    output: { theme: Theme };
  };
  devProfile: { input: undefined; output: ProfileInput | null };
}
