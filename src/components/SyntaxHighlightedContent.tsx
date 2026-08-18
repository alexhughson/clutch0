import {
  addDefaultParsers,
  getTreeSitterClient,
  pathToFiletype,
  SyntaxStyle,
  type FiletypeParserOptions,
} from "@opentui/core";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { splitUnifiedDiffByFile } from "../lib/git/unifiedDiffFiles";

let sharedSyntaxStyle: SyntaxStyle | null = null;
let sharedTreeSitterClient: ReturnType<typeof getTreeSitterClient> | null =
  null;

const require = createRequire(import.meta.url);

addDefaultParsers([kotlinFiletypeParser()]);

export function HighlightedCode({
  content,
  filePath,
  filetype,
}: {
  content: string;
  filePath?: string;
  filetype?: string;
}) {
  return (
    <code
      content={content}
      filetype={
        filetype ??
        (filePath === undefined ? undefined : pathToFiletype(filePath))
      }
      syntaxStyle={getSharedSyntaxStyle()}
      treeSitterClient={getSharedTreeSitterClient()}
      wrapMode="none"
      style={{ width: "100%" }}
    />
  );
}

export function HighlightedDiff({ diff }: { diff: string }) {
  const files = splitUnifiedDiffByFile(diff);
  if (files.length <= 1) {
    return <SingleFileHighlightedDiff diff={files[0]?.diff ?? diff} />;
  }

  // OpenTUI's <diff> only renders the first file of a multi-file patch.
  return (
    <box style={{ flexDirection: "column", gap: 1, width: "100%" }}>
      {files.map((file) => (
        <box
          key={file.path}
          style={{ flexDirection: "column", gap: 0, width: "100%" }}
        >
          <text style={{ fg: "#94a3b8" }}>{file.path}</text>
          <SingleFileHighlightedDiff diff={file.diff} />
        </box>
      ))}
    </box>
  );
}

function SingleFileHighlightedDiff({ diff }: { diff: string }) {
  return (
    <diff
      diff={diff}
      view="unified"
      showLineNumbers
      wrapMode="none"
      addedBg="#12351f"
      removedBg="#3a1717"
      addedSignColor="#4ade80"
      removedSignColor="#f87171"
      lineNumberFg="#666666"
      syntaxStyle={getSharedSyntaxStyle()}
      treeSitterClient={getSharedTreeSitterClient()}
      style={{ width: "100%" }}
    />
  );
}

export function HighlightedMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <markdown
      content={content}
      concealCode={false}
      streaming={streaming}
      syntaxStyle={getSharedSyntaxStyle()}
      treeSitterClient={getSharedTreeSitterClient()}
      style={{ width: "100%" }}
    />
  );
}

function getSharedTreeSitterClient(): ReturnType<typeof getTreeSitterClient> {
  sharedTreeSitterClient ??= getTreeSitterClient();
  return sharedTreeSitterClient;
}

function kotlinFiletypeParser(): FiletypeParserOptions {
  return {
    aliases: ["kt", "kts"],
    filetype: "kotlin",
    queries: {
      highlights: [
        fileURLToPath(
          new URL(
            "../assets/tree-sitter/kotlin/highlights.scm",
            import.meta.url,
          ),
        ),
      ],
    },
    wasm: require.resolve("@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm"),
  };
}

function getSharedSyntaxStyle(): SyntaxStyle {
  sharedSyntaxStyle ??= SyntaxStyle.fromStyles({
    attribute: { fg: "#f78c6c" },
    boolean: { fg: "#ffcb6b" },
    comment: { fg: "#697098", italic: true },
    constant: { fg: "#ffcb6b" },
    constructor: { fg: "#ffcb6b" },
    default: { fg: "#d6deeb" },
    emphasis: { italic: true },
    function: { fg: "#82aaff" },
    heading: { fg: "#c792ea", bold: true },
    keyword: { fg: "#c792ea", bold: true },
    link: { fg: "#80cbc4", underline: true },
    number: { fg: "#f78c6c" },
    operator: { fg: "#89ddff" },
    property: { fg: "#80cbc4" },
    punctuation: { fg: "#89ddff" },
    string: { fg: "#c3e88d" },
    strong: { bold: true },
    tag: { fg: "#ff5370" },
    type: { fg: "#ffcb6b" },
    variable: { fg: "#d6deeb" },
  });

  return sharedSyntaxStyle;
}
