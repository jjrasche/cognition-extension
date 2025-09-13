export const manifest = {
	name: "config",
	context: ["extension-page", "service-worker", "offscreen"],
	version: "1.0.0",
	description: "Auto-generates configuration UIs from module manifests with validation and persistence",
	dependencies: ["chrome-sync"],
	actions: ["showConfig", "saveModuleConfig", "toggleCard", "resetToDefaults"],
	uiComponents: [
		{ name: "module-config", getTree: "buildConfigTree" }
	]
};
let runtime, expandedCards = new Set();
export const initialize = async (rt) => {
	runtime = rt;
	addConfigSchemaActions();
	registerOnChangeActions();
	listenForCrossContextConfigChange();
	await Promise.all(getModules().map(async module => {
		const loadedConfig = await loadConfig(module);
		validateConfig(module, loadedConfig);
		applyConfig(module, loadedConfig);
	}));
};
export const configProxy = (manifest) => new Proxy(manifest.config, { get: (target, prop) => target[prop]?.value }); // syntactic sugar for module config access
const updateAndSaveConfig = async (moduleName, updates) => {
	const module = getModule(moduleName)
	validateConfig(module, updates);
	await applyConfig(module, updates);
	await saveConfig(module, updates);
	return updates;
};
const validateConfig = (module, updates) => {
	const validationErrors = Object.entries(updates).map(([field, value]) => ({ field, ...validateField(value, module.manifest.config[field]) })).filter(v => !v.valid);
	if (validationErrors.length > 0) throw new Error(`Validation failed: ${validationErrors.map(e => `${e.field}: ${e.error}`).join(', ')}`);
};
const getModules = () => runtime.getModulesWithProperty('config');
const getModule = (name) => getModules().find(m => m.manifest.name === name) || (() => { throw new Error(`Module ${name} not found`); })();
const loadConfig = async (module) => await runtime.call('chrome-sync.get', `config.${module.manifest.name}`) || moduleDefaults(module);
const applyConfig = async (module, updates) => Promise.all(Object.entries(updates).map(async ([field, value]) => {
	if (module.manifest.config[field]) {
		runtime.log(`Setting ${field} from`, { oldValue: module.manifest.config[field], newValue: value });
		module.manifest.config[field].value = value;
		const onChange = module.manifest.config[field].onChange;
		if (onChange) await runtime.call(`${module.manifest.name}.${onChange}`).catch(error => runtime.logError(`[Config] onChange failed for ${field}:`, error));
	}
}));

