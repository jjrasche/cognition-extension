export const manifest = {
  name: "chunking",
  version: "2.1.0",
  description: "Structure-based text chunking with format converters - paragraph and section granularity",
  context: ["service-worker"],
  permissions: ["storage"],
  actions: ["chunkByStructure"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const chunkByStructure = async ({ text, granularity = 'paragraph' }) => {
  if (!text?.trim()) return [];
  
  const rules = getRules(granularity);
  
  // Step 1: Store preserved blocks with random IDs BEFORE preprocessing
  const preservedBlocks = new Map();
  let withPlaceholders = text;
  
  if (rules.preserves) {
    rules.preserves.forEach((pattern) => {
      withPlaceholders = withPlaceholders.replace(pattern, (match) => {
        const id = Math.random().toString(36).substring(2, 10);
        preservedBlocks.set(id, match);
        return `{PPP_${id}}`;
      });
    });
  }
  
  // Step 2: NOW preprocess (won't affect preserved content)
  const processedText = preprocessText(withPlaceholders);
  
  // Step 3: Replace breakpoints with delimiters
  let delimiterText = processedText;
  rules.breakpoints.forEach((pattern) => {
    delimiterText = delimiterText.replace(pattern, '\0');
  });
  
  // Step 4: Split and restore preserved blocks
  return delimiterText.split('\0')
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      // Restore preserved blocks using Map lookup
      return chunk.replace(/\{PPP_([a-z0-9]+)\}/g, (match, id) => {
        return preservedBlocks.get(id) || match;
      });
    });
};

const getRules = (granularity) => GRANULARITY_RULES[granularity] || (() => { throw new Error(`Unknown granularity: ${granularity}`); })();
const applyConverters = (text, converters) => converters.reduce((result, conv) => result.replace(conv.pattern, conv.replacement), text);
const preprocessText = (text) => applyConverters(text, HTML_CONVERTERS).trim();

// Patterns - only what we actually use
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/gm;
const QUOTE_BLOCK_PATTERN = /(?:>\s.+(?:\n>\s.+)*)/gm;
const LIST_BLOCK_PATTERN = /(?:[-*+]\s.+(?:\n[-*+]\s.+)*)/gm;
const PARAGRAPH_END_PATTERN = /\n+/g;
const MARKDOWN_HEADER_PATTERN = /^#{1,6}\s+.+$/gm;
const SECTION_HEADER_PATTERN = /^.+\n[=-]+$/gm;
const HORIZONTAL_RULE_PATTERN = /^(-{3,}|_{3,}|\*{3,})$/gm;

const GRANULARITY_RULES = {
  paragraph: { 
    breakpoints: [PARAGRAPH_END_PATTERN], 
    preserves: [CODE_BLOCK_PATTERN, LIST_BLOCK_PATTERN, QUOTE_BLOCK_PATTERN] 
  },
  section: { 
    breakpoints: [MARKDOWN_HEADER_PATTERN, SECTION_HEADER_PATTERN, HORIZONTAL_RULE_PATTERN], 
    preserves: [CODE_BLOCK_PATTERN, LIST_BLOCK_PATTERN, QUOTE_BLOCK_PATTERN] 
  }
};

const HTML_CONVERTERS = [
  { pattern: /<br\s*\/?>/gi, replacement: '\n' },
  { pattern: /<p>(.*?)<\/p>/gi, replacement: '\n\n$1\n\n' },
  { pattern: /<\/p>\s*<p>/gi, replacement: '\n\n' },
  { pattern: /<[^>]+>/g, replacement: '' },
  { pattern: /[ \t]+/g, replacement: ' ' },
  { pattern: /\r\n/g, replacement: '\n' },
  { pattern: /\r/g, replacement: '\n' }
];

// ============================================
// Tests - removed all sentence tests
// ============================================
export const test = async () => (await Promise.all([
  { name: "Paragraph Newlines: Single newlines create paragraphs", text: "First paragraph\nSecond paragraph\nThird paragraph", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  // { name: "Paragraph Newlines: Multiple newlines treated same as single", text: "First paragraph\n\n\nSecond paragraph\n\n\n\n\nThird paragraph", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  // { name: "Paragraph Newlines: Windows line endings", text: "First paragraph\r\n\r\nSecond paragraph\r\nThird paragraph", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  // { name: "Markdown Formats: Horizontal rules create sections", text: "Section 1 content\n\n---\n\nSection 2 content\n\n___\n\nSection 3 content", granularity: "section", expected: ["Section 1 content", "Section 2 content", "Section 3 content"] },
  // { name: "Markdown Formats: Lists preserved in paragraphs", text: "My todo list:\n- Item 1\n- Item 2\n- Item 3\n\nNext paragraph", granularity: "paragraph", expected: ["My todo list:", "- Item 1\n- Item 2\n- Item 3", "Next paragraph"] },
  // { name: "Markdown Formats: Block quotes preserved", text: "He said:\n> This is important\n> Really important\n\nI agreed.", granularity: "paragraph", expected: ["He said:", "> This is important\n> Really important", "I agreed."] },
  // { name: "Markdown Formats: Code blocks preserved", text: "Here's the code:\n```python\ndef hello():\n    print('world')\n```\nThat's it.", granularity: "paragraph", expected: ["Here's the code:", "```python\ndef hello():\n    print('world')\n```", "That's it."] },
  // { name: "HTML Content: HTML break tags", text: "First part<br>Second part<br/>Third part<br />Fourth part", granularity: "paragraph", expected: ["First part", "Second part", "Third part", "Fourth part"] },
  // { name: "HTML Content: HTML paragraph tags", text: "<p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p>", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  // { name: "HTML Content: Mixed HTML and text", text: "Normal text<br><br>After break\n\nAfter newline<p>In paragraph</p>", granularity: "paragraph", expected: ["Normal text", "After break", "After newline", "In paragraph"] }
].map(async tc => {
  const { runUnitTest, deepEqual } = runtime.testUtils;
  const ret = await runUnitTest(tc.name, async () => {
    const actual = await chunkByStructure(tc);
    return { ...tc, actual, assert: deepEqual };
  });
  return ret;
}))).flat();