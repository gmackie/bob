import { cn } from "@gmacko/core/ui";
import { ThemeProvider } from "@gmacko/core/ui/theme";
import { Toaster } from "@gmacko/core/ui";
import { ThemeSwitcher } from "@gmacko/core/ui";

import { TRPCReactProvider } from "~/trpc/react";
import { AppShell } from "~/components/app-shell";

import "~/app/globals.css";

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="theme-color"
          content="black"
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content="white"
          media="(prefers-color-scheme: light)"
        />
        <title>OODA</title>
        <meta name="description" content="OODA workstation" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
        )}
        style={{
          fontFamily: "'Geist', sans-serif",
          // @ts-expect-error CSS custom properties
          "--font-geist-sans": "'Geist', sans-serif",
          "--font-geist-mono": "'Geist Mono', monospace",
        }}
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
