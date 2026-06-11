import type { ReactNode } from "react";

export function PagePanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-surface overflow-hidden ${className}`}>{children}</section>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyBlock({ label = "No data" }: { label?: string }) {
  return (
    <div className="py-12 text-center text-muted-foreground text-sm border border-dashed border-border rounded-lg m-3">
      {label}
    </div>
  );
}

export function MobileTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="md:hidden fixed left-0 right-0 bottom-0 z-40 bg-background/95 backdrop-blur pb-[max(env(safe-area-inset-bottom),0.5rem)]">
      <div className="flex gap-1 px-3">
        {tabs.map((t) => {
          const active = value === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`relative flex-1 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {t.label}
              {active && (
                <span className="absolute left-1/2 -translate-x-1/2 bottom-1 h-[3px] w-8 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StatRow({ items }: { items: { label: string; value: string; tone?: "up" | "down" | "neutral" }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p
            className={`text-lg font-semibold mt-1 ${
              s.tone === "up" ? "text-up" : s.tone === "down" ? "text-down" : "text-foreground"
            }`}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}
