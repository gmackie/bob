"use client";

import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { createUIStore, type UIStore, type UIState } from "./stores/ui";
import {
  createPreferencesStore,
  type PreferencesStore,
  type PreferencesState,
} from "./stores/preferences";

// localStorage adapter
const localStorageAdapter = {
  getItem: (name: string) => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(name);
  },
};

// Contexts
const UIStoreContext = createContext<UIStore | null>(null);
const PreferencesStoreContext = createContext<PreferencesStore | null>(null);

// Provider
interface StoreProviderProps {
  children: ReactNode;
}

export function StoreProvider({ children }: StoreProviderProps) {
  const uiStoreRef = useRef<UIStore | null>(null);
  const preferencesStoreRef = useRef<PreferencesStore | null>(null);

  if (!uiStoreRef.current) {
    uiStoreRef.current = createUIStore();
  }
  if (!preferencesStoreRef.current) {
    preferencesStoreRef.current = createPreferencesStore(localStorageAdapter);
  }

  return (
    <UIStoreContext.Provider value={uiStoreRef.current}>
      <PreferencesStoreContext.Provider value={preferencesStoreRef.current}>
        {children}
      </PreferencesStoreContext.Provider>
    </UIStoreContext.Provider>
  );
}

// Hooks
export function useUIStore<T>(selector: (state: UIState) => T): T {
  const store = useContext(UIStoreContext);
  if (!store) throw new Error("useUIStore must be used within StoreProvider");
  return useStore(store, selector);
}

export function usePreferencesStore<T>(selector: (state: PreferencesState) => T): T {
  const store = useContext(PreferencesStoreContext);
  if (!store) throw new Error("usePreferencesStore must be used within StoreProvider");
  return useStore(store, selector);
}

// Hydration hook for SSR safety
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

// Re-export types
export type { UIState, PreferencesState };
