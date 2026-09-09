import type { Metadata } from "next";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { getRepository } from "@/lib/ci/repository";

export function generateMetadata(): Metadata {
  const repo = getRepository();
  return { title: `CI Watcher — ${repo.name}` };
}

export default function Home() {
  const repo = getRepository();
  return <DashboardClient repo={repo} />;
}
