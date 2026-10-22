import type { Client } from "pg";
import { z } from "zod";
import type { HbaFile, ProfileInput } from "../shared/types";
import { forbiddenCharacter } from "../shared/hba";
import { connect, protectedServer } from "./postgres";
import { fingerprint, literal } from "./sql";

function denied(error: any, what: string): never {
  if (error?.code === "42501")
    throw new Error(
      `${what} réservée aux superutilisateurs (ou aux membres de pg_read_all_settings et pg_read_server_files).`,
    );
  throw error;
}
async function readFile(client: Client) {
  const path: string = await client
    .query(`SELECT current_setting('hba_file') AS path`)
    .then((r) => r.rows[0].path, (e) => denied(e, "La lecture de l’emplacement de pg_hba.conf est"));
  const content: string = await client
    .query(`SELECT pg_read_file($1) AS content`, [path])
    .then((r) => r.rows[0].content, (e) => denied(e, "La lecture de pg_hba.conf est"));
  return { path, content };
}
/** Errors PostgreSQL finds in the file currently on disk (not the loaded rules). */
async function fileErrors(client: Client, path: string) {
  try {
    const { rows } = await client.query(
      `SELECT to_jsonb(r) AS r FROM pg_hba_file_rules r WHERE error IS NOT NULL`,
    );
    return rows
      .map((x) => x.r)
      .filter((r) => !r.file_name || r.file_name === path)
      .map((r) => ({ line: Number(r.line_number) || 0, message: String(r.error) }));
  } catch {
    return [];
  }
}
export async function hbaRead(
  client: Client,
  profile: ProfileInput,
): Promise<HbaFile> {
  const { path, content } = await readFile(client);
  const {
    rows: [rights],
  } = await client.query(
    `SELECT rolsuper OR pg_has_role(current_user, 'pg_write_server_files', 'USAGE') AS write, has_function_privilege('pg_reload_conf()', 'EXECUTE') AS reload, host(inet_client_addr()) AS client FROM pg_roles WHERE rolname = current_user`,
  );
  const identMaps = await client
    .query(
      `SELECT DISTINCT map_name AS name FROM pg_ident_file_mappings WHERE error IS NULL ORDER BY 1`,
    )
    .then(
      (r) => r.rows.map((x) => String(x.name)),
      () => [] as string[],
    );
  const readOnlyReason = (await protectedServer(profile))
    ? "Serveur de dev partagé : sa configuration d’accès est gérée par devdb."
    : !rights.write
      ? "Écriture réservée aux superutilisateurs et aux membres de pg_write_server_files."
      : !rights.reload
        ? "Le rechargement (pg_reload_conf) n’est pas autorisé pour ce compte."
        : null;
  return {
    path,
    content,
    fingerprint: fingerprint(content),
    errors: await fileErrors(client, path),
    writable: !readOnlyReason,
    readOnlyReason,
    identMaps,
    clientAddress: rights.client ?? null,
  };
}
// COPY writes one CSV row per line; control characters that cannot appear in
// pg_hba.conf are used as delimiter and quote so no line ever gets quoted.
async function writeLines(client: Client, path: string, lines: string[]) {
  await client.query(
    `COPY (SELECT NULLIF(l, '') FROM unnest(ARRAY[${lines.map(literal).join(",")}]::text[]) WITH ORDINALITY AS t(l, n) ORDER BY n) TO ${literal(path)} WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')`,
  );
}
function splitLines(content: string) {
  const text = content.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return text ? text.split("\n") : [];
}
async function reload(client: Client) {
  const loaded = async () =>
    (await client.query(`SELECT pg_conf_load_time() AS t`)).rows[0].t.getTime();
  const before = await loaded();
  await client.query(`SELECT pg_reload_conf()`);
  // The session sees the new load time once the postmaster has processed the reload.
  for (let i = 0; i < 30 && (await loaded()) === before; i++)
    await new Promise((r) => setTimeout(r, 100));
}
export const hbaApplySchema = z.object({
  content: z.string().max(1_000_000),
  fingerprint: z.string().length(64),
});
export async function hbaApply(
  client: Client,
  profile: ProfileInput,
  input: z.infer<typeof hbaApplySchema>,
): Promise<HbaFile> {
  const { content, fingerprint: expected } = hbaApplySchema.parse(input);
  if (await protectedServer(profile))
    throw new Error("Serveur de dev partagé : pg_hba.conf est géré par devdb.");
  const lines = splitLines(content);
  lines.forEach((line, i) => {
    if (forbiddenCharacter.test(line) || line === "\\.")
      throw new Error(`Ligne ${i + 1} : caractère de contrôle interdit.`);
  });
  const current = await readFile(client);
  if (fingerprint(current.content) !== expected)
    throw new Error(
      "pg_hba.conf a été modifié depuis son ouverture. Actualisez, puis refaites vos changements.",
    );
  const original = splitLines(current.content);
  const backup = current.path + ".roma-backup";
  try {
    await writeLines(client, backup, original);
  } catch (error) {
    denied(error, "L’écriture de pg_hba.conf est");
  }
  await writeLines(client, current.path, lines);
  const restore = async () => {
    await writeLines(client, current.path, original);
    await reload(client);
  };
  const errors = await fileErrors(client, current.path);
  if (errors.length) {
    await writeLines(client, current.path, original);
    throw new Error(
      "PostgreSQL refuse ce fichier — " +
        errors.map((e) => `ligne ${e.line} : ${e.message}`).join(" ; ") +
        ". Le fichier d’origine a été restauré.",
    );
  }
  await reload(client);
  // A fresh connection with the same profile must still pass the new rules.
  try {
    const probe = await connect(profile);
    await probe.end();
  } catch (error: any) {
    await restore();
    throw new Error(
      `Avec ces règles, Roma DB ne pourrait plus se connecter (${error?.message || error}). L’ancien fichier a été restauré et rechargé.`,
    );
  }
  return { ...(await hbaRead(client, profile)), backup };
}
