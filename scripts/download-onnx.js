// scripts/download-onnx-simple.js
// Simple ONNX Runtime WebGPU downloader using fetch (Node 18+)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const onnxDir = path.join(rootDir, 'onnx-runtime');

// ONNX Runtime version
const ONNX_VERSION = '1.22.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_VERSION}/dist`;

//  files for WebGPU
const FILES = [
  'ort.webgpu.mjs',                     // Main WebGPU API (ES modules)
  'ort-wasm-simd-threaded.jsep.mjs',   // WebGPU JavaScript module
  'ort-wasm-simd-threaded.jsep.wasm',  // WebGPU execution provider
  'ort-wasm-simd-threaded.wasm',       // CPU fallback
]

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
    
  // Download  files
  const Results = [];
  for (const file of FILES) {
    const result = await downloadFile(file);
    Results.push(result);
  }
  const Success = Results.every(r => r.status === 'success' || r.status === 'skipped');
  
  if (!Success) {
    console.log('\n─'.repeat(60));
    log.error('Failed to download some  files!');
    Results.forEach(r => {
      if (r.status === 'error' || r.status === 'not-found') {
        log.error(`  ${r.filename}: ${r.status}`);
      }
    });
    process.exit(1);
  }
  
  const allResults = [...Results];
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
}

// Run the script
main().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});