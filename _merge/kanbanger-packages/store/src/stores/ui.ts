import { createStore } from "zustand";

export interface UIState {
  // State
  sidebarOpen: boolean;
  activeModal: string | null;
  theme: "light" | "dark" | "system";

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openModal: (modalId: string) => void;
  closeModal: () => void;
  setTheme: (theme: UIState["theme"]) => void;
}

export const createUIStore = () =>
  createStore<UIState>((set) => ({
    // Initial state
    sidebarOpen: false,
    activeModal: null,
    theme: "system",

    // Actions
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    openModal: (modalId) => set({ activeModal: modalId }),
    closeModal: () => set({ activeModal: null }),
    setTheme: (theme) => set({ theme }),
  }));

export type UIStore = ReturnType<typeof createUIStore>;
