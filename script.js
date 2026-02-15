// ============================================
// Game State & Configuration
// ============================================

const SudokuGame = {
    // Current game state
    board: [],           // Current board state (what user sees)
    solution: [],        // Complete solution
    initial: [],         // Initial fixed numbers
    notes: [],           // Notes for each cell (array of sets)
    history: [],         // Undo history

    // Game settings
    selectedCell: null,
    pencilMode: false,
    difficulty: 'medium',

    // Timer
    timerInterval: null,
    elapsedSeconds: 0,
    isPlaying: false,

    // Points system
    currentScore: 0,
    hintsUsed: 0,
    mistakesMade: 0,

    // Settings (from localStorage)
    settings: {
        showConflicts: true,
        highlightSame: true,
        highlightArea: true,
        autoRemoveNotes: true,
        validateSolution: true, // Default: validate against solution
        showHints: false, // Default: hints disabled
        theme: 'light'
    },

    // Statistics with points
    stats: {
        medium: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
        hard: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
        expert: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
        master: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
        extreme: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 }
    },

    // Difficulty settings (technique-based)
    difficultyConfig: {
        medium: { minRemove: 45, maxRemove: 49, maxLevel: 2, name: 'Medio', basePoints: 200, timeBonus: 1000 },
        hard: { minRemove: 48, maxRemove: 53, maxLevel: 3, name: 'Difícil', basePoints: 400, timeBonus: 2000 },
        expert: { minRemove: 50, maxRemove: 55, maxLevel: 4, name: 'Experto', basePoints: 800, timeBonus: 4000 },
        master: { minRemove: 53, maxRemove: 58, maxLevel: 5, name: 'Maestro', basePoints: 1200, timeBonus: 6000 },
        extreme: { minRemove: 55, maxRemove: 64, maxLevel: 7, name: 'Extremo', basePoints: 1600, timeBonus: 8000 }
    },

    // Points configuration
    pointsConfig: {
        correctNumber: 10,        // Points per correct number
        hintPenalty: -50,         // Penalty for using hint
        mistakePenalty: -5,       // Penalty per mistake
        timeBonusThreshold: 300,  // 5 minutes threshold for time bonus
        streakBonus: 5            // Extra points per streak
    }
};

// ============================================
// Initialization
// ============================================

/**
 * Initialize the game when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadStats();
    createBoard();
    setupEventListeners();
    loadGameState();
    updateScoreDisplay();
    updateGameInfo();

    // Start background puzzle generation
    initPuzzleWorker();

    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => console.log('Service Worker registered:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
});

// ============================================
// Puzzle Pool — Web Worker background generation
// ============================================

const puzzlePool = {};
let puzzleWorker = null;

/** Initialize the Web Worker and start pre-generating puzzles. */
function initPuzzleWorker() {
    try {
        puzzleWorker = new Worker('puzzle-worker.js');
        puzzleWorker.onmessage = function (e) {
            const { type, difficulty, puzzle, solution, analysis } = e.data;
            if (type === 'result') {
                if (!puzzlePool[difficulty]) puzzlePool[difficulty] = [];
                puzzlePool[difficulty].push({ puzzle, solution, analysis });
                savePool(); // Save to localStorage
                console.log(
                    `[DiverSoku] Pool: ${difficulty} listo ` +
                    `(${puzzlePool[difficulty].length} en pool, ` +
                    `nivel ${analysis.maxLevel}, ` +
                    `técnicas: [${analysis.techniquesUsed.join(', ')}])`
                );
                // Keep pool stocked: maintain 2 puzzles per difficulty
                replenishPool(difficulty);

                // If pool is full, maybe hunt for special techniques?
                checkAndHuntSwordfish(difficulty);
            }
        };
        puzzleWorker.onerror = function (err) {
            console.warn('[DiverSoku] Worker error:', err.message);
        };

        // Start by loading any saved pool from localStorage
        const savedPool = localStorage.getItem('diverSoku_pool');
        if (savedPool) {
            try {
                const parsed = JSON.parse(savedPool);
                // Merge saved pool into current (handling pot. new difficulties)
                for (const diff in parsed) {
                    if (SudokuGame.difficultyConfig[diff]) {
                        puzzlePool[diff] = parsed[diff];
                    }
                }
                console.log('[DiverSoku] Pool recuperado del disco:', puzzlePool);
            } catch (e) {
                console.warn('[DiverSoku] Error al cargar pool:', e);
            }
        }

        // Check which pools need replenishing (hardest first)
        const diffs = Object.keys(SudokuGame.difficultyConfig).reverse();
        for (const diff of diffs) {
            if (!puzzlePool[diff]) puzzlePool[diff] = [];
            // If empty or low, request more
            if (puzzlePool[diff].length < 2) {
                requestPuzzleFromWorker(diff);
            } else {
                checkAndHuntSwordfish(diff);
            }
        }
    } catch (err) {
        console.warn('[DiverSoku] Web Worker no disponible:', err.message);
        puzzleWorker = null;
    }
}

/** Request one puzzle from the Worker. */
function requestPuzzleFromWorker(difficulty, options = {}) {
    if (!puzzleWorker) return;
    const config = SudokuGame.difficultyConfig[difficulty];
    puzzleWorker.postMessage({
        type: 'generate',
        difficulty,
        config: {
            minRemove: config.minRemove,
            maxRemove: config.maxRemove,
            maxLevel: config.maxLevel,
            requiredTechnique: options.requiredTechnique // Pass requirement
        }
    });
}

