// scripts/download-onnx-simple.js
// Simple ONNX Runtime WebGPU downloader using fetch (Node 18+)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const onnxDir = path.join(rootDir, 'onnx-runtime');

// ONNX Runtime version
const ONNX_VERSION = '1.18.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_VERSION}/dist`;

// Critical files for WebGPU
const CRITICAL_FILES = [
  'ort-wasm-simd-threaded.jsep.wasm',  // WebGPU JSEP (main file)
  'ort-wasm-simd.wasm',                 // CPU fallback
  'ort.webgpu.min.js',                  // WebGPU JavaScript API
];

// Additional files that might be needed
const OPTIONAL_FILES = [
  'ort-wasm.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd.jsep.wasm',
  'ort.webgpu.min.mjs',
  'ort.webgpu.bundle.min.mjs',
  'ort.wasm-core.min.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-core.mjs',
  'ort.webgpu.mjs',
];


const ALL_FILES = [...CRITICAL_FILES, ...OPTIONAL_FILES];

// Colors for console
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.log(`❌ ${msg}`),
  warn: (msg) => console.log(`⚠️  ${msg}`),
  download: (msg) => console.log(`⬇️  ${msg}`),
};

// Download a single file using fetch
async function downloadFile(filename) {
  const url = `${CDN_BASE}/${filename}`;
  const destPath = path.join(onnxDir, filename);
  
  try {
    // Check if file already exists
    try {
      await fs.access(destPath);
      log.warn(`Skipping ${filename} (already exists)`);
      return { filename, status: 'skipped' };
    } catch {
      // File doesn't exist, proceed with download
    }
    
    log.download(`Downloading ${filename}...`);
    
    // Fetch the file
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { filename, status: 'not-found' };
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    // Get the data as ArrayBuffer
    const buffer = await response.arrayBuffer();
    
    // Write to file
    await fs.writeFile(destPath, Buffer.from(buffer));
    
    // Get file size for logging
    const stats = await fs.stat(destPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    
    log.success(`Downloaded ${filename} (${sizeKB} KB)`);
    return { filename, status: 'success', size: sizeKB };
    
  } catch (error) {
    log.error(`Failed to download ${filename}: ${error.message}`);
    return { filename, status: 'error', error: error.message };
  }
}

// Main function
async function main() {
  console.log('\n🚀 ONNX Runtime WebGPU Downloader (Simple Version)');
  console.log(`📦 Version: ${ONNX_VERSION}`);
  console.log(`📁 Destination: ${onnxDir}`);
  console.log('─'.repeat(60));
  
  // Create directory
  try {
    await fs.mkdir(onnxDir, { recursive: true });
    log.success('Created onnx-runtime directory');
  } catch (error) {
    log.error(`Failed to create directory: ${error.message}`);
    process.exit(1);
  }
  
  console.log('\n📥 Downloading critical files first...\n');
  
  // Download critical files
  const criticalResults = [];
  for (const file of CRITICAL_FILES) {
    const result = await downloadFile(file);
    criticalResults.push(result);
  }
  
  // Check if all critical files were downloaded
  const criticalSuccess = criticalResults.every(r => 
    r.status === 'success' || r.status === 'skipped'
  );
  
  if (!criticalSuccess) {
    console.log('\n─'.repeat(60));
    log.error('Failed to download some critical files!');
    criticalResults.forEach(r => {
      if (r.status === 'error' || r.status === 'not-found') {
        log.error(`  ${r.filename}: ${r.status}`);
      }
    });
    console.log('\nYou may need to:');
    console.log('1. Check your internet connection');
    console.log('2. Try a different ONNX version');
    console.log('3. Download files manually from:', CDN_BASE);
    process.exit(1);
  }
  
  console.log('\n📥 Downloading optional files...\n');
  
  // Download optional files
  const optionalResults = [];
  for (const file of OPTIONAL_FILES) {
    const result = await downloadFile(file);
    optionalResults.push(result);
  }
  
  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Download Summary:\n');
  
  const allResults = [...criticalResults, ...optionalResults];
  const successCount = allResults.filter(r => r.status === 'success').length;
  const skippedCount = allResults.filter(r => r.status === 'skipped').length;
  const notFoundCount = allResults.filter(r => r.status === 'not-found').length;
  const errorCount = allResults.filter(r => r.status === 'error').length;
  
  console.log(`  ✅ Downloaded: ${successCount} files`);
  console.log(`  ⏭️  Skipped: ${skippedCount} files (already exist)`);
  console.log(`  🚫 Not found: ${notFoundCount} files (optional)`);
  if (errorCount > 0) {
    console.log(`  ❌ Errors: ${errorCount} files`);
  }
  
  // Verify critical files exist
  console.log('\n🔍 Verifying critical files...\n');
  
  let allGood = true;
  for (const file of CRITICAL_FILES) {
    try {
      const filePath = path.join(onnxDir, file);
      const stats = await fs.stat(filePath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      log.success(`${file} (${sizeKB} KB)`);
    } catch {
      log.error(`Missing: ${file}`);
      allGood = false;
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  
  if (allGood) {
    console.log('\n✨ WebGPU support files are ready!\n');
    console.log('Next steps:');
    console.log('1. Run: npm run build');
    console.log('2. Reload the extension in Chrome');
    console.log('3. Test in the offscreen console:');
    console.log('   await transformer.testWebGPU()');
    console.log('   await embedding.embedText({ text: "Hello WebGPU!" })');
  } else {
    console.log('\n⚠️  Some critical files are missing.');
    console.log('The extension may not work properly with WebGPU.');
    console.log('\nYou can try:');
    console.log('1. Running this script again');
    console.log('2. Manually downloading from:', CDN_BASE);
  }
}

// Run the script
main().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});