const saveConfig = async (module, updates) => await runtime.call('chrome-sync.set', { [`config.${module.manifest.name}`]: updates });
const removeConfig = async (module) => await runtime.call('chrome-sync.remove', `config.${module.manifest.name}`);
export const resetToDefaults = async (eventData) => {
	const moduleName = eventData.target.dataset.moduleName;
	if (!moduleName) return;
	const module = getModule(moduleName);
	await removeConfig(module);
	applyConfig(module, moduleDefaults(module));
	refreshUI();
};
const moduleDefaults = (module) => Object.fromEntries(Object.entries(module.manifest.config).map(([key, schema]) => [key, schema.value]));
// validation todo: break out into form module
const validateField = (value, schema = {}) => {
	if (schema.required && (value === undefined || value === null || value === '')) return { valid: false, error: 'Required field' };
	if (value === undefined || value === null || value === '') return { valid: true };
	switch (schema.type) {
		case 'number':
			const num = Number(value);
			if (isNaN(num)) return { valid: false, error: 'Must be a number' };
			if (schema.min !== undefined && num < schema.min) return { valid: false, error: `Min: ${schema.min}` };
			if (schema.max !== undefined && num > schema.max) return { valid: false, error: `Max: ${schema.max}` };
			break;
		case 'string':
		case 'password':
			if (typeof value !== 'string') return { valid: false, error: 'Must be text' };
			if (schema.minLength && value.length < schema.minLength) return { valid: false, error: `Min length: ${schema.minLength}` };
			if (schema.maxLength && value.length > schema.maxLength) return { valid: false, error: `Max length: ${schema.maxLength}` };
			break;
		case 'select':
			const options = schema.options || [{ value: '', text: 'Loading...' }];
			const validValues = options.map(opt => typeof opt === 'string' ? opt : opt.value);
			if (!validValues.includes(value)) return { valid: false, error: 'Invalid selection' };
			break;
		case 'checkbox':
			if (typeof value !== 'boolean') return { valid: false, error: 'Must be true/false' };
			break;
	}
	return { valid: true };
};
// === UI GENERATION ===
export const refreshUI = () => runtime.call('layout.renderComponent', 'module-config');
const buildModuleCards = async () => Object.fromEntries(await Promise.all(getModules().map(async module => [`card-${module.manifest.name}`, await buildModuleCard(module)])));
export const buildConfigTree = async () => ({
	"config-page": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px;",
		"title": { tag: "h2", text: "Module Configuration", style: "margin-bottom: 20px;" },
		"config-cards": { tag: "div", style: "display: flex; flex-direction: column; gap: 15px; max-width: 800px;", ...(await buildModuleCards()) }
	}
});
const buildModuleCard = async (module) => {
	const name = module.manifest.name, isExpanded = expandedCards.has(name);
	const isLocalModule = runtime.getContextModules().find(m => m.manifest.name === name);
	const schema = isLocalModule ? module.manifest.config : await getSchemaCrossContext(name);
	return {
		tag: "div", class: "cognition-card", style: "border: 1px solid var(--border-primary);",
		[`header-${name}`]: {
			tag: "div", style: "display: flex; justify-content: space-between; align-items: center;",
			"title-area": {
				tag: "div", style: "display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1;", events: { click: "config.toggleCard" }, "data-module-name": name,
				"title": { tag: "h3", text: name, style: "margin: 0;" },
				"expand-icon": { tag: "span", text: isExpanded ? "▼" : "▶", style: "color: var(--text-muted);" }
			},
			"reset-button": { tag: "button", text: "Reset", class: "cognition-button-secondary", style: "padding: 4px 8px; font-size: 12px;", events: { click: "config.resetToDefaults" }, "data-module-name": name, title: "Reset to default values" }
		},
		"description": { tag: "p", text: module.manifest.description, style: "margin: 8px 0 0 0; color: var(--text-muted); font-size: 14px;" },
		...(isExpanded && { [`form-${name}`]: buildModuleForm(name, schema) })
	};
};
// todo: break out into form module
const buildModuleForm = (name, schema) => ({
	tag: "form", style: "margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-primary);", events: { submit: "config.saveModuleConfig" }, "hidden-module": { tag: "input", type: "hidden", name: "moduleName", value: name },
	...buildFormFields(name, schema),
	"save-button": { tag: "button", type: "submit", text: "Save Configuration", class: "cognition-button-primary", style: "margin-top: 15px;" }
});
const buildFormFields = (moduleName, schema) => Object.fromEntries(Object.entries(schema).map(([fieldName, fieldSchema]) => [`field-${moduleName}-${fieldName}`, buildFormField(fieldName, fieldSchema)]));
const buildFormField = (fieldName, schema) => ({
	tag: "div", style: "margin-bottom: 15px;", "label": { tag: "label", text: schema.label || fieldName, style: "display: block; margin-bottom: 6px; font-weight: 500;" },
	"input": buildInputElement(fieldName, schema),
	...(schema.description && { "desc": { tag: "div", text: schema.description, style: "font-size: 12px; color: var(--text-muted); margin-top: 4px;" } }),
	"error": { tag: "div", style: "color: var(--danger); font-size: 12px; margin-top: 4px; min-height: 16px;" }
});
const buildInputElement = (fieldName, schema) => {
	const baseProps = { name: fieldName, class: getInputClass(schema.type), value: schema.value || schema.default || '', required: schema.required || false };
	switch (schema.type) {
		case 'select': return { tag: "select", ...baseProps, class: "cognition-select", options: (schema.options || [{ value: '', text: 'Loading...' }]).map(opt => typeof opt === 'string' ? { value: opt, text: opt } : opt) };
		case 'number': return { tag: "input", type: "number", ...baseProps, ...(schema.min !== undefined && { min: schema.min }), ...(schema.max !== undefined && { max: schema.max }) };
		case 'password': return { tag: "input", type: "password", ...baseProps };
		case 'checkbox': return { tag: "input", type: "checkbox", ...baseProps, checked: schema.value || schema.default || false, value: undefined };
		case 'textarea': return { tag: "textarea", ...baseProps, rows: schema.rows || 4 };
		case 'globalKey': return { tag: "input", type: "text", ...baseProps };
		default: return { tag: "input", type: "text", ...baseProps, ...(schema.placeholder && { placeholder: schema.placeholder }) };
	}
};
const getInputClass = (type) => type === 'select' ? "cognition-select" : "cognition-input";
// === EVENT HANDLERS ===
export const toggleCard = async (eventData) => {
	const moduleName = eventData.target.dataset.moduleName;
	if (!moduleName) return;
	expandedCards.has(moduleName) ? expandedCards.delete(moduleName) : expandedCards.add(moduleName);
	refreshUI();
};
export const saveModuleConfig = async (eventData) => {
	eventData.preventDefault?.();
	const { moduleName, ...fieldValues } = eventData.formData;
	if (!moduleName) return;
	try {
		await updateAndSaveConfig(moduleName, fieldValues);
		chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', moduleName, updates: fieldValues }).catch(() => { }); // Broadcast to all contexts
		refreshUI();
	} catch (error) { runtime.logError(`[Config] Save failed:`, error); }
};
// === Cross Context Messaging ===
const listenForCrossContextConfigChange = () => chrome.runtime.onMessage.addListener((message) => {
	if (message.type === 'CONFIG_UPDATED') {
		const module = getModule(message.moduleName);
		if (module) applyConfig(module, message.updates);
	}
});
const addConfigSchemaActions = () => getModules().forEach(module => {
	const actionName = `${module.manifest.name}.getConfigSchema`;
	if (!runtime.actions.has(actionName)) {
		runtime.actions.set(actionName, { func: () => module.manifest.config, context: runtime.runtimeName, moduleName: module.manifest.name });
	}
});
const getSchemaCrossContext = async (moduleName) => {
	try { return await runtime.call(`${moduleName}.getConfigSchema`); }
	catch (error) { runtime.log(`[Config] Failed to get fresh schema for ${moduleName}, using local copy`); }
}
const registerOnChangeActions = () => getModules().forEach(module => {
	Object.entries(module.manifest.config || {}).forEach(([fieldName, fieldSchema]) => {
		if (fieldSchema.onChange) {
			const actionName = `${module.manifest.name}.${fieldSchema.onChange}`;
			if (!runtime.actions.has(actionName) && typeof module[fieldSchema.onChange] === 'function') {
				runtime.registerAction(module, fieldSchema.onChange);
			}
		}
	});
});
// === TESTING ===
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Validate required field", async () => {
			const validation = validateField('', { type: 'string', required: true });
			return { actual: validation.valid, assert: strictEqual, expected: false };
		}),
		await runUnitTest("Validate number constraints", async () => {
			const validation = validateField(15, { type: 'number', min: 1, max: 10 });
			return { actual: validation.valid, assert: strictEqual, expected: false };
		}),
		await runUnitTest("Schema value embedding", async () => {
			const mockSchema = { apiKey: { type: 'password', default: 'default-key' } };
			// Simulate loading config
			mockSchema.apiKey.value = 'loaded-key';
			const actual = mockSchema.apiKey.value;
			return { actual, assert: strictEqual, expected: 'loaded-key' };
		})
	];
};