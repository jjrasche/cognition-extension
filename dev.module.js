import { kebabToCamel } from './helpers.js';

export const manifest = {
  name: "dev",
  context: ["service-worker", "extension-page", "offscreen"],
  version: "1.0.0",
  description: "Development utilities and shortcuts for debugging",
  permissions: ["storage"],
  actions: ["testEmbeddingSpeed", "updateSuperintendentData", "testModules"],
  dependencies: ["file"]//, "inference", "transformer", "embedding"]
};

let runtime;
export async function initialize(rt) {
  runtime = rt;
  runtime.log('[Dev] Initializing development helpers...');
  createActionShortcuts();
  runtime.log('[Dev] Development helpers ready');
}

const isDevMode = () => runtime.runtimeName == "offscreen" || !chrome.runtime.getManifest().update_url;

const createActionShortcuts = () => {
  if (!isDevMode()) {
    runtime.log('[Dev] Production mode - skipping dev shortcuts');
    return;
  }
  addModuleManifestsToConsole();
  addModuleActionsToConsole();
  addEasyAccessVariablesToConsole();
};
const addModuleManifestsToConsole = () => runtime.getModules().forEach(module => {
  const camelModuleName = kebabToCamel(module.manifest.name);
  globalThis[camelModuleName] = {};
  globalThis[camelModuleName].manifest = module.manifest;
});

const addModuleActionsToConsole = () => {
  // Create shortcuts for all registered actions
  for (let [name] of runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    const camelModuleName = kebabToCamel(moduleName);
    globalThis[camelModuleName] ??= {};
    globalThis[camelModuleName][actionName] = (params = {}) => {
      return runtime.call(name, params)
        .then(res => (runtime.log(`[Dev] ${camelModuleName}.${actionName} →`, res), res))
        .catch(err => (runtime.logError(`[Dev] ${camelModuleName}.${actionName} ✗`, err), Promise.reject(err)));
    };
  }
};

const addEasyAccessVariablesToConsole = () => {
  // Add runtime reference
  globalThis.runtime = runtime;  
  // Add pretty print functions
  globalThis.printActions = prettyPrintActions;
  globalThis.printModules = prettyPrintModules;
  globalThis.printModuleState = prettyPrintModuleState;
  // Add quick status check
  globalThis.printStatus = () => {
    runtime.log('=== Extension Status ===');
    runtime.log('Context:', runtime.runtimeName);
    runtime.log('Loaded Modules:', runtime.getModules().map(m => m.manifest.name));
    runtime.log('Module States:', Object.fromEntries(runtime.moduleState));
    runtime.log('Registered Actions:', Array.from(runtime.getActions().keys()).length);
    runtime.log('Errors:', runtime.errors);
  };
  runtime.log('[Dev] Added global helpers: runtime, modules, printActions(), printModules(), printModuleState(), Status()');
};

const prettyPrintActions = () => {
  const actions = {};
  for (let [name] of runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    actions[name] = { module: moduleName, action: actionName };
  }
  console.table(actions);
};

const prettyPrintModules = () => {
  const moduleInfo = runtime.getModules().map(module => ({
    name: module.manifest.name,
    version: module.manifest.version,
    context: module.manifest.context || 'any',
    dependencies: (module.manifest.dependencies || []).join(', ') || 'none',
    actions: (module.manifest.actions || []).length
  }));
  console.table(moduleInfo);
};

const prettyPrintModuleState = () => {
  const states = {};
  for (let [name, state] of runtime.moduleState.entries()) {
    states[name] = state;
  }
  console.table(states);
};

export const testEmbeddingSpeed = async (text, runs = 10) => {
  const models = await runtime.call('transformer.listModels');
  
  const results = [];
  for (const modelName of models) {
    const times = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await runtime.call('embedding.embedText', { text, modelName });
      times.push(performance.now() - start);
    }
    const avgDuration = Math.round(times.reduce((sum, time) => sum + time, 0) / runs);
    results.push({ modelName, avgDuration });
  }
  
  const sorted = results.sort((a, b) => a.avgDuration - b.avgDuration);
  console.table(sorted);
  return sorted;
}





