import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef } from "react";
import type { FindFilesScreenState } from "../../app/appTypes";
import { AgentOutputLog } from "../../components/AgentOutputLog";
import {
  getFileContextItemId,
  hasContextItem,
} from "../../lib/context/contextItems";
import { getVerticalNavigationDirection } from "../../lib/keymap";
import { useAppStore } from "../../store/appStore";
import { runPiFileSearchAgent } from "./piFileSearchAgent";

type FindFilesScreenProps = {
  screen: FindFilesScreenState;
};

export function FindFilesScreen({ screen }: FindFilesScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useEffect(() => {
    if (screen.status !== "searching") {
      return;
    }

    let cancelled = false;
    void runPiFileSearchAgent({
      goal: screen.goal,
      hints: screen.hints,
      onAgentOutput: (update) => {
        if (!cancelled) {
          actions.findFiles.recordAgentOutput({ update });
        }
      },
    }).then(
      (candidates) => {
        if (!cancelled) {
          actions.findFiles.finish({ candidates });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          actions.findFiles.fail({
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [actions.findFiles, screen.goal, screen.hints, screen.status]);

  useKeyboard((event) => {
    if (screen.status === "searching") {
      return;
    }

    if (event.name === "escape") {
      event.preventDefault();
      event.stopPropagation();
      actions.navigation.showComposer();
      return;
    }

    if (screen.status === "error") {
      return;
    }

    const verticalNavigationDirection = getVerticalNavigationDirection(event);
    if (verticalNavigationDirection !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (verticalNavigationDirection === "next") {
        actions.findFiles.selectNext();
      } else {
        actions.findFiles.selectPrevious();
      }
      return;
    }

    if (event.name === "a") {
      event.preventDefault();
      event.stopPropagation();
      actions.findFiles.addAllCandidates();
      return;
    }

    if (isEnterKey(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      actions.findFiles.addSelectedCandidate();
    }
  });

  return (
    <box
      title="Find relevant files"
      bottomTitle={getBottomTitle(screen)}
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        gap: 1,
        padding: 1,
        width: "100%",
      }}
    >
      <box
        title="Search goal"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        <text>{screen.goal}</text>
        {screen.hints.length === 0 ? null : (
          <text
            style={{ fg: "gray" }}
          >{`Hints: ${screen.hints.join(", ")}`}</text>
        )}
      </box>
      {screen.status === "searching" ? <SearchingView screen={screen} /> : null}
      {screen.status === "error" ? (
        <ErrorView errorMessage={screen.errorMessage ?? "Unknown error"} />
      ) : null}
      {screen.status === "results" ? <ResultsView screen={screen} /> : null}
    </box>
  );
}

function SearchingView({ screen }: { screen: FindFilesScreenState }) {
  return (
    <box
      title="Searching"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      <text>Running a read-only pi agent to find relevant files...</text>
      <AgentOutputLog
        blocks={screen.agentOutput}
        emptyMessage="Waiting for pi activity..."
        height={24}
      />
    </box>
  );
}

function ErrorView({ errorMessage }: { errorMessage: string }) {
  return (
    <box
      title="Search failed"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      <text style={{ fg: "red" }}>{errorMessage}</text>
    </box>
  );
}

function ResultsView({ screen }: { screen: FindFilesScreenState }) {
  const contextItems = useAppStore((state) => state.workspace.contextItems);
  const scrollBoxRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    scrollBoxRef.current?.scrollChildIntoView(
      getCandidateRowId(screen.selectedIndex),
    );
  }, [screen.selectedIndex]);

  if (screen.candidates.length === 0) {
    return (
      <box
        title="Results"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        <text>No relevant files were found.</text>
      </box>
    );
  }

  return (
    <box
      title="Results"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      <scrollbox ref={scrollBoxRef} style={{ height: 30, width: "100%" }}>
        {screen.candidates.map((candidate, index) => {
          const selected = index === screen.selectedIndex;
          const confidence = candidate.confidence ?? "unknown";
          const isAdded = hasContextItem(
            contextItems,
            getFileContextItemId(candidate.path),
          );

          return (
            <box
              id={getCandidateRowId(index)}
              key={candidate.path}
              style={{ flexDirection: "column", marginBottom: 1 }}
            >
              <text style={selected ? { bg: "blue", fg: "white" } : undefined}>
                {`${selected ? ">" : " "} ${isAdded ? "✓" : " "} ${candidate.path} (${confidence})`}
              </text>
              <text style={{ fg: "gray" }}>{`  ${candidate.reason}`}</text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}

function getBottomTitle(screen: FindFilesScreenState): string | undefined {
  if (screen.status === "searching") {
    return undefined;
  }

  if (screen.status === "error") {
    return "Esc back";
  }

  if (screen.candidates.length === 0) {
    return "Esc back";
  }

  return "Enter add · a add all · ↑/↓/Ctrl+n/Ctrl+p move · Esc done";
}

function getCandidateRowId(index: number): string {
  return `find-files-candidate-${index}`;
}

function isEnterKey(keyName: string): boolean {
  return (
    keyName === "return" || keyName === "kpenter" || keyName === "linefeed"
  );
}
