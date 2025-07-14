// Watch script - rebuilds on changes and triggers extension reload
import chokidar from 'chokidar';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Files to watch
const filesToWatch = [
  '*.js',
  '*.json',
  '*.html',
  '*.md',
  '!build/**',
  '!node_modules/**',
  '!scripts/**'
];

// For communicating with extension
let wsServer = null;
let connectedExtensions = new Set();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.gray}[${timestamp}]${colors.reset} ${colors[color]}${message}${colors.reset}`);
}

// Start WebSocket server for extension communication
function startWebSocketServer() {
  wsServer = new WebSocketServer({ port: 9222 });
  
  wsServer.on('connection', (ws) => {
    log('✓ Extension connected for auto-reload', 'green');
    connectedExtensions.add(ws);
    
    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected' }));
    
    ws.on('close', () => {
      connectedExtensions.delete(ws);
      log('Extension disconnected', 'yellow');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connectedExtensions.delete(ws);
    });
  });
  
  log('WebSocket server listening on port 9222', 'blue');
}

// Build the extension
async function build() {
  log('🔨 Building extension...', 'yellow');
  
  return new Promise((resolve, reject) => {
    const buildProcess = spawn('node', ['scripts/build.js', '--dev'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });
    
    buildProcess.on('close', (code) => {
      if (code === 0) {
        log('✅ Build complete!', 'green');
        resolve();
      } else {
        log('❌ Build failed', 'red');
        reject(new Error(`Build process exited with code ${code}`));
      }
    });
    
    buildProcess.on('error', (error) => {
      log(`❌ Build error: ${error.message}`, 'red');
      reject(error);
    });
  });
}

// Reload all connected extensions
function reloadExtensions() {
  const activeConnections = Array.from(connectedExtensions).filter(
    ws => ws.readyState === 1 // WebSocket.OPEN = 1
  );
  
  if (activeConnections.length === 0) {
    log('No extensions connected. Reload manually in chrome://extensions', 'yellow');
    return;
  }
  
  log(`Reloading ${activeConnections.length} connected extension(s)...`, 'blue');
  
  activeConnections.forEach(ws => {
    try {
      ws.send(JSON.stringify({ type: 'reload' }));
    } catch (error) {
      console.error('Failed to send reload signal:', error);
      connectedExtensions.delete(ws);
    }
  });
}

// Debounce function to prevent multiple rapid rebuilds
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Handle file changes
const handleChange = debounce(async (path) => {
  log(`File changed: ${path}`, 'gray');
  
  try {
    await build();
    
    // Wait a bit for the build files to be written
    setTimeout(() => {
      reloadExtensions();
    }, 100);
    
  } catch (error) {
    log(`Build error: ${error.message}`, 'red');
  }
}, 300);

// Initialize watcher
async function startWatcher() {
  // Initial build
  try {
    await build();
  } catch (error) {
    log('Initial build failed', 'red');
  }
  
  // Start WebSocket server
  startWebSocketServer();
  
  // Set up file watcher
  const watcher = chokidar.watch(filesToWatch, {
    cwd: rootDir,
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true
  });
  
  watcher
    .on('add', handleChange)
    .on('change', handleChange)
    .on('unlink', handleChange)
    .on('error', error => log(`Watcher error: ${error}`, 'red'));
  
  log('👀 Watching for file changes...', 'green');
  log('Press Ctrl+C to stop', 'gray');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('\nShutting down...', 'yellow');
  
  // Close all WebSocket connections
  connectedExtensions.forEach(ws => {
    ws.close();
  });
  
  if (wsServer) {
    wsServer.close(() => {
      log('WebSocket server closed', 'gray');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Start everything
startWatcher().catch(error => {
  console.error('Failed to start watcher:', error);
  process.exit(1);
});