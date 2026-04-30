import "./globals.css";
import { TRPCReactProvider } from "../trpc/react";

export const metadata = {
  title: "OODA",
  description: "OODA — research workstation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
