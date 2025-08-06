import { initializeRuntime } from "./runtime.js";

setTimeout(async () => {
  console.log('[Offscreen] Starting initialization now...');
    const runtime = await initializeRuntime("offscreen");
}, 10000)