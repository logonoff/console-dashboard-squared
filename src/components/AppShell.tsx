"use client";

import { Page } from "@patternfly/react-core";
import type { ReactNode } from "react";

/**
 * Thin client wrapper around PF <Page>. Receives server-rendered children as a
 * prop so they stay outside this component's client module graph.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Page isContentFilled sidebar={null}>
      {children}
    </Page>
  );
}
