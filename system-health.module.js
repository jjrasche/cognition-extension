export const manifest = {
	name: "system-health",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Monitors module health metrics with configurable thresholds and real-time updates",
	dependencies: ["chrome-sync"],
	actions: ["getSystemHealth", "getModuleHealth", "recalculateMetrics", "showHealthUI", "showModuleDetail", "updateThreshold"],
	uiComponents: [{ name: "health dashboard", getTree: "buildTree" }],
};
let runtime, log, moduleHealthData = new Map(), debounceTimers = new Map();
const DEBOUNCE_DELAY = 1000;

export const initialize = async (rt, l) => {
	runtime = rt, log = l;
	registerHealthModules();
	// interceptRuntimeCalls();
	recalculateMetrics();
}
// === CORE HEALTH TRACKING ===
const registerHealthModules = () => runtime.getModulesWithProperty('healthMetrics').forEach(module => {
	const { name, healthMetrics = [], healthTriggers = [] } = module.manifest;
	moduleHealthData.set(name, { metrics: healthMetrics, triggers: healthTriggers, lastCalculated: null, currentValues: {}, status: 'unknown' });
});
// todo: need to come up with new architecture if we expand runtime intercepting to multiple modules
const interceptRuntimeCalls = () => {
	const originalCall = runtime.call.bind(runtime);
	runtime.call = async (actionName, ...args) => {
		const result = await originalCall(actionName, ...args);
		getTriggeredModules(actionName).forEach(moduleName => debouncedRecalculate(moduleName));
		return result;
	};
};
const getTriggeredModules = (actionName) => [...moduleHealthData].filter(([_, data]) => data.triggers.includes(actionName)).map(([name]) => name);
const debouncedRecalculate = (moduleName) => (clearTimeout(debounceTimers.get(moduleName)), debounceTimers.set(moduleName, setTimeout(() => recalculateModuleMetrics(moduleName), DEBOUNCE_DELAY)));
// === METRIC CALCULATION ===
export const recalculateMetrics = async (moduleName) => moduleName ? recalculateModuleMetrics(moduleName) : Promise.all([...moduleHealthData.keys()].map(recalculateModuleMetrics));
const recalculateModuleMetrics = async (moduleName) => {
	const moduleData = moduleHealthData.get(moduleName);
	if (!moduleData) return;
	try {
		const values = await Promise.all(moduleData.metrics.map(async metric => [metric.name, await metric.valueFunction().catch(() => 0)]));
		const statuses = values.map(([name, value]) => getMetricStatus(value, getThresholds(moduleName, name)));
		moduleData.currentValues = Object.fromEntries(values);
		moduleData.status = statuses.includes('critical') ? 'critical' : statuses.includes('warning') ? 'warning' : 'good';
		moduleData.lastCalculated = new Date().toISOString();
	} catch (error) {
		log.error(` Failed ${moduleName}:`, error);
		moduleData.status = 'critical';
	}
};
const getMetricStatus = (value, thresholds) => value >= thresholds.good ? 'good' : value >= thresholds.warning ? 'warning' : 'critical';
const getThresholds = (moduleName, metricName) => {
	const metric = moduleHealthData.get(moduleName)?.metrics.find(m => m.name === metricName);
	return metric?.thresholds || { good: 80, warning: 60, critical: 40 };
};
// === NORMALIZATION HELPERS ===
const normalize = (value, max, invert = false) => Math.max(0, Math.min(100, invert ? 100 - (value / max * 100) : (value / max * 100)));
export const normalizers = {
	latency: (ms, maxMs = 2000) => normalize(ms, maxMs, true),
	percentage: (decimal) => normalize(decimal, 1),
	errorRate: (errors, total) => total === 0 ? 100 : normalize(errors, total, true),
	successRate: (successes, total) => total === 0 ? 0 : normalize(successes, total),
	cacheHitRate: (hits, total) => total === 0 ? 0 : normalize(hits, total)
};
// === PUBLIC API ===
export const getSystemHealth = async () => {
	const modules = Object.fromEntries([...moduleHealthData].map(([name, data]) => [name, { status: data.status, metrics: data.currentValues, lastCalculated: data.lastCalculated }]));
	const statuses = Object.values(modules).map(m => m.status);
	return { overallStatus: statuses.includes('critical') ? 'critical' : statuses.includes('warning') ? 'warning' : 'good', modules };
};
export const getModuleHealth = async (moduleName) => {
	const data = moduleHealthData.get(moduleName);
	return data ? {
		name: moduleName,
		status: data.status,
		metrics: data.metrics.map(metric => ({
			name: metric.name,
			description: metric.description,
			currentValue: data.currentValues[metric.name] || 0
		})),
		lastCalculated: data.lastCalculated
	} : null;
};
export const updateThreshold = async (eventData) => {
	const { moduleName, metricName, threshold, value } = eventData.formData;
	const moduleData = moduleHealthData.get(moduleName);
	const metric = moduleData?.metrics.find(m => m.name === metricName);
	if (metric) {
		metric.thresholds[threshold] = parseFloat(value);
		await recalculateModuleMetrics(moduleName);
		await refreshDashboard();
	}
};
// === UI COMPONENTS ===
export const refreshDashboard = () => runtime.call('layout.renderComponent', 'health-dashboard', buildTree());
const statusColors = { good: '#10b981', warning: '#f59e0b', critical: '#ef4444', unknown: '#6b7280' };
export const buildTree = async () => {
	const health = await getSystemHealth();
	return {
		"health-dashboard": {
			tag: "div", style: "height: 100vh; padding: 20px; overflow-y: auto;",
			...buildHeader(),
			...buildOverallStatus(health),
			...buildModulesGrid(health.modules)
		}
	};
};
const buildHeader = () => ({
	"header": {
		tag: "div", style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;",
		"back-button": { tag: "button", text: "← Back", class: "cognition-button-secondary", events: { click: "ui.initializeLayout" } },
		"title": { tag: "h1", text: "System Health Dashboard", style: "margin: 0; color: var(--text-primary);" },
		"refresh-button": { tag: "button", text: "Refresh All", class: "cognition-button-primary", events: { click: "system-health.recalculateMetrics" } }
	}
});
const buildOverallStatus = (health) => {
	const moduleCount = Object.keys(health.modules).length;
	const statusCounts = Object.values(health.modules).reduce((acc, module) => (acc[module.status] = (acc[module.status] || 0) + 1, acc), {});
	return {
		"overall-status": {
			tag: "div", style: "background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 8px; padding: 20px; margin-bottom: 20px;",
			"status-header": {
				tag: "div", style: "display: flex; align-items: center; gap: 12px; margin-bottom: 10px;",
				"status-dot": { tag: "div", style: `width: 16px; height: 16px; border-radius: 50%; background: ${statusColors[health.overallStatus]};` },
				"status-text": { tag: "h2", text: `System Status: ${health.overallStatus.toUpperCase()}`, style: "margin: 0; text-transform: capitalize;" }
			},
			"status-summary": { tag: "div", text: `${moduleCount} modules monitored - ${statusCounts.good || 0} healthy, ${statusCounts.warning || 0} warning, ${statusCounts.critical || 0} critical`, style: "color: var(--text-secondary); font-size: 14px;" }
		}
	};
};
const buildModulesGrid = (modules) => ({
	"modules-grid": {
		tag: "div", style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;",
		...Object.fromEntries(Object.entries(modules).map(([name, data]) => [`module-${name}`, buildModuleCard(name, data)]))
	}
});
const buildModuleCard = (name, data) => ({
	tag: "div", style: "background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 8px; padding: 16px; cursor: pointer; transition: border-color 0.2s;",
	events: { click: "system-health.showModuleDetail" }, "data-module": name,
	"module-header": {
		tag: "div", style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;",
		"module-name": { tag: "h3", text: name, style: "margin: 0; text-transform: capitalize;" },
		"module-status": { tag: "span", style: `color: ${statusColors[data.status]}; font-weight: 500; text-transform: uppercase; font-size: 12px;`, text: data.status }
	},
	"metrics-preview": { tag: "div", style: "color: var(--text-secondary); font-size: 14px;", text: `${Object.keys(data.metrics).length} metrics monitored` },
	"last-updated": { tag: "div", style: "color: var(--text-muted); font-size: 12px; margin-top: 8px;", text: data.lastCalculated ? `Updated: ${new Date(data.lastCalculated).toLocaleTimeString()}` : 'Not calculated' }
});
export const showModuleDetail = async (eventData) => {
	const moduleName = eventData.target.closest('[data-module]')?.dataset.module;
	const moduleHealth = await getModuleHealth(moduleName);
	if (!moduleHealth) return;
	await runtime.call('ui.showModal', { title: `${moduleName} Health Details`, tree: buildModuleDetailTree(moduleHealth) });
};
const buildModuleDetailTree = (moduleHealth) => ({
	"module-detail": {
		tag: "div",
		"status-overview": {
			tag: "div", style: "display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px;",
			"status-dot": { tag: "div", style: `width: 12px; height: 12px; border-radius: 50%; background: ${statusColors[moduleHealth.status]};` },
			"status-text": { tag: "span", text: `Overall Status: ${moduleHealth.status.toUpperCase()}`, style: "font-weight: 500;" }
		},
		"metrics-list": {
			tag: "div",
			...Object.fromEntries(moduleHealth.metrics.map((metric, index) => [`metric-${index}`, buildMetricCard(moduleHealth.name, metric)]))
		},
		"last-calculated": {
			tag: "div", style: "text-align: center; color: var(--text-muted); font-size: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-primary);",
			text: moduleHealth.lastCalculated ? `Last calculated: ${new Date(moduleHealth.lastCalculated).toLocaleString()}` : 'Not yet calculated'
		}
	}
});
const buildMetricCard = (moduleName, metric) => {
	const thresholds = getThresholds(moduleName, metric.name);
	return {
		tag: "div", style: "background: var(--bg-tertiary); border-radius: 6px; padding: 12px; margin-bottom: 12px;",
		"metric-header": {
			tag: "div", style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;",
			"metric-name": { tag: "h4", text: metric.name.replace(/_/g, ' '), style: "margin: 0; text-transform: capitalize;" },
			"metric-value": { tag: "span", text: `${Math.round(metric.currentValue)}/100`, style: "font-weight: 600; font-size: 18px;" }
		},
		"metric-description": { tag: "div", text: metric.description, style: "color: var(--text-secondary); font-size: 13px; margin-bottom: 8px;" },
		"thresholds": {
			tag: "div", style: "display: flex; gap: 12px; font-size: 12px;",
			"good-threshold": { tag: "span", text: `Good: ≥${thresholds.good}`, style: "color: #10b981; cursor: pointer;", events: { click: "system-health.editThreshold" }, "data-module": moduleName, "data-metric": metric.name, "data-threshold": "good" },
			"warning-threshold": { tag: "span", text: `Warning: ≥${thresholds.warning}`, style: "color: #f59e0b; cursor: pointer;", events: { click: "system-health.editThreshold" }, "data-module": moduleName, "data-metric": metric.name, "data-threshold": "warning" },
			"critical-threshold": { tag: "span", text: `Critical: <${thresholds.warning}`, style: "color: #ef4444;" }
		}
	};
};
export const editThreshold = async (eventData) => {
	const { module: moduleName, metric: metricName, threshold } = eventData.target.dataset;
	const currentValue = getThresholds(moduleName, metricName)[threshold];
	await runtime.call('ui.showModal', {
		title: `Edit ${threshold} threshold for ${metricName}`,
		tree: {
			"threshold-form": {
				tag: "form", events: { submit: "system-health.updateThreshold" },
				"threshold-input": { tag: "input", type: "number", name: "value", value: currentValue, min: "0", max: "100", step: "1", required: true, style: "width: 100%; margin-bottom: 16px;" },
				"hidden-module": { tag: "input", type: "hidden", name: "moduleName", value: moduleName },
				"hidden-metric": { tag: "input", type: "hidden", name: "metricName", value: metricName },
				"hidden-threshold": { tag: "input", type: "hidden", name: "threshold", value: threshold },
				"actions": {
					tag: "div", style: "display: flex; gap: 12px; justify-content: flex-end;",
					"cancel": { tag: "button", type: "button", text: "Cancel", class: "cognition-button-secondary", events: { click: "ui.closeModal" } },
					"save": { tag: "button", type: "submit", text: "Save", class: "cognition-button-primary" }
				}
			}
		}
	});
};
// === TESTING ===
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Normalization works correctly", async () => {
			const actual = {
				latency500: normalizers.latency(500, 2000),
				percentage: normalizers.percentage(0.85),
				errorRate: normalizers.errorRate(1, 10)
			};
			const expected = { latency500: 75, percentage: 85, errorRate: 90 };
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Health status calculation", async () => {
			const thresholds = { good: 80, warning: 60, critical: 40 };
			const actual = { good: getMetricStatus(85, thresholds), warning: getMetricStatus(65, thresholds), critical: getMetricStatus(35, thresholds) };
			const expected = { good: 'good', warning: 'warning', critical: 'critical' };
			return { actual, assert: deepEqual, expected };
		})
	];
};