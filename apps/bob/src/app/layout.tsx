import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { cn } from "@gmacko/core/ui";
import { ThemeProvider } from "@gmacko/core/ui/theme";
import { ThemeToggle } from "@gmacko/core/ui/theme-toggle";
import { Toaster } from "@gmacko/core/ui/toast";

import { TRPCReactProvider } from "~/trpc/react";
import { BobRpcProvider } from "~/rpc/react";
import { Providers } from "./providers";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.FRONTEND_URL ?? "https://blder.bot",
  ),
  title: "blder.bot - AI Agent Manager",
  description: "Manage AI agents, plan work, and ship code with blder.bot",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "blder.bot - AI Agent Manager",
    description: "Manage AI agents, plan work, and ship code with blder.bot",
    url: "https://blder.bot",
    siteName: "blder.bot",
  },
};

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#141310" },
  ],
};

const satoshi = localFont({
  src: [
    { path: "../../public/fonts/satoshi/satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/satoshi/satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/satoshi/satoshi-700.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/satoshi/satoshi-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const dmSans = localFont({
  src: [
    { path: "../../public/fonts/dm-sans/dm-sans-latin-variable.woff2", weight: "100 900", style: "normal" },
    { path: "../../public/fonts/dm-sans/dm-sans-latin-italic-variable.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetBrainsMono = localFont({
  src: [
    { path: "../../public/fonts/jetbrains-mono/jetbrains-mono-latin-variable.woff2", weight: "100 800", style: "normal" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
  preload: false,
});

export default function RootLayout(props: { children: React.ReactNode; params: Promise<any> }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          satoshi.variable,
          dmSans.variable,
          jetBrainsMono.variable,
        )}
      >
        <ThemeProvider defaultTheme="bob">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <TRPCReactProvider>
            <BobRpcProvider>
              <Providers>{props.children}</Providers>
            </BobRpcProvider>
          </TRPCReactProvider>
          <div className="fixed right-6 bottom-20 z-50">
            <ThemeToggle />
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
