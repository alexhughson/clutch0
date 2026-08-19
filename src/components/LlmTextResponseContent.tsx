import type { LlmRequestLatencyStats } from "../app/appTypes";
import {
  HighlightedMarkdown,
  type HighlightedMarkdownProps,
} from "./SyntaxHighlightedContent";

type LlmTextResponseContentProps = {
  errorMessage?: string;
  hotkeys?: string;
  latencyStats?: LlmRequestLatencyStats;
  question?: string;
  responseText: string;
  status?: "done" | "error" | "loading" | "streaming";
  streaming?: HighlightedMarkdownProps["streaming"];
};

export function LlmTextResponseContent({
  errorMessage,
  hotkeys,
  latencyStats,
  question,
  responseText,
  status = "done",
  streaming,
}: LlmTextResponseContentProps) {
  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        height: question === undefined ? undefined : "100%",
        minHeight: question === undefined ? 1 : 0,
        padding: question === undefined ? 0 : 1,
        width: "100%",
      }}
    >
      {question === undefined ? null : (
        <>
          <text style={{ fg: "gray" }}>{`Question · ${formatStatus(status)}`}</text>
          <text>{question}</text>
          <LatencyStats stats={latencyStats} />
        </>
      )}
      <box
        style={{
          flexDirection: "column",
          flexGrow: 1,
          gap: 1,
          minHeight: 1,
          width: "100%",
        }}
      >
        <text style={{ fg: "gray" }}>Response</text>
        <scrollbox style={{ flexGrow: 1, minHeight: 0, height: "100%", width: "100%" }}>
          {responseText.length > 0 ? (
            <HighlightedMarkdown content={responseText} streaming={streaming} />
          ) : (
            <text>{status === "loading" ? "Waiting for model..." : ""}</text>
          )}
        </scrollbox>
        {status === "error" ? (
          <text style={{ fg: "red" }}>{errorMessage}</text>
        ) : null}
        {hotkeys === undefined ? null : (
          <text style={{ fg: "gray" }}>{hotkeys}</text>
        )}
      </box>
    </box>
  );
}

function LatencyStats({ stats }: { stats?: LlmRequestLatencyStats }) {
  if (stats === undefined) {
    return null;
  }

  return (
    <text style={{ fg: "gray" }}>{`Latency · TTFT ${formatOptionalLatency(
      stats.ttftMs,
      "n/a",
    )} · total ${formatOptionalLatency(stats.totalMs, "pending")}`}</text>
  );
}

function formatStatus(status: NonNullable<LlmTextResponseContentProps["status"]>): string {
  if (status === "done") {
    return "complete";
  }

  return status;
}

export function formatOptionalLatency(
  milliseconds: number | undefined,
  fallback: string,
): string {
  if (milliseconds === undefined) {
    return fallback;
  }

  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}
