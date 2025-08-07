// Simple build script - just copies files to build directory
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { modules, coreFiles, devFiles } from '../module-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
async function build() {
  console.log('Building Cognition Extension...');
  await cleanBuildDirectory();
  await downloadExternalDependencies(); // Add this line
  copyFiles([...coreFiles, ...moduleFiles(), ...(isDev() ? devFiles : [])]);
  console.log('Build complete!');
}
// helpers
const moduleFiles = () => modules
  .map(module => `${module.manifest?.name}.module.js`)
  .filter(modulePath => modulePath && typeof modulePath === 'string');
const isDev = () => process.argv.includes('--dev') || process.argv.includes('--watch');
const cleanBuildDirectory = async () => {
  try {
    const buildExists = await fs.access(buildDir).then(() => true).catch(() => false);
    if (!buildExists) {
      await fs.mkdir(buildDir, { recursive: true });
      return;
    }

    // Preserve asset directories during clean
    const preserveDirs = ['models', 'libs', 'onnx-runtime'];
    const items = await fs.readdir(buildDir);
    
    for (const item of items) {
      if (!preserveDirs.includes(item)) {
        const itemPath = path.join(buildDir, item);
        await fs.rm(itemPath, { recursive: true, force: true });
      }
    }
  } catch (error) {
    await fs.mkdir(buildDir, { recursive: true });
  }
};
const copyFiles = async(files) => files.forEach(async file => (console.log(file), await fs.copyFile(path.join(rootDir, file), path.join(buildDir, file))));
// external depednencies
const downloadExternalDependencies = async () => {
  const allDeps = modules.flatMap(m => (m.manifest?.externalDependencies || []).map(dep => ({ ...dep, fromModule: m.manifest.name })));
  if (allDeps.length === 0) return;
  
  console.log(`📦 Downloading ${allDeps.length} external dependencies...`);
  for (const dep of allDeps) await downloadDependency(dep);
};

const downloadDependency = async ({ url, destination, sha256, rename }) => {
  const destDir = path.join(buildDir, destination);
  let filePath = path.join(destDir, path.basename(new URL(url).pathname));
  
  // Skip if file exists with correct hash
  if (sha256 && await fileHasCorrectHash(filePath, sha256)) {
    console.log(`✅ ${filePath} (cached)`);
    return;
  }
  
  await fs.mkdir(destDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${filePath}: ${response.status}`);
  
  const buffer = new Uint8Array(await response.arrayBuffer());
  
  // Verify hash
  if (sha256) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
    console.log(`🔍 Verifying ${filePath}... ${hash}`);
    if (hash !== sha256.toUpperCase()) throw new Error(`Hash mismatch for ${filePath}`);
  }
  if (rename) filePath = path.join(destDir, path.basename(rename));
  await fs.writeFile(filePath, buffer);
  console.log(`⬇️  ${filePath} (${(buffer.length/1024).toFixed(1)}KB)`);
};

const fileHasCorrectHash = async (filePath, expectedHash) => {
  try {
    const buffer = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
    return hash === expectedHash.toUpperCase();
  } catch { return false; }
};
  
  
// Run build
build().catch(console.error);