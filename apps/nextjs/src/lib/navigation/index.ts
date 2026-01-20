"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useAppNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = useCallback(
    (path: string) => {
      router.push(path);
    },
    [router],
  );

  const navigateToWorktree = useCallback(
    (worktreeId: string) => {
      router.push(`/?worktree=${worktreeId}`);
    },
    [router],
  );

  const navigateToRepository = useCallback(
    (repositoryId: string) => {
      router.push(`/?repository=${repositoryId}`);
    },
    [router],
  );

  const navigateToDatabase = useCallback(() => {
    router.push("/database");
  }, [router]);

  const navigateHome = useCallback(() => {
    router.push("/");
  }, [router]);

  const getWorktreeIdFromUrl = useCallback(() => {
    return searchParams.get("worktree");
  }, [searchParams]);

  const getRepositoryIdFromUrl = useCallback(() => {
    return searchParams.get("repository");
  }, [searchParams]);

  return {
    navigate,
    navigateToWorktree,
    navigateToRepository,
    navigateToDatabase,
    navigateHome,
    getWorktreeIdFromUrl,
    getRepositoryIdFromUrl,
    pathname,
    searchParams,
    router,
  };
}

export { useRouter, usePathname, useSearchParams } from "next/navigation";
