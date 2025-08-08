import { initializeRuntime } from "./runtime.js";

const runtime = await initializeRuntime("extension-page");
runtime.log('[Extension Page] Initialized');