// Gate: each layer imports only what its rule allows (import, export-from, import(), require).
// Usage: node factory/gates/architecture.ts
import { builtinModules } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";

type Layer = { path: string; may: string[]; why: string };

// `may`: path prefixes (repo-relative) or "node:" for Node built-ins. Files outside every layer are free (cli.ts composes).
const LAYERS: Layer[] = [
  { path: "app/src/domain/", may: ["app/src/domain/"], why: "domain is pure rules: no I/O, no infra, no CLI" },
  { path: "app/src/infra/", may: ["app/src/domain/", "node:"], why: "infra persists domain types; it does not know the CLI" },
  { path: "tests/blackbox/", may: ["node:"], why: "black-box tests spawn the CLI; they never import app code" },
];

const builtins = new Set(builtinModules);

// Specifier → "node:x" for built-ins, repo-relative path for relative imports, unchanged for packages.
function resolve(file: string, spec: string): string {
  if (spec.startsWith("node:")) return spec;
  if (builtins.has(spec) || builtins.has(spec.split("/")[0] ?? "")) return `node:${spec}`;
  if (spec.startsWith(".")) return normalize(join(dirname(file), spec));
  return spec;
}

const violations: string[] = [];
for (const layer of LAYERS) {
  const files = readdirSync(layer.path, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(layer.path, f));
  for (const file of files) {
    for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      const target = resolve(file, fileName);
      if (!layer.may.some((p) => target.startsWith(p))) {
        violations.push(`${file} imports ${fileName}: ${layer.why}. Allowed: ${layer.may.join(", ")}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`architecture: ${violations.length} violation(s):\n  ${violations.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log(`architecture: ok (${LAYERS.map((l) => l.path).join(", ")})`);
}