export const updateSuperintendentData = async (params = {}) => {
  const { startIndex = 0, maxProcessed = 1 } = params;
  const districtFile = 'school-district-data.json';
  
  try {
    // Read existing file
    const fileContent = await runtime.call('file.read', { dir: 'data', filename: districtFile });

    if (!fileContent) throw new Error(`❌ Could not read ${districtFile} file`);
    const districts = JSON.parse(fileContent);
    runtime.log(`📁 Loaded ${districts.length} districts from file`);

    let updated = 0, skipped = 0, errors = 0, processed = 0;
    districts.slice(startIndex, startIndex + maxProcessed)
    .map(async (district, i) => {
      processed++;
      // Skip if already has sonnet35 data
      if (district.superIntendent?.sonnet35?.firstName) { skipped++; return; }
      
      runtime.log(`🔍 Processing ${district.district} (${i + 1}/${districts.length})`);
      
      try {
        const response = await runtime.call('inference.prompt', {
          userPrompt: buildSuperintendentPrompt(district),
          webSearch: { params: { max_uses: 2, allowedDomains: [district.website] } }
        });
        
        // Parse response
        const extractedData = parseSuperintendentResponse(response.content);
        
        // Update district data
        if (!district.superIntendent) {
          district.superIntendent = { crm: district.superIntendent?.crm || {} };
        }
        
        district.superIntendent.sonnet35 = extractedData;
        
        // Show result
        if (extractedData.firstName && extractedData.lastName) {
          runtime.log(`✅ Found: ${extractedData.firstName} ${extractedData.lastName} for ${district.district}`);
          runtime.log(`📍 Source: ${extractedData.sourceUrl || 'No URL provided'}`);
          updated++;
        } else {
          runtime.log(`⚠️  No superintendent found for ${district.district}`);
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Save updated file
        await runtime.call('file.write', {
          dir: 'data',
          filename: 'districts.json',
          data: JSON.stringify(districts, null, 2)
        });
        
      } catch (error) {
        runtime.logError(`❌ Error processing ${district.district}:`, error.message);
        errors++;
        
        // Still update with empty data to mark as processed
        if (!district.superIntendent) {
          district.superIntendent = { crm: district.superIntendent?.crm || {} };
        }
        district.superIntendent.sonnet35 = {
          firstName: "", lastName: "", email: "", phone: "", 
          sourceUrl: "", lastUpdated: new Date().toISOString().split('T')[0]
        };
      }
    });
    
    // Summary
    runtime.log(`\n📊 SUMMARY:`);
    runtime.log(`✅ Updated: ${updated}`);
    runtime.log(`⏭️  Skipped: ${skipped}`);
    runtime.log(`❌ Errors: ${errors}`);
    runtime.log(`📁 File saved successfully`);
    
    return { 
      success: true, 
      processed, 
      updated, 
      skipped, 
      errors,
      nextIndex: startIndex + processed 
    };
    
  } catch (error) {
    runtime.logError('❌ Fatal error:', error);
    return { error: error.message };
  }
};

const buildSuperintendentPrompt = (district) => `
Find the current superintendent information for "${district.district}" school district.
Website: ${district.website}

Please search their website and find:
- Superintendent's first name
- Superintendent's last name  
- Email address (if available)
- Phone number (if available)

CRITICAL: You must provide the exact URL of the webpage where you found this information.

Return your response in this exact JSON format:
{
  "firstName": "John",
  "lastName": "Smith", 
  "email": "jsmith@district.edu",
  "phone": "555-123-4567",
  "sourceUrl": "https://district.edu/administration/superintendent",
}

If you cannot with great confidence find the information, return just the word null
`;

const parseSuperintendentResponse = (responseText) => {
  try {
    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback to empty data
    return {
      firstName: "", lastName: "", email: "", phone: "", 
      sourceUrl: "", lastUpdated: new Date().toISOString().split('T')[0]
    };
  } catch (error) {
    console.error('Failed to parse superintendent response:', error);
    return {
      firstName: "", lastName: "", email: "", phone: "", 
      sourceUrl: "", lastUpdated: new Date().toISOString().split('T')[0]
    };
  }
};






export const testModules = async ({modulesToTest = []}) => {
  let modules = runtime.getModulesWithProperty("test")
    .filter(module => module.manifest.context.includes(runtime.runtimeName)) // run tests in their context
    .filter(module => modulesToTest.length === 0 || modulesToTest.includes(module.manifest.name));
  const results = await Promise.all(modules.map(module => module.test()));
  showSummary(results);
  showModuleSummary(results);
  return results;
};

const showSummary = (results) => {
  const totalTests = results.reduce((sum, r) => sum + r.totalTests, 0);
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  console.log(`\nOverall: ${totalPassed}/${totalTests} tests passed (${Math.round(totalPassed/totalTests*100)}%)`);
};
const showModuleSummary = (results) => {
  console.log('\n=== MODULES TESTED ===');
  console.table(results.map(result => ({
    Module: result.module,
    'Total Tests': result.totalTests,
    Passed: result.passed,
    Failed: result.totalTests - result.passed,
    'Pass Rate': result.totalTests > 0 ? `${Math.round(result.passed / result.totalTests * 100)}%` : '0%'
  })));
};
const showTestFailures = (results) => {
  const failedTests = results.flatMap(result => result.results
    .filter(test => !test.passed)
    .map(test => ({
      Module: result.module,
      'Test Name': test.name,
      'Expected': JSON.stringify(test.expected)?.substring(0, 50) + '...' || 'N/A',
      'Actual': JSON.stringify(test.result)?.substring(0, 50) + '...' || 'N/A',
      'Error': test.error?.message || test.error || 'Test failed'
    })));
  if (failedTests.length > 0) {
    console.log('\n=== FAILED TEST DETAILS ===');
    console.table(failedTests);
  } else {
    console.log('\n🎉 All tests passed!');
  }
}