/*
  Goal: Achieve high semantic resolution for LLM context selection by distinguishing between 5+ distinct relevance levels (synonyms, related concepts, same domain, tangentially related, unrelated) to enable precise retrieval of the most contextually useful content while avoiding token waste from irrelevant or weakly related material.
  Why: LLM performance depends heavily on context quality. Poor semantic resolution leads to including irrelevant content (wasting tokens) or missing relevant content (degrading responses). High-resolution embeddings enable building superior RAG systems and conversation context selection.

  STS focuses on: "The cat sat on the mat" vs "A feline rested on the rug"
  Your use case: "How do I implement OAuth?" vs "OAuth security best practices" vs "Database connection pooling"
  Your content has technical specificity and contextual relationships that standard paraphrasing tests miss.
  Example: "OAuth implementation in Node.js" vs "JWT token validation" = medium relevance (both auth, different specifics)
*/
export const manifest = {
  name: "embedding", 
  keywords: ["embed"],
  context: ["offscreen"],
  dependencies: ["transformer", "api-keys"],
  version: "1.0.0",
  description: "use local embedding models to embed text",
  actions: ["embedText", "runEmbeddingTests", "setJinaApiKey", "runSpeedQualityComparison", "testAllModels"],
  externalDependencies: [
    // { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: '759C3CD2B7FE7E93933AD23C4C9181B7396442A2ED746EC7C1D46192C469C46E' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_fp16.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: '2CDB5E58291813B6D6E248ED69010100246821A367FA17B1B81AE9483744533D' },
    // { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_q4f16.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: 'EB08A666C46109637E0B6CB04F6052A68EFD59BB0252D4E0438D28FB6B2D853D' },
    // { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_int8.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: 'AFDB6F1A0E45B715D0BB9B11772F032C399BABD23BFC31FED1C170AFC848BDB1' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json', destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: 'DA0E79933B9ED51798A3AE27893D3C5FA4A201126CEF75586296DF9B4D2C62A0' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json', destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: '9261E7D79B44C8195C1CADA2B453E55B00AEB81E907A6664974B4D7776172AB3' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json',  destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: '7135149F7CFFA1A573466C6E4D8423ED73B62FD2332C575BF738A0D033F70DF7' },
    
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: 'A488B290590D86DA3B81C502B242343CA8312E83CFC618B2CD1AE50C09D8F669' },
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model_fp16.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: '4158604FAD17A2C68244122D812A340BF64DA1A048CDA242DABAD5048864A93C' },
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model_q4f16.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: '78CF177870851C003763F6E39970F376D69D139DE45037B80CA065DB91524F1B' },
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/onnx/model_int8.onnx', destination: 'models/Xenova/all-mpnet-base-v2/onnx/', sha256: '84D57EC981CFC6B46920247B8628610271F59A724D73124E051DA96D6E406293' },
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/tokenizer.json', destination: 'models/Xenova/all-mpnet-base-v2/', sha256: 'D00DAD6F80B7EAB804479A58634A58A50966366627F847E47848BAC52873995D' },
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/tokenizer_config.json', destination: 'models/Xenova/all-mpnet-base-v2/', sha256: '3EA32220C2E21AF4F0BE95E2A43BDC8AC693F8C35C2255127EF680689B469461' },
    // { url: 'https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main/config.json', destination: 'models/Xenova/all-mpnet-base-v2/', sha256: 'A783505A4E839B61700AA61D249D381D00ADDFB9CF3221359E2D30A6DA6C6499' },
    
    // { url: 'https://huggingface.co/jinaai/jina-embeddings-v3/resolve/main/onnx/model_fp16.onnx', destination: 'models/jinaai/jina-embeddings-v3/onnx', sha256: '329C3EA03A1815CC98F6B97EFCAFB9000C6C780C2D89D40D4F541B9A88434C38' },
    // { url: 'https://huggingface.co/jinaai/jina-embeddings-v3/resolve/main/tokenizer.json', destination: 'models/jinaai/jina-embeddings-v3/', sha256: 'F59925FCB90C92B894CB93E51BB9B4A6105C5C249FE54CE1C704420AC39B81AF' },
    // { url: 'https://huggingface.co/jinaai/jina-embeddings-v3/resolve/main/tokenizer_config.json', destination: 'models/jinaai/jina-embeddings-v3/', sha256: 'E1BC77DA5B90BA65B47AA8BD776C6317F47D50DC6717E92B10177686B3B8F161' },
    // { url: 'https://huggingface.co/jinaai/jina-embeddings-v3/resolve/main/config.json', destination: 'models/jinaai/jina-embeddings-v3/', sha256: '556941599709401B3DC94ACF775526F1C4670ABE5E123CB53CCA8EB5250B0CB5' },
  ],
  localModels : [
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'fp32', local_files_only: true } },
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'fp32', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } },
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'fp16', local_files_only: true } },
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'q4f16', local_files_only: true } },
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'q4f16', local_files_only: true } },
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'int8', local_files_only: true } },
    // { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'int8', local_files_only: true } },
    
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'fp32', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'fp32', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'fp16', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'q4f16', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'q4f16', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'webgpu', dtype: 'int8', local_files_only: true } },
    // { name: "Xenova/all-mpnet-base-v2", options: { device: 'wasm', dtype: 'int8', local_files_only: true } },
    
    // { name: "jinaai/jina-embeddings-v3", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } },
    // { name: "jinaai/jina-embeddings-v3", options: { device: 'wasm', dtype: 'fp16', local_files_only: true } }, 
  ],
  cloudModels: [
    'jina-embeddings-v4',
    'jina-embeddings-v3',
    'jina-embeddings-v2-base-en'
  ],
  defaultModel: "Xenova/all-MiniLM-L6-v2",
  apiKeys: ["jina"],
};

