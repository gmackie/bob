import "./globals.css";
import { GmackoAppProviders } from "@gmacko/app-shell";

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
        <GmackoAppProviders
          defaultTheme="ooda"
          defaultMode="system"
          rpcOptions={{ baseURL: "/api/rpc" }}
        >
          {children}
        </GmackoAppProviders>
      </body>
    </html>
  );
}
