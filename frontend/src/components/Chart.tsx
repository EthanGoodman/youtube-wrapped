import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { tooltipStyle } from "../theme";

/** ECharts wrapper with the app's dark defaults (transparent bg, Roboto, styled tooltip). */
export function Chart({ option, height = 260, className = "", onClick, ariaLabel, merge = false }: {
  option: EChartsOption;
  /** update in place instead of replacing (needed for animated sorting, e.g. the bar race) */
  merge?: boolean;
  height?: number | string;
  className?: string;
  onClick?: (params: { name?: string; data?: unknown; dataIndex?: number }) => void;
  ariaLabel?: string;
}) {
  const merged: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "Roboto, system-ui, sans-serif" },
    animationDuration: 500,
    ...option,
    tooltip: option.tooltip === undefined ? undefined : { ...tooltipStyle, ...(option.tooltip as object) },
  };
  return (
    <div role="img" aria-label={ariaLabel} className={className}>
      <ReactECharts
        option={merged}
        notMerge={!merge}
        style={{ height, width: "100%" }}
        opts={{ renderer: "svg" }}
        onEvents={onClick ? { click: onClick } : undefined}
      />
    </div>
  );
}
