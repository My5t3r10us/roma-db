import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { cx } from "./ui";

type Tone = "ok" | "error" | "info";
interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
  action?: { label: string; run: () => void };
}
type Push = (toast: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => void;
const ToastContext = createContext<Push>(() => {});
export const useToast = () => useContext(ToastContext);

let nextId = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback<Push>(
    (toast) => {
      const id = ++nextId;
      setToasts((list) => [...list.slice(-3), { tone: "ok", ...toast, id }]);
      setTimeout(() => dismiss(id), toast.action ? 7000 : toast.tone === "error" ? 9000 : 4200);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-[90] flex w-[360px] flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = t.tone === "error" ? CircleAlert : t.tone === "info" ? Info : CheckCircle2;
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-lg)]"
              style={{ animation: "toast-in .18s ease-out" }}
            >
              <Icon
                size={17}
                className={cx(
                  "mt-px flex-none",
                  t.tone === "error" ? "text-danger" : t.tone === "info" ? "text-info" : "text-ok",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t.title}</div>
                {t.description ? (
                  <div className="mt-0.5 text-[12.5px] text-muted select-text">{t.description}</div>
                ) : null}
              </div>
              {t.action ? (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => {
                    dismiss(t.id);
                    t.action!.run();
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <button
                aria-label="Fermer la notification"
                className="icon-btn sm -mt-0.5 -mr-1"
                onClick={() => dismiss(t.id)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
