export const manifest = {
	name: "tetris",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Tetris game engine with AI integration capability",
	dependencies: ["ui", "tree-to-dom"],
	actions: ["startGame", "pauseGame", "makeMove", "getGameState", "resetGame"],
	searchActions: [
		{ name: "play tetris", keyword: "tetris", method: "startGame" }
	]
};

let runtime;
let gameState = null;
let gameInterval = null;
let isRunning = false;

// Tetris pieces (tetrominoes) with their rotations
const PIECES = {
	I: [
		[[1, 1, 1, 1]],
		[[1], [1], [1], [1]]
	],
	O: [
		[[1, 1], [1, 1]]
	],
	T: [
		[[0, 1, 0], [1, 1, 1]],
		[[1, 0], [1, 1], [1, 0]],
		[[1, 1, 1], [0, 1, 0]],
		[[0, 1], [1, 1], [0, 1]]
	],
	S: [
		[[0, 1, 1], [1, 1, 0]],
		[[1, 0], [1, 1], [0, 1]]
	],
	Z: [
		[[1, 1, 0], [0, 1, 1]],
		[[0, 1], [1, 1], [1, 0]]
	],
	J: [
		[[1, 0, 0], [1, 1, 1]],
		[[1, 1], [1, 0], [1, 0]],
		[[1, 1, 1], [0, 0, 1]],
		[[0, 1], [0, 1], [1, 1]]
	],
	L: [
		[[0, 0, 1], [1, 1, 1]],
		[[1, 0], [1, 0], [1, 1]],
		[[1, 1, 1], [1, 0, 0]],
		[[1, 1], [0, 1], [0, 1]]
	]
};

const PIECE_COLORS = {
	I: '#00f0f0', O: '#f0f000', T: '#a000f0',
	S: '#00f000', Z: '#f00000', J: '#0000f0', L: '#f0a000'
};

export const initialize = async (rt) => {
	runtime = rt;
	setupKeyboardControls();
};

const setupKeyboardControls = () => {
	document.addEventListener('keydown', (event) => {
		if (!isRunning || !gameState) return;

		switch (event.code) {
			case 'ArrowLeft':
				event.preventDefault();
				makeMove('left');
				break;
			case 'ArrowRight':
				event.preventDefault();
				makeMove('right');
				break;
			case 'ArrowDown':
				event.preventDefault();
				makeMove('down');
				break;
			case 'Space':
				event.preventDefault();
				makeMove('rotate');
				break;
			case 'KeyP':
				event.preventDefault();
				pauseGame();
				break;
		}
	});
};

export const startGame = async () => {
	initializeGame();
	isRunning = true;

	// Start the game loop (pieces fall automatically)
	gameInterval = setInterval(() => {
		if (isRunning) {
			makeMove('down');
		}
	}, 800); // Piece falls every 800ms

	await renderGame();
	return gameState;
};

export const pauseGame = async () => {
	isRunning = !isRunning;
	if (isRunning) {
		gameInterval = setInterval(() => {
			if (isRunning) makeMove('down');
		}, 800);
	} else {
		clearInterval(gameInterval);
	}
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
		case 'left':
			newPosition.x--;
			break;
		case 'right':
			newPosition.x++;
			break;
		case 'down':
			newPosition.y++;
			break;
		case 'rotate':
			newRotation = (currentPiece.rotation + 1) % PIECES[currentPiece.type].length;
			break;
		case 'drop':
			// Hard drop - move piece down until it can't move anymore
			while (isValidPosition(currentPiece.type, newRotation, { ...newPosition, y: newPosition.y + 1 })) {
				newPosition.y++;
			}
			break;
	}

	// Check if the new position is valid
	if (isValidPosition(currentPiece.type, newRotation, newPosition)) {
		gameState.currentPosition = newPosition;
		gameState.currentPiece.rotation = newRotation;
		await renderGame();
		return true;
	} else if (move === 'down') {
		// Piece can't move down anymore - lock it in place
		lockPiece();
		clearLines();
		spawnNewPiece();

		// Check for game over
		if (!isValidPosition(gameState.currentPiece.type, gameState.currentPiece.rotation, gameState.currentPosition)) {
			gameOver();
			return false;
		}

		await renderGame();
		return true;
	}

	return false;
};

