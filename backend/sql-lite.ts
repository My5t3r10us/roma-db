import type { Profile, ProfileInput } from "../shared/types";
// Runtime-independent validation: the TinyJS backend must not bundle Node builtins.
export function profileSchema(input: ProfileInput): Profile {
  if (
    !input ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) ||
    !input.name?.trim() ||
    !input.host?.trim() ||
    !input.user?.trim() ||
    !input.maintenanceDb?.trim()
  )
    throw new Error("Complétez les champs de connexion.");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
    throw new Error("Port invalide.");
  if (!["disable", "require", "verify-full"].includes(input.ssl))
    throw new Error("Mode SSL invalide.");
  if (!/^#[0-9a-f]{6}$/i.test(input.color))
    throw new Error("Couleur invalide.");
  if (
    [input.user, input.maintenanceDb].some(
      (v) => v.includes("\0") || new TextEncoder().encode(v).length > 63,
    )
  )
    throw new Error("Identifiant PostgreSQL invalide.");
  return {
    id: input.id,
    name: input.name.trim(),
    host: input.host.trim(),
    port: input.port,
    user: input.user,
    maintenanceDb: input.maintenanceDb,
    ssl: input.ssl,
    ca: input.ca || "",
    cert: input.cert || "",
    color: input.color,
  };
}
