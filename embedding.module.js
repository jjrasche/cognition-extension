export const manifest = {
  name: "embedding", 
  keywords: ["embed"],
  context: "offscreen",
  dependencies: ["transformer"],
  version: "1.0.0",
  description: "use local embedding models to embed text",
  actions: ["embedText", "runEmbeddingTests"],
  externalDependencies: [
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: '759C3CD2B7FE7E93933AD23C4C9181B7396442A2ED746EC7C1D46192C469C46E' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_fp16.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: '2CDB5E58291813B6D6E248ED69010100246821A367FA17B1B81AE9483744533D' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_q4f16.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: 'EB08A666C46109637E0B6CB04F6052A68EFD59BB0252D4E0438D28FB6B2D853D' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_int8.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: 'AFDB6F1A0E45B715D0BB9B11772F032C399BABD23BFC31FED1C170AFC848BDB1' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json', destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: 'DA0E79933B9ED51798A3AE27893D3C5FA4A201126CEF75586296DF9B4D2C62A0' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json', destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: '9261E7D79B44C8195C1CADA2B453E55B00AEB81E907A6664974B4D7776172AB3' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json',  destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: '7135149F7CFFA1A573466C6E4D8423ED73B62FD2332C575BF738A0D033F70DF7' },
    
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: 'A488B290590D86DA3B81C502B242343CA8312E83CFC618B2CD1AE50C09D8F669' },
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model_fp16.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: '4158604FAD17A2C68244122D812A340BF64DA1A048CDA242DABAD5048864A93C' },
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model_q4f16.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: '78CF177870851C003763F6E39970F376D69D139DE45037B80CA065DB91524F1B' },
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model_int8.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: '84D57EC981CFC6B46920247B8628610271F59A724D73124E051DA96D6E406293' },
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/tokenizer.json', destination: 'models/Xenova/all-mpnet-base-v2/', sha256: 'D00DAD6F80B7EAB804479A58634A58A50966366627F847E47848BAC52873995D' },
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/tokenizer_config.json', destination: 'models/Xenova/all-mpnet-base-v2/', sha256: '3EA32220C2E21AF4F0BE95E2A43BDC8AC693F8C35C2255127EF680689B469461' },
    { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/config.json', destination: 'models/Xenova/all-mpnet-base-v2/', sha256: 'A783505A4E839B61700AA61D249D381D00ADDFB9CF3221359E2D30A6DA6C6499' }
  ],
  localModels : [
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'fp32', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'fp32', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'fp16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'q4f16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'q4f16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'int8', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'int8', local_files_only: true } },


    { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'fp32', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'fp32', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'fp16', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'q4f16', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'q4f16', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'int8', local_files_only: true } },
    { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'int8', local_files_only: true } }, 
  ]
};


// Add these to externalDependencies array:

  // const executionProviders = [
  //   { device: 'webgpu', fallback: 'WebGPU acceleration' },
  //   { device: 'wasm', fallback: 'WASM CPU execution' }
  //   // { device: 'webnn', fallback: 'WebNN acceleration' },
  // ];

let runtime;
export const initialize = async (rt) => runtime = rt;

export const getModelName = async (model) => await runtime.call('transformer.getModelName', model);
export const embedText = async (params) => {
  const { text, modelName } = params;
  if (!text) throw new Error('Text required');
  
  const startTime = performance.now();
  const model = await runtime.call('transformer.getModel', modelName || (await getModelName(manifest.localModels[0])));
  if (!model) throw new Error('Model not loaded');
    
  runtime.log(`[Embedding] About to run inference with text: "${text.substring(0, 50)}..."`);
  
  // Try to get more device info from the actual inference
  const result = await model(text, { 
    pooling: 'mean',
    normalize: true,
    return_tensor: false  // This might give us more device info
  });
  
  const endTime = performance.now();
  runtime.log(`[Embedding] Inference completed in ${(endTime - startTime).toFixed(2)}ms`);
  runtime.log(`[Embedding] Result structure:`, Object.keys(result));
  
  return {
    embedding: result,
    dimensions: result.ort_tensor?.dims || 'unknown',
    processingTime: `${(endTime - startTime).toFixed(2)}ms`,
    modelUsed: manifest.localModels[0],
    device: result.ort_tensor?.dataLocation || 'unknown',
    tensorInfo: {
      type: result.ort_tensor?.type,
      size: result.ort_tensor?.size,
      dims: result.ort_tensor?.dims
    }
  };
};




// Test cases for embedding module - semantic similarity testing

