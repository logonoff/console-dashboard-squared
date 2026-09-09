"use client";

import { PageHeader } from "@patternfly/react-component-groups";
import { Content, PageSection } from "@patternfly/react-core";

export default function Home() {
  return (
    <>
      <PageHeader title="Dashboard^2" subtitle="Analyze prow jobs" />
      <PageSection>
        <Content>hi</Content>
      </PageSection>
    </>
  );
}
