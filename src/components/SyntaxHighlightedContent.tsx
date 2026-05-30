import {
  getTreeSitterClient,
  pathToFiletype,
  SyntaxStyle,
} from "@opentui/core";

let sharedSyntaxStyle: SyntaxStyle | null = null;
let sharedTreeSitterClient: ReturnType<typeof getTreeSitterClient> | null =
  null;

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