function checkAndHuntSwordfish(difficulty) {
    // Only hunt in Extreme/Master and if pool is healthy
    if (difficulty !== 'extreme' && difficulty !== 'master') return;
    if (!puzzlePool[difficulty] || puzzlePool[difficulty].length < 2) return;

    // - Extreme: Hunt for Swordfish (or XY-Wing, but Swordfish is rarer)
    // - Master: Hunt for Unique Rectangle (since X-Wing is common)

    let targetTech = '';
    if (difficulty === 'extreme') targetTech = 'Swordfish';
    if (difficulty === 'master') {
        // Alternate between UR and Skyscraper to fill pool faster and with variety
        // Pick random one for this request
        targetTech = Math.random() > 0.5 ? 'Unique Rectangle' : 'Skyscraper';
    }

    // Check if we already have it
    // Actually, for master we just want *any* special tech if we are low on them?
    // Or just hunt for what's missing?
    // Let's keep it simple: Hunt for what we selected essentially.

    // But better logic: Check what is missing from pool!
    if (difficulty === 'master') {
        const hasUR = puzzlePool[difficulty].some(p => p.analysis.techniquesUsed.includes('Unique Rectangle'));
        const hasSky = puzzlePool[difficulty].some(p => p.analysis.techniquesUsed.includes('Skyscraper'));

        if (!hasUR) targetTech = 'Unique Rectangle';
        else if (!hasSky) targetTech = 'Skyscraper';
        else return; // We have both, no need to hunt specific
    }

    const hasTechnique = puzzlePool[difficulty].some(p =>
        p.analysis && p.analysis.techniquesUsed && p.analysis.techniquesUsed.includes(targetTech)
    );

    if (!hasTechnique) {
        // Limit pool size to avoidance memory/spam issues, but keep trying if missing technique
        if (puzzlePool[difficulty].length < 10) {
            console.log(`[DiverSoku] Buscando especial para ${difficulty}: ${targetTech}....`);
            requestPuzzleFromWorker(difficulty, { requiredTechnique: targetTech });
        }
    }
}

/** Refill pool if below threshold. */
function replenishPool(difficulty) {
    if (!puzzlePool[difficulty]) puzzlePool[difficulty] = [];
    if (puzzlePool[difficulty].length < 2) {
        requestPuzzleFromWorker(difficulty);
    }
}

// ============================================
// Puzzle Generation (pool-first, async fallback)
// ============================================

/** Show/hide loading overlay */
function showLoading(show, message) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    if (show) {
        const msgEl = overlay.querySelector('.loading-message');
        if (msgEl && message) msgEl.textContent = message;
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

/**
 * Yield to the browser event loop (prevents UI freeze).
 */
function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Get a puzzle — tries pool first (instant), falls back to async generation.
 * @param {string} difficulty
 * @returns {Promise<{puzzle: number[][], solution: number[][]}>}
 */
async function generatePuzzle(difficulty) {
    // Try pool first (instant!)
    if (puzzlePool[difficulty] && puzzlePool[difficulty].length > 0) {
        const cached = puzzlePool[difficulty].shift();
        savePool(); // Save updated pool state
        console.log(`[DiverSoku] Puzzle desde pool (instantáneo) — ${difficulty}`);
        // Immediately request a replacement
        replenishPool(difficulty);
        checkAndHuntSwordfish(difficulty);
        return cached;
    }

    // Pool empty — generate synchronously with async yields
    console.log(`[DiverSoku] Pool vacío para ${difficulty}, generando en hilo principal...`);
    const config = SudokuGame.difficultyConfig[difficulty];

    // Give more time/attempts for harder levels
    const isHard = ['master', 'extreme', 'expert'].includes(difficulty);
    const maxAttempts = isHard ? 1000 : 50;
    const timeBudgetMs = isHard ? 45000 : 5000;
    const startTime = Date.now();

    let bestResult = null;
    let bestScore = -1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Check timeout
        if (Date.now() - startTime > timeBudgetMs) {
            // If we have a decent fallback, stop. If not, try a bit longer for high diffs.
            if (bestScore >= (isHard ? 3 : 1)) break;
            if (Date.now() - startTime > timeBudgetMs * 1.5) break; // Hard limit
        }

        if (attempt > 0 && attempt % 2 === 0) await yieldToBrowser();

        const result = generatePuzzleAttempt(config);
        if (!result || !result.analysis.solved) continue;

        // Exact match found? Return immediately
        if (isLevelMatch(result.analysis, config)) {
            console.log(
                `[DiverSoku] Puzzle generado (intento ${attempt + 1}, ` +
                `${Date.now() - startTime}ms): ` +
                `${81 - result.removed} pistas, nivel ${result.analysis.maxLevel}, ` +
                `técnicas: [${result.analysis.techniquesUsed.join(', ')}]`
            );
            replenishPool(difficulty);
            return { puzzle: result.puzzle, solution: result.solution };
        }

        // Keep track of the "best" puzzle found so far (closest to target level)
        // For Extreme (7), a level 5 is better than level 2.
        const level = result.analysis.maxLevel;
        // Penalize if level is too high (unlikely) or too low
        let score = level;
        if (level > config.maxLevel) score = -1; // Too hard (shouldn't happen with current logic)

        if (score > bestScore) {
            bestScore = score;
            bestResult = result;
        }
    }

    if (bestResult) {
        console.warn(
            `[DiverSoku] Mejor puzzle encontrado: nivel ${bestResult.analysis.maxLevel}`
        );
        replenishPool(difficulty);
        return { puzzle: bestResult.puzzle, solution: bestResult.solution };
    }

    // Last resort
    console.warn('[DiverSoku] Fallback: generación simple.');
    const solution = generateSolution();
    const puzzle = solution.map(row => [...row]);
    const positions = [];
    for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++)
            positions.push([r, c]);
    shuffleArray(positions);
    let removed = 0;
    for (const [row, col] of positions) {
        if (removed >= config.minRemove) break;
        const backup = puzzle[row][col];
        puzzle[row][col] = 0;
        if (countSolutions(puzzle) === 1) removed++;
        else puzzle[row][col] = backup;
    }
    replenishPool(difficulty);
    return { puzzle, solution };
}

