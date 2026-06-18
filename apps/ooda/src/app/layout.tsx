import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { cn } from "@gmacko/core/ui";
import { ThemeProvider } from "@gmacko/core/ui/theme";
import { Toaster } from "@gmacko/core/ui";
import { ThemeSwitcher } from "@gmacko/core/ui";

import { TRPCReactProvider } from "~/trpc/react";
import { AppShell } from "~/components/app-shell";

import "~/app/globals.css";

export const metadata: Metadata = {
  title: "OODA",
  description: "OODA workstation",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          geistSans.variable,
          geistMono.variable,
        )}
      >
        <ThemeProvider defaultTheme="ooda">
          <TRPCReactProvider>
            <AppShell>{props.children}</AppShell>
          </TRPCReactProvider>
          <div className="absolute right-4 bottom-4">
            <ThemeSwitcher />
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
