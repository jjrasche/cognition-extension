export const manifest = {
 name: "file",
 context: "extension-page",
 version: "1.0.0",
 description: "User-controlled file operations with directory handles",
 permissions: ["storage"],
 actions: ["write", "read", "listDirs", "selectDir", "hasDir", "removeDir"]
};

const getHandles = async () => (await chrome.storage.local.get('fileHandles')).fileHandles || {};
const setHandles = async (handles) => await chrome.storage.local.set({ fileHandles: handles });
const getHandle = async (name) => (await getHandles())[name];
const ensureHandle = async (name) => await getHandle(name) || await selectDir({ name });

export const selectDir = async ({ name }) => {
 const handle = await window.showDirectoryPicker();
 const handles = await getHandles();
 handles[name] = handle;
 await setHandles(handles);
 return { success: true, name, path: handle.name };
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
 return { success: true, dir, filename };
};

export const read = async ({ dir, filename }) => {
 const dirHandle = await ensureHandle(dir);
 const fileHandle = await dirHandle.getFileHandle(filename);
 const file = await fileHandle.getFile();
 return await file.text();
};

export const listDirs = async () => Object.keys(await getHandles());
export const hasDir = async ({ name }) => !!(await getHandle(name));
export const removeDir = async ({ name }) => {
 const handles = await getHandles();
 delete handles[name];
 await setHandles(handles);
 return { success: true };
};

let runtime;
export const initialize = async (rt) => runtime = rt;