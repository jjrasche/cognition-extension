import { test } from "api-keys.module";

export const manifest = {
	name: "tetris",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Tetris game engine with AI integration capability",
	dependencies: ["ui", "tree-to-dom", "inference"],
	actions: ["startGame", "pauseGame", "makeMove", "getGameState", "resetGame", "toggleAI", "getAIMove"],
	searchActions: [
		{ name: "play tetris", keyword: "tetris", method: "startGame" }
	]
};

let runtime, gameState = null, gameInterval = null, isRunning = false;
export const initialize = async (rt) => (runtime = rt, setupKeyboardControls())

// controls
const setupKeyboardControls = () => {
	document.addEventListener('keydown', (event) => {
		if (!isRunning || !gameState) return;
		const action = actions[event.code];
		if (action) {
			event.preventDefault();
			if (action === 'pause') pauseGame();
			else {
				gameState.humanOverride = true;
				makeMove(action);
			}
		}
	});
};
// game logic
export const startGame = async () => {
	initializeGame();
	isRunning = true;
	gameInterval = setInterval(() => isRunning && makeMove('down'), interval);
	await renderGame();
};
export const pauseGame = async () => {
	isRunning = !isRunning;
	if (isRunning) gameInterval = setInterval(() => isRunning && makeMove('down'), interval);
	else clearInterval(gameInterval);
	await renderGame();
};
export const resetGame = async () => {
	clearInterval(gameInterval);
	isRunning = false;
	await startGame();
};
export const makeMove = async (move) => {
	if (!gameState || !isRunning) return false;
	const { currentPiece, currentPosition } = gameState;
	let newPosition = { ...currentPosition };
	let newRotation = currentPiece.rotation;
	switch (move) {
		case 'left': newPosition.x--; break;
		case 'right': newPosition.x++; break;
		case 'down': newPosition.y++; break;
		case 'rotate': newRotation = (currentPiece.rotation + 1) % PIECES[currentPiece.type].length; break;
	}
	if (isValidPosition(currentPiece.type, newRotation, newPosition)) {
		gameState.currentPosition = newPosition;
		gameState.currentPiece.rotation = newRotation;
		await renderGame();
		return true;
	} else if (move === 'down') {
		lockPiece();
		clearLines();
		spawnNewPiece();
		if (!isValidPosition(gameState.currentPiece.type, gameState.currentPiece.rotation, gameState.currentPosition)) {
			gameOver();
			return false;
		}
		if (gameState.aiMode && !gameState.aiProcessing) await triggerAI();
		await renderGame();
		return true;
	}
	return false;
};
const initializeGame = () => (initializeGameState(), spawnNewPiece());
const initializeGameState = () => (gameState = { board: Array(boardHeight).fill(0).map(() => Array(boardWidth).fill(0)), currentPiece: null, currentPosition: { x: 4, y: 0 }, nextPiece: null, score: 0, lines: 0, level: 1, gameOver: false, aiMode: false, aiProcessing: false, aiStatus: "Human Control", currentMoveSequence: [], humanOverride: false });
const getRandomPiece = () => ({ type: types[Math.floor(Math.random() * types.length)], rotation: 0 });
const spawnNewPiece = () => {
	gameState.currentPiece = gameState.nextPiece || getRandomPiece();
	gameState.nextPiece = getRandomPiece();
	gameState.currentPosition = { x: 4, y: 0 };
	gameState.humanOverride = false;
};
const isValidPosition = (pieceType, rotation, position) => {
	const piece = PIECES[pieceType][rotation];
	for (let y = 0; y < piece.length; y++) {
		for (let x = 0; x < piece[y].length; x++) {
			if (piece[y][x]) {
				const boardX = position.x + x;
				const boardY = position.y + y;
				if (boardX < 0 || boardX >= boardWidth || boardY >= boardHeight) return false;
				if (boardY >= 0 && gameState.board[boardY][boardX]) return false;
			}
		}
	}
	return true;
};
const lockPiece = () => {
	const { currentPiece, currentPosition } = gameState;
	const piece = PIECES[currentPiece.type][currentPiece.rotation];
	for (let y = 0; y < piece.length; y++) {
		for (let x = 0; x < piece[y].length; x++) {
			if (piece[y][x]) {
				const boardX = currentPosition.x + x;
				const boardY = currentPosition.y + y;
				if (boardY >= 0) gameState.board[boardY][boardX] = currentPiece.type;
			}
		}
	}
};
const clearLines = () => {
	let linesCleared = 0;
	for (let y = gameState.board.length - 1; y >= 0; y--) {
		if (gameState.board[y].every(cell => cell !== 0)) {
			gameState.board.splice(y, 1);
			gameState.board.unshift(Array(boardWidth).fill(0));
			linesCleared++;
			y++;
		}
	}
	if (linesCleared > 0) {
		gameState.lines += linesCleared;
		gameState.score += linesCleared;
		gameState.level = Math.floor(gameState.lines / 10) + 1;
	}
};
const getLineScore = (lines) => [0, 100, 300, 500, 800][lines] || 800;
const gameOver = () => {
	isRunning = false;
	gameState.gameOver = true;
	clearInterval(gameInterval);
	runtime.log('[Tetris] Game Over! Score:', gameState.score);
};
// AI
export const toggleAI = async () => {
	gameState.aiMode = !gameState.aiMode;
	gameState.aiStatus = gameState.aiMode ? "AI Mode" : "Human Control";
	if (!gameState.aiMode) {
		gameState.aiProcessing = false;
		gameState.currentMoveSequence = [];
		isRunning = true;
	} else if (!gameState.aiProcessing && isRunning) {
		await triggerAI();
	}
	await renderGame();
};
export const getAIMoves = async () => {
	let aiMoves = []
	while (!aiMoves || aiMoves.length === 0) {
		aiMoves = parseAIResponse(await runtime.call('inference.prompt', { query: buildAIPrompt(), systemPrompt }));
	}
	return aiMoves;
}
const parseAIResponse = (response) => {
	const jsonMatch = response.match(/\[[\s\S]*?\]/);
	if (jsonMatch) {
		const moves = JSON.parse(jsonMatch[0]);
		return moves.filter(move => validMoves.includes(move)).slice(0, 20);
	}
	return null;
};
const systemPrompt = "You are a Tetris AI. Analyze the board and return optimal moves as a JSON array. Consider line clearing opportunities, stack height, and piece placement strategy.";
const buildAIPrompt = () => {
	const { board, currentPiece, currentPosition, nextPiece } = gameState;
	return `Current Tetris game state:

Board (${boardHeight} rows x ${boardWidth} columns, 0=empty, letters=placed pieces):
${board.map((row, i) => `${i.toString().padStart(2)}: [${row.map(cell => cell || '·').join(',')}]`).join('\n')}

Current piece: ${currentPiece.type} at position (${currentPosition.x}, ${currentPosition.y}), rotation ${currentPiece.rotation}
Next piece: ${nextPiece.type}

Current score: ${gameState.score}
Lines cleared: ${gameState.lines}

Valid moves: ${validMoves.join(", ")}

Instructions:
- "left"/"right": Move piece horizontally
- "down": Move piece down one row (faster than waiting)
- "rotate": Rotate piece clockwise

Strategy goals:
1. Clear complete lines when possible (prioritize multiple lines)
2. Keep stack height low
3. Avoid creating holes and overhangs
4. Consider upcoming piece for setup

Only return a JSON array of moves to optimally place the current piece:
Example: ["left", "rotate", "down", "down", "down", "down"]
Maximum 20 moves per sequence.`;
};
const triggerAI = async () => {
	gameState.aiProcessing = true;
	gameState.aiStatus = "AI Thinking...";
	isRunning = false;
	await renderGame();
	try {
		const moves = await getAIMoves();
		gameState.currentMoveSequence = moves;
		gameState.aiStatus = "AI Playing";
		isRunning = true;
		await executeAIMoves();
	} catch (error) {
		runtime.logError('[Tetris] AI failed:', error);
		gameState.aiStatus = "AI Error - Human Control";
		gameState.aiMode = false;
		isRunning = true;
	}
	gameState.aiProcessing = false;
	await renderGame();
};
const executeAIMoves = async () => {
	const moves = [...gameState.currentMoveSequence];
	for (let i = 0; i < moves.length; i++) {
		if (gameState.humanOverride) {
			runtime.log('[Tetris] Human override detected, stopping AI moves');
			gameState.aiStatus = "Human Override";
			return;
		}
		if (!isRunning || gameState.gameOver) return;
		const move = moves[i];
		await new Promise(resolve => setTimeout(resolve, 200));
		const success = await makeMove(move);
		if (!success && move !== 'down') {
			runtime.log(`[Tetris] AI move "${move}" failed, continuing sequence`);
		}
		if (move === 'down' && !success) break;
		await renderGame();
	}
	gameState.currentMoveSequence = [];
	gameState.aiStatus = gameState.aiMode ? "AI Mode" : "Human Control";
};
export const getGameState = async () => ({ ...gameState });
// rendering 
const renderGame = async () => {
	const tree = {
		"tetris-game": {
			tag: "div",
			style: "display: flex; flex-direction: column; align-items: center; padding: 20px; font-family: monospace; background: #000; color: #fff; min-height: 100vh;",
			"game-header": {
				tag: "div",
				style: "margin-bottom: 20px; text-align: center;",
				"title": { tag: "h1", text: "TETRIS", style: "margin: 0; color: #00ff00; font-size: 2em;" },
				"controls": { tag: "div", text: "← → ↓ SPACE (rotate) | P (pause)", style: "font-size: 12px; color: #888; margin-top: 5px;" }
			},
			"game-container": {
				tag: "div",
				style: "display: flex; gap: 20px; align-items: flex-start;",
				"board-container": {
					tag: "div",
					style: "border: 2px solid #444; background: #111;",
					"game-board": createBoardElement()
				},
				"info-panel": {
					tag: "div",
					style: "display: flex; flex-direction: column; gap: 15px; color: #fff;",
					"score-info": {
						tag: "div",
						style: "background: #222; padding: 10px; border-radius: 5px;",
						"score": { tag: "div", text: `Score: ${gameState?.score || 0}` },
						"lines": { tag: "div", text: `Lines: ${gameState?.lines || 0}` },
						"level": { tag: "div", text: `Level: ${gameState?.level || 1}` }
					},
					"next-piece": {
						tag: "div",
						style: "background: #222; padding: 10px; border-radius: 5px;",
						"next-label": { tag: "div", text: "Next:", style: "font-weight: bold; margin-bottom: 5px;" },
						"next-display": createNextPieceElement()
					},
					"ai-status": {
						tag: "div",
						style: "background: #222; padding: 10px; border-radius: 5px;",
						"ai-label": { tag: "div", text: "AI Status:", style: "font-weight: bold; margin-bottom: 5px;" },
						"ai-info": { tag: "div", text: gameState?.aiStatus || "Human Control", style: `color: ${gameState?.aiMode ? '#00ff00' : '#ffffff'};` }
					},
					"game-controls": {
						tag: "div",
						style: "display: flex; flex-direction: column; gap: 10px;",
						"pause-btn": {
							tag: "button",
							text: isRunning ? "Pause (P)" : "Resume (P)",
							class: "cognition-button-secondary",
							events: { click: "tetris.pauseGame" }
						},
						"ai-toggle": {
							tag: "button",
							text: gameState?.aiMode ? "Disable AI" : "Enable AI",
							class: gameState?.aiMode ? "cognition-button-primary" : "cognition-button-secondary",
							events: { click: "tetris.toggleAI" }
						},
						"reset-btn": {
							tag: "button",
							text: "Reset Game",
							class: "cognition-button-primary",
							events: { click: "tetris.resetGame" }
						}
					}
				}
			},
			...(gameState?.gameOver && {
				"game-over": {
					tag: "div",
					style: "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,0,0,0.9); color: white; padding: 20px; border-radius: 10px; text-align: center; font-size: 1.5em;",
					"game-over-text": { tag: "div", text: "GAME OVER", style: "font-weight: bold; margin-bottom: 10px;" },
					"final-score": { tag: "div", text: `Final Score: ${gameState.score}` }
				}
			})
		}
	};
	await runtime.call('ui.renderTree', tree);
};
const createBoardElement = () => {
	if (!gameState) return { tag: "div" };
	const visualBoard = gameState.board.map(row => [...row]);
	if (gameState.currentPiece) {
		const piece = PIECES[gameState.currentPiece.type][gameState.currentPiece.rotation];
		const { x: px, y: py } = gameState.currentPosition;
		for (let y = 0; y < piece.length; y++) {
			for (let x = 0; x < piece[y].length; x++) {
				if (piece[y][x]) {
					const boardX = px + x;
					const boardY = py + y;
					if (boardY >= 0 && boardY < boardHeight && boardX >= 0 && boardX < boardWidth) {
						visualBoard[boardY][boardX] = `current_${gameState.currentPiece.type}`;
					}
				}
			}
		}
	}
	const cells = {};
	visualBoard.forEach((row, y) => {
		row.forEach((cell, x) => {
			const cellId = `cell-${y}-${x}`;
			const isCurrent = typeof cell === 'string' && cell.startsWith('current_');
			const pieceType = isCurrent ? cell.split('_')[1] : cell;
			const color = cell ? PIECE_COLORS[pieceType] || '#666' : '#000';
			const border = isCurrent ? '2px solid #fff' : '1px solid #444';
			cells[cellId] = {
				tag: "div",
				style: `width: 25px; height: 25px; background: ${color}; border: ${border};`
			};
		});
	});
	return {
		tag: "div",
		style: "display: grid; grid-template-columns: repeat(10, 25px); grid-template-rows: repeat(20, 25px); gap: 1px; background: #333;",
		...cells
	};
};
const createNextPieceElement = () => {
	if (!gameState?.nextPiece) return { tag: "div" };
	const piece = PIECES[gameState.nextPiece.type][0];
	const color = PIECE_COLORS[gameState.nextPiece.type];
	const cells = {};
	for (let y = 0; y < 4; y++) {
		for (let x = 0; x < 4; x++) {
			const cellId = `next-${y}-${x}`;
			const hasBlock = piece[y] && piece[y][x];
			const cellColor = hasBlock ? color : 'transparent';
			cells[cellId] = {
				tag: "div",
				style: `width: 15px; height: 15px; background: ${cellColor}; border: 1px solid #555;`
			};
		}
	}
	return {
		tag: "div",
		style: "display: grid; grid-template-columns: repeat(4, 15px); grid-template-rows: repeat(4, 15px); gap: 1px;",
		...cells
	};
};
// game mechanics
// Tetris pieces (tetrominoes) with their rotations
const I = [[[1, 1, 1, 1]], [[1], [1], [1], [1]]];
const O = [[[1, 1], [1, 1]]];
const T = [[[0, 1, 0], [1, 1, 1]], [[1, 0], [1, 1], [1, 0]], [[1, 1, 1], [0, 1, 0]], [[0, 1], [1, 1], [0, 1]]];
const S = [[[0, 1, 1], [1, 1, 0]], [[1, 0], [1, 1], [0, 1]]];
const Z = [[[1, 1, 0], [0, 1, 1]], [[0, 1], [1, 1], [1, 0]]];
const J = [[[1, 0, 0], [1, 1, 1]], [[1, 1], [1, 0], [1, 0]], [[1, 1, 1], [0, 0, 1]], [[0, 1], [0, 1], [1, 1]]];
const L = [[[0, 0, 1], [1, 1, 1]], [[1, 0], [1, 0], [1, 1]], [[1, 1, 1], [1, 0, 0]], [[1, 1], [0, 1], [0, 1]]];
const PIECES = { I, O, T, S, Z, J, L };
const PIECE_COLORS = { I: '#00f0f0', O: '#f0f000', T: '#a000f0', S: '#00f000', Z: '#f00000', J: '#0000f0', L: '#f0a000' };
const actions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', Space: 'rotate', KeyP: 'pause' };
const types = Object.keys(PIECES);
const validMoves = ['left', 'right', 'down', 'rotate'];
const boardWidth = 10, boardHeight = 20;
let interval = 800; // milliseconds per automatic down move
// ai testing
const blankRow = Array(10).fill(0);
const testScenarios = [
	{
		name: "Tetris 4 line clear opportunity", currentPiece: { type: 'I', rotation: 0 },
		board: [
			Array(15).fill(blankRow),
			[I, 0, 0, 0, 0, 0, 0, 0, 0, 0],
			[I, 0, 0, 0, 0, 0, 0, 0, 0, 0],
			[I, 0, 0, 0, L, L, J, J, L, L],
			[I, T, 0, O, O, L, J, O, O, L],
			[T, T, T, O, O, L, J, O, O, L],
		],
		score: 2,
		lines: 2,
		level: 1,
		gameOver: false
	}
];
export const runModelTest = async (model, iterations = 3) => {
	const results = await Promise.all(testScenarios.map((t, i) => Array(iterations).map(() => runSingleTest(model, t, i + 1))));
	runtime.log(JSON.stringify(results, null, 2));
};

