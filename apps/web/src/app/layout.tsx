import { ThemeProvider } from "@gmacko/ui";
import { TRPCProvider } from "@/trpc/react";
import "./globals.css";

export const metadata = {
  title: "Gmacko",
  description: "Research workstation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <TRPCProvider>
          <ThemeProvider defaultTheme="ooda">{children}</ThemeProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