/** Save the current pool to localStorage */
function savePool() {
    try {
        localStorage.setItem('diverSoku_pool', JSON.stringify(puzzlePool));
    } catch (e) {
        console.warn('[DiverSoku] No se pudo guardar el pool:', e);
    }
}

// ============================================
// Points System
// ============================================

/**
 * Calculate points for placing a correct number
 * @param {boolean} isCorrect - Whether the placement was correct
 * @returns {number} Points earned (negative if wrong)
 */
function calculatePlacementPoints(isCorrect) {
    if (isCorrect) {
        return SudokuGame.pointsConfig.correctNumber;
    } else {
        SudokuGame.mistakesMade++;
        return SudokuGame.pointsConfig.mistakePenalty;
    }
}

/**
 * Calculate final score including time bonus
 * @returns {number} Final score
 */
function calculateFinalScore() {
    const config = SudokuGame.difficultyConfig[SudokuGame.difficulty];
    let score = SudokuGame.currentScore;

    // Add base points for completion
    score += config.basePoints;

    // Time bonus (if completed under threshold)
    const threshold = SudokuGame.pointsConfig.timeBonusThreshold;
    if (SudokuGame.elapsedSeconds < threshold) {
        const timeRatio = 1 - (SudokuGame.elapsedSeconds / threshold);
        score += Math.floor(config.timeBonus * timeRatio);
    }

    // Penalty for hints used
    score += SudokuGame.hintsUsed * SudokuGame.pointsConfig.hintPenalty;

    // Ensure minimum score of 0
    return Math.max(0, score);
}

/**
 * Add points and update display
 * @param {number} points - Points to add (can be negative)
 */
function addPoints(points) {
    SudokuGame.currentScore = Math.max(0, SudokuGame.currentScore + points);
    updateScoreDisplay();
}

/**
 * Update the score display in the header
 */
function updateScoreDisplay() {
    const scoreElement = document.getElementById('current-score');
    if (scoreElement) {
        scoreElement.textContent = SudokuGame.currentScore.toLocaleString();
    }
    updateGameInfo();
}

/**
 * Update the game info bar (Difficulty, Best Time, Best Score)
 */
function updateGameInfo() {
    const difficultyDisplay = document.getElementById('current-difficulty');
    const bestTimeDisplay = document.getElementById('best-time');
    const bestScoreDisplay = document.getElementById('best-score');

    if (difficultyDisplay) {
        difficultyDisplay.textContent = SudokuGame.difficultyConfig[SudokuGame.difficulty].name;
    }

    if (bestTimeDisplay && bestScoreDisplay) {
        const stats = SudokuGame.stats[SudokuGame.difficulty];

        // Best Time
        if (stats.bestTime === null) {
            bestTimeDisplay.textContent = '-';
        } else {
            const minutes = Math.floor(stats.bestTime / 60);
            const seconds = stats.bestTime % 60;
            bestTimeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        // Best Score
        bestScoreDisplay.textContent = stats.bestScore > 0 ? stats.bestScore.toLocaleString() : '-';
    }
}

// ============================================
// Board UI Creation
// ============================================

/**
 * Create the visual board in the DOM with 3x3 box structure
 */
function createBoard() {
    const boardElement = document.getElementById('sudoku-board');
    boardElement.innerHTML = '';

    // Create 9 boxes (3x3 grid of boxes)
    for (let boxIndex = 0; boxIndex < 9; boxIndex++) {
        const box = document.createElement('div');
        box.className = 'sudoku-box';

        // Calculate the starting row and column for this box
        const boxStartRow = Math.floor(boxIndex / 3) * 3;
        const boxStartCol = (boxIndex % 3) * 3;

        // Create 9 cells within each box
        for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
            const row = boxStartRow + Math.floor(cellIndex / 3);
            const col = boxStartCol + (cellIndex % 3);

            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.tabIndex = 0;

            // Inner container for value or notes
            cell.innerHTML = '<div class="cell-value"></div>';

            box.appendChild(cell);
        }

        boardElement.appendChild(box);
    }
}

/**
 * Render the current board state to the DOM
 */
