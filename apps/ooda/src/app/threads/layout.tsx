import { HydrateClient, prefetch, trpc } from "~/trpc/server";

export default function ThreadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  prefetch(trpc.threads.list.queryOptions());

  return <HydrateClient>{children}</HydrateClient>;
}