const initializeGame = () => {
	gameState = {
		board: Array(20).fill().map(() => Array(10).fill(0)),
		currentPiece: null,
		currentPosition: { x: 4, y: 0 },
		nextPiece: null,
		score: 0,
		lines: 0,
		level: 1,
		gameOver: false
	};

	spawnNewPiece();
	gameState.nextPiece = getRandomPiece();
};

const spawnNewPiece = () => {
	gameState.currentPiece = gameState.nextPiece || getRandomPiece();
	gameState.nextPiece = getRandomPiece();
	gameState.currentPosition = { x: 4, y: 0 };
};

const getRandomPiece = () => {
	const types = Object.keys(PIECES);
	const type = types[Math.floor(Math.random() * types.length)];
	return { type, rotation: 0 };
};

const isValidPosition = (pieceType, rotation, position) => {
	const piece = PIECES[pieceType][rotation];

	for (let y = 0; y < piece.length; y++) {
		for (let x = 0; x < piece[y].length; x++) {
			if (piece[y][x]) {
				const boardX = position.x + x;
				const boardY = position.y + y;

				// Check boundaries
				if (boardX < 0 || boardX >= 10 || boardY >= 20) {
					return false;
				}

				// Check collision with existing pieces (only if within board)
				if (boardY >= 0 && gameState.board[boardY][boardX]) {
					return false;
				}
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

				if (boardY >= 0) {
					gameState.board[boardY][boardX] = currentPiece.type;
				}
			}
		}
	}
};

const clearLines = () => {
	let linesCleared = 0;

	for (let y = gameState.board.length - 1; y >= 0; y--) {
		if (gameState.board[y].every(cell => cell !== 0)) {
			// Remove the completed line
			gameState.board.splice(y, 1);
			// Add a new empty line at the top
			gameState.board.unshift(Array(10).fill(0));
			linesCleared++;
			y++; // Check the same row again since we removed a line
		}
	}

	if (linesCleared > 0) {
		gameState.lines += linesCleared;
		gameState.score += getLineScore(linesCleared) * gameState.level;
		gameState.level = Math.floor(gameState.lines / 10) + 1;
	}
};

const getLineScore = (lines) => {
	const scores = [0, 100, 300, 500, 800]; // 0, 1, 2, 3, 4 lines
	return scores[lines] || 800;
};

const gameOver = () => {
	isRunning = false;
	gameState.gameOver = true;
	clearInterval(gameInterval);
	runtime.log('[Tetris] Game Over! Score:', gameState.score);
};

export const toggleAI = async () => {
	gameState.aiMode = !gameState.aiMode;
	gameState.aiStatus = gameState.aiMode ? "AI Mode" : "Human Control";

	if (!gameState.aiMode) {
		// Stop any current AI processing
		gameState.aiProcessing = false;
		gameState.currentMoveSequence = [];
		isRunning = true;
	} else if (!gameState.aiProcessing && isRunning) {
		// Start AI for current piece if we just enabled AI mode
		await triggerAI();
	}

	await renderGame();
};

export const getAIMove = async () => {
	const prompt = buildAIPrompt();
	const systemPrompt = "You are a Tetris AI. Analyze the board and return optimal moves as a JSON array. Consider line clearing opportunities, stack height, and piece placement strategy.";

	const response = await runtime.call('inference.prompt', {
		query: prompt,
		systemPrompt
	});

	return parseAIResponse(response);
};

