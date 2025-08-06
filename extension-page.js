import { initializeContext } from "./runtime.js";

initializeContext("extension-page");

// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   const params = msg.params || {};
//   if (msg.action === 'ui.setHTML') {
//     document.body.innerHTML = params.html;
//   }
//   if (msg.action === 'log') {
//     const func = params.type === 'error' ? console.error : console.log;
//     func(params.text);
//   }
// });