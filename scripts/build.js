// Simple build script - just copies files to build directory
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { modules, coreFiles, devFiles } from '../module-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
async function build() {
  console.log('Building Cognition Extension...');
  await cleanBuildDirectory();
  copyFiles([...coreFiles, ...moduleFiles(), ...(isDev() ? devFiles : [])]);
  createTabStateStoreFile();
  console.log('Build complete!');
}
// helpers
const createTabStateStoreFile = async () => await fs.writeFile('build/content-state.js',
  `${(await fs.readFile('state-store.js', 'utf8'))
    .replace(/export class StateStore/g, 'class StateStore')
    .replace(/import.*from.*;\n/g, '')}
    \n(() => ( window.ContentStore = StateStore,console.log('[ContentState] ContentStore loaded and available') )();`
);
const moduleFiles = () => modules
  .map(module => `${module.manifest?.name}.module.js`)
  .filter(modulePath => modulePath && typeof modulePath === 'string');
const isDev = () => process.argv.includes('--dev') || process.argv.includes('--watch');
const cleanBuildDirectory = async () => {
  try { await fs.rm(buildDir, { recursive: true, force: true });
  } catch (error) {}
  await fs.mkdir(buildDir, { recursive: true });
};
const copyFiles = async(files) => files.forEach(async file => await fs.copyFile(path.join(rootDir, file), path.join(buildDir, file)));
// Run build
build().catch(console.error);