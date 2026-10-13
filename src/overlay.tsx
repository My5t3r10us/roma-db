import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx, IconButton } from "./ui";

/** Popovers portal into the open modal (top layer) when there is one. */
const PortalTarget = createContext<HTMLElement | null>(null);
function usePortalTarget() {
  return useContext(PortalTarget) || document.body;
}

function useModal(onClose: () => void, busy?: boolean, focusField = true) {
  const ref = useRef<HTMLDialogElement>(null);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    // Start on the first field (React autoFocus runs before the dialog is open), else on the dialog.
    const field = focusField
      ? el.querySelector<HTMLElement>(
          "input:not([disabled]):not([type=checkbox]):not([type=color]), textarea:not([disabled]), select:not([disabled])",
        )
      : null;
    (field || el).focus();
    setNode(el);
    return () => {
      el.close();
      previous?.focus?.();
    };
  }, []);
  const props = {
    ref,
    onCancel: (e: React.SyntheticEvent) => {
      e.preventDefault();
      if (!busy) close.current();
    },
    onMouseDown: (e: React.MouseEvent<HTMLDialogElement>) => {
      // Click on the backdrop (the dialog element itself, outside its box) closes it.
      if (e.target !== e.currentTarget || busy) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        close.current();
    },
  };
  return { props, node };
}

export function Dialog({
  title,
  description,
  icon,
  children,
  footer,
  onClose,
  wide,
  busy,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const { props, node } = useModal(onClose, busy);
  const titleId = useId();
  return (
    <dialog
      {...props}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cx("dialog", wide && "wide", className)}
    >
      <PortalTarget.Provider value={node}>
        <header className="flex items-start gap-3 px-6 pt-5 pb-4">
          {icon ? (
            <div className="grid size-9 flex-none place-items-center rounded-[10px] border border-line bg-sunken text-muted">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 text-[15px] font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-[13px] text-muted">{description}</p>
            ) : null}
          </div>
          <IconButton label="Fermer" onClick={onClose} disabled={busy} className="-mt-1 -mr-2">
            <X size={17} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          {children}
        </div>
        {footer ? (
          <footer className="flex items-center gap-2 border-t border-line bg-sunken px-6 py-3.5">
            {footer}
          </footer>
        ) : null}
      </PortalTarget.Provider>
    </dialog>
  );
}

export function Sheet({
  title,
  description,
  icon,
  children,
  footer,
  onClose,
  busy,
  width,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  width?: number;
}) {
  const { props, node } = useModal(onClose, busy, false);
  const titleId = useId();
  return (
    <dialog
      {...props}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="sheet"
      style={width ? { width: `min(${width}px, 100vw)` } : undefined}
    >
      <PortalTarget.Provider value={node}>
        <header className="flex items-start gap-3 border-b border-line px-6 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 truncate text-[15px] font-semibold">
              {title}
            </h2>
            {description ? (
              <div className="mt-0.5 text-[13px] text-muted">{description}</div>
            ) : null}
          </div>
          <IconButton label="Fermer" onClick={onClose} disabled={busy} className="-mr-2">
            <X size={17} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <footer className="flex items-center gap-2 border-t border-line bg-sunken px-6 py-3.5">
            {footer}
          </footer>
        ) : null}
      </PortalTarget.Provider>
    </dialog>
  );
}

export type Placement = "bottom-start" | "bottom-end" | "bottom" | "right-start";
export function Popover({
  anchor,
  onClose,
  children,
  placement = "bottom-start",
  width,
  className,
  label,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
  width?: number;
  className?: string;
  label?: string;
}) {
  const target = usePortalTarget();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el || !anchor.isConnected) return;
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 6;
      let left =
        placement === "bottom-end"
          ? a.right - w
          : placement === "bottom"
            ? a.left + a.width / 2 - w / 2
            : placement === "right-start"
              ? a.right + gap
              : a.left;
      let top = placement === "right-start" ? a.top : a.bottom + gap;
      if (top + h > window.innerHeight - 8)
        top =
          placement === "right-start"
            ? window.innerHeight - h - 8
            : Math.max(8, a.top - gap - h);
      if (placement === "right-start" && left + w > window.innerWidth - 8)
        left = a.left - gap - w;
      left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
      setPos({ left, top: Math.max(8, top) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, placement]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      // A nested popover rendered elsewhere keeps this one open.
      if ((t as Element).closest?.("[data-popover]")) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [anchor]);
  useEffect(() => {
    const restore = anchor;
    return () => {
      if (document.activeElement === document.body || !document.activeElement)
        restore.focus?.();
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      data-popover
      role="dialog"
      aria-label={label}
      className={cx("popover", className)}
      style={{
        width,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    target,
  );
}

export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: (e: { currentTarget: HTMLElement }) => {
      // Read now: React clears currentTarget once the handler returns.
      const target = e.currentTarget;
      setAnchor((a) => (a === target ? null : target));
    },
    openAt: setAnchor,
    close: () => setAnchor(null),
  };
}

export type MenuEntry =
  | {
      label: ReactNode;
      icon?: ReactNode;
      hint?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
    }
  | { section: string }
  | "separator";
export function Menu({
  anchor,
  onClose,
  items,
  placement,
  width = 240,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  items: MenuEntry[];
  placement?: Placement;
  width?: number;
}) {
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items
    .map((item, i) => ({ item, i }))
    .filter(
      ({ item }) =>
        typeof item === "object" && "onSelect" in item && !item.disabled,
    )
    .map(({ i }) => i);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Popover anchor={anchor} onClose={onClose} placement={placement} width={width}>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        className="max-h-[60vh] overflow-y-auto p-1.5 outline-none"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const pos = actionable.indexOf(active);
            const next =
              e.key === "ArrowDown"
                ? actionable[(pos + 1) % actionable.length]
                : actionable[(pos - 1 + actionable.length) % actionable.length];
            setActive(next ?? -1);
          }
          if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            const item = items[active];
            if (typeof item === "object" && "onSelect" in item) {
              onClose();
              item.onSelect();
            }
          }
        }}
      >
        {items.map((item, i) =>
          item === "separator" ? (
            <div key={i} className="divider my-1.5" />
          ) : "section" in item ? (
            <div key={i} className="menu-label">
              {item.section}
            </div>
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              data-active={active === i}
              onMouseEnter={() => setActive(i)}
              className={cx("menu-item", item.danger && "danger")}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span className="grid w-4 flex-none place-items-center text-muted [.danger_&]:text-danger">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.checked ? (
                <span className="text-accent">✓</span>
              ) : item.hint ? (
                <span className="text-xs text-faint">{item.hint}</span>
              ) : null}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}