const runSingleTest = async (modelId, scenario, iteration) => {
	const startTime = performance.now();
	const testState = createTestGameState(scenario);
	const originalGameState = gameState;
	gameState = testState;

	try {
		getAIMoves()
		// Get AI moves using specified model
		const aiMoves = await runtime.call('inference.prompt', {
			query: buildAIPrompt(),
			systemPrompt,
			model: modelId
		});

		const endTime = performance.now();


		return {
			model: modelId,
			scenario: scenario.name,
			iteration,
			moves,
			valid: validation.allValid,
			validityScore: validation.validityPercentage,
			optimalityScore: optimality.score,
			responseTime: endTime - startTime,
			errors: validation.errors,
			reasoning: optimality.reasoning
		};

	} catch (error) {
		return {
			model: modelId,
			scenario: scenario.name,
			iteration,
			moves: [],
			valid: false,
			validityScore: 0,
			optimalityScore: 0,
			responseTime: 0,
			errors: [error.message]
		};
	} finally {
		gameState = originalGameState;
	}
};

const createTestGameState = (scenario) => ({
	board: scenario.board.map(row => [...row]),
	currentPiece: { ...scenario.currentPiece },
	currentPosition: { ...scenario.currentPosition },
	nextPiece: { type: 'I', rotation: 0 },
	score: 0,
	lines: 0,
	level: 1,
	gameOver: false
});