const buildAIPrompt = () => {
	const { board, currentPiece, currentPosition, nextPiece } = gameState;

	return `Current Tetris game state:
  
  Board (20 rows x 10 columns, 0=empty, letters=placed pieces):
  ${board.map((row, i) => `${i.toString().padStart(2)}: [${row.map(cell => cell || '·').join(',')}]`).join('\n')}
  
  Current piece: ${currentPiece.type} at position (${currentPosition.x}, ${currentPosition.y}), rotation ${currentPiece.rotation}
  Next piece: ${nextPiece.type}
  
  Current score: ${gameState.score}
  Lines cleared: ${gameState.lines}
  
  Valid moves: "left", "right", "down", "rotate", "drop"
  
  Instructions:
  - "left"/"right": Move piece horizontally
  - "down": Move piece down one row (faster than waiting)
  - "rotate": Rotate piece clockwise
  - "drop": Hard drop piece to bottom
  
  Strategy goals:
  1. Clear complete lines when possible (prioritize multiple lines)
  2. Keep stack height low
  3. Avoid creating holes and overhangs
  4. Consider upcoming piece for setup
  
  Return a JSON array of moves to optimally place the current piece:
  Example: ["left", "rotate", "drop"]
  Maximum 20 moves per sequence.`;
};

const parseAIResponse = (response) => {
	try {
		// Extract JSON from response
		const jsonMatch = response.match(/\[[\s\S]*?\]/);
		if (jsonMatch) {
			const moves = JSON.parse(jsonMatch[0]);

			// Validate moves
			const validMoves = ['left', 'right', 'down', 'rotate', 'drop'];
			const filteredMoves = moves.filter(move => validMoves.includes(move));

			// Limit to reasonable number of moves
			return filteredMoves.slice(0, 20);
		}

		// Fallback: random valid moves
		runtime.logError('[Tetris] Could not parse AI response, using fallback');
		return ['drop']; // Safe fallback

	} catch (error) {
		runtime.logError('[Tetris] AI parsing error:', error);
		return ['drop']; // Safe fallback
	}
};

const executeAIMoves = async () => {
	const moves = [...gameState.currentMoveSequence];

	for (let i = 0; i < moves.length; i++) {
		// Check for human override
		if (gameState.humanOverride) {
			runtime.log('[Tetris] Human override detected, stopping AI moves');
			gameState.aiStatus = "Human Override";
			return;
		}

		// Check if game is still running
		if (!isRunning || gameState.gameOver) {
			return;
		}

		const move = moves[i];
		await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay for visibility

		const success = await makeMove(move);
		if (!success && move !== 'down') {
			// Move failed (except down, which is expected when piece locks)
			runtime.log(`[Tetris] AI move "${move}" failed, continuing sequence`);
		}

		// If piece locked (down move failed), stop sequence
		if (move === 'down' && !success) {
			break;
		}

		await renderGame();
	}

	gameState.currentMoveSequence = [];
	gameState.aiStatus = gameState.aiMode ? "AI Mode" : "Human Control";
};

const triggerAI = async () => {
	gameState.aiProcessing = true;
	gameState.aiStatus = "AI Thinking...";
	isRunning = false; // Pause game while AI thinks

	await renderGame();

	try {
		const moves = await getAIMove();
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

export const getGameState = async () => ({ ...gameState });

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
						innerHTML: `
				<div><strong>Score:</strong> ${gameState?.score || 0}</div>
				<div><strong>Lines:</strong> ${gameState?.lines || 0}</div>
				<div><strong>Level:</strong> ${gameState?.level || 1}</div>
			  `
					},
					"next-piece": {
						tag: "div",
						style: "background: #222; padding: 10px; border-radius: 5px;",
						innerHTML: `<div><strong>Next:</strong></div>${createNextPieceElement()}`
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
					innerHTML: `<div><strong>GAME OVER</strong></div><div>Final Score: ${gameState.score}</div>`
				}
			})
		}
	};

	await runtime.call('ui.renderTree', tree);
};

