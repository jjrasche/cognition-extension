export const manifest = {
	name: "atomic-idea",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Extracts atomic ideas with exact source text spans",
	dependencies: ["inference"],
	actions: ["extractFromParagraph"],
	searchActions: [
		{ name: "extract atomic ideas", condition: input => input === "atomic", method: "buildAtomicExtractorUI" }
	]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const extractFromParagraph = async (paragraph) => {
	const prompt = buildExtractionPrompt(paragraph);
	const response = await runtime.call('inference.prompt', {
		query: prompt,
		systemPrompt: "Extract atomic ideas that are self-contained and preserve original confidence. Return only valid JSON."
	});
	return parseExtractionResponse(response, paragraph);
};

const buildExtractionPrompt = (paragraph) => `Extract atomic ideas from this paragraph. Each idea should be:
- Self-contained (no external references needed)
- Single concept with clear scope
- Preserve original confidence level ("might", "could", "definitely", etc.)
- Include concrete details when present

Paragraph: "${paragraph}"

Return JSON:
{
  "atomicIdeas": [
    {
      "idea": "Complete statement preserving original confidence and scope",
      "exactSpans": [
        "exact text from paragraph",
        "another exact phrase used"
      ],
      "reasoning": "Brief explanation of why this qualifies as atomic"
    }
  ]
}

Copy exact text spans word-for-word from the paragraph. Focus on standalone ideas that capture the author's intent and certainty level.`;

const parseExtractionResponse = (responseText, originalParagraph) => {
	try {
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (parsed && typeof parsed === 'object') {
				return {
					atomicIdeas: (parsed.atomicIdeas || []).map(idea => ({
						...idea,
						validSpans: (idea.exactSpans || []).filter(span => originalParagraph.includes(span))
					})),
					success: true
				};
			}
		}
		return { atomicIdeas: [], error: 'No valid JSON found', success: false };
	} catch (error) {
		runtime.logError('[Atomic Ideas] Parse failed:', error);
		return { atomicIdeas: [], error: error.message, success: false };
	}
};
const buildAtomicExtractorUI = () => ({
	"atomic-extractor": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px;",
		"back-button": {
			tag: "button", text: "← Back",
			class: "cognition-button-secondary",
			style: "margin-bottom: 20px; align-self: flex-start;",
			events: { click: "ui.initializeLayout" }
		},
		"main-content": {
			tag: "div", style: "flex: 1; display: flex; gap: 20px;",
			"input-panel": {
				tag: "div", style: "flex: 1; display: flex; flex-direction: column;",
				"input-header": { tag: "h3", text: "Input Paragraph", style: "margin-bottom: 10px;" },
				"paragraph-input": {
					tag: "textarea",
					id: "paragraph-text",
					placeholder: "Paste a paragraph here and click Extract to see atomic ideas...",
					style: "flex: 1; padding: 15px; font-size: 14px; line-height: 1.6; resize: none; border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-input); color: var(--text-primary);"
				},
				"extract-button": {
					tag: "button", text: "Extract Atomic Ideas",
					class: "cognition-button-primary",
					style: "margin-top: 15px; padding: 12px;",
					events: { click: "atomic-ideas.extractAndDisplay" }
				}
			},
			"output-panel": {
				tag: "div", style: "flex: 1; display: flex; flex-direction: column;",
				"output-header": { tag: "h3", text: "Atomic Ideas", style: "margin-bottom: 10px;" },
				"ideas-container": {
					tag: "div",
					id: "atomic-ideas-display",
					style: "flex: 1; border: 1px solid var(--border-primary); border-radius: 8px; padding: 15px; overflow-y: auto; background: var(--bg-secondary);",
					innerHTML: '<div style="color: var(--text-muted); text-align: center; margin-top: 50px;">Click "Extract" to see atomic ideas...</div>'
				}
			}
		}
	}
});
// Testing with real examples
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;

	const testParagraph = "OAuth 2.0 likely improves web application security by eliminating password transmission, though implementation complexity may outweigh benefits for teams under 5 developers based on setup overhead.";

	return [
		await runUnitTest("Extract atomic ideas from paragraph", async () => {
			const result = await extractFromParagraph(testParagraph);
			const actual = {
				success: result.success,
				hasIdeas: result.atomicIdeas?.length > 0,
				hasSpans: result.atomicIdeas?.[0]?.exactSpans?.length > 0,
				hasReasoning: !!result.atomicIdeas?.[0]?.reasoning
			};
			const expected = { success: true, hasIdeas: true, hasSpans: true, hasReasoning: true };
			return { actual, assert: deepEqual, expected };
		}),

		await runUnitTest("Validate spans exist in original text", async () => {
			const result = await extractFromParagraph("This is a test paragraph with specific content.");
			const allSpansValid = result.atomicIdeas?.every(idea =>
				idea.validSpans?.length === idea.exactSpans?.length
			) ?? true;
			return { actual: allSpansValid, assert: strictEqual, expected: true };
		})
	];
};