let runtime;
export const initialize = async (rt) => {
  runtime = rt;

}

export const getModelName = async (model) => await runtime.call('transformer.getModelName', model);
const isValidAPIService = (service) => manifest.apiKeys.includes(service) || (() => { throw new Error(`Invalid API service: ${service}. Valid services are: ${manifest.apiKeys.join(', ')}`); })();
const getAPIKey = async (service) => isValidAPIService(service) && await runtime.call('api-keys.getKey', { service });

export const embedText = async (text, modelName) => {
  if (!text) throw new Error('Text required');
  // Route to cloud or local based on model name
  if (isCloudModel(modelName)) {
    return await embedTextCloud(text, modelName);
  }
  
  // Local embedding logic (unchanged)
  const startTime = performance.now();
  const model = await runtime.call('transformer.getModel', modelName || (await getModelName(manifest.localModels[0])));
  if (!model) throw new Error('Model not loaded');
    
  runtime.log(`[Embedding] About to run inference with text: "${text.substring(0, 50)}..."`);
  
  const result = await model(text, { 
    pooling: 'mean',
    normalize: true,
    return_tensor: false
  });
  
  const endTime = performance.now();
  runtime.log(`[Embedding] Inference completed in ${(endTime - startTime).toFixed(2)}ms`);
  
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

const isCloudModel = (modelName) => manifest.cloudModels.includes(modelName);

const embedTextCloud = async (text, modelName) => {
  const apiKey = await getAPIKey('jina');
  const startTime = performance.now();
  
  // Jina API expects different format - just model and input
  const requestBody = {
    model: modelName,
    input: [text]
  };
  
  runtime.log(`[Embedding] Cloud request:`, { model: modelName, inputLength: text.length });
  
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    runtime.logError(`[Embedding] Jina API error ${response.status}:`, errorText);
    throw new Error(`Jina API error: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  const endTime = performance.now();
  
  runtime.log(`[Embedding] Cloud inference completed in ${(endTime - startTime).toFixed(2)}ms`);
  runtime.log(`[Embedding] Response structure:`, { 
    dataLength: result.data?.length, 
    embeddingLength: result.data?.[0]?.embedding?.length,
    usage: result.usage 
  });
  
  return {
    embedding: result.data[0].embedding,
    dimensions: result.data[0].embedding.length,
    processingTime: `${(endTime - startTime).toFixed(2)}ms`,
    modelUsed: modelName,
    device: 'cloud',
    usage: result.usage
  };
};

// Consolidated Speed + Quality Test
export const runSpeedQualityComparison = async (params = {}) => {
  const { includeLocal = true, includeCloud = true, runs = 3 } = params;
  
  runtime.log(`\n🚀 EMBEDDING SPEED + QUALITY COMPARISON`);
  runtime.log(`Running ${runs} iterations for speed testing...`);
  
  // Define test cases here to avoid scope issues
  const testCases = [
    { name: "Village Living Concepts - High Similarity",
      pairs: [
        { text1: "communal living with shared resources", text2: "collective ownership of basic necessities", expectedSimilarity: "high", notes: "Core village living concept" },
        { text1: "reduce individual workload through community effort",  text2: "shared labor decreases personal responsibilities", expectedSimilarity: "high", notes: "Labor distribution philosophy" }
      ]
    },
    { name: "Economic Systems - Medium Similarity", 
      pairs: [
        { text1: "internal economy based on labor hours", text2: "local currency tied to time investment", expectedSimilarity: "medium", notes: "Related economic concepts" },
        { text1: "profit motive distorts resource allocation", text2: "market forces don't optimize for human flourishing",  expectedSimilarity: "medium", notes: "Critique of capitalism" }
      ]
    },
    { name: "Contradictory Ideas - Low Similarity", 
      pairs: [
        { text1: "collective decision making ensures fairness", text2: "individual choice maximizes personal freedom", expectedSimilarity: "low", notes: "Opposing philosophies" },
        { text1: "shared resources create abundance through efficiency",  text2: "private ownership incentivizes productive investment", expectedSimilarity: "low", notes: "Contrasting economic views" }
      ]
    }
  ];
  
  // Get available models
  const models = [];
  if (includeLocal) {
    const localModels = await runtime.call('transformer.listModels');
    models.push(...localModels.map(name => ({ name, type: 'local' })));
  }
  if (includeCloud) {
    models.push(...manifest.cloudModels.map(name => ({ name, type: 'cloud' })));
  }
  
  if (models.length === 0) {
    runtime.log('❌ No models available for testing');
    return { error: 'No models available' };
  }
  
  runtime.log(`Testing models: ${models.map(m => `${m.name} (${m.type})`).join(', ')}\n`);
  
  // Speed Test - using a standard sentence
  const speedTestText = "communal living with shared resources reduces individual costs and workload";
  const speedResults = [];
  
  for (const model of models) {
    runtime.log(`⏱️  Speed testing ${model.name}...`);
    const times = [];
    let lastResult = null;
    
    try {
      for (let i = 0; i < runs; i++) {
        const start = performance.now();
        const result = await embedText({ text: speedTestText, modelName: model.name });
        const duration = performance.now() - start;
        times.push(duration);
        lastResult = result;
        
        // Small delay between runs
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const avgDuration = Math.round(times.reduce((sum, time) => sum + time, 0) / runs);
      const minDuration = Math.round(Math.min(...times));
      const maxDuration = Math.round(Math.max(...times));
      
      speedResults.push({
        model: model.name,
        type: model.type,
        avgDuration,
        minDuration,
        maxDuration,
        dimensions: lastResult.dimensions,
        device: lastResult.device || model.type,
        runs
      });
      
      runtime.log(`   ✅ ${model.name}: ${avgDuration}ms avg (${minDuration}-${maxDuration}ms range)`);
      
    } catch (error) {
      runtime.log(`   ❌ ${model.name}: ${error.message}`);
      speedResults.push({
        model: model.name,
        type: model.type,
        error: error.message,
        runs: 0
      });
    }
  }
  
  // Display speed results table
  runtime.log(`\n📊 SPEED COMPARISON RESULTS (${runs} runs each):`);
  const speedTable = speedResults
    .filter(r => !r.error)
    .sort((a, b) => a.avgDuration - b.avgDuration)
    .map(r => ({
      Model: r.model,
      Type: r.type,
      'Avg (ms)': r.avgDuration,
      'Range (ms)': `${r.minDuration}-${r.maxDuration}`,
      Dimensions: r.dimensions,
      Device: r.device
    }));
  
  console.table(speedTable);
  
  // Quality Test - using semantic similarity test cases
  runtime.log(`\n🎯 QUALITY TESTING (Semantic Similarity):`);
  const qualityResults = [];
  
  // Only test successful models
  const successfulModels = speedResults.filter(r => !r.error);
  
  for (const model of successfulModels) {
    runtime.log(`🧠 Quality testing ${model.model}...`);
    
    let totalTests = 0;
    let passedTests = 0;
    const testDetails = [];
    
    for (const testGroup of testCases) {
      for (const pair of testGroup.pairs) {
        try {
          const embedding1 = await embedText({ text: pair.text1, modelName: model.model });
          const embedding2 = await embedText({ text: pair.text2, modelName: model.model });
          
          // Handle different embedding formats (local vs cloud)
          const vec1 = embedding1.embedding.ort_tensor?.data || embedding1.embedding;
          const vec2 = embedding2.embedding.ort_tensor?.data || embedding2.embedding;
          
          const similarity = calculateCosineSimilarity(vec1, vec2);
          const passed = evaluateSimilarity(similarity, pair.expectedSimilarity);
          
          totalTests++;
          if (passed) passedTests++;
          
          testDetails.push({
            group: testGroup.name,
            similarity: similarity.toFixed(4),
            expected: pair.expectedSimilarity,
            passed,
            text1Preview: pair.text1.substring(0, 40) + '...',
            text2Preview: pair.text2.substring(0, 40) + '...'
          });
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          runtime.log(`   ❌ Test failed: ${error.message}`);
          totalTests++;
        }
      }
    }
    
    const qualityScore = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
    
    qualityResults.push({
      model: model.model,
      type: model.type,
      qualityScore: parseFloat(qualityScore),
      passedTests,
      totalTests,
      testDetails
    });
    
    runtime.log(`   ✅ ${model.model}: ${qualityScore}% quality (${passedTests}/${totalTests} tests passed)`);
  }
  
  // Display quality results table
  runtime.log(`\n🏆 QUALITY COMPARISON RESULTS:`);
  const qualityTable = qualityResults
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .map(r => ({
      Model: r.model,
      Type: r.type,
      'Quality Score (%)': r.qualityScore,
      'Tests Passed': `${r.passedTests}/${r.totalTests}`,
      'Speed Rank': speedTable.findIndex(s => s.Model === r.model) + 1
    }));
  
  console.table(qualityTable);
  
  // Combined Rankings
  runtime.log(`\n🥇 COMBINED RANKINGS (Speed + Quality):`);
  const combinedResults = qualityResults.map(quality => {
    const speed = speedResults.find(s => s.model === quality.model && !s.error);
    return {
      model: quality.model,
      type: quality.type,
      qualityScore: quality.qualityScore,
      avgSpeed: speed?.avgDuration || 999999,
      // Normalize scores (lower speed is better, higher quality is better)
      speedScore: speed ? (1000 / speed.avgDuration * 100) : 0,
      qualityScoreNorm: quality.qualityScore,
      combinedScore: speed ? (quality.qualityScore + (1000 / speed.avgDuration * 100)) / 2 : quality.qualityScore / 2
    };
  }).sort((a, b) => b.combinedScore - a.combinedScore);
  
  const combinedTable = combinedResults.map((r, index) => ({
    Rank: index + 1,
    Model: r.model,
    Type: r.type,
    'Quality (%)': r.qualityScore,
    'Speed (ms)': r.avgSpeed === 999999 ? 'ERROR' : r.avgSpeed,
    'Combined Score': r.combinedScore.toFixed(1)
  }));
  
  console.table(combinedTable);
  
  // Recommendations
  runtime.log(`\n💡 RECOMMENDATIONS:`);
  const fastest = speedResults.filter(r => !r.error).sort((a, b) => a.avgDuration - b.avgDuration)[0];
  const highestQuality = qualityResults.sort((a, b) => b.qualityScore - a.qualityScore)[0];
  const bestCombined = combinedResults[0];
  
  if (fastest) runtime.log(`🚀 Fastest: ${fastest.model} (${fastest.avgDuration}ms avg)`);
  if (highestQuality) runtime.log(`🎯 Best Quality: ${highestQuality.model} (${highestQuality.qualityScore}% accuracy)`);
  if (bestCombined) runtime.log(`⚖️  Best Overall: ${bestCombined.model} (${bestCombined.combinedScore.toFixed(1)} combined score)`);
  
  // Type-based recommendations
  const localBest = combinedResults.filter(r => r.type === 'local')[0];
  const cloudBest = combinedResults.filter(r => r.type === 'cloud')[0];
  
  if (localBest && cloudBest) {
    runtime.log(`\n🏠 Best Local: ${localBest.model}`);
    runtime.log(`☁️  Best Cloud: ${cloudBest.model}`);
    
    if (cloudBest.combinedScore > localBest.combinedScore) {
      runtime.log(`   → Cloud models show better overall performance`);
    } else {
      runtime.log(`   → Local models competitive with cloud performance`);
    }
  }
  
  return {
    speedResults,
    qualityResults,
    combinedResults,
    recommendations: {
      fastest: fastest?.model,
      highestQuality: highestQuality?.model,
      bestOverall: bestCombined?.model,
      bestLocal: localBest?.model,
      bestCloud: cloudBest?.model
    }
  };
};

// Helper function for testing all models quickly
export const testAllModels = async () => {
  runtime.log('🔄 Testing all available models (local + cloud)...');
  return await runSpeedQualityComparison({ includeLocal: true, includeCloud: true, runs: 2 });
};

// Existing test code (unchanged)
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
  { name: "Contradictory Ideas - Low Similarity", 
    pairs: [
      { text1: "collective decision making ensures fairness", text2: "individual choice maximizes personal freedom", expectedSimilarity: "low", notes: "Opposing philosophies" },
      { text1: "shared resources create abundance through efficiency",  text2: "private ownership incentivizes productive investment", expectedSimilarity: "low", notes: "Contrasting economic views" }
    ]
  }
];

export const runEmbeddingTests = async (params = {}) => {
  const { modelName } = params;
  if (!modelName) {
    runtime.log('[Embedding] Available models:');
    runtime.log('Local:', await runtime.call('transformer.listModels'));
    runtime.log('Cloud:', manifest.cloudModels);
    return { error: 'Please specify modelName parameter' };
  }
  
  const results = [];
  
  for (const testGroup of embeddingTestCases) {
    console.log(`\n=== Testing: ${testGroup.name} ===`);
    for (const pair of testGroup.pairs) {
      try {
        const embedding1 = await embedText({ text: pair.text1, modelName });
        const embedding2 = await embedText({ text: pair.text2, modelName });
        
        // Handle different embedding formats (local vs cloud)
        const vec1 = embedding1.embedding.ort_tensor?.data || embedding1.embedding;
        const vec2 = embedding2.embedding.ort_tensor?.data || embedding2.embedding;
        
        const similarity = calculateCosineSimilarity(vec1, vec2);
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
  console.log(`\n=== SUMMARY for ${modelName} ===`);
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