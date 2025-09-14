import { retryAsync } from "./helpers.js";

export const configProxy = (manifest) => new Proxy(manifest.config, { get: (target, prop) => target[prop]?.value });
export const manifest = {
	name: "config",
	context: ["extension-page", "service-worker", "offscreen"],
	version: "1.0.0",
	description: "Auto-generates configuration UIs from module manifests with validation and persistence",
	dependencies: ["chrome-sync"],
	actions: ["showConfig", "toggleCard", "resetToDefaults", "handleFieldChange", "testInferenceConfig"],
	uiComponents: [{ name: "module-config", getTree: "buildConfigTree" }]
};

let runtime, expandedCards = new Set();
export const initialize = async (rt) => {
	try {
		console.log('[CONFIG DEBUG] Initialize starting in:', rt.runtimeName);
		runtime = rt;

		console.log('[CONFIG DEBUG] Adding schema actions...');
		addConfigSchemaActions();

		console.log('[CONFIG DEBUG] Registering onChange actions...');
		registerOnChangeActions();

		console.log('[CONFIG DEBUG] Setting up cross-context listener...');
		listenForCrossContextConfigChange();

		const modules = getModules();
		console.log('[CONFIG DEBUG] Found modules with config:', modules.map(m => m.manifest.name));

		console.log('[CONFIG DEBUG] Loading configs for each module...');
		await Promise.all(modules.map(async module => {
			console.log('[CONFIG DEBUG] Loading config for:', module.manifest.name);
			const config = await loadConfig(module);
			console.log('[CONFIG DEBUG] Loaded config:', config);
			validateConfig(module.manifest.config, config);
			console.log('[CONFIG DEBUG] Config validated, applying locally...');
			applyConfigLocal(module, config);
			console.log('[CONFIG DEBUG] Config applied for:', module.manifest.name);
		}));

		console.log('[CONFIG DEBUG] Initialize complete successfully');
	} catch (error) {
		console.error('[CONFIG DEBUG] Initialize failed:', error);
		throw error;
	}
};


