"use client";

import {
  Button,
  ClipboardCopy,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";
import { useMemo } from "react";
import { AGGREGATE_BRANCH } from "@/lib/ci/constants";
import type { Repository } from "@/lib/ci/repository";
import type { Analysis, DevVersionResult } from "@/lib/ci/types";
import { generateBulkTriagePrompt } from "@/lib/jira/bulkPrompt";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  analysis: Analysis;
  devVersion: DevVersionResult;
  repo: Repository;
}

export function BulkTriageModal({
  isOpen,
  onClose,
  analysis,
  devVersion,
  repo,
}: Props) {
  const prompt = useMemo(
    () => generateBulkTriagePrompt(analysis, devVersion, repo),
    [analysis, devVersion, repo],
  );

  const actionableCount = analysis.suites.filter(
    (s) => s.unhealthyRate >= 0.1,
  ).length;

  const apiUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const params = new URLSearchParams({ days: String(analysis.windowDays) });
    if (analysis.job.branch === AGGREGATE_BRANCH) {
      params.set("suffix", analysis.job.suffix);
    } else {
      params.set("job", analysis.job.name);
    }
    return `${origin}/api/bulk-prompt?${params}`;
  }, [analysis]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="large"
      aria-label="Bulk OCPBUGS triage prompt"
    >
      <ModalHeader title="Bulk OCPBUGS triage prompt" />
      <ModalBody>
        <p style={{ marginBottom: "0.75rem", fontSize: 14 }}>
          This prompt covers all <strong>{actionableCount}</strong> suite
          {actionableCount !== 1 ? "s" : ""} with an unhealthy rate ≥ 10%. Copy
          it and paste it into an LLM (Claude, ChatGPT, etc.). The LLM will:
        </p>
        <ol
          style={{
            marginBottom: "1rem",
            paddingLeft: "1.5rem",
            fontSize: 14,
            lineHeight: 1.8,
          }}
        >
          <li>
            Run a broad JIRA dedup check once to load all existing ci-watcher
            bugs into its context.
          </li>
          <li>
            For each suite in order: search JIRA for an existing OCPBUGS —
            comment on it if found, create a new bug if not.
          </li>
          <li>
            Never file duplicates. Never assert root causes. Never create bugs
            for suites below the 10% threshold.
          </li>
        </ol>
        <p
          style={{
            marginBottom: "1rem",
            fontSize: 13,
            color: "var(--pf-t--global--text--color--subtle)",
          }}
        >
          The dashboard itself does not create any JIRA issues.
        </p>

        <p
          style={{
            marginBottom: "0.25rem",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          API endpoint — call this directly from a Claude skill or script:
        </p>
        <ClipboardCopy
          variant="inline"
          isReadOnly
          hoverTip="Copy URL"
          clickTip="Copied!"
          style={{
            marginBottom: "1rem",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          {apiUrl}
        </ClipboardCopy>

        <ClipboardCopy
          variant="expansion"
          isCode
          isReadOnly
          hoverTip="Copy prompt"
          clickTip="Copied!"
          style={{ maxHeight: 480, overflowY: "auto" }}
        >
          {prompt}
        </ClipboardCopy>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
