// pg_hba.conf model shared by the editor and the backend: parsing that keeps
// untouched lines byte for byte, formatting, validation and completion data.

export type HbaType =
  | "local"
  | "host"
  | "hostssl"
  | "hostnossl"
  | "hostgssenc"
  | "hostnogssenc";
export type HbaField = "type" | "database" | "user" | "address" | "method" | "options";
export interface HbaRule {
  kind: "rule";
  type: string;
  database: string;
  user: string;
  /** Address, or "address mask" for the two-column IPv4/IPv6 form. */
  address: string;
  method: string;
  /** Space-separated name=value pairs, as written in the file. */
  options: string;
  comment: string;
}
export type HbaEntry = { id: string; raw: string; line: number; edited?: boolean } & (
  | { kind: "blank" }
  | { kind: "comment" }
  | {
      kind: "include";
      directive: "include" | "include_if_exists" | "include_dir";
      path: string;
      comment: string;
    }
  | HbaRule
);
export interface Suggestion {
  value: string;
  detail?: string;
  /** Keep the list open after inserting (e.g. "ldapserver="). */
  partial?: boolean;
}

export const types: Suggestion[] = [
  { value: "host", detail: "TCP/IP, chiffré ou non" },
  { value: "hostssl", detail: "TCP/IP chiffré par SSL uniquement" },
  { value: "local", detail: "Socket Unix (même machine)" },
  { value: "hostnossl", detail: "TCP/IP sans SSL" },
  { value: "hostgssenc", detail: "TCP/IP chiffré par GSSAPI" },
  { value: "hostnogssenc", detail: "TCP/IP sans chiffrement GSSAPI" },
];
export const methods: Suggestion[] = [
  { value: "scram-sha-256", detail: "Mot de passe SCRAM — recommandé" },
  { value: "md5", detail: "Mot de passe MD5 ou SCRAM — obsolète" },
  { value: "reject", detail: "Refuse la connexion" },
  { value: "trust", detail: "Aucun mot de passe — dangereux" },
  { value: "peer", detail: "Utilisateur du système (local)" },
  { value: "ident", detail: "Serveur ident du client" },
  { value: "cert", detail: "Certificat client SSL" },
  { value: "ldap", detail: "Annuaire LDAP" },
  { value: "gss", detail: "Kerberos / GSSAPI" },
  { value: "sspi", detail: "Windows SSPI" },
  { value: "radius", detail: "Serveur RADIUS" },
  { value: "pam", detail: "Modules PAM" },
  { value: "bsd", detail: "Authentification BSD" },
  { value: "password", detail: "Mot de passe en clair — à éviter" },
];
export const databaseKeywords: Suggestion[] = [
  { value: "all", detail: "Toutes les bases" },
  { value: "sameuser", detail: "Base du même nom que l’utilisateur" },
  { value: "samerole", detail: "L’utilisateur est membre du rôle du même nom" },
  { value: "replication", detail: "Connexions de réplication physique" },
];
export const userKeywords: Suggestion[] = [
  { value: "all", detail: "Tous les rôles" },
];
export const addressKeywords: Suggestion[] = [
  { value: "all", detail: "Toutes les adresses" },
  { value: "samehost", detail: "Adresses du serveur lui-même" },
  { value: "samenet", detail: "Sous-réseaux du serveur" },
  { value: "127.0.0.1/32", detail: "Boucle locale IPv4" },
  { value: "::1/128", detail: "Boucle locale IPv6" },
  { value: "10.0.0.0/8", detail: "Réseau privé" },
  { value: "172.16.0.0/12", detail: "Réseau privé" },
  { value: "192.168.0.0/16", detail: "Réseau privé" },
  { value: "0.0.0.0/0", detail: "Tout IPv4" },
  { value: "::/0", detail: "Tout IPv6" },
];
type Values = "bool" | string[] | "ident" | undefined;
const option = (detail: string, values?: Values) => ({ detail, values });
const ldap = {
  ldapserver: option("Serveurs LDAP, séparés par des espaces"),
  ldapport: option("Port (389 ou 636 par défaut)"),
  ldapscheme: option("Protocole", ["ldap", "ldaps"]),
  ldaptls: option("STARTTLS", "bool"),
  ldapprefix: option("Préfixe du DN (mode simple bind)"),
  ldapsuffix: option("Suffixe du DN (mode simple bind)"),
  ldapbasedn: option("DN racine de recherche (mode search+bind)"),
  ldapbinddn: option("DN du compte de recherche"),
  ldapbindpasswd: option("Mot de passe du compte de recherche"),
  ldapsearchattribute: option("Attribut comparé au nom d’utilisateur", ["uid", "sAMAccountName", "cn", "mail"]),
  ldapsearchfilter: option("Filtre de recherche, $username remplacé"),
  ldapurl: option("URL RFC 4516 complète"),
};
const realm = {
  include_realm: option("Garder le realm dans le nom", "bool"),
  krb_realm: option("Realm accepté"),
  map: option("Correspondance pg_ident.conf", "ident"),
};
export const methodOptions: Record<string, Record<string, { detail: string; values?: Values }>> = {
  ldap,
  gss: realm,
  sspi: {
    ...realm,
    compat_realm: option("Nom de domaine NetBIOS", "bool"),
    upn_username: option("Utiliser l’UPN", "bool"),
  },
  ident: { map: realm.map },
  peer: { map: realm.map },
  cert: { map: realm.map },
  radius: {
    radiusservers: option("Serveurs RADIUS, séparés par des virgules"),
    radiussecrets: option("Secrets partagés"),
    radiusports: option("Ports (1812 par défaut)"),
    radiusidentifiers: option("NAS-Identifier"),
  },
  pam: {
    pamservice: option("Service PAM", ["postgresql"]),
    pam_use_hostname: option("Transmettre le nom d’hôte", "bool"),
  },
};
const sslOptions = {
  clientcert: option("Exiger un certificat client", ["verify-ca", "verify-full"]),
  clientname: option("Champ du certificat comparé (PostgreSQL 14+)", ["CN", "DN"]),
};

