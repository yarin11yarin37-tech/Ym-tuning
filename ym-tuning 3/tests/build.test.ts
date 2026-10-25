import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = process.cwd();

// Bundles both halves of the app the same way the production build resolves them.
// (Full packaging — `npm run dist:mac` / `dist:win` — needs Electron and runs on the target OS.)

test('renderer bundles (all screens, styles, i18n)', async () => {
  const r = await build({
    entryPoints: [path.join(ROOT, 'src/main.tsx')],
    bundle: true,
    write: false,
    outdir: '/tmp/ym-build-check',
    jsx: 'automatic',
    format: 'esm',
    loader: { '.css': 'css' },
    define: { 'import.meta.env.DEV': 'false' },
    logLevel: 'silent',
    plugins: [{
      // Fonts are separate npm packages; they are not needed to prove the app code builds.
      name: 'fonts', setup(b) {
        b.onResolve({ filter: /^@fontsource\// }, (a) => ({ path: a.path, namespace: 'font' }));
        b.onLoad({ filter: /.*/, namespace: 'font' }, () => ({ contents: '', loader: 'css' }));
      },
    }],
  });
  assert.equal(r.errors.length, 0);
  assert.ok(r.outputFiles.some((f) => f.path.endsWith('.js') && f.contents.length > 100_000));
});

test('main process and preload bundle without renderer code', async () => {
  for (const entry of ['electron/main.ts', 'electron/preload.ts']) {
    const r = await build({
      entryPoints: [path.join(ROOT, entry)],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      logLevel: 'silent',
    });
    assert.equal(r.errors.length, 0, entry);
    const js = r.outputFiles[0].text;
    assert.doesNotMatch(js, /react-dom/, `${entry} must not pull in renderer code`);
  }
});

test('sandboxed preload requires nothing but electron', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');
  const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(runtimeImports, ['electron']);
});
