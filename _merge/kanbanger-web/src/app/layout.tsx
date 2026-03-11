import React from "react";
import type { Metadata } from "next";
import { TRPCProvider } from "@/lib/trpc/provider";
import { PostHogProvider } from "@/lib/posthog";
import { ThemeProvider } from "@/lib/theme/provider";
import { StoreProvider } from "@linear-clone/store/web";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tasks",
  description: "Modern task tracking for high-performance teams",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
  manifest: "/manifest.json",
};

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PostHogProvider>
        <TRPCProvider>
          <StoreProvider>{children}</StoreProvider>
        </TRPCProvider>
      </PostHogProvider>
    </ThemeProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
