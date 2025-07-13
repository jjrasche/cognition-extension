// Simple build script - just copies files to build directory
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const buildDir = path.join(rootDir, 'build');

async function build() {
  console.log('Building Cognition Extension...');
  
  // Create build directory
  await fs.mkdir(buildDir, { recursive: true });
  
  // Files to copy
  const files = [
    'manifest.json',
    'background.js',
    'fitbit.module.js', 
    'ui.module.js',
    'test.html'
  ];
  
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