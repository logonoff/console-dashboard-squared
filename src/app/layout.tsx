import type { Metadata } from "next";
import "@patternfly/react-core/dist/styles/base.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { THEME_BOOTSTRAP, ThemeSync } from "@/components/ThemeSync";

export const metadata: Metadata = {
  title: "Dashboard²",
  description: "OpenShift Console CI failure heatmap",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning because the THEME_BOOTSTRAP script mutates
    // className before React hydrates, causing an intentional mismatch.
    <html lang="en" className="pf-v6-theme-glass" suppressHydrationWarning>
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: theme bootstrap must run before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <ThemeSync />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