const createBoardElement = () => {
	if (!gameState) return { tag: "div" };

	// Create a visual representation of the board with current piece
	const visualBoard = gameState.board.map(row => [...row]);

	// Add the current piece to the visual board
	if (gameState.currentPiece) {
		const piece = PIECES[gameState.currentPiece.type][gameState.currentPiece.rotation];
		const { x: px, y: py } = gameState.currentPosition;

		for (let y = 0; y < piece.length; y++) {
			for (let x = 0; x < piece[y].length; x++) {
				if (piece[y][x]) {
					const boardX = px + x;
					const boardY = py + y;

					if (boardY >= 0 && boardY < 20 && boardX >= 0 && boardX < 10) {
						visualBoard[boardY][boardX] = `current_${gameState.currentPiece.type}`;
					}
				}
			}
		}
	}

	return {
		tag: "div",
		style: "display: grid; grid-template-columns: repeat(10, 25px); grid-template-rows: repeat(20, 25px); gap: 1px; background: #333;",
		innerHTML: visualBoard.map(row =>
			row.map(cell => {
				const isCurrent = typeof cell === 'string' && cell.startsWith('current_');
				const pieceType = isCurrent ? cell.split('_')[1] : cell;
				const color = cell ? PIECE_COLORS[pieceType] || '#666' : '#000';
				const border = isCurrent ? '2px solid #fff' : '1px solid #444';

				return `<div style="width: 25px; height: 25px; background: ${color}; border: ${border};"></div>`;
			}).join('')
		).join('')
	};
};

const createNextPieceElement = () => {
	if (!gameState?.nextPiece) return '';

	const piece = PIECES[gameState.nextPiece.type][0]; // Always show first rotation
	const color = PIECE_COLORS[gameState.nextPiece.type];

	return `
	  <div style="display: grid; grid-template-columns: repeat(4, 15px); grid-template-rows: repeat(4, 15px); gap: 1px; margin-top: 5px;">
		${Array(4).fill().map((_, y) =>
		Array(4).fill().map((_, x) => {
			const hasBlock = piece[y] && piece[y][x];
			const cellColor = hasBlock ? color : 'transparent';
			return `<div style="width: 15px; height: 15px; background: ${cellColor}; border: 1px solid #555;"></div>`;
		}).join('')
	).join('')}
	  </div>
	`;
};

// Testing
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;

	return [
		await runUnitTest("Initialize game creates valid board", async () => {
			initializeGame();
			const actual = {
				boardHeight: gameState.board.length,
				boardWidth: gameState.board[0].length,
				hasCurrentPiece: !!gameState.currentPiece,
				hasNextPiece: !!gameState.nextPiece,
				initialScore: gameState.score
			};
			const expected = {
				boardHeight: 20,
				boardWidth: 10,
				hasCurrentPiece: true,
				hasNextPiece: true,
				initialScore: 0
			};
			return { actual, assert: deepEqual, expected };
		}),

		await runUnitTest("Piece movement validation works", async () => {
			initializeGame();
			gameState.currentPiece = { type: 'I', rotation: 0 };
			gameState.currentPosition = { x: 0, y: 0 };

			const actual = {
				canMoveRight: isValidPosition('I', 0, { x: 1, y: 0 }),
				cannotMoveLeft: !isValidPosition('I', 0, { x: -1, y: 0 }),
				canMoveDown: isValidPosition('I', 0, { x: 0, y: 1 })
			};
			const expected = {
				canMoveRight: true,
				cannotMoveLeft: true,
				canMoveDown: true
			};
			return { actual, assert: deepEqual, expected };
		}),

		await runUnitTest("Line clearing works correctly", async () => {
			initializeGame();
			// Create a full line at the bottom
			gameState.board[19] = Array(10).fill('I');
			const linesBefore = gameState.lines;
			const scoreBefore = gameState.score;

			clearLines();

			const actual = {
				linesIncreased: gameState.lines > linesBefore,
				scoreIncreased: gameState.score > scoreBefore,
				bottomLineEmpty: gameState.board[19].every(cell => cell === 0)
			};
			const expected = {
				linesIncreased: true,
				scoreIncreased: true,
				bottomLineEmpty: true
			};
			return { actual, assert: deepEqual, expected };
		})
	];
};