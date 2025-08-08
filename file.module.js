export const manifest = {
  name: "file",
  context: "extension-page",
  version: "1.0.0",
  description: "User-controlled file operations with directory handles and persistent permissions",
  permissions: ["storage"],
  actions: ["write", "read", "listDirs", "selectDir", "hasDir", "removeDir", "requestPermission"],
  dependencies: ["graph-db"]
};

let runtime;
export const initialize = async (rt) => {
  runtime = rt;
};

const getHandle = async (name) => {
  try {
    const node = await runtime.call('graph-db.getNode', { nodeId: `file-handle-${name}` });
    return node?.handle || null;
  } catch (error) {
    return null; // Node doesn't exist
  }
};

const setHandle = async (name, handle) => {
  const nodeData = {
    id: `file-handle-${name}`,
    type: 'file-directory-handle',
    name,
    handle,
    timestamp: new Date().toISOString(),
    directoryName: handle.name
  };
  
  return await runtime.call('graph-db.addNode', nodeData);
};

const getAllHandleNames = async () => {
  try {
    const nodes = await runtime.call('graph-db.getNodesByType', { type: 'file-directory-handle' });
    return nodes.map(node => node.name);
  } catch (error) {
    runtime.logError('[File] Error getting handle names:', error);
    return [];
  }
};

const removeHandle = async (name) => {
  return await runtime.call('graph-db.removeNode', { nodeId: `file-handle-${name}` });
};

// Main actions
export const selectDir = async ({ name }) => {
  const handle = await window.showDirectoryPicker();
  await setHandle(name, handle);
  runtime.log(`[File] Selected directory: ${handle.name} for handle: ${name}`);
  return { success: true, name, path: handle.name };
};

export const requestPermission = async ({ name, mode = 'readwrite' }) => {
  const handle = await getHandle(name);
  if (!handle) {
    return { success: false, error: `Directory '${name}' not found. Call selectDir first.` };
  }
  
  const permission = await handle.requestPermission({ mode });
  return { 
    success: permission === 'granted', 
    permission,
    name,
    mode
  };
};

const ensureHandle = async (name) => {
  const handle = await getHandle(name);
  if (!handle) {
    throw new Error(`Directory '${name}' not selected. Call selectDir({name: '${name}'}) first.`);
  }
  
  // Check current permission
  const currentPermission = await handle.queryPermission({ mode: 'readwrite' });
  
  if (currentPermission !== 'granted') {
    // Request permission - this may show the persistent permission dialog
    const newPermission = await handle.requestPermission({ mode: 'readwrite' });
    if (newPermission !== 'granted') {
      throw new Error(`Write permission denied for directory '${name}'. Permission: ${newPermission}`);
    }
    runtime.log(`[File] Permission granted for directory: ${name}`);
  }
  
  return handle;
};

export const write = async ({ dir, filename, data, append = false }) => {
  const dirHandle = await ensureHandle(dir);
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  
  if (append) {
    const existing = await read({ dir, filename }).catch(() => '');
    await writable.write(existing + data);
  } else {
    await writable.write(data);
  }
  
  await writable.close();
  
  // Store file operation in graph for history/tracking
  await runtime.call('graph-db.addNode', {
    id: `file-write-${Date.now()}`,
    type: 'file-operation',
    operation: 'write',
    directory: dir,
    filename,
    size: data.length,
    append,
    timestamp: new Date().toISOString()
  });
  
  runtime.log(`[File] Written to ${dir}/${filename} (${data.length} chars)`);
  return { success: true, dir, filename, size: data.length };
};

export const read = async ({ dir, filename }) => {
  const dirHandle = await ensureHandle(dir);
  const fileHandle = await dirHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  const content = await file.text();
  
  // Store file operation in graph for history/tracking
  await runtime.call('graph-db.addNode', {
    id: `file-read-${Date.now()}`,
    type: 'file-operation',
    operation: 'read',
    directory: dir,
    filename,
    size: content.length,
    timestamp: new Date().toISOString()
  });
  
  runtime.log(`[File] Read ${dir}/${filename} (${content.length} chars)`);
  return content;
};

export const listDirs = async () => await getAllHandleNames();
export const hasDir = async ({ name }) => !!(await getHandle(name));
export const removeDir = async ({ name }) => {
  await removeHandle(name);
  runtime.log(`[File] Removed directory handle: ${name}`);
  return { success: true, name };
};

// Bonus: Get file operation history
export const getFileHistory = async ({ limit = 10 } = {}) => {
  try {
    const nodes = await runtime.call('graph-db.getNodesByType', { type: 'file-operation' });
    return nodes
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  } catch (error) {
    runtime.logError('[File] Error getting file history:', error);
    return [];
  }
};