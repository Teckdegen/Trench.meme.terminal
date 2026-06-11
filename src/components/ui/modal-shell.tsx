import { ArrowLeft, X } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export function ModalShell({
  children,
  onClose,
  className,
  z = "z-50",
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  z?: string;
}) {
  return (
    <div className={cn("fixed inset-0 flex items-end justify-center sm:items-center px-0 sm:px-3", z)}>
      <button
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className={cn(
          "relative w-full sm:max-w-[92vw] rounded-t-3xl sm:rounded-3xl bg-background border border-white/10 overflow-hidden",
          className,
        )}
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  title,
  subtitle,
  onBack,
  onClose,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
      {onBack ? (
        <button onClick={onBack} className="size-8 grid place-items-center rounded-full hover:bg-white/5">
          <ArrowLeft className="size-4" />
        </button>
      ) : (
        <div className="size-8" />
      )}
      <div className="flex-1 min-w-0 text-center">
        <h2 className="font-bold truncate">{title}</h2>
        {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
      </div>
      {action ?? (
        <button onClick={onClose} className="size-8 grid place-items-center rounded-full bg-white/5 hover:bg-white/10">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
