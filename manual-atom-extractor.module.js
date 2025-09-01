export const manifest = {
	name: "manual-atom-extractor",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Extract and curate atomic ideas from conversation sources to test flow enhancement hypothesis",
	dependencies: ["conversation_search", "recent_chats", "ui", "tree-to-dom"],
	actions: ["buildUI", "loadSource", "handleSelection", "createAtomicIdea", "editIdea", "saveCollection"],
	searchActions: [
		{ name: "knowledge forge", keyword: "forge", method: "buildUI" }
	]
};

let runtime, selectedSpans = [], atomicIdeas = [], currentSource = null;
export const initialize = async (rt) => runtime = rt;

/*
	turn claude export into a list of inference interactions and load the next one in chronological order that isn't marked reviewed. format:
	currentSource = { sourceId: `claude_conv_${recentChat.uri}`, type: "inference interaction", prompt:  response: url:  timestamp: reviewed: false };
*/
export const loadSource = async () => {
	const claudeConversations = [];
	currentSource = claudeConversations.filter(c => !c.reviewed).sort((a, b) => a.timestamp - b.timestamp);
	await buildUI();
};

export const buildUI = async () => await runtime.call('ui.renderTree', buildTree());
const buildTree = () => ({ "manual-atom-extractor": { tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;", ...header(), ...mainContent() } });
const header = () => ({ "header": { tag: "div", style: "margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;", ...backButton(), "title": { tag: "h2", text: "Knowledge Forge", style: "margin: 0; color: var(--text-primary);" }, ...saveButton() } });
const backButton = () => ({ "back-button": { tag: "button", text: "← Back", class: "cognition-button-secondary", events: { click: "ui.initializeLayout" } } });
const saveButton = () => ({ "save-button": { tag: "button", text: "Save Collection", class: "cognition-button-primary", events: { click: "manual-atom-extractor.saveCollection" } } });
const mainContent = () => ({ "main-content": { tag: "div", style: "flex: 1; display: flex; gap: 20px; min-height: 0;", ...sourcePanel(), ...ideaPanel() } });
const sourcePanel = () => ({ "source-panel": { tag: "div", style: panelStyle, ...sourceHeader(), ...sourceContent() } });
const sourceHeader = () => ({ "source-header": { tag: "div", style: headerStyle, "next-sources-btn": { tag: "button", text: "Load Next Source", class: "cognition-button-secondary", events: { click: "manual-atom-extractor.loadSource" } } } });
const sourceContent = () => ({ "source-content": { tag: "div", id: "source-content", style: "flex: 1; padding: 15px; overflow-y: auto; line-height: 1.6; cursor: text;", data: { textSelectionHandler: "manual-atom-extractor.handleTextSelection" }, innerHTML: currentSource ? formatSourceContent(currentSource) : '<p style="color: var(--text-muted); text-align: center; margin-top: 50px;">Load a conversation to begin extracting atomic ideas</p>' } });
const ideaPanel = () => ({ "idea-panel": { tag: "div", style: "flex: 1; display: flex; flex-direction: column; gap: 20px;", ...ideaCreator(), ...ideaCollection() } });
const ideaCreator = () => ({
	"idea-creator": {
		tag: "div", style: "flex: 0 0 40%;" + panelStyle.replace("flex: 1;", ""),
		"creator-header": { tag: "div", style: headerStyle, "header-text": { tag: "h3", text: "Create Atomic Idea", style: "margin: 0; font-size: 16px;" } },
		"creator-body": {
			tag: "div", style: "flex: 1; padding: 15px; display: flex; flex-direction: column; gap: 10px;",
			"selected-spans-preview": { tag: "div", id: "selected-spans", style: "min-height: 60px; padding: 10px; border: 1px dashed var(--border-primary); border-radius: 4px; background: var(--bg-tertiary); font-size: 12px; color: var(--text-muted);", innerHTML: "Selected text will appear here..." },
			"idea-editor": { tag: "textarea", id: "idea-editor", placeholder: "Edit your atomic idea here...", style: "flex: 1; min-height: 80px; padding: 10px; border: 1px solid var(--border-primary); border-radius: 4px; resize: vertical; font-family: inherit;" },
			"create-button": { tag: "button", text: "Create Atomic Idea", class: "cognition-button-primary", events: { click: "manual-atom-extractor.createAtomicIdea" }, disabled: true, id: "create-idea-btn" }
		}
	}
});
const ideaCollection = () => ({ "idea-collection": { tag: "div", style: panelStyle, ...ideaCollectionHeader(), ...ideaList() } });
const ideaCollectionHeader = () => ({ "collection-header": { tag: "div", style: headerStyle, "collection-title": { tag: "h3", text: `Atomic Ideas (${atomicIdeas.length})`, style: "margin: 0; font-size: 16px;" } } });
const ideaList = () => ({ "ideas-list": { tag: "div", id: "ideas-list", style: "flex: 1; padding: 15px; overflow-y: auto;", innerHTML: atomicIdeas.map((idea, index) => formatIdea(idea, index)).join("") } });
const panelStyle = "flex: 1; display: flex; flex-direction: column; border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-secondary);";
const headerStyle = "padding: 15px; border-bottom: 1px solid var(--border-primary);";
// have each source define this eg. claude-api, web-read
const formatSourceContent = (source) => `
  <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid var(--accent-primary);">
    <div style="font-weight: 500; margin-bottom: 8px;">Source: ${source.type}</div>
    <div style="font-size: 12px; color: var(--text-muted);">ID: ${source.sourceId}</div>
    <div style="font-size: 12px; color: var(--text-muted);">Timestamp: ${new Date(source.timestamp).toLocaleString()}</div>
  </div>
  <div style="white-space: pre-wrap; font-family: 'SF Mono', Consolas, monospace; font-size: 13px;">${source.content}</div>
`;
const formatIdea = (idea, index) => `
  <div style="margin-bottom: 15px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid var(--accent-primary);">
    <textarea onchange="manual-atom-extractor.editIdea({index: ${index}, text: this.value})" 
              style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-input); resize: vertical;">${idea.text}</textarea>
    <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
      <strong>Source spans:</strong> ${idea.sourceSpans?.map(span => span.substring(0, 50) + (span.length > 50 ? '...' : '')).join(', ') || 'Manual entry'}
    </div>
    <div style="font-size: 10px; color: var(--text-muted); display: flex; justify-content: space-between; margin-top: 4px;">
      <span>Created: ${new Date(idea.createdAt).toLocaleString()}</span>
    </div>
  </div>
`;


const setupTextSelection = () => {
	const sourceContent = document.getElementById('source-content');
	sourceContent?.addEventListener('mouseup', handleTextSelection);
	sourceContent?.addEventListener('keyup', handleTextSelection);
};


export const handleTextSelection = async (eventData) => {
	const { selection } = eventData;  // Now gets selection.text, selection.elementId, etc.
	selectedSpans.push({
		text: selection.text,
		elementId: selection.elementId,
		timestamp: Date.now()
	});

	await refreshSelectionPreview();
};


// Add this pure function for updating selection preview via tree updates:
const refreshSelectionPreview = async () => {
	const previewHTML = selectedSpans.length === 0
		? "Selected text will appear here..."
		: selectedSpans.map((span, i) =>
			`<div style="margin-bottom: 8px; padding: 8px; background: var(--bg-input); border-radius: 4px; border-left: 3px solid var(--accent-primary);">
				<strong>Span ${i + 1}:</strong> "${span.text}"
			</div>`
		).join('') +
		`<button onclick="manual-atom-extractor.clearSelections" style="margin-top: 10px; padding: 4px 8px; background: var(--bg-hover); border: 1px solid var(--border-primary); border-radius: 4px; color: var(--text-secondary); cursor: pointer;">Clear All</button>`;

	await runtime.call('ui.renderTree', {
		"selected-spans": { innerHTML: previewHTML }
	}, document.getElementById('selected-spans'));

	// Enable/disable create button
	const createBtn = document.getElementById('create-idea-btn');
	if (createBtn) createBtn.disabled = selectedSpans.length === 0;
};


const ideasList = () => {
	if (atomicIdeas.length === 0) {
		return '<div style="color: var(--text-muted); text-align: center; margin-top: 50px;">No atomic ideas yet. Select text and create your first idea!</div>';
	}

	return atomicIdeas.map((idea, index) => `
    <div style="margin-bottom: 15px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid var(--accent-primary);">
      <div style="margin-bottom: 10px;">
        <textarea 
          onchange="runtime.call('knowledge-forge.editIdea', { index: ${index}, text: this.value })"
          style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-input); color: var(--text-primary); font-family: inherit; resize: vertical;"
        >${idea.text}</textarea>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
        <strong>Source spans:</strong> ${idea.sourceSpans.map(span => span.substring(0, 50) + (span.length > 50 ? '...' : '')).join(', ')}
      </div>
	<div style="font-size: 10px; color: var(--text-muted); display: flex; justify-content: space-between;">
		<span>Confidence: ${idea.confidence}</span>
		<span>Created: ${new Date(idea.createdAt).toLocaleString()}</span>
	</div>
    </div >
	`).join('');
};

export const editIdea = async (params) => {
	const { index, text } = params;
	if (atomicIdeas[index]) {
		atomicIdeas[index].text = text;
		atomicIdeas[index].lastEdited = new Date().toISOString();
		runtime.log('[Knowledge Forge] Edited atomic idea:', atomicIdeas[index]);
	}
};

export const saveCollection = async () => {
	if (atomicIdeas.length === 0) return;

	const collection = {
		sourceId: currentSource?.sourceId,
		extractedAt: new Date().toISOString(),
		atomicIdeas: atomicIdeas,
	};
	// todo save to file for now, graph db when stable
	console.log('Atomic Ideas Collection:', JSON.stringify(collection, null, 2));

	// Show success feedback
	const saveBtn = document.querySelector('[onclick*="saveCollection"]');
	if (saveBtn) {
		const originalText = saveBtn.textContent;
		saveBtn.textContent = '✓ Saved!';
		saveBtn.style.background = 'var(--success)';
		setTimeout(() => {
			saveBtn.textContent = originalText;
			saveBtn.style.background = '';
		}, 2000);
	}
};