"use client";

import {
  Button,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  DrawerActions,
  DrawerCloseButton,
  DrawerHead,
  DrawerPanelBody,
  DrawerPanelContent,
  Flex,
  FlexItem,
  Label,
  Tab,
  Tabs,
  TabTitleText,
  Title,
} from "@patternfly/react-core";
import { RhUiExternalLinkIcon } from "@patternfly/react-icons";
import { useState } from "react";
import { dptoolsUrl } from "@/lib/ci/links";
import type { Analysis, DevVersionResult, SuiteStat } from "@/lib/ci/types";
import { BugPromptPanel } from "./BugPromptPanel";

interface Props {
  suite: SuiteStat;
  analysis: Analysis;
  devVersion: DevVersionResult;
  onClose: () => void;
}

function rateLabel(rate: number, k: number, n: number): string {
  return `${Math.round(rate * 100)}% (${k}/${n})`;
}

export function SuiteDetailPanel({
  suite,
  analysis,
  devVersion,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState(0);

  const searchUrl = dptoolsUrl({
    searchTerm: suite.searchTerm,
    jobName: analysis.job.name,
    windowDays: analysis.windowDays,
  });

  return (
    <DrawerPanelContent widths={{ default: "width_50" }}>
      <DrawerHead>
        <Flex direction={{ default: "column" }} gap={{ default: "gapXs" }}>
          <FlexItem>
            <Title headingLevel="h3" size="md">
              {suite.name.split("/").pop() ?? suite.name}
            </Title>
          </FlexItem>
          <FlexItem>
            <code style={{ fontSize: 11, wordBreak: "break-all" }}>
              {suite.name}
            </code>
          </FlexItem>
          {suite.origin === "ci-operator" && (
            <FlexItem>
              <Label color="grey" isCompact>
                CI operator step
              </Label>
            </FlexItem>
          )}
        </Flex>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>

      <DrawerPanelBody>
        <Flex direction={{ default: "column" }} gap={{ default: "gapMd" }}>
          {/* Stats */}
          <FlexItem>
            <DescriptionList
              isHorizontal
              columnModifier={{ default: "2Col" }}
              isCompact
            >
              <DescriptionListGroup>
                <DescriptionListTerm>Unhealthy rate</DescriptionListTerm>
                <DescriptionListDescription>
                  {rateLabel(
                    suite.unhealthyRate,
                    suite.failedIn + suite.flakedIn,
                    suite.appearedIn,
                  )}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Hard failure rate</DescriptionListTerm>
                <DescriptionListDescription>
                  {rateLabel(
                    suite.failureRate,
                    suite.failedIn,
                    suite.appearedIn,
                  )}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Flake rate</DescriptionListTerm>
                <DescriptionListDescription>
                  {rateLabel(suite.flakeRate, suite.flakedIn, suite.appearedIn)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Runs in window</DescriptionListTerm>
                <DescriptionListDescription>
                  {suite.appearedIn}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </FlexItem>

          {/* dptools link */}
          <FlexItem>
            <Button
              component="a"
              href={searchUrl}
              target="_blank"
              rel="noreferrer"
              variant="primary"
              icon={<RhUiExternalLinkIcon />}
              iconPosition="end"
            >
              Search across jobs (dptools)
            </Button>
          </FlexItem>

          {/* Tabs */}
          <FlexItem>
            <Tabs
              activeKey={activeTab}
              onSelect={(_e, k) => setActiveTab(Number(k))}
              aria-label="Suite details"
            >
              <Tab
                eventKey={0}
                title={<TabTitleText>Failing runs</TabTitleText>}
              >
                <div style={{ padding: "8px 0" }}>
                  {suite.failingBuildIds.length === 0 ? (
                    <p>No hard failures in this window.</p>
                  ) : (
                    suite.failingBuildIds.map((bid) => {
                      const build = analysis.builds.find((b) => b.id === bid);
                      return (
                        <div
                          key={bid}
                          style={{ marginBottom: 6, fontSize: 13 }}
                        >
                          <Button
                            component="a"
                            href={build?.spyglassUrl}
                            target="_blank"
                            rel="noreferrer"
                            variant="link"
                            isInline
                            icon={<RhUiExternalLinkIcon />}
                            iconPosition="end"
                          >
                            {bid}
                          </Button>{" "}
                          {build?.startedIso?.slice(0, 10) ?? ""}
                          {build?.prNumber && (
                            <>
                              {" — PR "}
                              <Button
                                component="a"
                                href={`https://github.com/openshift/console/pull/${build.prNumber}`}
                                target="_blank"
                                rel="noreferrer"
                                variant="link"
                                isInline
                              >
                                #{build.prNumber}
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </Tab>

              <Tab
                eventKey={1}
                title={<TabTitleText>Top failures</TabTitleText>}
              >
                <div style={{ padding: "8px 0" }}>
                  {suite.topCases.length === 0 ? (
                    <p>No failure details recorded.</p>
                  ) : (
                    suite.topCases.map((tc) => (
                      <div key={tc.name} style={{ marginBottom: 12 }}>
                        <p
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            marginBottom: 4,
                          }}
                        >
                          {tc.name} — failed in {tc.failedIn}/{suite.appearedIn}{" "}
                          runs
                        </p>
                        {tc.messages.map((m) => (
                          <CodeBlock
                            key={m.message}
                            style={{ marginBottom: 4 }}
                          >
                            <CodeBlockCode>{m.message}</CodeBlockCode>
                          </CodeBlock>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </Tab>

              <Tab eventKey={2} title={<TabTitleText>OCPBUGS</TabTitleText>}>
                <div style={{ padding: "8px 0" }}>
                  <BugPromptPanel
                    analysis={analysis}
                    suite={suite}
                    devVersion={devVersion}
                  />
                </div>
              </Tab>
            </Tabs>
          </FlexItem>
        </Flex>
      </DrawerPanelBody>
    </DrawerPanelContent>
  );
}
