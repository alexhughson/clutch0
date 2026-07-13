import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef } from "react";
import type { FindFilesScreenState } from "../../app/appTypes";
import { AgentOutputLog } from "../../components/AgentOutputLog";
import {
  getFileContextItemId,
  hasContextItem,
} from "../../lib/context/contextItemFactories";
import { getVerticalNavigationDirection, isEnterKey } from "../../lib/keymap";
import { useAppStore } from "../../store/appStore";
import { startFindFilesSearch } from "./findFilesSearchController";

type FindFilesScreenProps = {
  screen: FindFilesScreenState;
};

export function FindFilesScreen({ screen }: FindFilesScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useEffect(() => {
    if (screen.status !== "searching") {
      return;
    }

    return startFindFilesSearch({
      actions: actions.findFiles,
      screen,
    });
  }, [actions.findFiles, screen.goal, screen.hints, screen.status]);

  useKeyboard((event) => {
    if (screen.status === "searching") {
      return;
    }

    if (event.name === "escape") {
      event.preventDefault();
      event.stopPropagation();
      actions.navigation.rejectToEdit();
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
        flexGrow: 1,
        gap: 1,
        height: "100%",
        padding: 1,
        width: "100%",
      }}
    >
      <text style={{ fg: "gray" }}>Search goal</text>
      <text>{screen.goal}</text>
      {screen.hints.length === 0 ? null : (
        <text
          style={{ fg: "gray" }}
        >{`Hints: ${screen.hints.join(", ")}`}</text>
      )}
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
    <box style={{ flexDirection: "column", flexGrow: 1, gap: 1 }}>
      <text style={{ fg: "gray" }}>Searching</text>
      <text>Running LLM file search...</text>
      <AgentOutputLog
        blocks={screen.agentOutput}
        emptyMessage="Waiting for file search activity..."
        height={32}
      />
    </box>
  );
}

function ErrorView({ errorMessage }: { errorMessage: string }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, gap: 1 }}>
      <text style={{ fg: "gray" }}>Search failed</text>
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
      <box style={{ flexDirection: "column", flexGrow: 1, gap: 1 }}>
        <text style={{ fg: "gray" }}>Results</text>
        <text>No relevant files were found.</text>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, gap: 1 }}>
      <text style={{ fg: "gray" }}>Results</text>
      <scrollbox
        ref={scrollBoxRef}
        style={{ flexGrow: 1, height: "100%", width: "100%" }}
      >
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

  return "Enter add · a add all · ↑/↓/Ctrl+n/Ctrl+p move · Esc edit prompt";
}

function getCandidateRowId(index: number): string {
  return `find-files-candidate-${index}`;
}
