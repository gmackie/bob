import { ThemeProvider } from "@gmacko/core/ui/theme";

import "~/app/globals.css";

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>blder.bot</title>
        <meta
          name="description"
          content="blder.bot platform -- hub for Bob, OODA, and gmacko services."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background font-[Geist,sans-serif] text-foreground antialiased">
        <ThemeProvider defaultTheme="bob">{props.children}</ThemeProvider>
      </body>
    </html>
  );
}
