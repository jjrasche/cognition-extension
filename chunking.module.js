export const manifest = {
  name: "chunking",
  version: "2.0.0",
  description: "Structure-based text chunking with format converters",
  context: ["service-worker"],
  permissions: ["storage"],
  actions: ["chunkByStructure", "runChunkingTests", "chunkByStructureDebug"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const chunkByStructure = async ({ text, granularity = 'paragraph' }) => {
  if (!text?.trim()) return [];
  
  const processedText = preprocessText(text);
  const rules = getRules(granularity);
  
  // Replace all breakpoints with delimiter
  let delimiterText = replaceBreakpointsWithDelimiter(processedText, rules);
  
  // Remove delimiters from within preserved blocks
  delimiterText = removeDelimitersFromPreservedBlocks(delimiterText, rules.preserves);
  
  // Split on delimiter and filter empty chunks
  return delimiterText.split('\0').map(chunk => chunk.trim()).filter(Boolean);
};
const replaceBreakpointsWithDelimiter = (text, rules) => {
  let result = text;
  rules.breakpoints.forEach((pattern) => result = result.replace(pattern, '\0'));
  return result;
};
const removeDelimitersFromPreservedBlocks = (text, preservePatterns) => {
  if (!preservePatterns) return text;
  
  let result = text;
  
  preservePatterns.forEach(pattern => {
    result = result.replace(pattern, (match) => {
      return match.replace(/\0/g, '');
    });
  });
  
  return result;
};
const getRules = (granularity) => GRANULARITY_RULES[granularity] || (() => { throw new Error(`Unknown granularity: ${granularity}`); })();
const applyConverters = (text, converters) => converters.reduce((result, conv) => result.replace(conv.pattern, conv.replacement), text);
const preprocessText = (text) => applyConverters(text, HTML_CONVERTERS).trim();
const isAbbreviation = (text, position) => {
  const beforeDot = text.slice(Math.max(0, position - 10), position);
  return ABBREVIATIONS.some(abbr => beforeDot.endsWith(abbr));
};
// Patterns
const ABBREVIATIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Inc', 'Corp', 'Ltd', 'etc', 'vs', 'e.g', 'i.e', 'Ph.D', 'U.S', 'U.K', 'U.N'];
const CODE_BLOCK_PATTERN = /^.+:\n```[\s\S]*?```/gm;
const LIST_BLOCK_PATTERN = /^.+:\n(?:[-*+]\s.+(?:\n[-*+]\s.+)*)/gm;
const QUOTE_BLOCK_PATTERN = /^.+:\n(?:>\s.+(?:\n>\s.+)*)/gm;
const SENTENCE_END_PATTERN = /[.!?](?:\s+[A-Z]|\s*\n)/g;
const PARAGRAPH_END_PATTERN = /\n+/g;
const MARKDOWN_HEADER_PATTERN = /^#{1,6}\s+.+$/gm;
const SECTION_HEADER_PATTERN = /^.+\n[=-]+$/gm;
const HORIZONTAL_RULE_PATTERN = /^(-{3,}|_{3,}|\*{3,})$/gm;
const GRANULARITY_RULES = {
  sentence: { breakpoints: [SENTENCE_END_PATTERN] },
  paragraph: { breakpoints: [PARAGRAPH_END_PATTERN], preserves: [CODE_BLOCK_PATTERN, LIST_BLOCK_PATTERN, QUOTE_BLOCK_PATTERN] },
  section: { breakpoints: [MARKDOWN_HEADER_PATTERN, SECTION_HEADER_PATTERN, HORIZONTAL_RULE_PATTERN], preserves: [CODE_BLOCK_PATTERN, LIST_BLOCK_PATTERN, QUOTE_BLOCK_PATTERN] }
};
const HTML_CONVERTERS = [
  { pattern: /<br\s*\/?>/gi, replacement: '\n' },
  { pattern: /<\/p>\s*<p>/gi, replacement: '\n\n' },
  { pattern: /<\/p>/gi, replacement: '\n' }, // Add newline after closing p tag
  { pattern: /<p>/gi, replacement: '' },     // Remove opening p tag
  { pattern: /<[^>]+>/g, replacement: '' },  // Strip remaining tags
  { pattern: /[ \t]+/g, replacement: ' ' },
  { pattern: /\r\n/g, replacement: '\n' },
  { pattern: /\r/g, replacement: '\n' }
];
// ============================================
// Tests
// ============================================
export const test = async () => (await Promise.all([
  { name: "Sentence Abbreviations: Common abbreviations preserved", input: "Mr. Smith met Dr. Johnson at Inc. headquarters. They discussed e.g. profits.", granularity: "sentence", expected: ["Mr. Smith met Dr. Johnson at Inc. headquarters.", "They discussed e.g. profits."] },
  { name: "Sentence Abbreviations: Academic abbreviations",  input: "Prof. Lee has a Ph.D from MIT. She studied i.e. machine learning.", granularity: "sentence", expected: ["Prof. Lee has a Ph.D from MIT.", "She studied i.e. machine learning."] },
  { name: "Sentence Abbreviations: Country abbreviations", input: "U.S. markets opened strong. U.K. followed suit.", granularity: "sentence",  expected: ["U.S. markets opened strong.", "U.K. followed suit."] },
  { name: "Paragraph Newlines: Single newlines create paragraphs", input: "First paragraph\nSecond paragraph\nThird paragraph", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  { name: "Paragraph Newlines: Multiple newlines treated same as single", input: "First paragraph\n\n\nSecond paragraph\n\n\n\n\nThird paragraph",  granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  { name: "Paragraph Newlines: Windows line endings", input: "First paragraph\r\n\r\nSecond paragraph\r\nThird paragraph", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  { name: "Markdown Formats: Horizontal rules create sections", input: "Section 1 content\n\n---\n\nSection 2 content\n\n___\n\nSection 3 content", granularity: "section", expected: ["Section 1 content", "Section 2 content", "Section 3 content"] },
  { name: "Markdown Formats: Lists preserved in paragraphs", input: "My todo list:\n- Item 1\n- Item 2\n- Item 3\n\nNext paragraph", granularity: "paragraph",  expected: ["My todo list:\n- Item 1\n- Item 2\n- Item 3", "Next paragraph"] },
  { name: "Markdown Formats: Block quotes preserved", input: "He said:\n> This is important\n> Really important\n\nI agreed.", granularity: "paragraph", expected: ["He said:\n> This is important\n> Really important", "I agreed."] },
  { name: "Markdown Formats: Code blocks preserved", input: "Here's the code:\n```python\ndef hello():\n    print('world')\n```\nThat's it.", granularity: "paragraph", expected: ["Here's the code:\n```python\ndef hello():\n    print('world')\n```", "That's it."] },
  { name: "HTML Content: HTML break tags", input: "First part<br>Second part<br/>Third part<br />Fourth part", granularity: "paragraph", expected: ["First part", "Second part", "Third part", "Fourth part"] },
  { name: "HTML Content: HTML paragraph tags",  input: "<p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p>", granularity: "paragraph", expected: ["First paragraph", "Second paragraph", "Third paragraph"] },
  { name: "HTML Content: Mixed HTML and text", input: "Normal text<br><br>After break\n\nAfter newline<p>In paragraph</p>", granularity: "paragraph", expected: ["Normal text", "After break", "After newline", "In paragraph"] }
].map(runChunkTest))).flat();
const runChunkTest = async (testCase) => {
  const { name, input, granularity, expected } = testCase;
  try {
    const actual = await chunkByStructure({ text: input, granularity });
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    return { ...testCase, actual, passed };
  } catch (error) {
    return { name, passed: false, error };
  }
};