/*
 * Twitch Chat X-Ray — build pipeline (esbuild).
 *
 *   npm run build      -> dist/chrome    (Manifest V3, Chrome/Edge/Opera)
 *   npm run build:firefox -> dist/firefox (Firefox >= 140)
 *   npm run build:safari -> dist/safari (Safari >= 18)
 *   npm run build:all  -> all browser targets
 *   npm run dev        -> watch mode
 *   npm run package    -> browser zips + sources from a clean Git checkout
 *
 * All targets share one manifest source. Safari resources can be converted
 * into a macOS app and extension with npm run package:safari.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const ICONS = path.join(ROOT, 'icons');
const TIPPY_CSS = path.join(ROOT, 'node_modules/tippy.js/dist/tippy.css');

const argv = process.argv.slice(2);
const isWatch = argv.includes('--watch');
const isPackage = argv.includes('--package');
function selectedTargets() {
  if (isPackage) return ['chrome', 'firefox'];
  if (argv.includes('--all')) return ['chrome', 'firefox', 'safari'];
  if (argv.includes('--firefox-only')) return ['firefox'];
  if (argv.includes('--safari-only')) return ['safari'];
  return argv.includes('--firefox') ? ['chrome', 'firefox'] : ['chrome'];
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Firefox refuses to install an MV3 add-on without a stable gecko id. */
const GECKO_ID = process.env.GECKO_ID || 'chat-x-ray@nohomoxd.github.io';

const ENTRY_POINTS = [
  path.join(SRC, 'app', 'background.js'),
  { in: path.join(SRC, 'platform/inject.js'), out: 'inject' },
  { in: path.join(SRC, 'app/content.js'), out: 'content' },
  { in: path.join(SRC, 'app/options.js'), out: 'options' },
];

function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
}

function writeStyles(outDir) {
  if (!fs.existsSync(TIPPY_CSS)) {
    throw new Error('tippy.js is missing: run npm install');
  }
  const tippy = fs.readFileSync(TIPPY_CSS, 'utf8');
  const app = fs.readFileSync(path.join(SRC, 'ui/styles.css'), 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'styles.css'),
    `/* tippy.js base */\n${tippy}\n\n/* Twitch Chat X-Ray */\n${app}`
  );
}

function copySharedAssets(outDir) {
  writeStyles(outDir);
  fs.copyFileSync(
    path.join(SRC, 'app/options.html'),
    path.join(outDir, 'options.html')
  );
  fs.copyFileSync(
    path.join(SRC, 'ui/settings/options.css'),
    path.join(outDir, 'options.css')
  );
  fs.cpSync(path.join(SRC, '_locales'), path.join(outDir, '_locales'), {
    recursive: true,
  });
  for (const icon of fs.readdirSync(ICONS)) {
    if (icon.endsWith('.png')) {
      fs.copyFileSync(path.join(ICONS, icon), path.join(outDir, 'icons', icon));
    }
  }
}

/**
 * Apply per-browser differences to the single manifest source.
 * Firefox rejects unknown keys such as minimum_chrome_version and needs a
 * gecko id for signing; everything else (MV3, world:"MAIN" content script,
 * options_ui, _locales, storage) is shared as-is.
 */
function writeManifest(outDir, target) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')
  );
  if (manifest.version !== pkg.version) {
    throw new Error('Version mismatch between package.json and src/manifest.json');
  }
  manifest.background = target === 'chrome'
    ? { service_worker: 'background.js' }
    : { scripts: ['background.js'] };
  if (target !== 'chrome') {
    delete manifest.minimum_chrome_version;
  }
  if (target === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 128 is the first release with content_scripts.world: "MAIN", but
        // data_collection_permissions (mandatory on AMO since 2025-11-03)
        // only exists from 140, so 140 is the desktop floor.
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      // Android only understands data_collection_permissions from 142, so it
      // needs its own floor; inheriting the desktop one trips web-ext lint.
      gecko_android: {
        strict_min_version: '142.0',
      },
    };
  } else if (target === 'safari') {
    manifest.browser_specific_settings = { safari: { strict_min_version: '18.0' } };
  }

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
}

function esbuildOptions(outDir, target) {
  return {
    entryPoints: ENTRY_POINTS,
    outdir: outDir,
    bundle: true,
    format: 'iife',
    target: { firefox: 'firefox140', chrome: 'chrome111', safari: 'safari18' }[target],
    platform: 'browser',
    sourcemap: isWatch ? 'inline' : false,
    minify: !isWatch,
    logLevel: 'warning',
  };
}

async function buildTarget(target) {
  const outDir = path.join(DIST, target);
  freshDir(outDir);
  copySharedAssets(outDir);
  writeManifest(outDir, target);
  await esbuild.build(esbuildOptions(outDir, target));
  console.log(`[build] ${target} -> ${path.relative(ROOT, outDir)}`);
}

function zipDir(dir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  execFileSync('zip', ['-X', '-r', '-q', zipPath, '.'], { cwd: dir });
  console.log(`[package] ${path.relative(ROOT, zipPath)}`);
}

// The browser bundles and source ZIP must come from the same revision.
function validateReleaseTree() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const sourceFiles = git('ls-tree', '-rz', '--name-only', 'HEAD').split('\0').filter(Boolean);
  const blocked = sourceFiles.filter((file) =>
    file.startsWith('testing_logs/') ||
    file === 'tools/audit-aggregate.json' ||
    /(^|\/)twitch-xray-(?:audit|session)-[^/]+\.json$/i.test(file) ||
    file.endsWith('.jsonl')
  );
  if (blocked.length) {
    throw new Error(`Local capture data in release source: ${blocked.join(', ')}`);
  }
  if (!sourceFiles.includes('package-lock.json')) {
    throw new Error('Release source must include package-lock.json');
  }
  if (git('status', '--porcelain', '--untracked-files=all').trim()) {
    throw new Error('Package from a clean checkout so the source and browser zips match');
  }
}

async function main() {
  console.log(`[build] ${pkg.name} v${pkg.version}`);

  if (isWatch) {
    freshDir(path.join(DIST, 'chrome'));
    copySharedAssets(path.join(DIST, 'chrome'));
    writeManifest(path.join(DIST, 'chrome'), 'chrome');
    const ctx = await esbuild.context(esbuildOptions(path.join(DIST, 'chrome'), 'chrome'));
    await ctx.watch();
    console.log('[build] watching...');
    return;
  }

  if (isPackage) {
    validateReleaseTree();
  }
  for (const target of selectedTargets()) {
    await buildTarget(target);
  }

  if (isPackage) {
    fs.mkdirSync(RELEASE, { recursive: true });
    const base = `chat-x-ray-v${pkg.version}`;
    zipDir(path.join(DIST, 'chrome'), path.join(RELEASE, `${base}-chrome-opera.zip`));
    zipDir(path.join(DIST, 'firefox'), path.join(RELEASE, `${base}-firefox.zip`));
    const sourceZip = path.join(RELEASE, `${base}-source.zip`);
    fs.rmSync(sourceZip, { force: true });
    execFileSync('git', ['archive', '--format=zip', '-o', sourceZip, 'HEAD'], { cwd: ROOT });
    console.log(`[package] ${path.relative(ROOT, sourceZip)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
