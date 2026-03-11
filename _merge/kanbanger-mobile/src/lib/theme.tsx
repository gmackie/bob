import React, { createContext, useContext, useState, useEffect } from "react";
import { useColorScheme } from "react-native";
import { palette } from "./styles";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Define semantic color type explicitly to allow different values between themes
type SemanticColors = {
  background: string;
  surface: string;
  surfaceHighlight: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  primary: string;
  primaryForeground: string;
  danger: string;
  success: string;
  warning: string;
  overlay: string;
};

export type ThemeColors = SemanticColors & typeof palette;

export interface Theme {
  colors: ThemeColors;
  dark: boolean;
}

export const lightTheme: Theme = {
  colors: {
    background: palette["gray-50"],
    surface: palette["white"],
    surfaceHighlight: palette["gray-100"],
    text: palette["gray-900"],
    textSecondary: palette["gray-500"],
    textTertiary: palette["gray-400"],
    border: palette["gray-200"],
    primary: palette["indigo-600"],
    primaryForeground: palette["white"],
    danger: palette["red-600"],
    success: palette["green-600"],
    warning: palette["orange-600"],
    overlay: "rgba(0, 0, 0, 0.5)",
    ...palette,
  },
  dark: false,
};

export const darkTheme: Theme = {
  colors: {
    background: palette["gray-900"],
    surface: palette["gray-800"],
    surfaceHighlight: palette["gray-700"],
    text: palette["gray-50"],
    textSecondary: palette["gray-400"],
    textTertiary: palette["gray-500"],
    border: palette["gray-700"],
    primary: palette["indigo-500"],
    primaryForeground: palette["white"],
    danger: palette["red-500"],
    success: palette["green-500"],
    warning: palette["orange-500"],
    overlay: "rgba(0, 0, 0, 0.7)",
    ...palette,
  },
  dark: true,
};

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  colors: ThemeColors;
  toggleTheme: () => void;
  setScheme: (scheme: "light" | "dark" | "system") => void;
  scheme: "light" | "dark" | "system";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "app_theme_preference";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [scheme, setSchemeState] = useState<"light" | "dark" | "system">("system");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === "light" || saved === "dark" || saved === "system") {
          setSchemeState(saved);
        }
      } catch (e) {
      } finally {
        setIsReady(true);
      }
    };
    loadTheme();
  }, []);

  const setScheme = async (newScheme: "light" | "dark" | "system") => {
    setSchemeState(newScheme);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newScheme);
    } catch (e) {
    }
  };

  const activeScheme = scheme === "system" ? systemColorScheme ?? "light" : scheme;
  const isDark = activeScheme === "dark";
  const theme = isDark ? darkTheme : lightTheme;

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    setScheme(next);
  };

  if (!isReady) {
    return null; 
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark,
        colors: theme.colors,
        toggleTheme,
        setScheme,
        scheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
