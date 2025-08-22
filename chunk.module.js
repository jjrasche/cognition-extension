import { calculateCosineSimilarity } from "./helpers.js";

export const manifest = {
  name: "chunk",
  context: ["service-worker"],
  version: "1.0.0",
  description: "Registry and assess chunking strategies",
  dependencies: ["chrome-sync", "embedding"],
  actions: ["chunk"]
};

let runtime, implementation, implementations = [];
export const initialize = async (rt) => {
  runtime = rt;
  implementation = await loadImplementation();
  await registerImplementations();
};

const loadImplementation = async () => await implementations.find(async p => p.manifest.name === (await runtime.call('chrome-sync.get', "chunking.implementation")));
const registerImplementations = async (runtime) => runtime.getModulesWithProperty('isChunkingStrategy').forEach(async implementation => {
  verifyImplementation(implementation);
  implementations.push(implementation);
});

export const chunk = async (text, options = {}) => {
  const ret = { text,};
  ret.chunks = await implementation.chunk(text, options);
  if (ret.chunks.length > 0) ret.quality = assessQuality(ret.chunks, text);
  return ret;
};

const assessQuality = async (chunks, text) => {
  return {
    coherence: await assessSemanticCoherence(chunks),
    boundary: await assessBoundaryQuality(chunks, text),
    size: assessSizeDistribution(chunks)
  };
};

const verifyImplementation = (impl) => {
  requiredMethods.forEach(method => ensureMethodExists(impl, method));
};
const requiredMethods = ['chunk'];
const ensureMethodExists = (impl, method) => typeof impl[method] !== 'function' && (() => { throw new Error(`Strategy missing required method: ${method}`); })();


// Quality assessment functions for the registry
const assessSemanticCoherence = async (chunks) => {
  const scores = [];
  
  for (let i = 0; i < chunks.length - 1; i++) {
    const embedding1 = await runtime.call('embedding.embedText', chunks[i].content);
    const embedding2 = await runtime.call('embedding.embedText', chunks[i + 1].content);
    const similarity = calculateCosineSimilarity(embedding1.embedding, embedding2.embedding);
    scores.push(similarity);
  }
  
  return {
    avgCoherence: scores.reduce((sum, s) => sum + s, 0) / scores.length,
    minCoherence: Math.min(...scores),
    maxCoherence: Math.max(...scores),
    coherenceVariance: calculateVariance(scores)
  };
};

const assessBoundaryQuality = async (chunks, originalText) => {
  const boundaryScores = chunks.map(chunk => {
    const beforeChar = originalText[chunk.startIndex - 1] || '';
    const afterChar = originalText[chunk.endIndex] || '';
    const startsClean = /\s/.test(beforeChar) || chunk.startIndex === 0;
    const endsClean = /[.!?]\s/.test(chunk.content.slice(-2)) || /\s/.test(afterChar);
    
    return {
      startsClean: startsClean ? 1 : 0,
      endsClean: endsClean ? 1 : 0,
      overall: (startsClean && endsClean) ? 1 : 0
    };
  });
  
  return {
    avgBoundaryQuality: boundaryScores.reduce((sum, s) => sum + s.overall, 0) / boundaryScores.length,
    cleanStarts: boundaryScores.filter(s => s.startsClean).length / boundaryScores.length,
    cleanEnds: boundaryScores.filter(s => s.endsClean).length / boundaryScores.length
  };
};

const assessSizeDistribution = (chunks) => {
  const sizes = chunks.map(c => c.content.length);
  return {
    avgSize: sizes.reduce((sum, s) => sum + s, 0) / sizes.length,
    minSize: Math.min(...sizes),
    maxSize: Math.max(...sizes),
    sizeVariance: calculateVariance(sizes),
    sizeStdDev: Math.sqrt(calculateVariance(sizes))
  };
};