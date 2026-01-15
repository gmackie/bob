import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { cn } from "@bob/ui";
import { ThemeProvider, ThemeToggle } from "@bob/ui/theme";
import { Toaster } from "@bob/ui/toast";

import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";
import { Providers } from "./providers";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production"
      ? "https://bob.app"
      : "http://localhost:43829",
  ),
  title: "Bob - AI Agent Manager",
  description: "Manage multiple AI agent instances across git repositories and worktrees",
  openGraph: {
    title: "Bob - AI Agent Manager",
    description: "Manage multiple AI agent instances across git repositories and worktrees",
    url: "https://bob.app",
    siteName: "Bob",
  },
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
        <ThemeProvider>
          <Providers>
            <TRPCReactProvider>{props.children}</TRPCReactProvider>
          </Providers>
          <div className="absolute right-4 bottom-4">
            <ThemeToggle />
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
