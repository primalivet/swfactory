// Black-box: drive the CLI as a user would. No imports from app/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TODO_CLI lets the monitor run this suite against a released artifact.
const CLI = process.env.TODO_CLI ?? join(import.meta.dirname, "../../app/src/cli.ts");

function session() {
  const env = { ...process.env, TODO_FILE: join(mkdtempSync(join(tmpdir(), "todo-")), "t.json") };
  return (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
    return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status };
  };
}

test("empty list prints nothing", () => {
  const todo = session();
  assert.deepEqual(todo("list"), { out: "", err: "", code: 0 });
});

test("add assigns increasing ids and list shows them in order", () => {
  const todo = session();
  assert.equal(todo("add", "buy", "milk").out, "added 1");
  assert.equal(todo("add", "walk dog").out, "added 2");
  assert.equal(todo("list").out, "[ ] 1 buy milk\n[ ] 2 walk dog");
});

test("done marks an item", () => {
  const todo = session();
  todo("add", "a");
  todo("add", "b");
  assert.equal(todo("done", "2").out, "done 2");
  assert.equal(todo("list").out, "[ ] 1 a\n[x] 2 b");
});

test("rm removes an item", () => {
  const todo = session();
  todo("add", "a");
  todo("add", "b");
  assert.equal(todo("rm", "1").out, "removed 1");
  assert.equal(todo("list").out, "[ ] 2 b");
});

test("ids are never reused after removing the highest id", () => {
  const todo = session();
  todo("add", "a");
  assert.equal(todo("rm", "1").out, "removed 1");
  assert.equal(todo("add", "b").out, "added 2");
});

for (const [name, args, msg] of [
  ["unknown command", ["frobnicate"], "error: unknown command: frobnicate"],
  ["add without text", ["add"], "error: text is required"],
  ["done with missing id", ["done", "9"], "error: no todo with id 9"],
  ["done without id", ["done"], "error: id is required"],
  ["done abc", ["done", "abc"], "error: invalid id: abc"],
  ["done 1abc", ["done", "1abc"], "error: invalid id: 1abc"],
  ["done 0", ["done", "0"], "error: invalid id: 0"],
  ["done -1", ["done", "-1"], "error: invalid id: -1"],
  ["done 1.5", ["done", "1.5"], "error: invalid id: 1.5"],
  ["rm with missing id", ["rm", "9"], "error: no todo with id 9"],
  ["rm without id", ["rm"], "error: id is required"],
  ["rm x", ["rm", "x"], "error: invalid id: x"],
  ["rm 0", ["rm", "0"], "error: invalid id: 0"],
  ["rm -1", ["rm", "-1"], "error: invalid id: -1"],
  ["rm 1.5", ["rm", "1.5"], "error: invalid id: 1.5"],
] as const) {
  test(`error: ${name}`, () => {
    assert.deepEqual(session()(...args), { out: "", err: msg, code: 1 });
  });
}
