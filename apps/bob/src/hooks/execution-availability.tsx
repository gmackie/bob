"use client";

import { createContext, useContext, type ReactNode } from "react";

const ExecutionAvailability = createContext(true);
export function ExecutionAvailabilityProvider({ available, children }: { available: boolean; children: ReactNode }) {
  return <ExecutionAvailability.Provider value={available}>{children}</ExecutionAvailability.Provider>;
}
export const useExecutionAvailable = () => useContext(ExecutionAvailability);
