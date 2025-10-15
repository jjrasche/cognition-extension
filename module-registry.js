import './helpers.js';
import * as apiKeysModule from './api-keys.module.js';
// import * as atomicIdeaModule from './atomic-idea.module.js';
import * as chromeLocalModule from './chrome-local.module.js'
import * as chromeSyncModule from './chrome-sync.module.js';
import * as claudeApiModule from './claude-api.module.js';
import * as commandModule from './command.module.js';
import * as configModule from './config.module.js';
import * as contextModule from './context.module.js';
import * as developmentModule from './dev.module.js';
import * as embeddingModule from './embedding.module.js';
import * as fileModule from './file.module.js';
import * as graphDbModule from './graph-db.module.js';
import * as groqInferenceModule from './groq-inference.module.js';
import * as indexedDbModule from './indexed-db.module.js';
import * as inferenceModule from './inference.module.js';
import * as layoutModule from './layout.module.js';
import * as manualAtomExtractor from './manual-atom-extractor.module.js';
import * as siteIndexModule from './site-index.module.js';
// import * as summaryModule from './summary.module.js';
// import * as superIntendentModule from './superintendent.module.js';
import * as systemHealthModule from './system-health.module.js';
import * as tabModule from './tab.module.js';
import * as tetrisModule from './tetris.module.js';
import * as transformerModule from './transformer.module.js';
import * as treeToDomModule from './tree-to-dom.module.js';
import * as webReadModule from './web-read.module.js';
import * as webSearchModule from './web-search.module.js';
import * as webSpeechSTTModule from './web-speech-stt.module.js';
import * as webSpeechTTSModule from './web-speech-tts.module.js';
import * as codeAssistantModule from './code-assistant.module.js';
import * as trainingModule from './training.module.js';
import * as ttsModule from './tts.module.js';

export const modules = [
	ttsModule,
	apiKeysModule,
	codeAssistantModule,
	trainingModule,
	// atomicIdeaModule,
	chromeLocalModule,
	chromeSyncModule,
	claudeApiModule,
	commandModule,
	configModule,
	contextModule,
	developmentModule,
	embeddingModule,
	fileModule,
	graphDbModule,
	groqInferenceModule,
	indexedDbModule,
	inferenceModule,
	layoutModule,
	manualAtomExtractor,
	siteIndexModule,
	// summaryModule,
	// superIntendentModule,
	systemHealthModule,
	tabModule,
	tetrisModule,
	transformerModule,
	treeToDomModule,
	webReadModule,
	webSearchModule,
	webSpeechSTTModule,
	webSpeechTTSModule,
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