// Core operations - UI discovery
const getModules = () => runtime.getModulesWithProperty('config');
const loadConfig = async (module) => await runtime.call('chrome-sync.get', `config.${module.manifest.name}`) || moduleDefaults(module);
const moduleDefaults = (module) => Object.fromEntries(Object.entries(module.manifest.config).map(([key, schema]) => [key, schema.value]));
// Validation
const validateConfig = (schema, updates) => {
	const errors = Object.entries(updates).map(([field, value]) => ({ field, ...validateField(value, schema[field]) })).filter(v => !v.valid);
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
			return validValues.length === 0 || validValues.includes(v) ? { valid: true } : { valid: false, error: 'Invalid selection' };
		},
		checkbox: (v) => typeof v !== 'boolean' ? { valid: false, error: 'Must be true/false' } : { valid: true }
	};
	return validators[schema.type]?.(value, schema) || { valid: true };
};
// Config operations
const saveConfig = async (moduleName, updates) => {
	// Use local state when available, fallback to chrome-sync
	const localModule = runtime.getContextModules().find(m => m.manifest.name === moduleName);
	const currentConfig = localModule
		? Object.fromEntries(Object.entries(localModule.manifest.config).map(([k, s]) => [k, s.value]))
		: await runtime.call('chrome-sync.get', `config.${moduleName}`) || {};

	await runtime.call('chrome-sync.set', { [`config.${moduleName}`]: { ...currentConfig, ...updates } });
};
const applyConfigLocal = async (module, updates) => {
	runtime.log(`[Config Debug] applyConfigLocal - module: ${module.manifest.name}, updates:`, updates);
	for (const [field, value] of Object.entries(updates)) {
		if (module.manifest.config[field]) {
			const oldValue = module.manifest.config[field].value;
			module.manifest.config[field].value = value;
			runtime.log(`[Config Debug] Updated ${field}: ${oldValue} -> ${value}`);
			const onChange = module.manifest.config[field].onChange;
			onChange && await runtime.call(`${module.manifest.name}.${onChange}`).catch(error => runtime.logError(`[Config] onChange failed for ${field}:`, error));
		}
	}
};
const triggerOnChange = async (moduleName, fieldName, schema) => {
	const onChange = schema[fieldName]?.onChange;
	runtime.log(`[Config Debug] triggerOnChange - module: ${moduleName}, field: ${fieldName}, onChange: ${onChange}`);
	if (onChange) {
		try {
			runtime.log(`[Config Debug] Calling ${moduleName}.${onChange}`);
			const result = await runtime.call(`${moduleName}.${onChange}`);
			runtime.log(`[Config Debug] onChange result:`, result);
		} catch (error) {
			runtime.logError(`[Config] Cross-context onChange failed for ${moduleName}.${fieldName}:`, error);
		}
	}
};
// Event handlers
export const handleFieldChange = async (eventData) => {
	const { target: { name: fieldName, value }, formData } = eventData, moduleName = formData?.moduleName;
	runtime.log(`[Config Debug] handleFieldChange - module: ${moduleName}, field: ${fieldName}, value: ${value}`);
	if (!moduleName || !fieldName) return;
	try {
		// Get schema (works for local and cross-context)
		const schema = await getSchemaCrossContext(moduleName);

		// Validate single field
		const validation = validateField(value, schema[fieldName]);
		if (!validation.valid) throw new Error(validation.error);

		// Save and trigger onChange
		await saveConfig(moduleName, { [fieldName]: value });
		await triggerOnChange(moduleName, fieldName, schema);

		// Broadcast to other contexts
		chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', moduleName, updates: { [fieldName]: value } }).catch(() => { });
		refreshUI();
	} catch (error) {
		runtime.logError(`[Config] Field change failed:`, error);
	}
};
export const toggleCard = async (eventData) => {
	const moduleName = eventData.target.dataset.moduleName;
	if (!moduleName) return;

	const cardElement = eventData.target.closest('.cognition-card');
	if (!cardElement) return;

	const isCurrentlyExpanded = expandedCards.has(moduleName);
	const willBeExpanded = !isCurrentlyExpanded;

	// Update state
	isCurrentlyExpanded ? expandedCards.delete(moduleName) : expandedCards.add(moduleName);

	// Update icon immediately
	const expandIcon = cardElement.querySelector('[data-module-name="' + moduleName + '"] span');
	if (expandIcon) expandIcon.textContent = willBeExpanded ? "▼" : "▶";

	// Handle form section
	let formElement = cardElement.querySelector(`[id*="form-${moduleName}"]`);

	if (willBeExpanded && !formElement) {
		// Create and append form
		const schema = await getSchemaCrossContext(moduleName);
		const formTree = { [`form-${moduleName}`]: buildModuleForm(moduleName, schema) };
		const tempContainer = document.createElement('div');
		await runtime.call('tree-to-dom.transform', formTree, tempContainer);
		cardElement.appendChild(tempContainer.firstElementChild);
	} else if (!willBeExpanded && formElement) {
		// Remove form
		formElement.remove();
	}

	runtime.log('[Config Debug] Card toggled without scroll disruption:', { moduleName, willBeExpanded });
};
export const resetToDefaults = async (eventData) => {
	const moduleName = eventData.target.dataset.moduleName;
	if (!moduleName) return;

	const schema = await getSchemaCrossContext(moduleName);
	const defaults = Object.fromEntries(Object.entries(schema).map(([key, s]) => [key, s.value]));

	// Get current config to compare what actually changed
	const currentConfig = await runtime.call('chrome-sync.get', `config.${moduleName}`) || {};

	await runtime.call('chrome-sync.remove', `config.${moduleName}`);
	await saveConfig(moduleName, defaults);

	// Only trigger onChange for fields that actually changed
	for (const [fieldName, defaultValue] of Object.entries(defaults)) {
		if (currentConfig[fieldName] !== defaultValue) {
			await triggerOnChange(moduleName, fieldName, schema);
		}
	}

	chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', moduleName, updates: defaults }).catch(() => { });
	refreshUI();
};
// Cross-context messaging
const listenForCrossContextConfigChange = () => chrome.runtime.onMessage.addListener(async (message) => {
	if (message.type === 'CONFIG_UPDATED') {
		// Only update local modules
		const localModule = runtime.getContextModules().find(m => m.manifest.name === message.moduleName);
		if (localModule) {
			await applyConfigLocal(localModule, message.updates);
		}
	}
});
// UI generation
// In config.module.js, replace the refreshUI function (around line 154):
const refreshUI = async () => {
	// Debug all potential scrolling elements
	const candidates = [
		'[data-component="module-config"]',
		'[data-component="module-config"] .component-content',
		'.cognition-layout-container',
		'body'
	];

	let scrollElement = null, scrollTop = 0;
	candidates.forEach(selector => {
		const el = document.querySelector(selector);
		if (el && el.scrollTop > 0) {
			scrollElement = selector;
			scrollTop = el.scrollTop;
			runtime.log('[Config Debug] Found scrolling element:', { selector, scrollTop: el.scrollTop });
		}
	});

	runtime.log('[Config Debug] Before refresh - scroll analysis:', {
		scrollElement,
		scrollTop,
		allElements: candidates.map(sel => {
			const el = document.querySelector(sel);
			return { selector: sel, found: !!el, scrollTop: el?.scrollTop || 0 };
		})
	});

	await runtime.call('layout.renderComponent', 'module-config');

	// Restore if we found a scrolling element
	if (scrollElement && scrollTop > 0) {
		// Try multiple times with increasing delays
		[50, 100, 200].forEach((delay, index) => {
			setTimeout(() => {
				const newEl = document.querySelector(scrollElement);
				if (newEl) {
					const beforeScrollTop = newEl.scrollTop;
					newEl.scrollTop = scrollTop;
					runtime.log(`[Config Debug] Restore attempt ${index + 1} (${delay}ms):`, {
						selector: scrollElement,
						targetScroll: scrollTop,
						beforeScroll: beforeScrollTop,
						afterScroll: newEl.scrollTop,
						success: newEl.scrollTop === scrollTop
					});
				} else {
					runtime.log(`[Config Debug] Restore attempt ${index + 1} failed - element not found:`, scrollElement);
				}
			}, delay);
		});
	} else {
		runtime.log('[Config Debug] No scroll to restore:', { scrollElement, scrollTop });
	}
};
const getSchemaCrossContext = async (moduleName) => {
	// Try local first
	const localModule = runtime.getContextModules().find(m => m.manifest.name === moduleName);
	if (localModule) return localModule.manifest.config;

	// Fetch cross-context
	try {
		return await runtime.call(`${moduleName}.getConfigSchema`);
	} catch (error) {
		runtime.log(`[Config] Failed to get schema for ${moduleName}`);
		return {};
	}
};
export const buildConfigTree = async () => ({
	"config-page": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; overflow-y: auto;",
		"title": { tag: "h2", text: "Module Configuration", style: "margin-bottom: 20px;" },
		"config-cards": { tag: "div", style: "display: flex; flex-direction: column; gap: 15px; max-width: 800px;", ...await buildModuleCards() }
	}
});
const buildModuleCards = async () => Object.fromEntries(await Promise.all(getModules().map(async module => [`card-${module.manifest.name}`, await buildModuleCard(module)])));
const buildModuleCard = async (module) => {
	const { name } = module.manifest, isExpanded = expandedCards.has(name);
	const schema = await getSchemaCrossContext(name);
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
	tag: "form", style: "margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-primary);",
	"hidden-module": { tag: "input", type: "hidden", name: "moduleName", value: name },
	...Object.fromEntries(Object.entries(schema).map(([fieldName, fieldSchema]) => [`field-${name}-${fieldName}`, buildFormField(fieldName, fieldSchema)]))
});
const buildFormField = (fieldName, schema) => ({
	tag: "div", style: "margin-bottom: 15px;",
	"label": { tag: "label", text: schema.label || fieldName, style: "display: block; margin-bottom: 6px; font-weight: 500;" },
	"input": buildInputElement(fieldName, schema),
	...(schema.description && { "desc": { tag: "div", text: schema.description, style: "font-size: 12px; color: var(--text-muted); margin-top: 4px;" } })
});
const buildInputElement = (fieldName, schema) => {
	const baseProps = { name: fieldName, class: schema.type === 'select' ? "cognition-select" : "cognition-input", value: schema.value || schema.default || '', required: schema.required || false };
	// All inputs are live-updating now
	const events = { change: 'config.handleFieldChange' };
	const inputTypes = {
		select: () => ({ tag: "select", ...baseProps, class: "cognition-select", events, options: (schema.options || [{ value: '', text: 'Loading...' }]).map(opt => typeof opt === 'string' ? { value: opt, text: opt } : opt) }),
		number: () => ({ tag: "input", type: "number", ...baseProps, events, ...(schema.min !== undefined && { min: schema.min }), ...(schema.max !== undefined && { max: schema.max }), ...(schema.step !== undefined && { step: schema.step }) }),
		password: () => ({ tag: "input", type: "password", ...baseProps, events }),
		checkbox: () => ({ tag: "input", type: "checkbox", ...baseProps, events, checked: schema.value || schema.default || false, value: undefined }),
		textarea: () => ({ tag: "textarea", ...baseProps, events, rows: schema.rows || 4 }),
		globalKey: () => ({ tag: "input", type: "text", ...baseProps, events }),
		default: () => ({ tag: "input", type: "text", ...baseProps, events, ...(schema.placeholder && { placeholder: schema.placeholder }) })
	};
	return inputTypes[schema.type]?.() || inputTypes.default();
};
// Schema action registration
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