/** Splits a line into tokens; quotes are kept, `#` outside quotes starts the comment. */
export function tokenize(line: string): { tokens: string[]; comment: string } {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "#")
      return { tokens: current ? [...tokens, current] : tokens, comment: line.slice(i + 1).trim() };
    if (!quoted && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
    } else current += ch;
  }
  if (current) tokens.push(current);
  return { tokens, comment: "" };
}
/** Splits a comma list (database/user columns) outside quotes. */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}
const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
function isIpv6(value: string) {
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(":")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((h) => (h ? h.split(":") : []));
  const last = groups.at(-1);
  const embedded = last && ipv4.test(last) ? 1 : 0;
  const words = groups.slice(0, groups.length - embedded);
  if (!words.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  const size = words.length + embedded * 2;
  return halves.length === 2 ? size < 8 : size === 8;
}
const isIp = (value: string) => ipv4.test(value) || isIpv6(value);

let counter = 0;
const nextId = () => "hba-" + ++counter;
export function parseHba(content: string): HbaEntry[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const entries: HbaEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    let raw = lines[i];
    let logical = raw;
    // PostgreSQL 16+ joins a line ending with a backslash to the next one.
    while (/\\$/.test(logical) && !logical.trimStart().startsWith("#") && i + 1 < lines.length) {
      i++;
      raw += "\n" + lines[i];
      logical = logical.slice(0, -1) + " " + lines[i];
    }
    const { tokens, comment } = tokenize(logical);
    const base = { id: nextId(), raw, line };
    if (!tokens.length) {
      entries.push(logical.trim() ? { ...base, kind: "comment" } : { ...base, kind: "blank" });
      continue;
    }
    const [first, ...rest] = tokens;
    if (first === "include" || first === "include_if_exists" || first === "include_dir") {
      entries.push({ ...base, kind: "include", directive: first, path: rest.join(" "), comment });
      continue;
    }
    const local = first === "local";
    const [database = "", user = ""] = rest;
    let next = 2;
    let address = "";
    if (!local) {
      address = rest[next++] || "";
      // Two-column form: an IP address followed by its netmask.
      if (isIp(address) && rest[next] && isIp(rest[next])) address += " " + rest[next++];
    }
    entries.push({
      ...base,
      kind: "rule",
      type: first,
      database,
      user,
      address,
      method: rest[next] || "",
      options: rest.slice(next + 1).join(" "),
      comment,
    });
  }
  return entries;
}
export function formatRule(rule: Omit<HbaRule, "kind">): string {
  const cols = [
    rule.type.padEnd(7),
    rule.database.padEnd(15),
    rule.user.padEnd(15),
    (rule.type === "local" ? "" : rule.address).padEnd(23),
    rule.method,
    rule.options.trim().replace(/\s+/g, " "),
  ];
  const text = cols.join(" ").trimEnd();
  return rule.comment.trim() ? `${text}  # ${rule.comment.trim()}` : text;
}
export function entryText(entry: HbaEntry): string {
  if (!entry.edited) return entry.raw;
  if (entry.kind === "rule") return formatRule(entry);
  if (entry.kind === "include")
    return `${entry.directive} ${entry.path}${entry.comment.trim() ? `  # ${entry.comment.trim()}` : ""}`;
  return entry.raw;
}
export function serializeHba(entries: HbaEntry[], newline = "\n"): string {
  return entries.map(entryText).join("\n").split("\n").join(newline) + newline;
}

