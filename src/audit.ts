import { useCallback, useState } from "react";
import { call, isDesktop } from "./api";
import { useToast } from "./toast";
import { errorMessage } from "./ui";
import { useWorkspace } from "./workspace";

/** Exports an HTML audit (roles, rights, databases, schemas, tables) of the current server. */
export function useAuditExport() {
  const ws = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (busy || !ws.profileId) return;
    if (!isDesktop() || !window.tiny?.dialog)
      return toast({
        tone: "error",
        title: "Export indisponible en démonstration",
        description: "Lancez l’application de bureau pour exporter un audit.",
      });
    try {
      const path = await window.tiny.dialog.saveFile({ types: ["html"] });
      if (!path) return;
      setBusy(true);
      toast({
        tone: "info",
        title: "Audit en cours…",
        description: "Lecture des rôles, bases, schémas et tables.",
      });
      const result = await call("auditExport", {
        profileId: ws.profileId,
        path,
      });
      toast({
        title: "Audit exporté",
        description: result.path,
        action: {
          label: "Ouvrir",
          run: () => void window.tiny?.app?.shell?.open(result.path),
        },
      });
    } catch (error) {
      toast({
        tone: "error",
        title: "Export impossible",
        description: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, ws.profileId, toast]);
  return { run, busy };
}
