import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Braces,
  Database,
  Eye,
  Layers,
  ListOrdered,
  LoaderCircle,
  Table2,
  Info,
  CircleAlert,
} from "lucide-react";
import type { ObjectKind } from "../shared/types";

export function cx(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}
export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <LoaderCircle
      className="animate-spin text-current"
      size={size}
      aria-label="Chargement"
    />
  );
}
type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
export function Button({
  variant = "secondary",
  size,
  icon,
  loading,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "lg";
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "btn",
        `btn-${variant}`,
        size && `btn-${size}`,
        className,
      )}
    >
      {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : icon}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  className,
  small,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      {...props}
      className={cx("icon-btn", small && "sm", className)}
    >
      {children}
    </button>
  );
}
export function Badge({
  tone,
  children,
  className,
  tip,
}: {
  tone?: "accent" | "ok" | "warn" | "danger" | "info";
  children: ReactNode;
  className?: string;
  tip?: string;
}) {
  return (
    <span className={cx("badge", tone, className)} data-tip={tip}>
      {children}
    </span>
  );
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
          {o.count !== undefined ? (
            <span className="count">{o.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="hint mt-1.5">{hint}</p>
      ) : null}
    </div>
  );
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon =
    tone === "danger" ? CircleAlert : tone === "warn" ? AlertTriangle : Info;
  const colors = {
    info: "bg-info-soft text-info",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    ok: "bg-ok-soft text-ok",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx("flex gap-2.5 rounded-[10px] px-3 py-2.5", colors, className)}
    >
      <Icon size={16} className="mt-px flex-none" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? (
          <div className={title ? "opacity-90" : ""}>
            {children}
          </div>
        ) : null}
      </div>
      {action ? <div className="flex-none self-center">{action}</div> : null}
    </div>
  );
}
export function ErrorCallout({
  error,
  className,
}: {
  error: unknown;
  className?: string;
}) {
  if (!error) return null;
  return (
    <Callout tone="danger" className={className}>
      <span className="select-text">{errorMessage(error)}</span>
    </Callout>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-surface text-muted shadow-[var(--shadow-sm)]">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children ? (
        <p className="mt-1.5 max-w-sm text-[13px] text-muted">{children}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}
export const kindLabel: Record<ObjectKind, string> = {
  database: "Base de données",
  schema: "Schéma",
  table: "Table",
  view: "Vue",
  sequence: "Séquence",
  function: "Fonction",
};
export const kindPlural: Record<ObjectKind, string> = {
  database: "Bases",
  schema: "Schémas",
  table: "Tables",
  view: "Vues",
  sequence: "Séquences",
  function: "Fonctions",
};
const kindColor: Record<ObjectKind, string> = {
  database: "text-accent",
  schema: "text-accent",
  table: "text-info",
  view: "text-ok",
  sequence: "text-warn",
  function: "text-[#c026d3] dark:text-[#e879f9]",
};
export function KindIcon({
  kind,
  size = 15,
  className,
}: {
  kind: ObjectKind;
  size?: number;
  className?: string;
}) {
  const Icon = {
    database: Database,
    schema: Layers,
    table: Table2,
    view: Eye,
    sequence: ListOrdered,
    function: Braces,
  }[kind];
  return <Icon size={size} className={cx(kindColor[kind], className)} />;
}
const avatarHues = [262, 200, 160, 24, 330, 45, 190, 290, 120, 0];
export function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return avatarHues[h % avatarHues.length];
}
export function RoleAvatar({
  name,
  group,
  size = 24,
}: {
  name: string;
  group?: boolean;
  size?: number;
}) {
  if (name === "PUBLIC")
    return (
      <span
        className="grid flex-none place-items-center rounded-full border border-dashed border-line-strong text-muted"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        aria-hidden
      >
        ∗
      </span>
    );
  const h = hue(name);
  const initials = name
    .replace(/^[^a-zA-Z0-9]+/, "")
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center font-bold"
      style={{
        width: size,
        height: size,
        borderRadius: group ? size * 0.3 : size,
        fontSize: Math.max(9, size * 0.38),
        background: `hsl(${h} 70% var(--avatar-l, 92%))`,
        color: `hsl(${h} 55% var(--avatar-fg, 32%))`,
      }}
    >
      {initials || "?"}
    </span>
  );
}
/** Global tooltip: any element with data-tip shows it after a short delay. */
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean }>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(undefined);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (el === current) return;
      hide();
      if (!el) return;
      const text = el.getAttribute("data-tip");
      if (!text) return;
      current = el;
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 60;
        setTip({
          text,
          x: Math.min(Math.max(r.left + r.width / 2, 160), window.innerWidth - 160),
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
      }, 380);
    };
    window.addEventListener("mouseover", over);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", hide, true);
    return () => {
      window.removeEventListener("mouseover", over);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div
      className="tooltip"
      role="tooltip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
      }}
    >
      {tip.text}
    </div>
  );
}
const SQL_KEYWORDS =
  /\b(GRANT|REVOKE|ON|TO|FROM|WITH|OPTION|FOR|ALTER|DEFAULT|PRIVILEGES|IN|SCHEMA|TABLES?|SEQUENCES?|FUNCTIONS?|DATABASE|ROLE|CREATE|DROP|ADD|COLUMN|CONSTRAINT|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|INDEX|RENAME|TYPE|USING|SET|NOT|NULL|GENERATED|BY|AS|IDENTITY|IF|EXISTS|RESTRICT|CASCADE|COMMENT|IS|OWNER|DELETE|UPDATE|NO|ACTION|LOGIN|NOLOGIN|PASSWORD|CONNECTION|LIMIT|VALID|UNTIL|AUTHORIZATION|PUBLIC|BEGIN|COMMIT)\b/g;
/** Minimal SQL highlighting for previews (strings, quoted identifiers, keywords). */
export function Sql({ code, className }: { code: string; className?: string }) {
  const parts: ReactNode[] = [];
  const token = /(E?'(?:[^']|'')*')|("(?:[^"]|"")*")|(--[^\n]*)/g;
  let last = 0;
  let index = 0;
  const pushPlain = (text: string) => {
    let l = 0;
    for (const m of text.matchAll(SQL_KEYWORDS)) {
      if (m.index! > l) parts.push(text.slice(l, m.index));
      parts.push(
        <span key={"k" + index++} className="kw">
          {m[0]}
        </span>,
      );
      l = m.index! + m[0].length;
    }
    if (l < text.length) parts.push(text.slice(l));
  };
  for (const m of code.matchAll(token)) {
    pushPlain(code.slice(last, m.index));
    parts.push(
      <span
        key={"t" + index++}
        className={m[1] ? "str" : m[2] ? "ident" : "cm"}
      >
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  pushPlain(code.slice(last));
  return <pre className={cx("sql m-0", className)}>{parts}</pre>;
}
export function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n > 1 ? many : one}`;
}
