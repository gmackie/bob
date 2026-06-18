"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface Toast {
  readonly id: string;
  readonly message: string;
  readonly kind?: ToastKind;
}

export interface ToastInput {
  readonly message: string;
  readonly kind?: ToastKind;
}

interface ToastContextValue {
  readonly toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_TTL_MS = 5_000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message: input.message, kind: input.kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            <ol
              role="status"
              aria-live="polite"
              style={{
                position: "fixed",
                bottom: "1rem",
                right: "1rem",
                zIndex: 9999,
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                margin: 0,
                padding: 0,
                listStyle: "none",
              }}
            >
              {toasts.map((t) => (
                <li
                  key={t.id}
                  data-toast-kind={t.kind ?? "info"}
                  style={{
                    minWidth: "200px",
                    padding: "0.75rem 1rem",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-secondary)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                    borderLeftWidth: "3px",
                    borderLeftColor: borderColorForKind(t.kind),
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  }}
                >
                  {t.message}
                </li>
              ))}
            </ol>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

function borderColorForKind(kind: ToastKind | undefined): string {
  switch (kind) {
    case "success":
      return "var(--color-success)";
    case "warn":
      return "var(--color-warning)";
    case "error":
      return "var(--color-error)";
    default:
      return "var(--color-info)";
  }
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