function renderBoard() {
    const cells = document.querySelectorAll('.cell');
    const numberCount = new Map();

    // Count numbers for completed detection
    for (let i = 1; i <= 9; i++) numberCount.set(i, 0);

    cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        const value = SudokuGame.board[row][col];
        const isFixed = SudokuGame.initial[row][col] !== 0;
        const notes = SudokuGame.notes[row * 9 + col];

        // Clear previous classes
        cell.classList.remove('fixed', 'user-input', 'conflict', 'wrong');

        if (value !== 0) {
            // Show value
            cell.innerHTML = `<div class="cell-value">${value}</div>`;
            cell.classList.add(isFixed ? 'fixed' : 'user-input');
            numberCount.set(value, (numberCount.get(value) || 0) + 1);

            if (!isFixed) {
                // Check for conflicts (duplicates in row/col/box)
                if (SudokuGame.settings.showConflicts && hasConflict(row, col, value)) {
                    cell.classList.add('conflict');
                }

                // Validate against solution
                if (SudokuGame.settings.validateSolution && SudokuGame.solution[row] && SudokuGame.solution[row][col] !== value) {
                    cell.classList.add('wrong');
                }
            }
        } else if (notes && notes.size > 0) {
            // Show notes
            let notesHtml = '<div class="cell-notes">';
            for (let n = 1; n <= 9; n++) {
                notesHtml += `<div class="cell-note">${notes.has(n) ? n : ''}</div>`;
            }
            notesHtml += '</div>';
            cell.innerHTML = notesHtml;
        } else {
            cell.innerHTML = '<div class="cell-value"></div>';
        }
    });

    // Update number pad completed state
    document.querySelectorAll('.num-btn').forEach(btn => {
        const num = parseInt(btn.dataset.number);
        btn.classList.toggle('completed', numberCount.get(num) >= 9);
    });

    updateHighlights();
}

/**
 * Check if placing a number at position creates a conflict
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} num - Number to check
 * @returns {boolean} True if there's a conflict
 */
function hasConflict(row, col, num) {
    // Check row
    for (let c = 0; c < 9; c++) {
        if (c !== col && SudokuGame.board[row][c] === num) return true;
    }

    // Check column
    for (let r = 0; r < 9; r++) {
        if (r !== row && SudokuGame.board[r][col] === num) return true;
    }

    // Check 3x3 box
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
        for (let c = boxCol; c < boxCol + 3; c++) {
            if ((r !== row || c !== col) && SudokuGame.board[r][c] === num) return true;
        }
    }

    return false;
}

/**
 * Update cell highlighting based on selection
 */
function updateHighlights() {
    const cells = document.querySelectorAll('.cell');

    cells.forEach(cell => {
        cell.classList.remove('selected', 'highlighted', 'same-number');
    });

    if (!SudokuGame.selectedCell) return;

    const [selRow, selCol] = SudokuGame.selectedCell;
    const selectedValue = SudokuGame.board[selRow][selCol];
    const boxRow = Math.floor(selRow / 3) * 3;
    const boxCol = Math.floor(selCol / 3) * 3;

    cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        const value = SudokuGame.board[row][col];

        // Highlight same numbers
        if (SudokuGame.settings.highlightSame && selectedValue !== 0 && value === selectedValue) {
            cell.classList.add('same-number');
        }

        // Highlight row, column, and box
        if (SudokuGame.settings.highlightArea) {
            if (row === selRow || col === selCol ||
                (row >= boxRow && row < boxRow + 3 && col >= boxCol && col < boxCol + 3)) {
                cell.classList.add('highlighted');
            }
        }

        // Selected cell
        if (row === selRow && col === selCol) {
            cell.classList.add('selected');
            cell.classList.remove('highlighted');
        }
    });
}

// ============================================
// Game Actions
// ============================================

/**
 * Start a new game with the given difficulty (async with loading indicator)
 * @param {string} difficulty - Difficulty level
 */
async function startNewGame(difficulty) {
    SudokuGame.difficulty = difficulty;
    closeModal('new-game-modal');

    // Check if pool has a puzzle ready (instant!) or needs generation
    const hasPooled = puzzlePool[difficulty] && puzzlePool[difficulty].length > 0;

    if (!hasPooled) {
        const diffName = SudokuGame.difficultyConfig[difficulty].name;
        showLoading(true, `Generando puzzle (${diffName})...`);
        await yieldToBrowser();
    }

    const { puzzle, solution } = await generatePuzzle(difficulty);

    showLoading(false);

    SudokuGame.board = puzzle.map(row => [...row]);
    SudokuGame.solution = solution;
    SudokuGame.initial = puzzle.map(row => [...row]);
    SudokuGame.notes = Array(81).fill(null).map(() => new Set());
    SudokuGame.history = [];
    SudokuGame.selectedCell = null;
    SudokuGame.pencilMode = false;
    SudokuGame.elapsedSeconds = 0;
    SudokuGame.isPlaying = true;

    // Reset points for new game
    SudokuGame.currentScore = 0;
    SudokuGame.hintsUsed = 0;
    SudokuGame.mistakesMade = 0;

    // Update stats
    SudokuGame.stats[difficulty].played++;
    saveStats();

    // Update UI
    document.getElementById('pencil-btn').classList.remove('active');
    document.getElementById('auto-notes-btn')?.classList.remove('active');
    updateTimerDisplay();
    updateScoreDisplay();
    startTimer();
    renderBoard();
    saveGameState();
}

/**
 * Place a number in the selected cell
 * @param {number} num - Number to place (1-9)
 */
