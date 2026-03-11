import { createStore } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

export interface PreferencesState {
  // State
  locale: string | null; // null = use device/browser default
  onboardingComplete: boolean;

  // Per-project UI preferences
  projectViewById: Record<string, ProjectViewTab>;

  // Actions
  setLocale: (locale: string | null) => void;
  completeOnboarding: () => void;
  setProjectViewForProject: (projectId: string, view: ProjectViewTab) => void;
  resetPreferences: () => void;
}

export type ProjectViewTab = "list" | "board" | "overview" | "documents";

const initialState = {
  locale: null,
  onboardingComplete: false,
  projectViewById: {} as Record<string, ProjectViewTab>,
};

export const createPreferencesStore = (storage: StateStorage) =>
  createStore<PreferencesState>()(
    persist(
      (set) => ({
        ...initialState,

        setLocale: (locale) => set({ locale }),
        completeOnboarding: () => set({ onboardingComplete: true }),
        setProjectViewForProject: (projectId, view) =>
          set((state) => ({
            projectViewById: {
              ...state.projectViewById,
              [projectId]: view,
            },
          })),
        resetPreferences: () => set(initialState),
      }),
      {
        name: "app-preferences",
        storage: createJSONStorage(() => storage),
      }
    )
  );

export type PreferencesStore = ReturnType<typeof createPreferencesStore>;
