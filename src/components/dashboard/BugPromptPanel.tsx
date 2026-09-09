"use client";

import {
  Button,
  ClipboardCopy,
  Flex,
  FlexItem,
  Title,
} from "@patternfly/react-core";
import { ExternalLinkAltIcon } from "@patternfly/react-icons";
import { useMemo } from "react";
import type { Analysis, DevVersionResult, SuiteStat } from "@/lib/ci/types";
import { generateBugPrompt } from "@/lib/jira/prompt";

interface Props {
  analysis: Analysis;
  suite: SuiteStat;
  devVersion: DevVersionResult;
}

export function BugPromptPanel({ analysis, suite, devVersion }: Props) {
  const { markdown, jqlUrl } = useMemo(
    () => generateBugPrompt({ analysis, suite, devVersion }),
    [analysis, suite, devVersion],
  );

  return (
    <Flex direction={{ default: "column" }} gap={{ default: "gapSm" }}>
      <FlexItem>
        <Title headingLevel="h4" size="md">
          OCPBUGS — LLM triage prompt
        </Title>
      </FlexItem>
      <FlexItem>
        <p
          style={{
            fontSize: 13,
            color: "var(--pf-t--global--text--color--subtle)",
          }}
        >
          Copy this markdown and paste it into an LLM. The LLM will check for an
          existing OCPBUGS and file one with the correct target version if
          absent. The dashboard itself does not create any JIRA issues.
        </p>
      </FlexItem>
      <FlexItem>
        <Button
          component="a"
          href={jqlUrl}
          target="_blank"
          rel="noreferrer"
          variant="secondary"
          icon={<ExternalLinkAltIcon />}
          iconPosition="end"
          size="sm"
        >
          Pre-check: search JIRA for existing bug
        </Button>
      </FlexItem>
      <FlexItem>
        <ClipboardCopy
          variant="expansion"
          isCode
          isReadOnly
          hoverTip="Copy prompt"
          clickTip="Copied!"
        >
          {markdown}
        </ClipboardCopy>
      </FlexItem>
    </Flex>
  );
}