function placeNumber(num) {
    if (!SudokuGame.selectedCell || !SudokuGame.isPlaying) return;

    const [row, col] = SudokuGame.selectedCell;

    // Can't modify fixed cells
    if (SudokuGame.initial[row][col] !== 0) return;

    if (SudokuGame.pencilMode) {
        // Toggle note
        const noteIndex = row * 9 + col;
        const notes = SudokuGame.notes[noteIndex];

        // Save history
        saveHistory(row, col, 0, new Set(notes));

        if (notes.has(num)) {
            notes.delete(num);
        } else {
            notes.add(num);
        }

        // Clear value when adding notes
        if (SudokuGame.board[row][col] !== 0) {
            SudokuGame.board[row][col] = 0;
        }
    } else {
        const oldValue = SudokuGame.board[row][col];
        const oldNotes = new Set(SudokuGame.notes[row * 9 + col]);

        // Save history
        saveHistory(row, col, oldValue, oldNotes);

        // Check if correct before placing
        const isCorrect = SudokuGame.solution[row][col] === num;

        // Place number
        SudokuGame.board[row][col] = num;
        SudokuGame.notes[row * 9 + col].clear();

        // Award or deduct points
        if (oldValue === 0) { // Only score new placements
            const points = calculatePlacementPoints(isCorrect);
            addPoints(points);
        }

        // Auto-remove notes in related cells
        if (SudokuGame.settings.autoRemoveNotes) {
            removeRelatedNotes(row, col, num);
        }

        // Check for victory
        if (checkVictory()) {
            handleVictory();
        }
    }

    renderBoard();
    saveGameState();
}

/**
 * Erase the selected cell
 */
function eraseCell() {
    if (!SudokuGame.selectedCell || !SudokuGame.isPlaying) return;

    const [row, col] = SudokuGame.selectedCell;

    // Can't modify fixed cells
    if (SudokuGame.initial[row][col] !== 0) return;

    const noteIndex = row * 9 + col;
    const oldValue = SudokuGame.board[row][col];
    const oldNotes = new Set(SudokuGame.notes[noteIndex]);

    // Save history
    if (oldValue !== 0 || oldNotes.size > 0) {
        saveHistory(row, col, oldValue, oldNotes);
    }

    SudokuGame.board[row][col] = 0;
    SudokuGame.notes[noteIndex].clear();

    renderBoard();
    saveGameState();
}

/**
 * Remove notes of a number from related cells (row, column, box)
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} num - Number to remove from notes
 */
function removeRelatedNotes(row, col, num) {
    // Row
    for (let c = 0; c < 9; c++) {
        SudokuGame.notes[row * 9 + c].delete(num);
    }

    // Column
    for (let r = 0; r < 9; r++) {
        SudokuGame.notes[r * 9 + col].delete(num);
    }

    // Box
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
        for (let c = boxCol; c < boxCol + 3; c++) {
            SudokuGame.notes[r * 9 + c].delete(num);
        }
    }
}

/**
 * Save action to history for undo
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} value - Previous value
 * @param {Set} notes - Previous notes
 */
function saveHistory(row, col, value, notes) {
    SudokuGame.history.push({
        row,
        col,
        value,
        notes: new Set(notes)
    });

    // Limit history size
    if (SudokuGame.history.length > 100) {
        SudokuGame.history.shift();
    }
}

/**
 * Undo the last action
 */
function undo() {
    if (SudokuGame.history.length === 0 || !SudokuGame.isPlaying) return;

    const action = SudokuGame.history.pop();
    const { row, col, value, notes } = action;

    SudokuGame.board[row][col] = value;
    SudokuGame.notes[row * 9 + col] = new Set(notes);

    SudokuGame.selectedCell = [row, col];

    renderBoard();
    saveGameState();
}

/**
 * Give a hint by revealing a random empty cell
 */
function giveHint() {
    if (!SudokuGame.isPlaying) return;

    // Find all empty cells
    const emptyCells = [];
    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
            if (SudokuGame.board[row][col] === 0) {
                emptyCells.push([row, col]);
            }
        }
    }

    if (emptyCells.length === 0) return;

    // Pick a random empty cell
    const [row, col] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const correctValue = SudokuGame.solution[row][col];

    // Save history
    const noteIndex = row * 9 + col;
    saveHistory(row, col, 0, new Set(SudokuGame.notes[noteIndex]));

    // Place the correct value
    SudokuGame.board[row][col] = correctValue;
    SudokuGame.notes[noteIndex].clear();

    // Auto-remove related notes
    if (SudokuGame.settings.autoRemoveNotes) {
        removeRelatedNotes(row, col, correctValue);
    }

    SudokuGame.selectedCell = [row, col];

    // Apply hint penalty
    SudokuGame.hintsUsed++;
    addPoints(SudokuGame.pointsConfig.hintPenalty);

    // Add 30 seconds as additional penalty
    SudokuGame.elapsedSeconds += 30;
    updateTimerDisplay();

    renderBoard();
    saveGameState();

    // Check for victory
    if (checkVictory()) {
        handleVictory();
    }
}

/**
 * Toggle pencil/notes mode
 */
function togglePencilMode() {
    SudokuGame.pencilMode = !SudokuGame.pencilMode;
    document.getElementById('pencil-btn').classList.toggle('active', SudokuGame.pencilMode);
}

/**
 * Auto-fill candidates (notes) for all empty cells based on current board state.
 * Uses getCandidates from sudoku-engine.js.
 */
function fillAutoCandidates() {
    if (!SudokuGame.isPlaying) return;

    const cands = getCandidates(SudokuGame.board);
    let filled = 0;

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const idx = r * 9 + c;
            if (SudokuGame.board[r][c] !== 0) continue;
            if (cands[r][c].size === 0) continue;

            // Replace existing notes with computed candidates
            SudokuGame.notes[idx] = new Set(cands[r][c]);
            filled++;
        }
    }

    if (filled > 0) {
        renderBoard();
        saveGameState();
        const btn = document.getElementById('auto-notes-btn');
        if (btn) {
            btn.classList.add('active');
            setTimeout(() => btn.classList.remove('active'), 600);
        }
    }
}

/**
 * Check if the puzzle is completed correctly
 * @returns {boolean} True if puzzle is solved
 */
