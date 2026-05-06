"use client";

import { useEffect } from "react";

export default function HomePage() {
  useEffect(() => {
    window.location.replace("/oracle");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111113]">
      <span className="text-sm text-[#6B6560]">Redirecting to Oracle...</span>
    </div>
  );
}
