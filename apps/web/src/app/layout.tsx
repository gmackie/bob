import { ThemeProvider } from "@gmacko/ui";
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
        <ThemeProvider defaultTheme="ooda">{children}</ThemeProvider>
      </body>
    </html>
  );
}