function checkVictory() {
    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
            if (SudokuGame.board[row][col] !== SudokuGame.solution[row][col]) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Handle victory state
 */
function handleVictory() {
    SudokuGame.isPlaying = false;
    stopTimer();

    // Calculate final score
    const finalScore = calculateFinalScore();
    SudokuGame.currentScore = finalScore;
    updateScoreDisplay();

    // Update stats
    const difficulty = SudokuGame.difficulty;
    const stats = SudokuGame.stats[difficulty];
    stats.won++;
    stats.totalScore += finalScore;

    // Check for new records
    let isNewTimeRecord = false;
    let isNewScoreRecord = false;

    if (stats.bestTime === null || SudokuGame.elapsedSeconds < stats.bestTime) {
        stats.bestTime = SudokuGame.elapsedSeconds;
        isNewTimeRecord = true;
    }

    if (finalScore > stats.bestScore) {
        stats.bestScore = finalScore;
        isNewScoreRecord = true;
    }

    saveStats();

    // Clear saved game
    localStorage.removeItem('sudoku_gameState');

    // Show victory modal
    document.getElementById('victory-score').textContent = finalScore.toLocaleString();
    document.getElementById('victory-time').textContent = formatTime(SudokuGame.elapsedSeconds);
    document.getElementById('victory-difficulty').textContent =
        SudokuGame.difficultyConfig[difficulty].name;

    // Show record badge if new record
    const recordElement = document.getElementById('victory-record');
    if (isNewScoreRecord || isNewTimeRecord) {
        recordElement.style.display = 'block';
    } else {
        recordElement.style.display = 'none';
    }

    openModal('victory-modal');
}

// ============================================
// Timer Functions
// ============================================

/**
 * Start the game timer
 */
function startTimer() {
    stopTimer();
    SudokuGame.timerInterval = setInterval(() => {
        if (SudokuGame.isPlaying) {
            SudokuGame.elapsedSeconds++;
            updateTimerDisplay();

            // Save game state every 10 seconds
            if (SudokuGame.elapsedSeconds % 10 === 0) {
                saveGameState();
            }
        }
    }, 1000);
}

/**
 * Stop the game timer
 */
function stopTimer() {
    if (SudokuGame.timerInterval) {
        clearInterval(SudokuGame.timerInterval);
        SudokuGame.timerInterval = null;
    }
}

/**
 * Update the timer display
 */
function updateTimerDisplay() {
    document.getElementById('timer-display').textContent =
        formatTime(SudokuGame.elapsedSeconds);
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// Event Listeners
// ============================================

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Board cell clicks
    document.getElementById('sudoku-board').addEventListener('click', e => {
        const cell = e.target.closest('.cell');
        if (cell) {
            selectCell(parseInt(cell.dataset.row), parseInt(cell.dataset.col));
        }
    });

    // Number pad
    document.getElementById('number-pad').addEventListener('click', e => {
        const btn = e.target.closest('.num-btn');
        if (btn && !btn.classList.contains('completed')) {
            placeNumber(parseInt(btn.dataset.number));
        }
    });

    // Action buttons
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('erase-btn').addEventListener('click', eraseCell);
    document.getElementById('pencil-btn').addEventListener('click', togglePencilMode);
    document.getElementById('hint-btn').addEventListener('click', giveHint);
    document.getElementById('auto-notes-btn')?.addEventListener('click', fillAutoCandidates);

    // New game
    document.getElementById('new-game-btn').addEventListener('click', () => {
        openModal('new-game-modal');
    });

    // Difficulty selection
    document.querySelectorAll('.difficulty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            startNewGame(btn.dataset.difficulty);
        });
    });

    // Theme toggle in settings
    document.getElementById('theme-toggle-setting').addEventListener('change', () => {
        toggleTheme();
    });

    // Settings
    document.getElementById('settings-btn').addEventListener('click', () => {
        updateStatsDisplay();
        openModal('settings-modal');
    });

    // Settings toggles
    document.getElementById('show-conflicts').addEventListener('change', e => {
        SudokuGame.settings.showConflicts = e.target.checked;
        saveSettings();
        renderBoard();
    });

    document.getElementById('highlight-same').addEventListener('change', e => {
        SudokuGame.settings.highlightSame = e.target.checked;
        saveSettings();
        updateHighlights();
    });

    document.getElementById('highlight-area').addEventListener('change', e => {
        SudokuGame.settings.highlightArea = e.target.checked;
        saveSettings();
        updateHighlights();
    });

    document.getElementById('auto-remove-notes').addEventListener('change', e => {
        SudokuGame.settings.autoRemoveNotes = e.target.checked;
        saveSettings();
    });

    document.getElementById('validate-solution').addEventListener('change', e => {
        SudokuGame.settings.validateSolution = e.target.checked;
        saveSettings();
        renderBoard();
    });

    document.getElementById('enable-hints').addEventListener('change', e => {
        SudokuGame.settings.showHints = e.target.checked;
        saveSettings();
        toggleHintButton(SudokuGame.settings.showHints);
    });

    // Reset stats
    document.getElementById('reset-stats-btn').addEventListener('click', () => {
        if (confirm('¿Estás seguro de que deseas reiniciar las estadísticas?')) {
            SudokuGame.stats = {
                medium: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
                hard: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
                expert: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
                master: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 },
                extreme: { played: 0, won: 0, bestTime: null, bestScore: 0, totalScore: 0 }
            };
            saveStats();
            updateStatsDisplay();
        }
    });

    // Modal close buttons
    document.getElementById('close-new-game-modal').addEventListener('click', () => {
        closeModal('new-game-modal');
    });

    document.getElementById('close-settings-modal').addEventListener('click', () => {
        closeModal('settings-modal');
    });

    // Victory modal buttons
    document.getElementById('play-again-btn').addEventListener('click', () => {
        closeModal('victory-modal');
        openModal('new-game-modal');
    });

    document.getElementById('share-btn').addEventListener('click', shareResult);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });

    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboard);

    // Visibility change (pause timer when tab is hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            saveGameState();
        }
    });
}

