// Bundles each tests/*.test.ts with esbuild and runs them with Node's built-in test runner.
// No hardware needed: OBD tests use an in-process fake ELM327 TCP server.
import { build } from 'esbuild';
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, '.test-dist');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const files = readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.ts'));
await build({
  entryPoints: files.map((f) => path.join(root, 'tests', f)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: outDir,
  outExtension: { '.js': '.mjs' },
  jsx: 'automatic',
  logLevel: 'warning',
});

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files.map((f) => path.join(outDir, f.replace(/\.ts$/, '.mjs')))], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(r.status ?? 1);
