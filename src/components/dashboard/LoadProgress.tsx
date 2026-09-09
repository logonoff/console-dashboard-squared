"use client";

import {
  Button,
  Flex,
  FlexItem,
  Progress,
  ProgressMeasureLocation,
} from "@patternfly/react-core";

interface Props {
  done: number;
  total: number;
  onCancel: () => void;
}

export function LoadProgress({ done, total, onCancel }: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Flex
      alignItems={{ default: "alignItemsCenter" }}
      gap={{ default: "gapMd" }}
      style={{ padding: "16px 12px" }}
    >
      <FlexItem grow={{ default: "grow" }}>
        <Progress
          value={pct}
          title={`Analyzing ${done} / ${total} builds…`}
          measureLocation={ProgressMeasureLocation.outside}
        />
      </FlexItem>
      <FlexItem>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </FlexItem>
    </Flex>
  );
}
