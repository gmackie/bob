import "~/app/styles.css";

export default function TestLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<any>;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
