const exampleFilePaths = [
  "src/index.tsx",
  "src/lib/inputLineParser.ts",
  "src/lib/fileFilter.ts",
  "src/components/ChatInput.tsx",
  "README.md",
  "package.json",
];

export type FileFilterExample = {
  name: string;
  input: string;
  filePaths: string[];
  expected: string[];
};

export const fileFilterExamples: FileFilterExample[] = [
  {
    name: "empty input returns all files",
    input: "",
    filePaths: exampleFilePaths,
    expected: exampleFilePaths,
  },
  {
    name: "filename letters",
    input: "ff",
    filePaths: exampleFilePaths,
    expected: ["src/lib/fileFilter.ts"],
  },
  {
    name: "directory initials plus filename",
    input: "slff",
    filePaths: exampleFilePaths,
    expected: ["src/lib/fileFilter.ts"],
  },
  {
    name: "case-insensitive",
    input: "ILP",
    filePaths: exampleFilePaths,
    expected: ["src/lib/inputLineParser.ts"],
  },
  {
    name: "no match",
    input: "zz",
    filePaths: exampleFilePaths,
    expected: [],
  },
  {
    name: "multi match",
    input: "src",
    filePaths: exampleFilePaths,
    expected: [
      "src/index.tsx",
      "src/lib/inputLineParser.ts",
      "src/lib/fileFilter.ts",
      "src/components/ChatInput.tsx",
    ],
  },
];

export function filterFiles(
  input: string,
  filePaths: readonly string[],
): string[] {
  const query = input.toLowerCase();

  return filePaths.filter((filePath) =>
    isSubsequence(query, filePath.toLowerCase()),
  );
}

function isSubsequence(query: string, target: string): boolean {
  let queryIndex = 0;

  for (const character of target) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
    }
  }

  return queryIndex === query.length;
}