export const embeddingTestCases = [
  { name: "Village Living Concepts - High Similarity",
    pairs: [
      { text1: "communal living with shared resources", text2: "collective ownership of basic necessities", expectedSimilarity: "high", notes: "Core village living concept" },
      { text1: "reduce individual workload through community effort",  text2: "shared labor decreases personal responsibilities", expectedSimilarity: "high", notes: "Labor distribution philosophy" },
      { text1: "5 hours per week community service requirement", text2: "weekly commitment of five hours to collective tasks", expectedSimilarity: "high", notes: "Specific time commitment" }
    ]
  },
  { name: "Economic Systems - Medium Similarity", 
    pairs: [
      { text1: "internal economy based on labor hours", text2: "local currency tied to time investment", expectedSimilarity: "medium", notes: "Related economic concepts" },
      { text1: "profit motive distorts resource allocation", text2: "market forces don't optimize for human flourishing",  expectedSimilarity: "medium", notes: "Critique of capitalism" },
      { text1: "universal basic needs guarantee", text2: "community provides housing food water electricity", expectedSimilarity: "medium",  notes: "UBN concept variations" }
    ]
  },
  { name: "Governance Models - Medium Similarity",
    pairs: [
      { text1: "participatory democracy with subject matter experts", text2: "community voting with technical specialist input", expectedSimilarity: "medium", notes: "Decision making structure" },
      { text1: "consensus building and conflict resolution", text2: "restorative justice and community mediation",  expectedSimilarity: "medium", notes: "Conflict handling approaches" }
    ]
  },
  { name: "Technology Integration - Low-Medium Similarity",
    pairs: [
      { text1: "AI-assisted task allocation and scheduling", text2: "algorithmic optimization of community workflows", expectedSimilarity: "medium", notes: "Tech-enabled organization" },
      { text1: "reduce transactional friction with automation", text2: "streamline administrative overhead through technology", expectedSimilarity: "medium",  notes: "Efficiency through tech" }
    ]
  },
  { name: "Cross-Domain Concepts - Variable Similarity",
    pairs: [
      { text1: "village living community organization", text2: "software development team coordination",  expectedSimilarity: "low", notes: "Different domains, similar coordination needs" },
      { text1: "shared ownership reduces individual costs", text2: "bulk purchasing provides economies of scale", expectedSimilarity: "medium", notes: "Economic efficiency principles" },
      { text1: "intentional community with shared values", text2: "corporate culture and team alignment", expectedSimilarity: "low-medium", notes: "Group cohesion concepts" }
    ]
  },
  { name: "Contradictory Ideas - Low Similarity", 
    pairs: [
      { text1: "collective decision making ensures fairness", text2: "individual choice maximizes personal freedom", expectedSimilarity: "low", notes: "Opposing philosophies" },
      { text1: "shared resources create abundance through efficiency",  text2: "private ownership incentivizes productive investment", expectedSimilarity: "low", notes: "Contrasting economic views" }
    ]
  },
  { name: "Technical vs Conceptual - Testing Precision",
    pairs: [
      { text1: "housing department maintains 300 residential units", text2: "community provides adequate shelter for all members", expectedSimilarity: "medium", notes: "Specific vs general housing concepts" },
      { text1: "6.17 hours per person per week community labor", text2: "minimal time commitment for basic needs provision",  expectedSimilarity: "medium", notes: "Precise vs abstract labor requirements" }
    ]
  }
];

// Test runner function
export const runEmbeddingTests = async (modelName) => {
  const results = [];
  
  for (const testGroup of embeddingTestCases) {
    console.log(`\n=== Testing: ${testGroup.name} ===`);
    for (const pair of testGroup.pairs) {
      try {
        const embedding1 = await runtime.call('embedding.embedText', { text: pair.text1, modelName });
        const embedding2 = await runtime.call('embedding.embedText', { text: pair.text2, modelName });
        const similarity = calculateCosineSimilarity(embedding1.embedding.ort_tensor.data, embedding2.embedding.ort_tensor.data);
        const passed = evaluateSimilarity(similarity, pair.expectedSimilarity); 
        const result = { text1: pair.text1, text2: pair.text2, similarity: similarity.toFixed(4), expected: pair.expectedSimilarity, passed, notes: pair.notes };
        results.push(result);
        console.log(`${passed ? '✅' : '❌'} ${similarity.toFixed(4)} (${pair.expectedSimilarity}) - ${pair.notes}\n\t"${pair.text1}"\n\t"${pair.text2}"`);
      } catch (error) {
        console.error(`❌ Error testing pair: ${error.message}`);
        results.push({ ...pair, similarity: 'ERROR', passed: false, error: error.message });
      }
    }
  }
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed: ${passed}/${total} (${(passed/total*100).toFixed(1)}%)`);
  return results;
};

// Utility functions
const calculateCosineSimilarity = (vecA, vecB) => {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
};

const evaluateSimilarity = (actual, expected) => {
  switch (expected) {
    case 'high': return actual > 0.75;
    case 'medium': return actual >= 0.5 && actual <= 0.8;
    case 'low-medium': return actual >= 0.3 && actual <= 0.65;
    case 'low': return actual < 0.5;
    default: return false;
  }
};
