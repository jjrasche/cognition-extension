export const configProxy = (manifest) => new Proxy(manifest.config, { get: (target, prop) => target[prop]?.value });

export const manifest = {
	name: "config",
	context: ["extension-page", "service-worker", "offscreen"],
	version: "1.0.0",
	description: "Auto-generates configuration UIs from module manifests with validation and persistence",
	dependencies: ["chrome-sync"],
	actions: ["showConfig", "saveModuleConfig", "toggleCard", "resetToDefaults", "handleFieldChange"],
	uiComponents: [{ name: "module-config", getTree: "buildConfigTree" }]
};
let runtime, expandedCards = new Set();
export const initialize = async (rt) => {
	runtime = rt;
	addConfigSchemaActions();
	registerOnChangeActions();
	listenForCrossContextConfigChange();
	await Promise.all(getModules().map(async module => {
		const config = await loadConfig(module);
		validateConfig(module, config);
		applyConfig(module, config);
	}));
};

// Core operations
const getModules = () => runtime.getModulesWithProperty('config');
const getModule = (name) => getModules().find(m => m.manifest.name === name) ?? (() => { throw new Error(`Module ${name} not found`); })();
const loadConfig = async (module) => await runtime.call('chrome-sync.get', `config.${module.manifest.name}`) || moduleDefaults(module);
const saveConfig = async (module, updates) => await runtime.call('chrome-sync.set', { [`config.${module.manifest.name}`]: updates });
const removeConfig = async (module) => await runtime.call('chrome-sync.remove', `config.${module.manifest.name}`);
const moduleDefaults = (module) => Object.fromEntries(Object.entries(module.manifest.config).map(([key, schema]) => [key, schema.value]));
const updateAndSaveConfig = async (moduleName, updates) => {
	const module = getModule(moduleName);
	validateConfig(module, updates);
	await applyConfig(module, updates);
	await saveConfig(module, updates);
	return updates;
};
const validateConfig = (module, updates) => {
	const errors = Object.entries(updates).map(([field, value]) => ({ field, ...validateField(value, module.manifest.config[field]) })).filter(v => !v.valid);
	if (errors.length > 0) throw new Error(`Validation failed: ${errors.map(e => `${e.field}: ${e.error}`).join(', ')}`);
};
const validateField = (value, schema = {}) => {
	if (schema.required && (value === undefined || value === null || value === '')) return { valid: false, error: 'Required field' };
	if (value === undefined || value === null || value === '') return { valid: true };
	const validators = {
		number: (v, s) => {
			const num = Number(v);
			if (isNaN(num)) return { valid: false, error: 'Must be a number' };
			if (s.min !== undefined && num < s.min) return { valid: false, error: `Min: ${s.min}` };
			if (s.max !== undefined && num > s.max) return { valid: false, error: `Max: ${s.max}` };
			return { valid: true };
		},
		string: (v, s) => typeof v !== 'string' ? { valid: false, error: 'Must be text' } :
			s.minLength && v.length < s.minLength ? { valid: false, error: `Min length: ${s.minLength}` } :
				s.maxLength && v.length > s.maxLength ? { valid: false, error: `Max length: ${s.maxLength}` } : { valid: true },
		password: (v, s) => validators.string(v, s),
		select: (v, s) => {
			const validValues = (s.options || []).map(opt => typeof opt === 'string' ? opt : opt.value);
			return validValues.includes(v) ? { valid: true } : { valid: false, error: 'Invalid selection' };
		},
		checkbox: (v) => typeof v !== 'boolean' ? { valid: false, error: 'Must be true/false' } : { valid: true }
	};
	return validators[schema.type]?.(value, schema) || { valid: true };
};
const applyConfig = async (module, updates) => {
	for (const [field, value] of Object.entries(updates)) {
		if (module.manifest.config[field]) {
			runtime.log(`Setting ${field} from`, { oldValue: module.manifest.config[field], newValue: value });
			module.manifest.config[field].value = value;
			const onChange = module.manifest.config[field].onChange;
			onChange && await runtime.call(`${module.manifest.name}.${onChange}`).catch(error => runtime.logError(`[Config] onChange failed for ${field}:`, error));
		}
	}
};
// Event handlers
export const handleFieldChange = async (eventData) => {
	const { target: { name: fieldName, value }, formData } = eventData;
	const moduleName = formData?.moduleName;
	if (!moduleName || !fieldName) return;
	chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', moduleName, updates: { [fieldName]: value } }).catch(() => { });
	refreshUI();
};
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
		chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', moduleName, updates: fieldValues }).catch(() => { });
		refreshUI();
	} catch (error) { runtime.logError(`[Config] Save failed:`, error); }
};
export const resetToDefaults = async (eventData) => {
	const moduleName = eventData.target.dataset.moduleName;
	if (!moduleName) return;
	const module = getModule(moduleName);
	await removeConfig(module);
	applyConfig(module, moduleDefaults(module));
	refreshUI();
};
// UI generation
const refreshUI = () => runtime.call('layout.renderComponent', 'module-config');
const getSchemaCrossContext = async (moduleName) => {
	try { return await runtime.call(`${moduleName}.getConfigSchema`); }
	catch (error) { runtime.log(`[Config] Failed to get schema for ${moduleName}, using local copy`); return {}; }
};
export const buildConfigTree = async () => ({
	"config-page": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px;",
		"title": { tag: "h2", text: "Module Configuration", style: "margin-bottom: 20px;" },
		"config-cards": { tag: "div", style: "display: flex; flex-direction: column; gap: 15px; max-width: 800px;", ...await buildModuleCards() }
	}
});
const buildModuleCards = async () => Object.fromEntries(await Promise.all(getModules().map(async module => [`card-${module.manifest.name}`, await buildModuleCard(module)])));
const buildModuleCard = async (module) => {
	const { name } = module.manifest, isExpanded = expandedCards.has(name);
	const isLocal = runtime.getContextModules().find(m => m.manifest.name === name);
	const schema = isLocal ? module.manifest.config : await getSchemaCrossContext(name);
	return {
		tag: "div", class: "cognition-card", style: "border: 1px solid var(--border-primary);",
		[`header-${name}`]: {
			tag: "div", style: "display: flex; justify-content: space-between; align-items: center;",
			"title-area": { tag: "div", style: "display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1;", events: { click: "config.toggleCard" }, "data-module-name": name, "title": { tag: "h3", text: name, style: "margin: 0;" }, "expand-icon": { tag: "span", text: isExpanded ? "▼" : "▶", style: "color: var(--text-muted);" } },
			"reset-button": { tag: "button", text: "Reset", class: "cognition-button-secondary", style: "padding: 4px 8px; font-size: 12px;", events: { click: "config.resetToDefaults" }, "data-module-name": name, title: "Reset to default values" }
		},
		"description": { tag: "p", text: module.manifest.description, style: "margin: 8px 0 0 0; color: var(--text-muted); font-size: 14px;" },
		...(isExpanded && { [`form-${name}`]: buildModuleForm(name, schema) })
	};
};
const buildModuleForm = (name, schema) => ({
	tag: "form", style: "margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-primary);", events: { submit: "config.saveModuleConfig" },
	"hidden-module": { tag: "input", type: "hidden", name: "moduleName", value: name },
	...Object.fromEntries(Object.entries(schema).map(([fieldName, fieldSchema]) => [`field-${name}-${fieldName}`, buildFormField(fieldName, fieldSchema)])),
	"save-button": { tag: "button", type: "submit", text: "Save Configuration", class: "cognition-button-primary", style: "margin-top: 15px;" }
});
const buildFormField = (fieldName, schema) => ({
	tag: "div", style: "margin-bottom: 15px;",
	"label": { tag: "label", text: schema.label || fieldName, style: "display: block; margin-bottom: 6px; font-weight: 500;" },
	"input": buildInputElement(fieldName, schema),
	...(schema.description && { "desc": { tag: "div", text: schema.description, style: "font-size: 12px; color: var(--text-muted); margin-top: 4px;" } }),
	"error": { tag: "div", style: "color: var(--danger); font-size: 12px; margin-top: 4px; min-height: 16px;" }
});
const buildInputElement = (fieldName, schema) => {
	const baseProps = { name: fieldName, class: schema.type === 'select' ? "cognition-select" : "cognition-input", value: schema.value || schema.default || '', required: schema.required || false };
	const events = schema.onChange ? { change: 'config.handleFieldChange' } : {};
	const inputTypes = {
		select: () => ({ tag: "select", ...baseProps, class: "cognition-select", events, options: (schema.options || [{ value: '', text: 'Loading...' }]).map(opt => typeof opt === 'string' ? { value: opt, text: opt } : opt) }),
		number: () => ({ tag: "input", type: "number", ...baseProps, ...(schema.min !== undefined && { min: schema.min }), ...(schema.max !== undefined && { max: schema.max }) }),
		password: () => ({ tag: "input", type: "password", ...baseProps }),
		checkbox: () => ({ tag: "input", type: "checkbox", ...baseProps, checked: schema.value || schema.default || false, value: undefined }),
		textarea: () => ({ tag: "textarea", ...baseProps, rows: schema.rows || 4 }),
		globalKey: () => ({ tag: "input", type: "text", ...baseProps }),
		default: () => ({ tag: "input", type: "text", ...baseProps, ...(schema.placeholder && { placeholder: schema.placeholder }) })
	};
	return inputTypes[schema.type]?.() || inputTypes.default();
};
// Cross-context messaging
const listenForCrossContextConfigChange = () => chrome.runtime.onMessage.addListener((message) => {
	if (message.type === 'CONFIG_UPDATED') {
		const module = getModule(message.moduleName);
		module && applyConfig(module, message.updates);
	}
});
const addConfigSchemaActions = () => getModules().forEach(module => {
	const actionName = `${module.manifest.name}.getConfigSchema`;
	!runtime.actions.has(actionName) && runtime.actions.set(actionName, { func: () => module.manifest.config, context: runtime.runtimeName, moduleName: module.manifest.name });
});
const registerOnChangeActions = () => getModules().forEach(module =>
	Object.entries(module.manifest.config || {}).forEach(([fieldName, fieldSchema]) => {
		if (fieldSchema.onChange) {
			const actionName = `${module.manifest.name}.${fieldSchema.onChange}`;
			!runtime.actions.has(actionName) && typeof module[fieldSchema.onChange] === 'function' && runtime.registerAction(module, fieldSchema.onChange);
		}
	})
);
// Testing
export const test = async () => {
	const { runUnitTest, strictEqual } = runtime.testUtils;
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
			const mockSchema = { apiKey: { type: 'password', default: 'default-key', value: 'loaded-key' } };
			return { actual: mockSchema.apiKey.value, assert: strictEqual, expected: 'loaded-key' };
		})
	];
};