"use client";
/**
 * Chart palette (validated with the dataviz palette validator on both surfaces: light #ffffff, dark #11151d).
 * Categorical hues are assigned in FIXED slot order (never cycled); past 8 series fold into "Other".
 * Scatter/all-pairs charts cap at the first three slots. Status colours are reserved for state, never series.
 */
import * as React from "react";

export const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

/** Single-hue sequential ramp (blue), light -> dark. Use steps 250+ (light) / up to 600 (dark) for ordinal marks. */
export const SEQUENTIAL = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"] as const;

export const DIVERGING = { negative: "#e34948", neutral: { light: "#f0efec", dark: "#383835" }, positive: "#2a78d6" } as const;

/** Status colours mirror the design tokens; always pair with an icon or label. */
export const STATUS = { good: "var(--success)", warning: "var(--warning)", serious: "var(--danger)", critical: "var(--critical)", info: "var(--info)", neutral: "var(--fg-subtle)" } as const;

export const CHART_TEXT = { primary: "var(--fg)", secondary: "var(--fg-muted)", muted: "var(--fg-subtle)", grid: "var(--border)", axis: "var(--border-strong)" } as const;

export function useChartTheme() {
  const [mode, setMode] = React.useState<"light" | "dark">("dark");
  React.useEffect(() => {
    const read = () => setMode(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return { mode, series: CATEGORICAL[mode] as readonly string[], sequential: SEQUENTIAL, diverging: DIVERGING, status: STATUS, text: CHART_TEXT, tooltipStyle: { background: "var(--surface-3)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--fg)", fontSize: 12 } as React.CSSProperties };
}

/** Deterministic colour for a named series across charts (entity-stable, independent of rank). */
export function seriesColor(index: number, mode: "light" | "dark" = "dark"): string {
  const p = CATEGORICAL[mode];
  return p[Math.min(index, p.length - 1)];
}
