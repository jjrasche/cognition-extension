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
  await copyModels();
  await copyOnnxRuntime();
  await copyLibs();
  console.log('Build complete!');
}
// helpers
const moduleFiles = () => modules
  .map(module => `${module.manifest?.name}.module.js`)
  .filter(modulePath => modulePath && typeof modulePath === 'string');
const isDev = () => process.argv.includes('--dev') || process.argv.includes('--watch');
const cleanBuildDirectory = async () => {
  const filesToDelete = [...coreFiles, ...moduleFiles(), ...(isDev() ? devFiles : [])];
  await Promise.all(filesToDelete.map(file => fs.unlink(path.join(buildDir, file)).catch(() => {})));
  await fs.mkdir(buildDir, { recursive: true });
};
const copyFiles = async(files) => files.forEach(async file => (console.log(file), await fs.copyFile(path.join(rootDir, file), path.join(buildDir, file))));
const copyModels = async () => await fs.cp('models/', 'build/models/', { recursive: true });
const copyLibs = async () => await fs.cp('libs/', 'build/libs/', { recursive: true });
const copyOnnxRuntime = async () => await fs.cp(path.join(rootDir, 'onnx-runtime'), path.join(buildDir, 'onnx-runtime'), { recursive: true });
// Run build
build().catch(console.error);