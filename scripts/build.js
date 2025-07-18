// Simple build script - just copies files to build directory
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { enabledModules } from '../enabled-modules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const buildDir = path.join(rootDir, 'build');

async function build() {
  console.log('Building Cognition Extension...');
  console.log('Enabled modules:', enabledModules);
  
  // Create build directory
  await fs.mkdir(buildDir, { recursive: true });

  // Files to copy
  const coreFiles = [
    'manifest.json',
    'helper-methods.module.js',
    'background.js',
    'state-store.js',
    'extension-state.js',
    'action-registry.js',
    'oauth-manager.js',
    'enabled-modules.js',
    'content-script-handler.module.js',
    'fitbit.module.js',
    'ui.module.js',
    'text-input.module.js',
    'context-assembler.module.js',
    'email.module.js',
    'context.module.js',
    'groq-inference.module.js',
  ];

  // Get module files safely
  const moduleFiles = enabledModules
    .filter(module => module && typeof module === 'object')
    .map(module => module.path)
    .filter(modulePath => modulePath && typeof modulePath === 'string');

  console.log('Module files to copy:', moduleFiles);

  const files = [...coreFiles, ...moduleFiles];

  // Add dev-reload in development mode
  const isDev = process.argv.includes('--dev') || process.argv.includes('--watch');
  if (isDev) {
    files.push('dev-reload.js');
    files.push('dev-console-helper.js');
    console.log('📦 Including dev-reload client for auto-reload');
    console.log('🛠️  Including console helpers for debugging');
  }
  
  // Copy each file
  for (const file of files) {
    const src = path.join(rootDir, file);
    const dest = path.join(buildDir, file);
    
    try {
      await fs.copyFile(src, dest);
      console.log(`✓ Copied ${file}`);
    } catch (error) {
      console.error(`✗ Failed to copy ${file}:`, error.message);
    }
  }
  
  console.log('\nBuild complete! Extension files are in the build/ directory.');
  console.log('\nTo install:');
  console.log('1. Open chrome://extensions');
  console.log('2. Enable "Developer mode"');
  console.log('3. Click "Load unpacked"');
  console.log('4. Select the build/ folder');
}

// Run build
build().catch(console.error);