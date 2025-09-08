// https://claude.ai/chat/4ef01f2e-b27c-40b4-a03b-3a89a8c003f1
export const manifest = {
  name: "clause-extraction",
  context: ["service-worker"],
  version: "1.0.0",
  description: "Extract semantic structure from text for improved context assembly",
  actions: ["extractStructure", "extractEntities", "extractActions", "extractRelationships"],
  dependencies: ["graph-db"]
};

export const extractStructure = async ({ text }) => {
  return {
    entities: await extractEntities(text),
    actions: await extractActions(text),
    temporal: await extractTemporal(text),
    relationships: await extractRelationships(text) 
  };
};

// "React component", "OAuth library"
const extractEntities = (text) => []
// "debug", "modify", "help with";
const extractActions = (text) => [];
// "yesterday" → "2025-01-13"
const extractTemporal = (text) => [];
// "X connects to Y"
const extractRelationships = (text) => [];


// test
export const test = async () => [
  {
    name: "Extract entities and actions",
    input: "debug the React component that handles login",
    expected: {
      entities: ["React component"],
      actions: ["debug"], 
      relationships: [{ subject: "React component", predicate: "handles", object: "login" }]
    }
  },
  {
    name: "Extract temporal references", 
    input: "the API we built yesterday",
    expected: {
      entities: ["API"],
      temporal: { relative: "yesterday", absolute: "2025-01-13" },
      relationships: [{ subject: "we", predicate: "built", object: "API" }]
    }
  }
];