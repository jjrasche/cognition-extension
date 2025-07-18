import * as fitbitModule from './fitbit.module.js';
import * as helperMethods from './helper-methods.module.js';
import * as uiModule from './ui.module.js';
import * as transcriptModule from './transcript.module.js';
import * as textInputModule from './text-input.module.js';
import * as emailModule from './email.module.js';
import * as contentScriptHandlerModule from './content-script-handler.module.js';
import * as contextAssemblerModule from './context-assembler.module.js';
import * as groqInferenceModule from './groq-inference.module.js';

export const enabledModules = [
    contentScriptHandlerModule, // is core module, must load first
    helperMethods,
    fitbitModule,
    uiModule,
    emailModule,
    textInputModule,
    contextAssemblerModule,
    groqInferenceModule
];