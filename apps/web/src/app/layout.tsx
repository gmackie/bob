import { ThemeProvider } from "@gmacko/ui";
import { RpcProvider } from "@/rpc/provider";
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
        <RpcProvider>
          <ThemeProvider defaultTheme="ooda">{children}</ThemeProvider>
        </RpcProvider>
      </body>
    </html>
  );
}