/**
 * Select a cell on the board
 * @param {number} row - Row index
 * @param {number} col - Column index
 */
function selectCell(row, col) {
    SudokuGame.selectedCell = [row, col];
    updateHighlights();
}

/**
 * Handle keyboard input
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeyboard(e) {
    // Ignore if modal is open (except for escape)
    const modalOpen = document.querySelector('.modal-overlay.active');
    if (modalOpen && e.key !== 'Escape') {
        if (e.key === 'Escape') {
            closeModal(modalOpen.id);
        }
        return;
    }

    if (e.key === 'Escape') {
        if (modalOpen) {
            closeModal(modalOpen.id);
        }
        return;
    }

    // Number input (1-9)
    if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        placeNumber(parseInt(e.key));
        return;
    }

    // Arrow navigation
    if (SudokuGame.selectedCell) {
        let [row, col] = SudokuGame.selectedCell;
        let moved = false;

        switch (e.key) {
            case 'ArrowUp':
                if (row > 0) { row--; moved = true; }
                break;
            case 'ArrowDown':
                if (row < 8) { row++; moved = true; }
                break;
            case 'ArrowLeft':
                if (col > 0) { col--; moved = true; }
                break;
            case 'ArrowRight':
                if (col < 8) { col++; moved = true; }
                break;
        }

        if (moved) {
            e.preventDefault();
            selectCell(row, col);
        }
    }

    // Delete/Backspace to erase
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        eraseCell();
    }

    // P for pencil mode
    if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        togglePencilMode();
    }

    // Z for undo (Ctrl+Z or just Z)
    if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
    }

    // N for new game
    if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openModal('new-game-modal');
    }
}

// ============================================
// Modal Functions
// ============================================

/**
 * Open a modal by ID
 * @param {string} modalId - Modal element ID
 */
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Close a modal by ID
 * @param {string} modalId - Modal element ID
 */
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// Theme Functions
// ============================================

/**
 * Toggle between light and dark theme
 */
function toggleTheme() {
    const newTheme = SudokuGame.settings.theme === 'light' ? 'dark' : 'light';
    SudokuGame.settings.theme = newTheme;
    document.documentElement.dataset.theme = newTheme;

    // Update meta theme-color
    const themeColor = newTheme === 'dark' ? '#1e293b' : '#6366f1';
    document.querySelector('meta[name="theme-color"]').content = themeColor;

    saveSettings();
}

/**
 * Apply the saved theme
 */
function applyTheme() {
    document.documentElement.dataset.theme = SudokuGame.settings.theme;
    const themeColor = SudokuGame.settings.theme === 'dark' ? '#1e293b' : '#6366f1';
    document.querySelector('meta[name="theme-color"]').content = themeColor;
}

// ============================================
// Statistics Display
// ============================================

/**
 * Update the statistics display in settings modal
 */
function updateStatsDisplay() {
    const statsGrid = document.getElementById('stats-grid');
    const difficulties = ['medium', 'hard', 'expert', 'master', 'extreme'];
    const names = ['Medio', 'Difícil', 'Experto', 'Maestro', 'Extremo'];

    let html = '';

    // Games won per difficulty
    difficulties.forEach((diff, i) => {
        const stats = SudokuGame.stats[diff];
        html += `
            <div class="stat-card">
                <div class="stat-value">${stats.won}/${stats.played}</div>
                <div class="stat-label">${names[i]}</div>
            </div>
        `;
    });

    // Best scores per difficulty
    difficulties.forEach((diff, i) => {
        const stats = SudokuGame.stats[diff];
        const bestScore = stats.bestScore > 0 ? stats.bestScore.toLocaleString() : '-';
        html += `
            <div class="stat-card">
                <div class="stat-value">${bestScore}</div>
                <div class="stat-label">Récord ${names[i]}</div>
            </div>
        `;
    });

    // Best times per difficulty
    difficulties.forEach((diff, i) => {
        const stats = SudokuGame.stats[diff];
        const bestTime = stats.bestTime !== null ? formatTime(stats.bestTime) : '-';
        html += `
            <div class="stat-card">
                <div class="stat-value">${bestTime}</div>
                <div class="stat-label">Mejor T. ${names[i]}</div>
            </div>
        `;
    });

    // Total score
    const totalScore = difficulties.reduce((sum, diff) => sum + SudokuGame.stats[diff].totalScore, 0);
    html += `
        <div class="stat-card">
            <div class="stat-value">${totalScore.toLocaleString()}</div>
            <div class="stat-label">Puntos Totales</div>
        </div>
    `;

    // Total games won
    const totalWon = difficulties.reduce((sum, diff) => sum + SudokuGame.stats[diff].won, 0);
    html += `
        <div class="stat-card">
            <div class="stat-value">${totalWon}</div>
            <div class="stat-label">Victorias Totales</div>
        </div>
    `;

    statsGrid.innerHTML = html;
}

/**
 * Share the game result
 */
