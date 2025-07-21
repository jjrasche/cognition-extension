export const moduleFiles = [
  './content-script-handler.module.js',
  './global-helpers.module.js',
  './fitbit.module.js',
  './ui.module.js',
  './text-input.module.js',
  './context-assembler.module.js',
  './email.module.js',
  './groq-inference.module.js',
  './debug.module.js',
];

export const loadEnabledModules = async () => {
  const loaded = [];
  for (const module of moduleFiles) {
    const mod = await import(module);
    loaded.push(mod);
  }
  return loaded;
};