import type { Metadata } from "next";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard² — CI Watcher",
};

export default function Home() {
  return <DashboardClient />;
}