function shareResult() {
    const time = formatTime(SudokuGame.elapsedSeconds);
    const difficulty = SudokuGame.difficultyConfig[SudokuGame.difficulty].name;
    const score = SudokuGame.currentScore.toLocaleString();
    const text = `🎮 ¡He completado un Sudoku ${difficulty}!\n⏱️ Tiempo: ${time}\n⭐ Puntos: ${score}\n¿Puedes superarlo?`;

    if (navigator.share) {
        navigator.share({
            title: 'Sudoku',
            text: text
        }).catch(() => { });
    } else {
        navigator.clipboard.writeText(text).then(() => {
            alert('¡Resultado copiado al portapapeles!');
        }).catch(() => { });
    }
}

// ============================================
// Local Storage Functions
// ============================================

/**
 * Save current game state to localStorage
 */
function saveGameState() {
    if (!SudokuGame.isPlaying) return;

    const state = {
        board: SudokuGame.board,
        solution: SudokuGame.solution,
        initial: SudokuGame.initial,
        notes: SudokuGame.notes.map(set => Array.from(set)),
        history: SudokuGame.history,
        difficulty: SudokuGame.difficulty,
        elapsedSeconds: SudokuGame.elapsedSeconds,
        selectedCell: SudokuGame.selectedCell,
        pencilMode: SudokuGame.pencilMode,
        currentScore: SudokuGame.currentScore,
        hintsUsed: SudokuGame.hintsUsed,
        mistakesMade: SudokuGame.mistakesMade
    };

    localStorage.setItem('sudoku_gameState', JSON.stringify(state));
}

/**
 * Load game state from localStorage
 */
function loadGameState() {
    const saved = localStorage.getItem('sudoku_gameState');

    if (saved) {
        try {
            const state = JSON.parse(saved);

            SudokuGame.board = state.board;
            SudokuGame.solution = state.solution;
            SudokuGame.initial = state.initial;
            SudokuGame.notes = state.notes.map(arr => new Set(arr));
            SudokuGame.history = state.history || [];
            SudokuGame.difficulty = state.difficulty;
            SudokuGame.elapsedSeconds = state.elapsedSeconds;
            SudokuGame.selectedCell = state.selectedCell;
            SudokuGame.pencilMode = state.pencilMode || false;
            SudokuGame.isPlaying = true;

            // Restore points state
            SudokuGame.currentScore = state.currentScore || 0;
            SudokuGame.hintsUsed = state.hintsUsed || 0;
            SudokuGame.mistakesMade = state.mistakesMade || 0;

            if (SudokuGame.pencilMode) {
                document.getElementById('pencil-btn').classList.add('active');
            }

            updateTimerDisplay();
            updateScoreDisplay();
            startTimer();
            renderBoard();
        } catch (e) {
            console.error('Error loading game state:', e);
            startNewGame('medium');
        }
    } else {
        // No saved game, show new game modal
        openModal('new-game-modal');
    }
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
    localStorage.setItem('sudoku_settings', JSON.stringify(SudokuGame.settings));
}

/**
 * Load settings from localStorage
 */
function loadSettings() {
    const saved = localStorage.getItem('sudoku_settings');

    if (saved) {
        try {
            Object.assign(SudokuGame.settings, JSON.parse(saved));
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }

    // Apply settings to UI
    document.getElementById('show-conflicts').checked = SudokuGame.settings.showConflicts;
    document.getElementById('highlight-same').checked = SudokuGame.settings.highlightSame;
    document.getElementById('highlight-area').checked = SudokuGame.settings.highlightArea;
    document.getElementById('auto-remove-notes').checked = SudokuGame.settings.autoRemoveNotes;

    // Validate solution setting
    const validateCheckbox = document.getElementById('validate-solution');
    if (validateCheckbox) {
        validateCheckbox.checked = SudokuGame.settings.validateSolution;
    }

    // Hints setting
    const hintsCheckbox = document.getElementById('enable-hints');
    if (hintsCheckbox) {
        hintsCheckbox.checked = SudokuGame.settings.showHints;
    }
    toggleHintButton(SudokuGame.settings.showHints);

    toggleHintButton(SudokuGame.settings.showHints);

    // Theme setting
    const themeCheckbox = document.getElementById('theme-toggle-setting');
    if (themeCheckbox) {
        themeCheckbox.checked = SudokuGame.settings.theme === 'dark';
    }

    applyTheme();
}

/**
 * Show or hide the hint button
 * @param {boolean} show - Whether to show the button
 */
function toggleHintButton(show) {
    const hintBtn = document.getElementById('hint-btn');
    if (hintBtn) {
        hintBtn.style.display = show ? 'flex' : 'none';
    }
}

/**
 * Save statistics to localStorage
 */
function saveStats() {
    localStorage.setItem('sudoku_stats', JSON.stringify(SudokuGame.stats));
}

/**
 * Load statistics from localStorage
 */
function loadStats() {
    const saved = localStorage.getItem('sudoku_stats');

    if (saved) {
        try {
            const loadedStats = JSON.parse(saved);
            // Merge with default to ensure all properties exist
            for (const diff of ['medium', 'hard', 'expert', 'master', 'extreme']) {
                if (loadedStats[diff]) {
                    SudokuGame.stats[diff] = {
                        played: loadedStats[diff].played || 0,
                        won: loadedStats[diff].won || 0,
                        bestTime: loadedStats[diff].bestTime || null,
                        bestScore: loadedStats[diff].bestScore || 0,
                        totalScore: loadedStats[diff].totalScore || 0
                    };
                }
            }
        } catch (e) {
            console.error('Error loading stats:', e);
        }
    }
}
