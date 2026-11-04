// Benchmark the build station: same task, several models, scored by checks the agent cannot see.
// Usage: pnpm bench <task-dir> <model> [model...]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checks, runLoop, sh } from "./loop.ts";

const MAX_ITERATIONS = 3;

type Row = {
  model: string;
  checks: boolean;
  hidden: string;
  outsidePlan: string[];
  iterations: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  seconds: number;
};

const [taskDirArg, ...models] = process.argv.slice(2);
if (!taskDirArg || models.length === 0) throw new Error("usage: pnpm bench <task-dir> <model> [model...]");
const taskDir = resolve(taskDirArg);
const task = readFileSync(join(taskDir, "task.md"), "utf8");
const planFiles = [...task.matchAll(/^\d+\. `([^`]+)`/gm)].map((m) => m[1]);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const benchDir = resolve("runs", `bench-${stamp}`);
const wtRoot = join(tmpdir(), "swfactory-bench", stamp);
mkdirSync(benchDir, { recursive: true });

function hiddenScore(wt: string): string {
  const dest = join(wt, ".acceptance", "acceptance.test.ts");
  mkdirSync(join(wt, ".acceptance"), { recursive: true });
  copyFileSync(join(taskDir, "acceptance.test.ts"), dest);
  const out = sh("node", ["--test", "--test-reporter=tap", dest], wt).out;
  const n = (k: string) => Number(out.match(new RegExp(`^# ${k} (\\d+)`, "m"))?.[1] ?? 0);
  return `${n("pass")}/${n("tests")}`;
}

function benchModel(model: string): Row {
  const slug = model.replace(/[^a-z0-9.-]+/gi, "_");
  const wt = join(wtRoot, slug);
  const runDir = join(benchDir, slug);
  console.log(`\n== ${model}`);
  sh("git", ["worktree", "add", "--detach", wt, "HEAD"]);
  try {
    rmSync(join(wt, "factory", "bench"), { recursive: true, force: true });
    const install = sh("pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--silent"], wt);
    if (install.code !== 0) throw new Error(`pnpm install failed in ${wt}:\n${install.out}`);
    const preflight = checks(wt);
    if (!preflight.ok) throw new Error(`preflight: \`${preflight.cmd}\` red before the agent ran:\n${preflight.out}`);

    const start = Date.now();
    const res = runLoop({ cwd: wt, model, task, max: MAX_ITERATIONS, runDir });
    const seconds = Math.round((Date.now() - start) / 1000);

    sh("git", ["add", "-A"], wt);
    writeFileSync(join(runDir, "diff.patch"), sh("git", ["diff", "--cached", "HEAD"], wt).out);
    const changed = sh("git", ["diff", "--cached", "--name-only", "HEAD"], wt).out.split("\n").filter(Boolean);
    const row: Row = {
      model,
      checks: res.ok,
      hidden: hiddenScore(wt),
      outsidePlan: changed.filter((f) => !planFiles.includes(f)),
      iterations: res.iterations.length,
      turns: res.usage.turns,
      tokensIn: res.usage.input + res.usage.cacheRead,
      tokensOut: res.usage.output,
      costUsd: res.usage.costUsd,
      seconds,
    };
    writeFileSync(join(runDir, "row.json"), JSON.stringify(row, null, 2));
    return row;
  } finally {
    sh("git", ["worktree", "remove", "--force", wt]);
  }
}

const rows = models.map(benchModel);
const table = [
  "| model | checks | hidden | outside plan | iter | turns | tokens in | tokens out | $ | s |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) =>
    `| \`${r.model}\` | ${r.checks ? "green" : "red"} | ${r.hidden} | ${r.outsidePlan.join(", ") || "-"} | ${r.iterations} | ${r.turns} | ${r.tokensIn} | ${r.tokensOut} | ${r.costUsd.toFixed(4)} | ${r.seconds} |`
  ),
].join("\n");
writeFileSync(join(benchDir, "summary.md"), `# bench ${stamp}\n\ntask: ${taskDirArg}\n\n${table}\n`);
console.log(`\n${table}\n\nresults: ${benchDir}`);
