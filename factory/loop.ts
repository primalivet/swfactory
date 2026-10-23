// Stage 1: the bare loop. One agent, one task: act → check → feed back → repeat.
// Usage: pnpm loop "<task>" [maxIterations]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ClaudeResult = {
  session_id: string;
  result: string;
  num_turns: number;
  total_cost_usd: number;
  is_error: boolean;
};

const CHECKS = ["pnpm -s typecheck", "pnpm -s test:blackbox"];

function sh(cmd: string, args: string[] = []) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: args.length === 0, maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

function agent(prompt: string, sessionId?: string): ClaudeResult {
  const args = ["-p", prompt, "--output-format", "json", "--permission-mode", "acceptEdits", "--max-budget-usd", "1"];
  if (sessionId) args.push("--resume", sessionId);
  const r = sh("claude", args);
  return JSON.parse(r.out.slice(r.out.indexOf("{"))) as ClaudeResult;
}

function checks() {
  for (const cmd of CHECKS) {
    const r = sh(cmd);
    if (r.code !== 0) return { ok: false, cmd, out: r.out.slice(-4000) };
  }
  return { ok: true, cmd: CHECKS.join(" && "), out: "" };
}

const [task, maxArg] = process.argv.slice(2);
if (!task) throw new Error('usage: pnpm loop "<task>" [maxIterations]');
const max = Number(maxArg ?? 5);
const runDir = join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });

let prompt = task;
let sessionId: string | undefined;
let cost = 0;

for (let i = 1; i <= max; i++) {
  const res = agent(prompt, sessionId);
  sessionId = res.session_id;
  cost += res.total_cost_usd;
  const check = checks();
  const diff = sh("git", ["diff", "--stat"]).out;
  writeFileSync(join(runDir, `iter-${i}.json`), JSON.stringify({ prompt, res, check, diff }, null, 2));
  console.log(`iter ${i}: turns=${res.num_turns} cost=$${res.total_cost_usd.toFixed(3)} checks=${check.ok ? "green" : `red (${check.cmd})`}`);
  if (check.ok) break;
  prompt = `\`${check.cmd}\` failed:\n\n${check.out}\n\nFix it.`;
}

console.log(`total cost $${cost.toFixed(3)}, log: ${runDir}`);
