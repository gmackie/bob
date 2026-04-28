"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const EMPTY_SEARCH_PARAMS = new URLSearchParams();

export function useAppNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = searchParams ?? EMPTY_SEARCH_PARAMS;

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
    return params.get("worktree");
  }, [params]);

  const getRepositoryIdFromUrl = useCallback(() => {
    return params.get("repository");
  }, [params]);

  return {
    navigate,
    navigateToWorktree,
    navigateToRepository,
    navigateToDatabase,
    navigateHome,
    getWorktreeIdFromUrl,
    getRepositoryIdFromUrl,
    pathname,
    searchParams: params,
    router,
  };
}

export { useRouter, usePathname, useSearchParams } from "next/navigation";
