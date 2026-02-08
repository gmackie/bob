import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";

export const dynamic = "force-dynamic";

export default async function ChatLayout(props: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return props.children;
}
