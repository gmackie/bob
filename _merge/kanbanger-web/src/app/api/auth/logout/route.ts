import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@linear-clone/auth";
import { db } from "@linear-clone/db";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;

  if (sessionToken) {
    try {
      await deleteSession(db, sessionToken);
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  }

  // Clear the session cookie
  cookieStore.delete("session_token");

  // Redirect to home page
  return NextResponse.redirect(new URL("/", request.url));
}

// Also handle GET for form submissions
export async function GET(request: Request) {
  return POST(request);
}
