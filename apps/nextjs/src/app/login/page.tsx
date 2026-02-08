import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { LoginForm } from "./_components/login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-16">
      <LoginForm />
    </main>
  );
}
