import React, {
  createContext,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { createUIStore, type UIStore, type UIState } from "./stores/ui";
import {
  createPreferencesStore,
  type PreferencesStore,
  type PreferencesState,
} from "./stores/preferences";

// AsyncStorage adapter (requires @react-native-async-storage/async-storage)
function createAsyncStorageAdapter() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return {
      getItem: async (name: string) => {
        return AsyncStorage.getItem(name);
      },
      setItem: async (name: string, value: string) => {
        await AsyncStorage.setItem(name, value);
      },
      removeItem: async (name: string) => {
        await AsyncStorage.removeItem(name);
      },
    };
  } catch {
    // Fallback to in-memory storage if AsyncStorage not available
    const memory: Record<string, string> = {};
    return {
      getItem: (name: string) => memory[name] ?? null,
      setItem: (name: string, value: string) => {
        memory[name] = value;
      },
      removeItem: (name: string) => {
        delete memory[name];
      },
    };
  }
}

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
    const storage = createAsyncStorageAdapter();
    preferencesStoreRef.current = createPreferencesStore(storage);
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

// Re-export types
export type { UIState, PreferencesState };
