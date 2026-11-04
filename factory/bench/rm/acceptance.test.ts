// Hidden acceptance test for the rm task. Never present in the agent's worktree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = process.env.TODO_CLI ?? join(process.cwd(), "app/src/cli.ts");

function session() {
  const env = { ...process.env, TODO_FILE: join(mkdtempSync(join(tmpdir(), "todo-")), "t.json") };
  return (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
    return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status };
  };
}

test("rm removes the item", () => {
  const todo = session();
  todo("add", "a");
  todo("add", "b");
  assert.deepEqual(todo("rm", "1"), { out: "removed 1", err: "", code: 0 });
  assert.equal(todo("list").out, "[ ] 2 b");
});

test("rm does not reuse ids", () => {
  const todo = session();
  todo("add", "a");
  todo("add", "b");
  todo("rm", "2");
  assert.equal(todo("add", "c").out, "added 3");
  assert.equal(todo("list").out, "[ ] 1 a\n[ ] 3 c");
});

test("rm keeps done state of other items", () => {
  const todo = session();
  todo("add", "a");
  todo("add", "b");
  todo("done", "2");
  todo("rm", "1");
  assert.equal(todo("list").out, "[x] 2 b");
});

for (const [name, args, msg] of [
  ["without id", ["rm"], "error: id is required"],
  ["abc", ["rm", "abc"], "error: invalid id: abc"],
  ["0", ["rm", "0"], "error: invalid id: 0"],
  ["1.5", ["rm", "1.5"], "error: invalid id: 1.5"],
  ["absent id", ["rm", "9"], "error: no todo with id 9"],
] as const) {
  test(`rm error: ${name}`, () => {
    assert.deepEqual(session()(...args), { out: "", err: msg, code: 1 });
  });
}
