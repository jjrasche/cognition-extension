import './helpers.js';
import * as apiKeysModule from './api-keys.module.js';
import * as chunkModule from './chunk.module.js';
import * as claudeApiModule from './claude-api.module.js';
// import * as contentScriptHandlerModule from './content-script-handler.module.js';
import * as contextModule from './context.module.js';
// import * as debugModule from './debug.module.js';
import * as developmentModule from './dev.module.js';
// import * as emailModule from './outlook-email.module.js';
import * as embeddingModule from './embedding.module.js';
import * as fileModule from './file.module.js';
// import * as fitbitModule from './fitbit.module.js';
import * as graphDbModule from './graph-db.module.js';
import * as groqInferenceModule from './groq-inference.module.js';
import * as indexedDbModule from './indexed-db.module.js';
// import * as inferenceModelValidationModule from './inference-model-validation.module.js';
import * as inferenceModule from './inference.module.js';
// import * as oauthModule from './oauth.module.js';
import * as tabModule from './tab.module.js';
// import * as textInputModule from './text-input.module.js';
import * as webSpeechSTTModule from './web-speech-stt.module.js';
import * as webSpeechTTSModule from './web-speech-tts.module.js';
import * as transformerModule from './transformer.module.js';
import * as chromeSyncModule from './chrome-sync.module.js';
import * as webReadModule from './web-read.module.js';
import * as treeToDomModule from './tree-to-dom.module.js';
import * as uiModule from './ui.module.js';
import * as webSearchModule from './web-search.module.js';
import * as superIntendentModule from './superintendent.module.js';
import * as chromeLocalModule from './chrome-local.module.js'
import * as summaryModule from './summary.module.js';
import * as fileToGraphModule from './file-to-graph.module.js'
import * as atomicIdeaModule from './atomic-idea.module.js';
import * as siteIndexModule from './site-index.module.js';
import * as manualAtomExtractor from './manual-atom-extractor.module.js';
import * as tetrisModule from './tetris.module.js';

export const modules = [
	tetrisModule,
	manualAtomExtractor,
	siteIndexModule,
	apiKeysModule,
	chromeSyncModule,
	chunkModule,
	claudeApiModule,
	summaryModule,
	// contentScriptHandlerModule,
	contextModule,
	// debugModule,
	developmentModule,
	// emailModule,
	embeddingModule,
	fileModule,
	// fitbitModule,
	graphDbModule,
	groqInferenceModule,
	indexedDbModule,
	// inferenceModelValidationModule,
	inferenceModule,
	// oauthModule,
	tabModule,
	// textInputModule,
	webSpeechSTTModule,
	webSpeechTTSModule,
	transformerModule,
	treeToDomModule,
	uiModule,
	webReadModule,
	webSearchModule,
	superIntendentModule,
	chromeLocalModule,
	fileToGraphModule,
	atomicIdeaModule
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