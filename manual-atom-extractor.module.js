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



export const buildUI = async () => {
	const tree = {
		"knowledge-forge-layout": {
			tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
			"header": {
				tag: "div", style: "margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;",
				"back-button": { tag: "button", text: "← Back", class: "cognition-button-secondary", events: { click: "ui.initializeLayout" } },
				"title": { tag: "h2", text: "Knowledge Forge", style: "margin: 0; color: var(--text-primary);" },
				"save-button": { tag: "button", text: "Save Collection", class: "cognition-button-primary", events: { click: "knowledge-forge.saveCollection" }, }
			},
			"main-content": {
				sourcePanel(), tag: "div", style: "flex: 1; display: flex; gap: 20px; min-height: 0;",

				// Right Panel - Split into Extractor and Collection
				"right-panel": {
					tag: "div",
					style: "flex: 1; display: flex; flex-direction: column; gap: 20px;",
					"idea-creator": {
						tag: "div",
						style: "flex: 0 0 40%; display: flex; flex-direction: column; border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-secondary);",
						"creator-header": {
							tag: "div",
							style: "padding: 15px; border-bottom: 1px solid var(--border-primary);",
							"header-text": { tag: "h3", text: "Create Atomic Idea", style: "margin: 0; font-size: 16px;" }
						},
						"creator-body": {
							tag: "div",
							style: "flex: 1; padding: 15px; display: flex; flex-direction: column; gap: 10px;",
							"selected-spans-preview": {
								tag: "div",
								id: "selected-spans",
								style: "min-height: 60px; padding: 10px; border: 1px dashed var(--border-primary); border-radius: 4px; background: var(--bg-tertiary); font-size: 12px; color: var(--text-muted);",
								innerHTML: "Selected text will appear here..."
							},
							"idea-editor": {
								tag: "textarea",
								id: "idea-editor",
								placeholder: "Edit your atomic idea here...",
								style: "flex: 1; min-height: 80px; padding: 10px; border: 1px solid var(--border-primary); border-radius: 4px; resize: vertical; font-family: inherit;"
							},
							"create-button": {
								tag: "button",
								text: "Create Atomic Idea",
								class: "cognition-button-primary",
								events: { click: "knowledge-forge.createAtomicIdea" },
								disabled: true,
								id: "create-idea-btn"
							}
						}
					},

					// Bottom Right - Atomic Ideas Collection (60%)
					"idea-collection": {
						tag: "div",
						style: "flex: 1; display: flex; flex-direction: column; border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-secondary);",
						"collection-header": {
							tag: "div",
							style: "padding: 15px; border-bottom: 1px solid var(--border-primary);",
							"collection-title": { tag: "h3", text: `Atomic Ideas (${atomicIdeas.length})`, style: "margin: 0; font-size: 16px;" }
						},
						"ideas-list": {
							tag: "div",
							id: "ideas-list",
							style: "flex: 1; padding: 15px; overflow-y: auto;",
							innerHTML: buildIdeasList()
						}
					}
				}
			}
		}
	};

	await runtime.call('ui.renderTree', tree);
	await setupTextSelection();
};

const setupTextSelection = async () => {
	const sourceContent = document.getElementById('source-content');
	if (!sourceContent) return;

	sourceContent.addEventListener('mouseup', handleTextSelection);
	sourceContent.addEventListener('keyup', handleTextSelection); // For keyboard selection
};

const handleTextSelection = () => {
	const selection = window.getSelection();
	const selectedText = selection.toString().trim();

	if (selectedText) {
		selectedSpans.push({
			text: selectedText,
			range: selection.getRangeAt(0).cloneRange()
		});

		updateSelectedSpansPreview();
		enableCreateButton();
	}
};

