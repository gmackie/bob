"use client";

import { conversationsUrlForLegacyList } from "@gmacko/ooda-client/v1";
import { useEffect } from "react";

export default function LegacyThreadsPage() {
  useEffect(() => {
    window.location.replace(
      conversationsUrlForLegacyList(window.location.search),
    );
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111113] text-sm text-[#6B6560]">
      Opening migrated conversations…
    </div>
  );
}
