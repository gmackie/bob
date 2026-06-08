import { redirect } from "next/navigation";

import { getDefaultSidebarShellHref } from "~/components/layout/sidebar-nav-model";

export default function DashboardRootPage() {
  redirect(getDefaultSidebarShellHref());
}
