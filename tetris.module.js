import { wait } from "./helpers.js";

export const manifest = {
	name: "tetris",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Tetris game engine with AI integration capability",
	dependencies: ["ui", "tree-to-dom", "inference"],
	actions: ["startGame", "pauseGame", "resetGame", "toggleAI"],
	searchActions: [
		{ name: "play tetris", keyword: "tetris", method: "startGame" }
	]
};

let runtime, gameState = null, runner = null
export const initialize = async (rt) => (runtime = rt, setupKeyboardControls())

// game logic
const run = () => {
	if (runner) return;
	runner = setInterval(() => !makeMove('down') || stopRunning, interval);
};
const stopRunning = () => { clearInterval(runner); runner = null };
export const startGame = () => { initializeGame(); run(); renderGame(); };
export const pauseGame = () => { runner ? stopRunning() : run(); renderGame(); };
export const resetGame = () => { stopRunning(); startGame(); };
const initializeGame = () => (initializeGameState(), spawnPiece());
const initializeGameState = () => (gameState = { board: Array(boardHeight).fill(0).map(() => Array(boardWidth).fill(0)), currentPiece: null, currentPosition: { x: 4, y: 0 }, nextPiece: null, lines: 0, gameOver: false, aiMode: false, moves: [] });
const makeMove = (move) => {
	if (!gameState) return false;
	const newPos = getNewPosition(move), newRot = getNewRotation(move);
	if (isValidPosition(gameState.currentPiece.type, newRot, newPos)) return movePiece(newPos, newRot);
	if (move === 'down') return lockAndSpawn();
	return false;
};
const getNewPosition = (move) => {
	const pos = { ...gameState.currentPosition };
	if (move === 'left') return { x: pos.x - 1, y: pos.y };
	if (move === 'right') return { x: pos.x + 1, y: pos.y };
	if (move === 'down') return { x: pos.x, y: pos.y + 1 };
};
const getNewRotation = (move) => move === 'rotate' ? (gameState.currentPiece.rotation + 1) % 4 : gameState.currentPiece.rotation;
const lockAndSpawn = () => { lockPiece(); clearLines(); spawnPiece(); renderGame(); return !gameState.gameOver; };
const movePiece = (position, rotation) => { gameState.currentPosition = position; gameState.currentPiece.rotation = rotation; renderGame(); return true; };
const getRandomPiece = () => ({ type: types[Math.floor(Math.random() * types.length)], rotation: 0 });
const spawnPiece = () => {
	gameState.currentPiece = gameState.nextPiece || getRandomPiece();
	gameState.nextPiece = getRandomPiece();
	gameState.currentPosition = { x: 4, y: 0 };
	const t = isValidPosition(gameState.currentPiece.type, 0, gameState.currentPosition);
	if (!isValidPosition(gameState.currentPiece.type, 0, gameState.currentPosition)) gameOver();
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
const clearLines = () => gameState.board.forEach((row, y) => row.every(cell => cell !== 0) && clearLine(y));
const clearLine = (y) => (removeRow(y), addRowAtTop(), gameState.lines++);
const removeRow = (rowIndex) => gameState.board.splice(rowIndex, 1);
const addRowAtTop = () => gameState.board.unshift(blankRow);
const gameOver = () => { gameState.gameOver = true; stopRunning(); };
// AI
const systemPrompt = "You are a Tetris AI. Analyze the board and return optimal moves as a JSON array. Consider line clearing opportunities, stack height, and piece placement strategy.";
const query = () => `Board: ${gameState.board.map(row => row.join('')).join('\n')}
Current: ${gameState.currentPiece.type}
Valid Moves: ${validMoves.join(', ')}
Return JSON array of moves: ["left", "rotate", "down"]
`;
export const getAIMoves = async () => {
	const aiMoves = parseAIResponse(await runtime.call('inference.prompt', { query: query(), systemPrompt }));
	return !aiMoves || aiMoves.length === 0 ? (await wait(500), await getAIMoves()) : aiMoves;
}
const parseAIResponse = (response) => {
	const jsonMatch = response.match(/\[[\s\S]*?\]/);
	return jsonMatch ? JSON.parse(jsonMatch[0]).filter(move => validMoves.includes(move)) : null;
};
const aiTurn = async () => {
	gameState.moves = await getAIMoves();
	for (const move of gameState.moves) { await wait(200); if (!makeMove(move)) break; }
};

// rendering 
const renderGame = async () => await runtime.call('ui.renderTree', buildGameTree());
const buildGameTree = () => ({ "tetris-game": { tag: "div", style: "display: flex; flex-direction: column; align-items: center; padding: 20px; font-family: monospace; background: #000; color: #fff; min-height: 100vh;", ...gameHeader(), ...mainGameArea(), ...(gameState?.gameOver && gameOverOverlay()) } });
const gameHeader = () => ({ "game-header": { tag: "div", style: "margin-bottom: 20px; text-align: center;", "title": { tag: "h1", text: "TETRIS", style: "margin: 0; color: #00ff00; font-size: 2em;" }, "controls": { tag: "div", text: "← → ↓ SPACE (rotate) | P (pause)", style: "font-size: 12px; color: #888; margin-top: 5px;" } } });
const mainGameArea = () => ({ "game-container": { tag: "div", style: "display: flex; gap: 20px; align-items: flex-start;", "board-container": { tag: "div", style: "border: 2px solid #444; background: #111;", "game-board": createBoardElement() }, ...infoPanel() } });
const infoPanel = () => ({ "info-panel": { tag: "div", style: "display: flex; flex-direction: column; gap: 15px; color: #fff;", ...scoreSection(), ...nextPieceSection(), ...aiStatusSection(), ...gameControls() } });
const scoreSection = () => ({ "score-info": { tag: "div", style: "background: #222; padding: 10px; border-radius: 5px;", "score": { tag: "div", text: `Score: ${gameState?.score || 0}` }, "lines": { tag: "div", text: `Lines: ${gameState?.lines || 0}` }, "level": { tag: "div", text: `Level: ${gameState?.level || 1}` } } });
const nextPieceSection = () => ({ "next-piece": { tag: "div", style: "background: #222; padding: 10px; border-radius: 5px;", "next-label": { tag: "div", text: "Next:", style: "font-weight: bold; margin-bottom: 5px;" }, "next-display": createNextPieceElement() } });
const aiStatusSection = () => ({ "ai-status": { tag: "div", style: "background: #222; padding: 10px; border-radius: 5px;", "ai-label": { tag: "div", text: "AI Status:", style: "font-weight: bold; margin-bottom: 5px;" }, "ai-info": { tag: "div", text: gameState?.aiStatus || "Human Control", style: `color: ${gameState?.aiMode ? '#00ff00' : '#ffffff'};` } } });
const gameControls = () => ({ "game-controls": { tag: "div", style: "display: flex; flex-direction: column; gap: 10px;", "pause-btn": { tag: "button", text: runner ? "Pause (P)" : "Resume (P)", class: "cognition-button-secondary", events: { click: "tetris.pauseGame" } }, "ai-toggle": { tag: "button", text: gameState?.aiMode ? "Disable AI" : "Enable AI", class: gameState?.aiMode ? "cognition-button-primary" : "cognition-button-secondary", events: { click: "tetris.toggleAI" } }, "reset-btn": { tag: "button", text: "Reset Game", class: "cognition-button-primary", events: { click: "tetris.resetGame" } } } });
const gameOverOverlay = () => ({ "game-over": { tag: "div", style: "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,0,0,0.9); color: white; padding: 20px; border-radius: 10px; text-align: center; font-size: 1.5em;", "game-over-text": { tag: "div", text: "GAME OVER", style: "font-weight: bold; margin-bottom: 10px;" }, "final-score": { tag: "div", text: `Final Score: ${gameState.score}` } } });
const createBoardElement = () => !gameState ? { tag: "div" } : (() => {
	const visualBoard = gameState.board.map(row => [...row]);
	gameState.currentPiece && (() => {
		const piece = PIECES[gameState.currentPiece.type][gameState.currentPiece.rotation];
		const { x: px, y: py } = gameState.currentPosition;
		piece.forEach((row, y) => row.forEach((cell, x) => cell && py + y >= 0 && py + y < boardHeight && px + x >= 0 && px + x < boardWidth && (visualBoard[py + y][px + x] = `current_${gameState.currentPiece.type}`)));
	})();
	return {
		tag: "div", style: "display: grid; grid-template-columns: repeat(10, 25px); grid-template-rows: repeat(20, 25px); gap: 1px; background: #333;",
		...visualBoard.reduce((cells, row, y) => (row.forEach((cell, x) => {
			const isCurrent = typeof cell === 'string' && cell.startsWith('current_');
			const pieceType = isCurrent ? cell.split('_')[1] : cell;
			cells[`cell-${y}-${x}`] = { tag: "div", style: `width: 25px; height: 25px; background: ${cell ? PIECE_COLORS[pieceType] || '#666' : '#000'}; border: ${isCurrent ? '2px solid #fff' : '1px solid #444'};` };
		}), cells), {})
	};
})();
const createNextPieceElement = () => !gameState?.nextPiece ? { tag: "div" } : (() => {
	const piece = PIECES[gameState.nextPiece.type][0];
	const color = PIECE_COLORS[gameState.nextPiece.type];
	return {
		tag: "div", style: "display: grid; grid-template-columns: repeat(4, 15px); grid-template-rows: repeat(4, 15px); gap: 1px;",
		...Array.from({ length: 16 },
			(_, i) => {
				const y = Math.floor(i / 4);
				const x = i % 4;
				const hasBlock = piece[y] && piece[y][x];
				return [`next-${y}-${x}`, { tag: "div", style: `width: 15px; height: 15px; background: ${hasBlock ? color : 'transparent'}; border: 1px solid #555;` }];
			}).reduce((acc, [key, val]) => (acc[key] = val, acc), {})
	};
})();
// keyboard controls
const actions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', Space: 'rotate', KeyP: 'pause' };
const setupKeyboardControls = () => document.addEventListener('keydown', (event) => {
	if (!gameState) return;
	const action = actions[event.code];
	if (action) {
		event.preventDefault();
		action === 'pause' ? pauseGame() : makeMove(action);
	}
});
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