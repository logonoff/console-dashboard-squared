import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use as registerCharts } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import sharp from "sharp";

registerCharts([
  LineChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  AriaComponent,
  SVGRenderer,
]);

/** Render the shared ECharts options to SVG, then rasterize without a browser. */
export async function renderCrpPng(
  option: EChartsOption,
  opts: {
    width: number;
    height: number;
    title: string;
    subtitle: string;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const chart = init(null, null, {
    renderer: "svg",
    ssr: true,
    width: opts.width,
    height: opts.height,
  });
  try {
    chart.setOption({
      ...option,
      animation: false,
      backgroundColor: "#ffffff",
      color: ["#0066cc"],
      textStyle: { fontFamily: "sans-serif", color: "#151515" },
      title: {
        text: opts.title,
        subtext: opts.subtitle,
        left: 24,
        top: 16,
        textStyle: { color: "#151515", fontSize: 18 },
        subtextStyle: { color: "#4f5255", fontSize: 12, lineHeight: 18 },
      },
      grid: { left: 100, right: 32, top: 110, bottom: 65 },
      tooltip: { show: false },
      aria: { enabled: false },
      xAxis: {
        ...option.xAxis,
        nameTextStyle: { color: "#151515" },
        axisLabel: { color: "#151515" },
      },
      yAxis: {
        ...option.yAxis,
        splitLine: { show: true, lineStyle: { color: "#e0e0e0" } },
      },
    });
    const svg = chart.renderToSVGString();
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    // Return an owned ArrayBuffer for the web Response API (no SharedArrayBuffer).
    return new Uint8Array(png);
  } finally {
    chart.dispose();
  }
}
