import './helpers.js';
// import * as fitbitModule from './fitbit.module.js';
import * as uiModule from './ui.module.js';
import * as transcriptModule from './transcript.module.js';
// import * as textInputModule from './text-input.module.js';
// import * as emailModule from './outlook-email.module.js';
// import * as contentScriptHandlerModule from './content-script-handler.module.js';
import * as contextModule from './context.module.js';
// import * as groqInferenceModule from './groq-inference.module.js';
// import * as debugModule from './debug.module.js';
// import * as tabManagerModule from './tab-manager.module.js';
import * as developmentModule from './dev.module.js';
import * as claudeApiModule from './claude-api.module.js';
import * as inferenceModule from './inference.module.js';
// import * as inferenceModelValidationModule from './inference-model-validation.module.js';
import * as graphDbModule from './graph-db.module.js';
import * as embeddingModule from './embedding.module.js';
// import * as oauthModule from './oauth.module.js';
import * as transformerModule from './transformer.module.js';
import * as chunkingModule from './chunking.module.js';
import * as fileModule from './file.module.js';
import * as indexedDbModule from './indexed-db.module.js';
import * as apiKeysModule from './api-keys.module.js';
import * as webSearchModule from './web-search.module.js';
import * as webExtractorModule from './web-extractor.module.js';
import * as chromeSyncModule from './chrome-sync.module.js';
import * as webTreeRendererModule from './web-tree-renderer.module.js';

export const modules = [
    // tabManagerModule,
    // contentScriptHandlerModule,
    uiModule,
    webTreeRendererModule,
    // emailModule,
    // textInputModule,
    // groqInferenceModule,
    // debugModule,
    // inferenceModelValidationModule,
    // oauthModule,
    indexedDbModule,
    graphDbModule,
    // fitbitModule,
    contextModule,
    claudeApiModule,
    transformerModule,
    embeddingModule,
    inferenceModule,
    developmentModule,
    chunkingModule,
    fileModule,
    apiKeysModule,
    webSearchModule,
    webExtractorModule,
    chromeSyncModule,
    transcriptModule,
];

export const coreFiles = [
  'manifest.json',
  'module-registry.js',
  'helpers.js',
  'runtime.js',
  'service-worker.js',
  'extension-page.js',
  'extension-page.html',
  'extension-page.css',
  'offscreen.html',
  'offscreen.js',
];

export const devFiles = [
  'dev-reload.js',
];