export const manifest = {
  name: "live-chunker",
  context: ["extension-page"],
  version: "1.0.0",
  description: "Real-time speech chunking with bubble visualization",
  dependencies: ["transcript", "ui", "chunk"],
  actions: ["startDemo", "stopDemo", "processTranscript", "getChunks"],
};

let runtime, chunks = [], isActive = false, lastProcessedText = '';

export const initialize = async (rt) => {
  runtime = rt;
  setupTranscriptListener();
};

const setupTranscriptListener = () => {
  // Poll transcript status and process new sentences
  setInterval(async () => {
    if (!isActive) return;
    
    const status = await runtime.call('transcript.getStatus');
    if (!status.isListening || !status.currentTranscript) return;
    
    // Only process if transcript changed and ends with punctuation
    if (status.currentTranscript !== lastProcessedText && 
        status.currentTranscript.match(/[.!?]\s*$/)) {
      await processTranscript(status.currentTranscript.trim());
      lastProcessedText = status.currentTranscript;
      await runtime.call('ui.clearPrompt');
    }
  }, 500);
};

export const startDemo = async () => {
  isActive = true;
  chunks = [];
  await runtime.call('transcript.startListening');
  await renderChunkerUI();
  return { success: true, message: 'Live chunking demo started' };
};

export const stopDemo = async () => {
  isActive = false;
  await runtime.call('transcript.stopListening');
  return { success: true, message: 'Live chunking demo stopped' };
};

export const processTranscript = async (sentence) => {
  if (!sentence.trim()) return;
  
  runtime.log('[Live-Chunker] Processing sentence:', sentence);
  
  if (chunks.length === 0) {
    chunks.push({ sentences: [sentence], id: generateId() });
  } else {
    // Test similarity with all existing chunks
    const similarities = await Promise.all(
      chunks.map(async chunk => {
        const chunkText = chunk.sentences.join(' ');
        return await runtime.call('chunk.calculateSimilarity', chunkText, sentence);
      })
    );
    
    const maxSimilarity = Math.max(...similarities);
    const bestChunkIndex = similarities.indexOf(maxSimilarity);
    
    if (maxSimilarity > 0.4) {
      // Add to existing chunk
      chunks[bestChunkIndex].sentences.push(sentence);
      runtime.log('[Live-Chunker] Added to existing chunk', bestChunkIndex);
    } else {
      // Create new chunk
      chunks.push({ sentences: [sentence], id: generateId() });
      runtime.log('[Live-Chunker] Created new chunk');
    }
  }
  
  await renderChunkerUI();
};

const renderChunkerUI = async () => {
  const tree = {
    "chunker-container": {
      tag: "div",
      class: "chunker-container",
      style: "padding: 20px; display: flex; flex-wrap: wrap; gap: 15px;",
      ...createChunkBubbles()
    }
  };
  
  await runtime.call('ui.renderTree', tree);
};

const createChunkBubbles = () => {
  const bubbles = {};
  
  chunks.forEach((chunk, index) => {
    const bubbleId = `chunk-${chunk.id}`;
    const sentenceCount = chunk.sentences.length;
    const previewText = chunk.sentences.join(' ').substring(0, 100) + 
                       (chunk.sentences.join(' ').length > 100 ? '...' : '');
    
    bubbles[bubbleId] = {
      tag: "div",
      class: "chunk-bubble",
      style: `
        background: hsl(${index * 50 % 360}, 70%, 85%);
        border-radius: 15px;
        padding: 12px 16px;
        border: 2px solid hsl(${index * 50 % 360}, 70%, 70%);
        max-width: 300px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transition: all 0.3s ease;
      `,
      title: chunk.sentences.join('\n\n'),
      [`${bubbleId}-count`]: {
        tag: "div",
        text: `${sentenceCount} sentence${sentenceCount > 1 ? 's' : ''}`,
        style: "font-size: 11px; color: #666; margin-bottom: 6px; font-weight: bold;"
      },
      [`${bubbleId}-text`]: {
        tag: "div",
        text: previewText,
        style: "font-size: 13px; line-height: 1.4;"
      }
    };
  });
  
  return bubbles;
};

export const getChunks = async () => ({ chunks, totalSentences: chunks.reduce((sum, c) => sum + c.sentences.length, 0) });

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);