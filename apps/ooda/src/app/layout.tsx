import "./globals.css";
import { GmackoAppProviders } from "@gmacko/core/app-shell";

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
        <GmackoAppProviders
          defaultTheme="ooda"
          defaultMode="system"
          rpcOptions={{
            baseURL:
              process.env.NEXT_PUBLIC_RPC_BASE_URL ??
              "http://localhost:3000/api/rpc",
          }}
        >
          {children}
        </GmackoAppProviders>
      </body>
    </html>
  );
}