/** Characters the backend cannot write safely through COPY. */
export const forbiddenCharacter = /[\0-\x08\x0b-\x1f\x7f]/;
export type RuleProblems = Partial<Record<HbaField, string>>;
export function validateRule(rule: Omit<HbaRule, "kind">, version = 170000): RuleProblems {
  const problems: RuleProblems = {};
  const type = rule.type;
  if (!types.some((t) => t.value === type)) problems.type = "Type inconnu : " + (type || "vide");
  const list = (value: string, label: string, keywords: string[]) => {
    if (!value) return `${label} obligatoire.`;
    for (const part of splitList(value)) {
      if (!part) return "Élément vide dans la liste.";
      if ((part.match(/"/g) || []).length % 2) return "Guillemet non fermé.";
      if (part.startsWith("/") && version < 160000) return "Les expressions régulières nécessitent PostgreSQL 16.";
      if (/\s/.test(part) && !part.startsWith('"')) return "Les espaces exigent des guillemets.";
      if (part.startsWith("@") && part.length < 2) return "Indiquez un fichier après @.";
      if (keywords.includes(part.toLowerCase()) && part !== part.toLowerCase())
        return `Les mots-clés s’écrivent en minuscules (${part.toLowerCase()}).`;
    }
    return undefined;
  };
  const database = list(rule.database, "La base", ["all", "sameuser", "samerole", "samegroup", "replication"]);
  if (database) problems.database = database;
  const user = list(rule.user, "L’utilisateur", ["all"]);
  if (user) problems.user = user;
  else if (splitList(rule.user).some((u) => u === "+")) problems.user = "Indiquez un groupe après +.";
  if (type !== "local") {
    const address = rule.address.trim();
    const [ip, mask, extra] = address.split(/\s+/);
    if (!address) problems.address = "Adresse obligatoire pour une connexion réseau.";
    else if (extra) problems.address = "Une adresse, ou une adresse suivie d’un masque.";
    else if (mask) {
      if (!isIp(ip) || !isIp(mask)) problems.address = "Adresse et masque doivent être des IP.";
    } else if (ip.includes("/")) {
      const [host, bits] = ip.split("/");
      const max = ipv4.test(host) ? 32 : isIpv6(host) ? 128 : 0;
      if (!max) problems.address = "Adresse IP invalide avant le /.";
      else if (!/^\d+$/.test(bits) || Number(bits) > max) problems.address = `Préfixe CIDR entre 0 et ${max}.`;
    } else if (isIp(ip)) problems.address = "Ajoutez un préfixe CIDR (ex. /32) ou un masque.";
    else if (/^[\d.]+$/.test(ip)) problems.address = "Adresse IP incomplète ou invalide.";
    else if (
      !["all", "samehost", "samenet"].includes(ip) &&
      !/^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(ip)
    )
      problems.address = "Adresse IP, CIDR, nom d’hôte ou all / samehost / samenet.";
  }
  const method = rule.method;
  if (!method) problems.method = "Méthode obligatoire.";
  else if (!methods.some((m) => m.value === method)) problems.method = "Méthode inconnue : " + method;
  else if (method === "peer" && type !== "local") problems.method = "peer ne s’applique qu’aux connexions local.";
  else if (method === "cert" && type !== "hostssl") problems.method = "cert exige le type hostssl.";
  const allowed = { ...(methodOptions[method] || {}), ...sslOptions };
  for (const pair of rule.options.trim() ? splitOptions(rule.options) : []) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? "" : pair.slice(eq + 1);
    if (eq < 0 || !value) {
      problems.options = `Option « ${key} » sans valeur (nom=valeur).`;
      break;
    }
    const spec = allowed[key as keyof typeof allowed];
    if (!spec) {
      problems.options = `Option « ${key} » inconnue pour ${method || "cette méthode"}.`;
      break;
    }
    const plain = value.replace(/^"|"$/g, "");
    if (spec.values === "bool" && !["0", "1"].includes(plain)) {
      problems.options = `${key} vaut 0 ou 1.`;
      break;
    }
    if (Array.isArray(spec.values) && key !== "ldapsearchattribute" && key !== "pamservice" && !spec.values.includes(plain)) {
      problems.options = `${key} : ${spec.values.join(" ou ")}.`;
      break;
    }
    if ((key === "clientcert" || key === "clientname") && type !== "hostssl") {
      problems.options = `${key} exige le type hostssl.`;
      break;
    }
  }
  for (const field of ["type", "database", "user", "address", "method", "options"] as const)
    if (forbiddenCharacter.test(rule[field])) problems[field] = "Caractère de contrôle interdit.";
  return problems;
}
/** Splits "a=1 b="x y"" on spaces outside quotes. */
export function splitOptions(value: string): string[] {
  return tokenize(value.replaceAll("#", "\u0000")).tokens.map((t) => t.replaceAll("\u0000", "#"));
}

export interface CompletionContext {
  databases: string[];
  roles: { name: string; login: boolean }[];
  identMaps: string[];
  clientAddress?: string | null;
}
export function suggestions(field: HbaField, rule: Omit<HbaRule, "kind">, token: string, ctx: CompletionContext): Suggestion[] {
  const quote = (name: string) => (/^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`);
  let list: Suggestion[] = [];
  if (field === "type") list = types;
  else if (field === "method")
    list = methods.filter((m) => (rule.type === "local" ? !["cert", "ident", "radius"].includes(m.value) : m.value !== "peer"));
  else if (field === "database")
    list = [...databaseKeywords, ...ctx.databases.map((d) => ({ value: quote(d), detail: "Base" })), { value: "@", detail: "Liste lue dans un fichier", partial: true }];
  else if (field === "user")
    list = [
      ...userKeywords,
      ...ctx.roles.filter((r) => !r.login).map((r) => ({ value: "+" + quote(r.name), detail: "Membres du groupe" })),
      ...ctx.roles.map((r) => ({ value: quote(r.name), detail: r.login ? "Compte" : "Groupe (le rôle lui-même)" })),
      { value: "@", detail: "Liste lue dans un fichier", partial: true },
    ];
  else if (field === "address") {
    list = [...addressKeywords];
    if (ctx.clientAddress) {
      const bits = ctx.clientAddress.includes(":") ? 128 : 32;
      list.unshift({ value: `${ctx.clientAddress.replace(/\/\d+$/, "")}/${bits}`, detail: "Votre adresse actuelle" });
    }
  } else if (field === "options") {
    const allowed = { ...(methodOptions[rule.method] || {}), ...(rule.type === "hostssl" ? sslOptions : {}) };
    const eq = token.indexOf("=");
    if (eq >= 0) {
      const key = token.slice(0, eq);
      const spec = allowed[key as keyof typeof allowed];
      const values = spec?.values === "bool" ? ["1", "0"] : spec?.values === "ident" ? ctx.identMaps : spec?.values || [];
      return values
        .map((v) => ({ value: `${key}=${v}`, detail: spec?.detail }))
        .filter((s) => s.value.toLowerCase().startsWith(token.toLowerCase()));
    }
    const used = new Set(splitOptions(rule.options).map((p) => p.split("=")[0]));
    list = Object.entries(allowed)
      .filter(([k]) => !used.has(k) || token === k)
      .map(([k, s]) => ({ value: k + "=", detail: s.detail, partial: true }));
  }
  const t = token.toLowerCase();
  if (!t) return list;
  const starts = list.filter((s) => s.value.toLowerCase().startsWith(t) && s.value !== token);
  const contains = list.filter((s) => !s.value.toLowerCase().startsWith(t) && s.value.toLowerCase().includes(t));
  return [...starts, ...contains];
}

/** Earlier rule that matches every connection this one could match, if any. */
export function shadowedBy(entries: HbaEntry[], index: number): HbaEntry | undefined {
  const rule = entries[index];
  if (rule.kind !== "rule") return undefined;
  const network = (t: string) => t.startsWith("host");
  for (const prev of entries.slice(0, index)) {
    if (prev.kind !== "rule") continue;
    const typeCovers = prev.type === rule.type || (prev.type === "host" && network(rule.type));
    const dbCovers =
      prev.database === "all" ? rule.database !== "replication" && !splitList(rule.database).includes("replication") : prev.database === rule.database;
    const userCovers = prev.user === "all" || prev.user === rule.user;
    const v4 = (a: string) => ipv4.test(a.split(/[/\s]/)[0]);
    const addressCovers =
      rule.type === "local" ||
      prev.address === "all" ||
      prev.address === rule.address ||
      (prev.address === "0.0.0.0/0" && v4(rule.address)) ||
      (prev.address === "::/0" && isIpv6(rule.address.split(/[/\s]/)[0]));
    if (typeCovers && dbCovers && userCovers && addressCovers) return prev;
  }
  return undefined;
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string };
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const b = after.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] > lcs[i + 1][j])) out.push({ kind: "add", text: b[j++] });
    else out.push({ kind: "del", text: a[i++] });
  }
  return out;
}
