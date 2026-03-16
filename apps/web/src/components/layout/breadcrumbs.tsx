"use client";

import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@radix-ui/react-icons";

import { cn } from "@bob/ui";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1.5 text-sm", className)}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;

        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRightIcon className="size-3 text-white/25" />
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="text-white/50 transition-colors hover:text-white/80"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-white/80" : "text-white/50"}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
