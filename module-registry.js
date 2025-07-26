import * as fitbitModule from './fitbit.module.js';
import * as globalHelpers from './global-helpers.module.js';
import * as uiModule from './ui.module.js';
// import * as transcriptModule from './transcript.module.js';
import * as textInputModule from './text-input.module.js';
import * as emailModule from './outlook-email.module.js';
import * as contentScriptHandlerModule from './content-script-handler.module.js';
import * as contextAssemblerModule from './context-assembler.module.js';
import * as groqInferenceModule from './groq-inference.module.js';
import * as debugModule from './debug.module.js';
import * as tabManagerModule from './tab-manager.module.js';
import * as developmentModule from './dev.module.js';
import * as claudeApiModule from './claude-api.module.js';
import * as inferenceManager from './inference.module.js';

export const modules = [
    tabManagerModule,
    contentScriptHandlerModule,
    globalHelpers,
    fitbitModule,
    uiModule,
    emailModule,
    textInputModule,
    contextAssemblerModule,
    groqInferenceModule,
    debugModule,
    developmentModule,
    claudeApiModule,
    inferenceManager
];

export const coreFiles = [
  'manifest.json',
  'background.js',
  'state-store.js',
  'extension-state.js',
  'action-registry.js',
  'oauth-manager.js',
  'module-registry.js'
];

export const devFiles = [
  'dev-reload.js',
];