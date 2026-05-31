import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  applyAgentSandboxDiff,
  createAgentSandbox,
  getAgentSandboxDiff,
  removeAgentSandbox,
} from "./agentSandbox";

test("agent sandbox snapshots the dirty workspace and produces an applyable diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-agent-sandbox-"));
  git(root, "init");
  git(root, "config", "user.email", "clutch@example.test");
  git(root, "config", "user.name", "Clutch Test");
  await writeFile(join(root, ".gitignore"), "node_modules\n");
  await writeFile(join(root, "tracked.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");

  await writeFile(join(root, "tracked.txt"), "dirty workspace\n");
  await writeFile(join(root, "untracked.txt"), "untracked baseline\n");
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "dep", "index.js"),
    "ignored dep\n",
  );

  const sandbox = await createAgentSandbox({ root });
  try {
    expect(await readFile(join(sandbox.path, "tracked.txt"), "utf8")).toBe(
      "dirty workspace\n",
    );
    expect(await readFile(join(sandbox.path, "untracked.txt"), "utf8")).toBe(
      "untracked baseline\n",
    );
    expect(
      await readFile(
        join(sandbox.path, "node_modules", "dep", "index.js"),
        "utf8",
      ),
    ).toBe("ignored dep\n");

    await writeFile(join(sandbox.path, "tracked.txt"), "agent edit\n");
    await writeFile(join(sandbox.path, "created.txt"), "created by agent\n");

    const diff = await getAgentSandboxDiff(sandbox);
    expect(diff.diffText).toContain("agent edit");
    expect(diff.diffText).toContain("created.txt");

    await applyAgentSandboxDiff({ diffText: diff.diffText, root });
    expect(await readFile(join(root, "tracked.txt"), "utf8")).toBe(
      "agent edit\n",
    );
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe(
      "created by agent\n",
    );
  } finally {
    await removeAgentSandbox(sandbox);
  }
});

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
