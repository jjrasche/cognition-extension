export const manifest = {
	name: "manual-atom-extractor",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Extract and curate atomic ideas from conversation sources to test flow enhancement hypothesis",
	actions: ["loadSource", "handleSelection", "createAtomicIdea", "editIdea", "saveCollection"],
	uiComponents: [
		{ name: "main", getTree: "buildTree" }
	]
};

let runtime, selectedSpans = [], atomicIdeas = [], currentSource = null;
export const initialize = async (rt) => runtime = rt;

export const loadSource = async (tree, params = {}) => {
	currentSource = { tree, ...params };
	await refreshUI();
};
// dynamic form behavior
export const handleSelection = async ({ selection }) => {
	selectedSpans.push({ text: selection.text, elementId: selection.elementId, timestamp: Date.now() });
	await refreshUI();
};
export const createAtomicIdea = async ({ formData }) => {
	const text = formData.ideaText || selectedSpans.map(s => s.text).join(' ');
	const node = await runtime.call('graph-db.addNode', { type: 'atomic-idea', text, sourceSpans: selectedSpans.map(s => s.text), sourceId: currentSource?.sourceId });
	atomicIdeas.push(node);
	await clearSelections();
};
const clearSelections = async () => (selectedSpans = [], await refreshUI());
export const editIdea = async (eventData) => {
	const index = parseInt(eventData.target.dataset.ideaIndex), newText = eventData.target.value;
	atomicIdeas[index] = { ...atomicIdeas[index], text: newText, lastEdited: new Date().toISOString() };
};
export const saveCollection = async () => {
	if (atomicIdeas.length === 0) return;
	const collection = { sourceId: currentSource?.sourceId, extractedAt: new Date().toISOString(), atomicIdeas: atomicIdeas };
	console.log('Atomic Ideas Collection:', JSON.stringify(collection, null, 2));	// todo save to file for now, graph db when stable
};
// UI
const refreshUI = () => runtime.call('layout.replaceComponent', 'main', buildTree());
const buildTree = () => ({ "manual-atom-extractor": { tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;", ...header(), ...mainContent() } });
const header = () => ({ "header": { tag: "div", style: "margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;", "title": { tag: "h2", text: "Knowledge Forge", style: "margin: 0; color: var(--text-primary);" }, ...saveButton() } });
const saveButton = () => ({ "save-button": { tag: "button", text: "Save Collection", class: "cognition-button-primary", events: { click: "manual-atom-extractor.saveCollection" } } });
const mainContent = () => ({ "main-content": { tag: "div", style: "flex: 1; display: flex; gap: 20px; min-height: 0;", ...sourcePanel(), ...ideaPanel() } });
const sourcePanel = () => ({ "source-panel": { tag: "div", style: panelStyle, ...sourceHeader(), ...sourceContent() } });
const sourceHeader = () => ({ "source-header": { tag: "div", style: headerStyle, "next-sources-btn": { tag: "button", text: "Load Next Source", class: "cognition-button-secondary", events: { click: "manual-atom-extractor.loadSource" } } } });
const sourceContent = () => ({ "source-content": { tag: "div", id: "source-content", style: "flex: 1; padding: 15px; overflow-y: auto; line-height: 1.6; cursor: text;", data: { textSelectionHandler: "manual-atom-extractor.handleSelection" }, innerHTML: currentSource ? currentSource.tree : '<p style="color: var(--text-muted); text-align: center; margin-top: 50px;">Load a conversation to begin extracting atomic ideas</p>' } });
const ideaPanel = () => ({ "idea-panel": { tag: "div", style: "flex: 1; display: flex; flex-direction: column; gap: 20px;", ...ideaCreator(), ...ideaCollection() } });
const ideaCreator = () => ({
	"idea-creator": {
		tag: "form", style: "flex: 0 0 40%;" + panelStyle.replace("flex: 1;", ""), events: { submit: "manual-atom-extractor.createAtomicIdea" },
		"creator-header": { tag: "div", style: headerStyle, "header-text": { tag: "h3", text: "Create Atomic Idea", style: "margin: 0; font-size: 16px;" } },
		"creator-body": {
			tag: "div", style: "flex: 1; padding: 15px; display: flex; flex-direction: column; gap: 10px;",
			"selected-spans-preview": { tag: "div", style: "min-height: 60px; padding: 10px; border: 1px dashed var(--border-primary); border-radius: 4px; background: var(--bg-tertiary); font-size: 12px; color: var(--text-muted);", innerHTML: selectedSpans.length === 0 ? "Selected text will appear here..." : selectedSpans.map((span, i) => `<div><strong>Span ${i + 1}:</strong> "${span.text}"</div>`).join('') },
			"idea-editor": { tag: "textarea", name: "ideaText", placeholder: "Edit your atomic idea here...", style: "flex: 1; min-height: 80px; padding: 10px; border: 1px solid var(--border-primary); border-radius: 4px; resize: vertical; font-family: inherit;" },
			"create-button": { tag: "button", type: "submit", text: "Create Atomic Idea", class: "cognition-button-primary", disabled: selectedSpans.length === 0 }
		}
	}
});
const ideaCollection = () => ({ "idea-collection": { tag: "div", style: panelStyle, ...ideaCollectionHeader(), ...ideaList() } });
const ideaCollectionHeader = () => ({ "collection-header": { tag: "div", style: headerStyle, "collection-title": { tag: "h3", text: `Atomic Ideas (${atomicIdeas.length})`, style: "margin: 0; font-size: 16px;" } } });
const panelStyle = "flex: 1; display: flex; flex-direction: column; border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-secondary);";
const headerStyle = "padding: 15px; border-bottom: 1px solid var(--border-primary);";
const noIdeas = () => ({ "empty-state": { tag: "div", style: "color: var(--text-muted); text-align: center; margin-top: 50px;", text: "No atomic ideas yet. Select text and create your first idea!" } });
const ideaList = () => {
	if (atomicIdeas.length === 0) return noIdeas();
	const ideaNodes = atomicIdeas.reduce((acc, idea, index) => (acc[`idea-${index}`] = createIdea(idea, index), acc), {});
	return { "ideas-list": { tag: "div", style: "flex: 1; padding: 15px; overflow-y: auto;", ...ideaNodes } };
};
const createIdea = (idea, index) => ({
	tag: "div", style: "margin-bottom: 15px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid var(--accent-primary);",
	[`${idea.id}-textarea`]: { tag: "textarea", value: idea.text, style: "width: 100%; min-height: 60px; padding: 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-input); resize: vertical;", events: { change: "manual-atom-extractor.editIdea" }, "data-idea-index": index },
	[`${idea.id}-spans`]: { tag: "div", style: "font-size: 11px; color: var(--text-muted); margin-top: 6px;", innerHTML: `<strong>Source spans:</strong> ${idea.sourceSpans?.map(span => span.substring(0, 50) + (span.length > 50 ? '...' : '')).join(', ') || 'Manual entry'}` },
	[`${idea.id}-meta`]: { tag: "div", style: "font-size: 10px; color: var(--text-muted); margin-top: 4px;", text: `Created: ${new Date(idea.createdAt).toLocaleString()}` }
})