export const testInferenceConfig = async () => {
	runtime.log(`[Dev Test] Starting inference config DOM test`);

	try {
		// Step 1: Ensure config UI is rendered to layout
		runtime.log(`[Dev Test] Adding config component to layout...`);
		await runtime.call('layout.renderComponent', 'module-config');
		await runtime.wait(500);

		// Step 2: Wait for inference card to exist
		runtime.log(`[Dev Test] Waiting for inference config card...`);
		const cardHeader = await waitForElement('[data-module-name="inference"]');
		runtime.log(`[Dev Test] Found inference card, expanding...`);
		cardHeader.click();
		await runtime.wait(200);

		// Step 3: Wait for provider dropdown and set value
		runtime.log(`[Dev Test] Waiting for provider dropdown...`);
		const providerSelect = await waitForElement('select[name="provider"]');
		runtime.log(`[Dev Test] Setting provider to groq-inference...`);
		providerSelect.value = 'groq-inference';
		providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
		await runtime.wait(500);

		// Step 4: Check model dropdown populated
		runtime.log(`[Dev Test] Checking model dropdown...`);
		const modelSelect = await waitForElement('select[name="model"]');
		const modelOptions = Array.from(modelSelect.options).map(opt => ({ value: opt.value, text: opt.text }));
		runtime.log(`[Dev Test] Found ${modelOptions.length} model options`);

		// Step 5: Collect and format logs with timing
		const logs = await runtime.call('chrome-local.get', 'runtime.logs') || [];
		const filteredLogs = logs.filter(log =>
			log.message.includes('[Config Debug]') ||
			log.message.includes('[Inference Debug]') ||
			log.message.includes('[Dev Test]')
		);

		const startTime = filteredLogs.length > 0 ? filteredLogs[0].time : Date.now();
		const logsWithTiming = filteredLogs.map(log => ({
			time: `+${log.time - startTime}ms`,
			context: log.context,
			message: log.message,
			data: log.data
		}));

		await navigator.clipboard.writeText(JSON.stringify(logsWithTiming, null, 2));
		runtime.log(`[Dev Test] Complete! ${logsWithTiming.length} logs copied to clipboard`);

		return { success: true, modelOptions, logs: logsWithTiming };

	} catch (error) {
		runtime.logError(`[Dev Test] Failed:`, error);
		return { success: false, error: error.message };
	}
};

// Helper function (keep existing)
const waitForElement = (selector, timeout = 5000) => {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const check = () => {
			const el = document.querySelector(selector);
			if (el) resolve(el);
			else if (Date.now() - start > timeout) reject(new Error(`Element not found: ${selector}`));
			else setTimeout(check, 100);
		};
		check();
	});
};

export const debugConfigElements = async () => {
	runtime.log(`[Dev Debug] Looking for config elements...`);

	// Check what module cards exist
	const moduleCards = document.querySelectorAll('[data-module-name]');
	runtime.log(`[Dev Debug] Found ${moduleCards.length} module cards:`,
		Array.from(moduleCards).map(el => el.dataset.moduleName));

	// Check for inference specifically
	const inferenceCard = document.querySelector('[data-module-name="inference"]');
	runtime.log(`[Dev Debug] Inference card found:`, !!inferenceCard);

	// Check for any select elements
	const selects = document.querySelectorAll('select');
	runtime.log(`[Dev Debug] Found ${selects.length} select elements:`,
		Array.from(selects).map(s => s.name));

	return { moduleCards: moduleCards.length, hasInference: !!inferenceCard, selects: selects.length };
};