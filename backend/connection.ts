import type { ClientConfig } from "pg";
import type { ProfileInput } from "../shared/types";

export function sslOptions(profile: ProfileInput): ClientConfig["ssl"] {
  if (profile.ssl === "disable") return false;
  return {
    rejectUnauthorized: profile.ssl === "verify-full",
    ...(profile.ca ? { ca: profile.ca } : {}),
    ...(profile.cert ? { cert: profile.cert } : {}),
    ...(profile.privateKey ? { key: profile.privateKey } : {}),
  };
}

export function connectionError(error: {
  message?: string;
  code?: string;
}): string {
  const original = error.message || "Erreur PostgreSQL.";
  if (
    /pg_hba.conf/i.test(original) &&
    /no encryption|SSL off/i.test(original)
  ) {
    return (
      "Le serveur refuse cette connexion non chiffrée. Activez SSL dans « Chiffrement », puis testez à nouveau. Détail PostgreSQL : " +
      original
    );
  }
  if (
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ].includes(error.code || "")
  ) {
    return (
      "Le certificat SSL n’est pas reconnu. Ajoutez l’autorité de certification (PEM), ou choisissez explicitement « SSL requis · certificat non vérifié » si vous acceptez ce certificat. Détail : " +
      original
    );
  }
  if (error.code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return (
      "Le certificat SSL ne correspond pas à l’hôte. Utilisez le nom DNS indiqué dans le certificat. Détail : " +
      original
    );
  }
  return original;
}
