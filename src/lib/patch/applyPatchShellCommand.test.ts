import { expect, test } from "bun:test";
import {
  isImplicitApplyPatchShellCommand,
  parseApplyPatchShellCommand,
} from "./applyPatchShellCommand";

test("extracts direct apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        "PATCH",
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Add File: hello.txt",
      "+hello",
      "*** End Patch",
    ].join("\n"),
  );
});

test("extracts direct apply_patch argument commands", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "apply_patch '*** Begin Patch",
        "*** Add File: direct.txt",
        "+hello",
        "*** End Patch'",
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Add File: direct.txt",
      "+hello",
      "*** End Patch",
    ].join("\n"),
  );
});

test("extracts direct applypatch argument commands", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "applypatch '*** Begin Patch",
        "*** Add File: alias.txt",
        "+hello",
        "*** End Patch'",
      ].join("\n"),
    ),
  ).toContain("*** Add File: alias.txt");
});

test("rejects direct apply_patch commands with extra arguments", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "apply_patch '*** Begin Patch",
        "*** Add File: direct.txt",
        "+hello",
        "*** End Patch' extra",
      ].join("\n"),
    ),
  ).toBeNull();
});

test("extracts applypatch alias heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "applypatch <<EOF",
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toContain("*** Add File: hello.txt");
});

test("prefixes patch paths for cd apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "cd src/features && apply_patch <<EOF",
        "*** Begin Patch",
        "*** Update File: panel.ts",
        "*** Move to: panelView.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File: readme.md",
        "+hello",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Update File: src/features/panel.ts",
      "*** Move to: src/features/panelView.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: src/features/readme.md",
      "+hello",
      "*** End Patch",
    ].join("\n"),
  );
});

test("does not prefix absolute patch paths for cd apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "cd src/features && apply_patch <<EOF",
        "*** Begin Patch",
        "*** Update File: /tmp/project/panel.ts",
        "*** Move to: /tmp/project/panelView.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File: readme.md",
        "+hello",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Update File: /tmp/project/panel.ts",
      "*** Move to: /tmp/project/panelView.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: src/features/readme.md",
      "+hello",
      "*** End Patch",
    ].join("\n"),
  );
});

test("does not prefix Windows absolute patch paths for cd apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "cd src && apply_patch <<EOF",
        "*** Begin Patch",
        String.raw`*** Update File: C:\repo\panel.ts`,
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toContain(String.raw`*** Update File: C:\repo\panel.ts`);
});

test("supports quoted relative cd paths", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        'cd "docs/reference" && apply_patch <<EOF',
        "*** Begin Patch",
        "*** Delete File: old.md",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toContain("*** Delete File: docs/reference/old.md");
});

test("extracts bash -lc apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "bash -lc \"apply_patch <<'PATCH'",
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        'PATCH"',
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Update File: README.md",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n"),
  );
});

test("prefixes zsh -c cd apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "/bin/zsh -c 'cd src && apply_patch <<EOF",
        "*** Begin Patch",
        "*** Update File: main.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF'",
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Update File: src/main.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n"),
  );
});

test("extracts powershell.exe apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        'powershell.exe -Command "apply_patch <<\'PATCH\'',
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        'PATCH"',
      ].join("\n"),
    ),
  ).toBe(
    [
      "*** Begin Patch",
      "*** Add File: hello.txt",
      "+hello",
      "*** End Patch",
    ].join("\n"),
  );
});

test("extracts powershell.exe NoProfile apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        'powershell.exe -NoProfile -Command "apply_patch <<\'PATCH\'',
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        'PATCH"',
      ].join("\n"),
    ),
  ).toContain("*** Add File: hello.txt");
});

test("prefixes cmd.exe cd apply_patch heredocs", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        'cmd.exe /c "cd src && apply_patch <<EOF',
        "*** Begin Patch",
        "*** Update File: main.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        'EOF"',
      ].join("\n"),
    ),
  ).toContain("*** Update File: src/main.ts");
});

test("rejects shell wrappers with extra arguments", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "bash -lc apply_patch extra",
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toBeNull();
});

test("detects implicit raw patch shell commands", () => {
  expect(
    isImplicitApplyPatchShellCommand(
      [
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toBe(true);
});

test("detects implicit patch bodies inside shell wrappers", () => {
  expect(
    isImplicitApplyPatchShellCommand(
      [
        "bash -lc '*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch'",
      ].join("\n"),
    ),
  ).toBe(true);
});

test("does not treat explicit apply_patch heredocs as implicit", () => {
  expect(
    isImplicitApplyPatchShellCommand(
      [
        "apply_patch <<EOF",
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toBe(false);
});

test("rejects unsafe cd paths", () => {
  expect(() =>
    parseApplyPatchShellCommand(
      [
        "cd ../outside && apply_patch <<EOF",
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toThrow("relative cd paths");
});

test("rejects larger shell scripts that contain apply_patch", () => {
  expect(
    parseApplyPatchShellCommand(
      [
        "printf before",
        "apply_patch <<EOF",
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
        "EOF",
      ].join("\n"),
    ),
  ).toBeNull();
});
