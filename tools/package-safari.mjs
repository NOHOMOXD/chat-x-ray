import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appName = 'Chat X-Ray';
const work = path.join(root, 'dist', 'safari-xcode');
const projectDir = path.join(work, 'project');
const artifacts = path.join(root, 'release');
const archive = path.join(artifacts, `chat-x-ray-v${version}-safari-macos-project.zip`);

function run(tool, args, options = {}) {
  return execFileSync(tool, args, { cwd: root, stdio: 'inherit', ...options });
}

function findPackager() {
  // New Xcode releases use packager; older supported releases use converter.
  for (const tool of ['safari-web-extension-packager', 'safari-web-extension-converter']) {
    try {
      return run('xcrun', ['--find', tool], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Try the other name.
    }
  }
  throw new Error('Safari packaging needs full Xcode with its developer directory selected');
}

function findProject(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const next = path.join(dir, entry.name);
    if (entry.name.endsWith('.xcodeproj')) return next;
    const project = findProject(next);
    if (project) return project;
  }
  return null;
}

function updateProjectVersion(project) {
  const file = path.join(project, 'project.pbxproj');
  let contents = fs.readFileSync(file, 'utf8');
  for (const key of ['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION']) {
    const setting = new RegExp(`\\b${key} = [^;]+;`, 'g');
    if (!setting.test(contents)) throw new Error(`Generated Xcode project lacks ${key}`);
    contents = contents.replace(setting, `${key} = ${version};`);
  }
  fs.writeFileSync(file, contents);
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Safari Xcode packaging runs on macOS');
  }
  const packager = findPackager();
  run(process.execPath, ['build.js', '--safari-only']);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  run(packager, [
    path.join(root, 'dist', 'safari'),
    '--project-location', projectDir, '--app-name', appName,
    '--bundle-identifier', 'io.github.nohomoxd.chat-x-ray',
    '--macos-only', '--swift', '--copy-resources', '--no-open', '--no-prompt',
  ]);

  const project = findProject(projectDir);
  if (!project) throw new Error('Safari packager did not generate an Xcode project');
  updateProjectVersion(project);
  // The app target embeds the extension. The generated XCTest targets use
  // @testable imports and are not part of the Release product.
  run('xcodebuild', [
    '-project', project, '-target', appName, '-configuration', 'Release', '-sdk', 'macosx',
    `SYMROOT=${path.join(work, 'products')}`, `OBJROOT=${path.join(work, 'intermediates')}`,
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'build',
  ]);

  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(archive, { force: true });
  run('ditto', ['-c', '-k', projectDir, archive]);
  console.log(`[package] ${path.relative(root, archive)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
