#!/usr/bin/env node
/**
 * Publishes the chat packages to GitHub Packages under the @tidio-tools scope,
 * following the manifest shape of the previous 4.33.0-hubi.0 release:
 *   - name:        chat -> @tidio-tools/chat, @chat-adapter/x -> @tidio-tools/chat-adapter-x
 *   - version:     <package version>-<suffix>   (default suffix: hubi.0)
 *   - repository:  rewritten to this fork so GitHub links the package to it
 *   - workspace deps -> npm aliases (e.g. "chat": "npm:@tidio-tools/chat@<version>")
 *     so consumers keep importing the upstream names.
 *
 * Usage:
 *   pnpm build                                   # dist must exist first
 *   TIDIO_TOOLS_NPM_TOKEN=ghp_... node scripts/publish-hubi-packages.mjs [--dry-run] [suffix]
 *
 * The token needs write:packages for the tidio-tools org. package.json files
 * are restored after publishing - nothing gets committed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REGISTRY = 'https://npm.pkg.github.com/';
const REPOSITORY_URL = 'git+https://github.com/tidio-tools/chat-integrations-sdk.git';

const PACKAGES = [
  { dir: 'packages/chat', publishedName: '@tidio-tools/chat' },
  { dir: 'packages/adapter-shared', publishedName: '@tidio-tools/chat-adapter-shared' },
  { dir: 'packages/adapter-slack', publishedName: '@tidio-tools/chat-adapter-slack' },
  { dir: 'packages/adapter-teams', publishedName: '@tidio-tools/chat-adapter-teams' },
  { dir: 'packages/state-redis', publishedName: '@tidio-tools/chat-adapter-state-redis' },
];

const dryRun = process.argv.includes('--dry-run');
const suffix = process.argv.find((arg) => !arg.startsWith('-') && !arg.includes(path.sep) && /^[a-z]+\.\d+$/.test(arg)) ?? 'hubi.0';
const token = process.env.TIDIO_TOOLS_NPM_TOKEN;

if (!dryRun && !token) {
  console.error('TIDIO_TOOLS_NPM_TOKEN is required (GitHub PAT with write:packages for tidio-tools).');
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Original name -> published alias, filled while renaming so deps can point at the new versions. */
const publishedVersions = new Map(
  PACKAGES.map(({ dir, publishedName }) => {
    const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    return [pkg.name, `npm:${publishedName}@${pkg.version}-${suffix}`];
  })
);

function rewriteDeps(deps) {
  if (!deps) return deps;
  const next = { ...deps };
  for (const [name, range] of Object.entries(next)) {
    if (String(range).startsWith('workspace:')) {
      const alias = publishedVersions.get(name);
      if (!alias) throw new Error(`No published mapping for workspace dependency "${name}"`);
      next[name] = alias;
    }
  }
  return next;
}

const backups = new Map();

try {
  for (const { dir, publishedName } of PACKAGES) {
    const pkgPath = path.join(root, dir, 'package.json');
    const original = readFileSync(pkgPath, 'utf8');
    backups.set(pkgPath, original);

    const pkg = JSON.parse(original);
    pkg.name = publishedName;
    pkg.version = `${pkg.version}-${suffix}`;
    pkg.repository = { type: 'git', url: REPOSITORY_URL, directory: dir };
    pkg.dependencies = rewriteDeps(pkg.dependencies);
    pkg.peerDependencies = rewriteDeps(pkg.peerDependencies);
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  for (const { dir, publishedName } of PACKAGES) {
    const cwd = path.join(root, dir);
    const npmrcPath = path.join(cwd, '.npmrc');
    // Project-local npmrc so auth applies regardless of the user's global config.
    writeFileSync(npmrcPath, `//npm.pkg.github.com/:_authToken=\${TIDIO_TOOLS_NPM_TOKEN}\n`);

    try {
      console.log(`\n=== Publishing ${publishedName} ${dryRun ? '(dry run)' : ''} ===`);
      // npm treats the -hubi.N suffix as a prerelease and demands an explicit
      // tag; the fork's convention is that -hubi.N releases ARE latest.
      execFileSync('npm', ['publish', `--registry=${REGISTRY}`, '--tag=latest', ...(dryRun ? ['--dry-run'] : [])], {
        cwd,
        stdio: 'inherit',
        env: process.env,
      });
    } finally {
      rmSync(npmrcPath, { force: true });
    }
  }
} finally {
  for (const [pkgPath, original] of backups) {
    writeFileSync(pkgPath, original);
  }
  console.log('\npackage.json files restored.');
}
