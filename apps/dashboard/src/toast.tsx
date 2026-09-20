import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Notifications that answer an action ("saved", "the passkey prompt was dismissed") pop up bottom right and leave
 * on their own. Anything that describes a standing condition stays inline where it belongs.
 * Plain CSS transitions and timers on purpose: a toast must also leave when the tab is in the background.
 */
export type ToastKind = "ok" | "err" | "info";
type Toast = { id: number; text: string; kind: ToastKind; ms: number; at: number; leaving?: boolean };

const LEAVE_MS = 240;
let items: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function toast(text: string, kind: ToastKind = "info"): void {
  const now = Date.now();
  // the same message twice in a row (a double click, a handler that fires twice) is one notification
  if (items.some((t) => t.text === text && !t.leaving && now - t.at < 1500)) return;
  // long messages (a contract's rejection, for instance) stay long enough to be read
  const ms = Math.min(14_000, 3_500 + text.length * 45);
  items = [...items.filter((t) => t.text !== text), { id: nextId++, text, kind, ms, at: now }].slice(-3);
  emit();
}
function dismiss(id: number): void {
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, LEAVE_MS);
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {list.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast: t }: { toast: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dismiss(t.id), t.ms);
  };
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);
  return (
    <div className={`toast ${t.kind} ${t.leaving ? "leaving" : ""}`} role={t.kind === "err" ? "alert" : "status"} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={arm}>
      <p>{t.text}</p>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
        ×
      </button>
    </div>
  );
}
