/*
 * Twitch Chat X-Ray — build pipeline (esbuild).
 *
 *   npm run build      -> dist/chrome    (Manifest V3, Chrome/Edge/Opera)
 *   npm run build:ff   -> dist/firefox   (Manifest V3, Firefox >= 128)
 *   npm run build:all  -> both
 *   npm run dev        -> watch mode
 *   npm run package    -> both builds + store-ready zip files in release/
 *
 * Both targets share one manifest source; Firefox only needs a different
 * browser_specific_settings block, a gecko id and no minimum_chrome_version.
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
const wants = {
  chrome: !argv.includes('--firefox-only'),
  firefox: isPackage || argv.includes('--firefox') || argv.includes('--all'),
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Firefox refuses to install an MV3 add-on without a stable gecko id. */
const GECKO_ID = 'chat-x-ray@local';

const ENTRY_POINTS = [
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
  manifest.version = pkg.version;

  if (target === 'firefox') {
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 128 is the first release with content_scripts.world: "MAIN", but
        // data_collection_permissions (mandatory on AMO since 2025-11-03)
        // only exists from 140, so 140 is the real floor.
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    };
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
    // Firefox 128+ and Chromium 111 both support the syntax we emit.
    target: target === 'firefox' ? ['firefox128'] : ['chrome111'],
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
  execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: dir });
  console.log(`[package] ${path.relative(ROOT, zipPath)}`);
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

  if (wants.chrome) await buildTarget('chrome');
  if (wants.firefox) await buildTarget('firefox');

  if (isPackage) {
    fs.mkdirSync(RELEASE, { recursive: true });
    const base = `chat-x-ray-v${pkg.version}`;
    if (wants.chrome) {
      zipDir(path.join(DIST, 'chrome'), path.join(RELEASE, `${base}-chrome.zip`));
    }
    if (wants.firefox) {
      zipDir(path.join(DIST, 'firefox'), path.join(RELEASE, `${base}-firefox.zip`));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
