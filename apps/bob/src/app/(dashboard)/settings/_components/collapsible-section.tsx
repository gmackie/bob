"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@gmacko/core/ui";

interface CollapsibleSectionProps {
  title: string;
  sectionId?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  sectionId,
  defaultOpen = true,
  forceOpen,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen || !!forceOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen && ref.current) {
      setIsOpen(true);
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [forceOpen]);

  return (
    <div ref={ref} id={sectionId} className="border-b border-border pb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <svg
          className={cn(
            "h-5 w-5 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isOpen && <div className="mt-4">{children}</div>}
    </div>
  );
}
