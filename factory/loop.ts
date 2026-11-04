// The loop: one agent, one task: act → check → feed back → repeat.
// Agent: pi on OpenRouter. The loop, not the agent, runs the checks.
// Usage: pnpm loop <model> "<task>" [maxIterations]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const CHECKS = ["pnpm -s typecheck", "pnpm -s test:blackbox"];
const TOOLS = "read,edit,write";
const AGENT_TIMEOUT_MS = 10 * 60_000;

export type Usage = { input: number; output: number; cacheRead: number; costUsd: number; turns: number };
export type Iteration = { prompt: string; usage: Usage; check: Check; exitCode: number };
export type Check = { ok: boolean; cmd: string; out: string };
export type LoopResult = { ok: boolean; iterations: Iteration[]; usage: Usage };

export function sh(cmd: string, args: string[] = [], cwd = ".") {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: args.length === 0, maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

export function checks(cwd: string): Check {
  for (const cmd of CHECKS) {
    const r = sh(cmd, [], cwd);
    if (r.code !== 0) return { ok: false, cmd, out: r.out.slice(-4000) };
  }
  return { ok: true, cmd: CHECKS.join(" && "), out: "" };
}

// pi emits one JSON event per line; assistant messages carry usage.
function usageOf(events: string): Usage {
  const u: Usage = { input: 0, output: 0, cacheRead: 0, costUsd: 0, turns: 0 };
  for (const line of events.split("\n")) {
    if (!line.startsWith("{")) continue;
    const ev = JSON.parse(line);
    if (ev.type !== "message_end" || ev.message?.role !== "assistant" || !ev.message.usage) continue;
    const m = ev.message.usage;
    u.input += m.input ?? 0;
    u.output += m.output ?? 0;
    u.cacheRead += m.cacheRead ?? 0;
    u.costUsd += m.cost?.total ?? 0;
    u.turns += 1;
  }
  return u;
}

function agent(opts: { cwd: string; model: string; prompt: string; sessionDir: string; resume: boolean; log: string }) {
  const args = ["-p", "--mode", "json", "-nc", "-ne", "-ns", "--provider", "openrouter", "--model", opts.model,
    "--tools", TOOLS, "--session-dir", opts.sessionDir];
  if (opts.resume) args.push("--continue");
  args.push(opts.prompt);
  const r = spawnSync("pi", args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 256 << 20, timeout: AGENT_TIMEOUT_MS });
  writeFileSync(opts.log, `${r.stdout}${r.stderr}`);
  return { exitCode: r.status ?? 1, usage: usageOf(r.stdout) };
}

export function runLoop(opts: { cwd: string; model: string; task: string; max: number; runDir: string }): LoopResult {
  mkdirSync(opts.runDir, { recursive: true });
  const sessionDir = resolve(opts.runDir, "sessions");
  const total: Usage = { input: 0, output: 0, cacheRead: 0, costUsd: 0, turns: 0 };
  const iterations: Iteration[] = [];
  let prompt = opts.task;

  for (let i = 1; i <= opts.max; i++) {
    const log = join(opts.runDir, `iter-${i}.jsonl`);
    const res = agent({ cwd: opts.cwd, model: opts.model, prompt, sessionDir, resume: i > 1, log });
    for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += res.usage[k];
    const check = checks(opts.cwd);
    iterations.push({ prompt, usage: res.usage, check, exitCode: res.exitCode });
    console.log(`  iter ${i}: turns=${res.usage.turns} $${res.usage.costUsd.toFixed(4)} checks=${check.ok ? "green" : `red (${check.cmd})`}`);
    if (check.ok) break;
    prompt = `\`${check.cmd}\` failed:\n\n${check.out}\n\nFix it.`;
  }
  return { ok: iterations.at(-1)?.check.ok ?? false, iterations, usage: total };
}

if (import.meta.main) {
  const [model, task, maxArg] = process.argv.slice(2);
  if (!model || !task) throw new Error('usage: pnpm loop <model> "<task>" [maxIterations]');
  const runDir = join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
  const res = runLoop({ cwd: ".", model, task, max: Number(maxArg ?? 3), runDir });
  writeFileSync(join(runDir, "result.json"), JSON.stringify(res, null, 2));
  console.log(`${res.ok ? "green" : "red"}, total $${res.usage.costUsd.toFixed(4)}, log: ${runDir}`);
  if (!res.ok) process.exitCode = 1;
}
