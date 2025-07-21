import * as fitbitModule from './fitbit.module.js';
import * as globalHelpers from './global-helpers.module.js';
import * as uiModule from './ui.module.js';
import * as transcriptModule from './transcript.module.js';
import * as textInputModule from './text-input.module.js';
import * as emailModule from './outlook-email.module.js';
import * as contentScriptHandlerModule from './content-script-handler.module.js';
import * as contextAssemblerModule from './context-assembler.module.js';
import * as groqInferenceModule from './groq-inference.module.js';
import * as debugModule from './debug.module.js';

export const modules = [
    contentScriptHandlerModule, // is core module, must load first
    globalHelpers,
    fitbitModule,
    uiModule,
    emailModule,
    textInputModule,
    contextAssemblerModule,
    groqInferenceModule,
    debugModule,
];