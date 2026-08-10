#!/usr/bin/env node
'use strict';

// B4Call has no bundler: the browser loads the ES modules in public/js as-is,
// and the server is plain CommonJS. So "build" does the two things that are
// actually useful here — verify the source, then stage a deployable copy in
// dist/ with the dev-only files left behind.
//
//   npm run build            verify + stage dist/
//   npm run build -- --check verify only, write nothing

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const checkOnly = process.argv.includes('--check');

const RUNTIME = ['server.js', 'src', 'public'];
const SKIP_IN_PUBLIC = new Set(['.DS_Store']);

let problems = 0;
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => {
  problems += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
};
const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

/* ---------------- helpers ---------------- */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_IN_PUBLIC.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ---------------- 1. syntax ---------------- */

function checkSyntax() {
  step('Checking syntax');

  const serverFiles = [
    path.join(ROOT, 'server.js'),
    ...walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')),
  ];
  for (const file of serverFiles) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      bad(`${rel(file)}: ${String(err.stderr || err.message).split('\n')[0]}`);
    }
  }
  ok(`${serverFiles.length} server module(s)`);

  // public/js is ESM; --check treats a bare .js as CommonJS, so feed it stdin.
  const browserFiles = walk(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js'));
  for (const file of browserFiles) {
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(file),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      bad(`${rel(file)}: ${String(err.stderr || err.message).split('\n')[0]}`);
    }
  }
  ok(`${browserFiles.length} browser module(s)`);
}

/* ---------------- 2. imports resolve ---------------- */

function checkImports() {
  step('Checking browser imports');

  const dir = path.join(ROOT, 'public', 'js');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const exportsOf = new Map();

  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s+(?:const|let|var|class)\s+(\w+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
      m[1].split(',').forEach((part) => {
        const name = part.split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      });
    }
    exportsOf.set(file, names);
  }

  let checked = 0;
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([\w-]+\.js)['"]/g)) {
      const target = m[2];
      if (!exportsOf.has(target)) {
        bad(`${file} imports missing module ./${target}`);
        continue;
      }
      m[1].split(',').forEach((part) => {
        const name = part.split(/\s+as\s+/)[0].trim();
        if (!name) return;
        checked += 1;
        if (!exportsOf.get(target).has(name)) {
          bad(`${file}: ./${target} does not export "${name}"`);
        }
      });
    }
    for (const m of src.matchAll(/import\s+\*\s+as\s+\w+\s+from\s*['"]\.\/([\w-]+\.js)['"]/g)) {
      if (!exportsOf.has(m[1])) bad(`${file} imports missing module ./${m[1]}`);
    }
  }
  ok(`${checked} named import(s) resolve`);
}

/* ---------------- 3. DOM ids the scripts reach for ---------------- */

function checkDomIds() {
  step('Checking DOM references');

  const html = ['index.html', 'docs.html']
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'))
    .join('\n');
  const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

  const dir = path.join(ROOT, 'public', 'js');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

  // Ids the scripts create themselves are legitimately absent from the HTML.
  const created = new Set();
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) created.add(m[1]);
    for (const m of src.matchAll(/id="([\w-]+)"/g)) created.add(m[1]);
    // authField(box, label, type, 'auth-token', …) mints ids from a variable.
    for (const m of src.matchAll(/'(auth-[\w-]+)'/g)) created.add(m[1]);
  }

  let missing = 0;
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const refs = new Set();
    for (const m of src.matchAll(/\$\(\s*['"]#([\w-]+)['"]\s*\)/g)) refs.add(m[1]);
    for (const m of src.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) refs.add(m[1]);
    for (const m of src.matchAll(/querySelector\(\s*['"]#([\w-]+)['"]\s*\)/g)) refs.add(m[1]);
    for (const id of refs) {
      if (declared.has(id) || created.has(id)) continue;
      missing += 1;
      bad(`${file} looks for #${id}, which no page defines`);
    }
  }
  if (missing === 0) ok(`${declared.size} ids declared, every reference found`);
}

/* ---------------- 4. stage dist/ ---------------- */

function copyInto(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (SKIP_IN_PUBLIC.has(entry)) continue;
      copyInto(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.copyFileSync(source, target);
}

function stage() {
  step('Staging dist/');

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const entry of RUNTIME) {
    copyInto(path.join(ROOT, entry), path.join(DIST, entry));
  }

  // A production package.json: runtime deps and a start script, nothing else.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(DIST, 'package.json'),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        main: 'server.js',
        private: true,
        scripts: { start: pkg.scripts.start },
        dependencies: pkg.dependencies,
      },
      null,
      2
    )}\n`
  );

  // The database is created on first run; never ship the developer's data.
  fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(DIST, 'data', '.gitkeep'),
    ''
  );

  const files = walk(DIST);
  const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  ok(`${files.length} files, ${formatBytes(bytes)}`);
}

/* ---------------- run ---------------- */

console.log('\x1b[1mB4Call build\x1b[0m — no bundler; verify, then stage a deployable copy');

checkSyntax();
checkImports();
checkDomIds();

if (problems > 0) {
  console.error(`\n\x1b[31m${problems} problem(s) found — not staging dist/\x1b[0m`);
  process.exit(1);
}

if (checkOnly) {
  console.log('\n\x1b[32mAll checks passed.\x1b[0m (--check: dist/ not written)');
  process.exit(0);
}

stage();

console.log(`
\x1b[32mBuild complete.\x1b[0m  dist/ is ready to deploy:

  cd dist && npm install --omit=dev && npm start

The frontend needs no build step — the browser loads public/js/*.js directly.
Run \x1b[1mnpm test\x1b[0m for the test suite.
`);
