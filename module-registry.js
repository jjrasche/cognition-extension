import './global-helpers.js';
import * as fitbitModule from './fitbit.module.js';
import * as uiModule from './ui.module.js';
// import * as transcriptModule from './transcript.module.js';
import * as textInputModule from './text-input.module.js';
import * as emailModule from './outlook-email.module.js';
import * as contentScriptHandlerModule from './content-script-handler.module.js';
import * as contextModule from './context.module.js';
import * as groqInferenceModule from './groq-inference.module.js';
import * as debugModule from './debug.module.js';
import * as tabManagerModule from './tab-manager.module.js';
import * as developmentModule from './dev.module.js';
import * as claudeApiModule from './claude-api.module.js';
import * as inferenceManager from './inference.module.js';
import * as inferenceModelValidation from './inference-model-validation.module.js';
import * as graphDbModule from './graph-db.module.js';
import * as embeddingModule from './embedding.module.js';
import * as transformerModule from './transformer.module.js';

export const modules = [
    tabManagerModule,
    contentScriptHandlerModule,
    fitbitModule,
    uiModule,
    emailModule,
    textInputModule,
    contextModule,
    groqInferenceModule,
    debugModule,
    developmentModule,
    claudeApiModule,
    inferenceManager,
    inferenceModelValidation,
    graphDbModule,
    embeddingModule,
    transformerModule
];

export const coreFiles = [
  'global-helpers.js',
  'manifest.json',
  'background.js',
  'state-store.js',
  'extension-state.js',
  'action-registry.js',
  'oauth-manager.js',
  'module-registry.js',
];

export const devFiles = [
  'dev-reload.js',
];