const updateSelectedSpansPreview = () => {
	const previewEl = document.getElementById('selected-spans');
	if (!previewEl) return;

	if (selectedSpans.length === 0) {
		previewEl.innerHTML = "Selected text will appear here...";
		previewEl.style.color = "var(--text-muted)";
	} else {
		const spansHtml = selectedSpans.map((span, i) =>
			`<div style="margin-bottom: 8px; padding: 8px; background: var(--bg-input); border-radius: 4px; border-left: 3px solid var(--accent-primary);">
        <strong>Span ${i + 1}:</strong> "${span.text}"
      </div>`
		).join('');

		previewEl.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: 500; color: var(--text-primary);">
        ${selectedSpans.length} text span${selectedSpans.length > 1 ? 's' : ''} selected:
      </div>
      ${spansHtml}
      <button onclick="runtime.call('knowledge-forge.clearSelections')" 
              style="margin-top: 10px; padding: 4px 8px; background: var(--bg-hover); border: 1px solid var(--border-primary); border-radius: 4px; color: var(--text-secondary); cursor: pointer;">
        Clear All
      </button>
    `;
		previewEl.style.color = "var(--text-primary)";
	}
};

const enableCreateButton = () => {
	const createBtn = document.getElementById('create-idea-btn');
	if (createBtn) {
		createBtn.disabled = selectedSpans.length === 0;
	}
};

export const clearSelections = async () => {
	selectedSpans = [];
	updateSelectedSpansPreview();
	enableCreateButton();

	// Clear visual selection
	window.getSelection().removeAllRanges();
};

/*
turn claude export into a list of inference interactions and load the next one in chronological order that isn't marked reviewed. format:
currentSource = {
	sourceId: `claude_conv_${recentChat.uri}`,
	type: "inference interaction",
	prompt: 
	response:
	url: `https://claude.ai/chat/${recentChat.uri}`,
	timestamp:
	reviewed: false
};
*/
const claudeConversations = [];
export const loadSource = async () => {
	currentSource = claudeConversations.filter(c => !c.reviewed).sort((a, b) => a.timestamp - b.timestamp);
	await buildUI();
};

const extractConversationText = (chat) => {
	// Extract readable text from chat object
	// This is a simplified version - you might want to format this better
	return JSON.stringify(chat, null, 2);
};

const formatSourceContent = (source) => {
	// todo let each content type have its own source content
	return `
    <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid var(--accent-primary);">
      <div style="font-weight: 500; margin-bottom: 8px;">Source: ${source.type}</div>
      <div style="font-size: 12px; color: var(--text-muted);">ID: ${source.sourceId}</div>
      <div style="font-size: 12px; color: var(--text-muted);">Timestamp: ${new Date(source.timestamp).toLocaleString()}</div>
    </div>
    <div style="white-space: pre-wrap; font-family: 'SF Mono', Consolas, monospace; font-size: 13px;">
      ${source.content}
    </div>
  `;
};

const sourceContent = () => ({ "source-content": { tag: "div", id: "source-content", style: "flex: 1; padding: 15px; overflow-y: auto; line-height: 1.6; user-select: text; cursor: text;", innerHTML: currentSource ? formatSourceContent(currentSource) : '<p style="color: var(--text-muted); text-align: center; margin-top: 50px;">Load a conversation to begin extracting atomic ideas</p>' } });
const sourceHeader = () => ({ tag: "div", style: "padding: 15px; border-bottom: 1px solid var(--border-primary); background: var(--bg-secondary);", "next-sources-btn": { tag: "button", text: "Load Next Source", class: "cognition-button-secondary", events: { click: "knowledge-forge.loadSource" } } });
const sourcePanel = () => ({ "source-panel": { sourceHeader, sourceContent, tag: "div", style: "flex: 1; display: flex; flex-direction: column; border: 1px solid var(--border-primary); border-radius: 8px;" }, });

export const createAtomicIdea = async () => {
	const ideaEditor = document.getElementById('idea-editor');
	if (!ideaEditor || selectedSpans.length === 0) return;

	const ideaText = ideaEditor.value.trim() || selectedSpans.map(s => s.text).join(' ');

	if (!ideaText) return;

	const newIdea = {
		text: ideaText,
		sourceSpans: selectedSpans.map(s => s.text),
		sourceId: currentSource?.sourceId,
		confidence: "medium", // Default confidence
		extractedBy: "manual",
		createdAt: new Date().toISOString()
	};

	atomicIdeas.push(newIdea);

	// Clear selections and editor
	await clearSelections();
	ideaEditor.value = '';

	// Refresh the ideas list
	await refreshIdeasList();

	runtime.log('[Knowledge Forge] Created atomic idea:', newIdea);
};

const refreshIdeasList = async () => {
	const ideasList = document.getElementById('ideas-list');
	if (ideasList) {
		ideasList.innerHTML = buildIdeasList();
	}

	// Update header count
	const collectionTitle = document.querySelector('#knowledge-forge-layout [style*="collection-title"]');
	if (collectionTitle) {
		collectionTitle.textContent = `Atomic Ideas (${atomicIdeas.length})`;
	}
};

const buildIdeasList = () => {
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