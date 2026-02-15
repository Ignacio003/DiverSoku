// ============================================
// Sudoku Engine — Pure computation (no DOM)
// Used by both main thread and Web Worker.
// ============================================

// ============================================
// Board Generation & Solving (Backtracking)
// ============================================

/**
 * Generate a complete valid Sudoku solution using backtracking
 * @returns {number[][]} 9x9 array with complete solution
 */
function generateSolution() {
    const board = Array(9).fill(null).map(() => Array(9).fill(0));
    fillBoard(board);
    return board;
}

/**
 * Fill the board using backtracking with randomization
 * @param {number[][]} board - The board to fill
 * @returns {boolean} True if filling was successful
 */
function fillBoard(board) {
    const empty = findEmptyCell(board);
    if (!empty) return true;

    const [row, col] = empty;
    const numbers = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    for (const num of numbers) {
        if (isValidPlacement(board, row, col, num)) {
            board[row][col] = num;
            if (fillBoard(board)) return true;
            board[row][col] = 0;
        }
    }
    return false;
}

/**
 * Find the first empty cell in the board
 * @param {number[][]} board - The board to search
 * @returns {number[]|null} [row, col] or null if full
 */
function findEmptyCell(board) {
    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
            if (board[row][col] === 0) return [row, col];
        }
    }
    return null;
}

/**
 * Check if a number can be placed at the given position
 * @param {number[][]} board - The board
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} num - Number to check
 * @returns {boolean} True if placement is valid
 */
function isValidPlacement(board, row, col, num) {
    for (let c = 0; c < 9; c++) {
        if (board[row][c] === num) return false;
    }
    for (let r = 0; r < 9; r++) {
        if (board[r][col] === num) return false;
    }
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
        for (let c = boxCol; c < boxCol + 3; c++) {
            if (board[r][c] === num) return false;
        }
    }
    return true;
}

/**
 * Count solutions for a given board (to ensure unique solution)
 * @param {number[][]} board - The board to solve
 * @param {number} limit - Maximum solutions to find
 * @returns {number} Number of solutions found (up to limit)
 */
function countSolutions(board, limit = 2) {
    const boardCopy = board.map(row => [...row]);
    let count = 0;

    function solve() {
        if (count >= limit) return;

        const empty = findEmptyCell(boardCopy);
        if (!empty) {
            count++;
            return;
        }

        const [row, col] = empty;
        for (let num = 1; num <= 9; num++) {
            if (isValidPlacement(boardCopy, row, col, num)) {
                boardCopy[row][col] = num;
                solve();
                boardCopy[row][col] = 0;
            }
        }
    }

    solve();
    return count;
}

/**
 * Shuffle array in place using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} The shuffled array
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ============================================
// Logic Solver — Technique-Based Difficulty
// ============================================

/**
 * Technique difficulty levels:
 *   1 = Naked Single
 *   2 = Hidden Single
 *   3 = Naked Pair / Naked Triple / Hidden Subsets
 *   4 = Pointing Pairs / Box-Line Reduction
 *   5 = X-Wing
 *   6 = Swordfish
 *   7 = XY-Wing
 */

/**
 * Compute candidate sets for every empty cell.
 * @param {number[][]} board
 * @returns {Set[][]} 9×9 array of Sets (empty set for filled cells)
 */
function getCandidates(board) {
    const cands = Array.from({ length: 9 }, () =>
        Array.from({ length: 9 }, () => new Set())
    );
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] !== 0) continue;
            for (let n = 1; n <= 9; n++) {
                if (isValidPlacement(board, r, c, n)) cands[r][c].add(n);
            }
        }
    }
    return cands;
}

/** Level 1 — Naked Single: a cell with exactly one candidate. */
function applyNakedSingles(board, cands) {
    let progress = false;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] === 0 && cands[r][c].size === 1) {
                const val = [...cands[r][c]][0];
                board[r][c] = val;
                cands[r][c].clear();
                eliminateFromPeers(cands, r, c, val);
                progress = true;
            }
        }
    }
    return progress;
}

/** Level 2 — Hidden Single: a candidate that appears only once in a unit. */
function applyHiddenSingles(board, cands) {
    let progress = false;
    const units = getUnits();
    for (const unit of units) {
        for (let n = 1; n <= 9; n++) {
            const places = unit.filter(([r, c]) => cands[r][c].has(n));
            if (places.length === 1) {
                const [r, c] = places[0];
                board[r][c] = n;
                cands[r][c].clear();
                eliminateFromPeers(cands, r, c, n);
                progress = true;
            }
        }
    }
    return progress;
}

/** Level 3 — Naked Pairs and Naked Triples. */
function applyNakedSubsets(board, cands) {
    let progress = false;
    const units = getUnits();
    for (const unit of units) {
        if (findNakedSubset(cands, unit, 2)) progress = true;
        if (findNakedSubset(cands, unit, 3)) progress = true;
    }
    return progress;
}

function findNakedSubset(cands, unit, size) {
    let progress = false;
    const cells = unit.filter(([r, c]) => cands[r][c].size >= 2 && cands[r][c].size <= size);
    if (cells.length < size) return false;

    const combos = combinations(cells, size);
    for (const combo of combos) {
        const unionSet = new Set();
        for (const [r, c] of combo) {
            for (const v of cands[r][c]) unionSet.add(v);
        }
        if (unionSet.size === size) {
            for (const [r, c] of unit) {
                if (combo.some(([cr, cc]) => cr === r && cc === c)) continue;
                for (const v of unionSet) {
                    if (cands[r][c].delete(v)) progress = true;
                }
            }
        }
    }
    return progress;
}

/** Level 3 — Hidden Subsets: N candidates confined to N cells in a unit. */
function applyHiddenSubsets(board, cands) {
    let progress = false;
    const units = getUnits();
    for (const unit of units) {
        if (findHiddenSubset(cands, unit, 2)) progress = true;
        if (findHiddenSubset(cands, unit, 3)) progress = true;
    }
    return progress;
}

function findHiddenSubset(cands, unit, size) {
    let progress = false;
    const candidateCells = new Map();
    for (let n = 1; n <= 9; n++) {
        const cells = unit.filter(([r, c]) => cands[r][c].has(n));
        if (cells.length >= 2 && cells.length <= size) {
            candidateCells.set(n, cells);
        }
    }
    const candidateKeys = [...candidateCells.keys()];
    if (candidateKeys.length < size) return false;

    const combos = combinations(candidateKeys, size);
    for (const combo of combos) {
        const cellSet = new Map();
        for (const n of combo) {
            for (const [r, c] of candidateCells.get(n)) {
                cellSet.set(r * 9 + c, [r, c]);
            }
        }
        if (cellSet.size === size) {
            const comboSet = new Set(combo);
            for (const [, [r, c]] of cellSet) {
                for (const v of [...cands[r][c]]) {
                    if (!comboSet.has(v)) {
                        if (cands[r][c].delete(v)) progress = true;
                    }
                }
            }
        }
    }
    return progress;
}

/** Level 4 — Pointing Pairs / Box-Line Reduction. */
function applyPointingPairs(board, cands) {
    let progress = false;

    for (let br = 0; br < 3; br++) {
        for (let bc = 0; bc < 3; bc++) {
            const boxCells = [];
            for (let r = br * 3; r < br * 3 + 3; r++)
                for (let c = bc * 3; c < bc * 3 + 3; c++)
                    boxCells.push([r, c]);

            for (let n = 1; n <= 9; n++) {
                const places = boxCells.filter(([r, c]) => cands[r][c].has(n));
                if (places.length < 2 || places.length > 3) continue;

                const rows = new Set(places.map(([r]) => r));
                const cols = new Set(places.map(([, c]) => c));

                if (rows.size === 1) {
                    const row = [...rows][0];
                    for (let c = 0; c < 9; c++) {
                        if (c >= bc * 3 && c < bc * 3 + 3) continue;
                        if (cands[row][c].delete(n)) progress = true;
                    }
                }
                if (cols.size === 1) {
                    const col = [...cols][0];
                    for (let r = 0; r < 9; r++) {
                        if (r >= br * 3 && r < br * 3 + 3) continue;
                        if (cands[r][col].delete(n)) progress = true;
                    }
                }
            }
        }
    }

    for (let n = 1; n <= 9; n++) {
        for (let r = 0; r < 9; r++) {
            const cols = [];
            for (let c = 0; c < 9; c++) {
                if (cands[r][c].has(n)) cols.push(c);
            }
            if (cols.length < 2 || cols.length > 3) continue;
            const boxes = new Set(cols.map(c => Math.floor(c / 3)));
            if (boxes.size === 1) {
                const bc = [...boxes][0];
                const br = Math.floor(r / 3);
                for (let rr = br * 3; rr < br * 3 + 3; rr++) {
                    if (rr === r) continue;
                    for (let cc = bc * 3; cc < bc * 3 + 3; cc++) {
                        if (cands[rr][cc].delete(n)) progress = true;
                    }
                }
            }
        }
        for (let c = 0; c < 9; c++) {
            const rows = [];
            for (let r = 0; r < 9; r++) {
                if (cands[r][c].has(n)) rows.push(r);
            }
            if (rows.length < 2 || rows.length > 3) continue;
            const boxes = new Set(rows.map(r => Math.floor(r / 3)));
            if (boxes.size === 1) {
                const br = [...boxes][0];
                const bc = Math.floor(c / 3);
                for (let rr = br * 3; rr < br * 3 + 3; rr++) {
                    for (let cc = bc * 3; cc < bc * 3 + 3; cc++) {
                        if (cc === c) continue;
                        if (cands[rr][cc].delete(n)) progress = true;
                    }
                }
            }
        }
    }

    return progress;
}

/** Level 5 — X-Wing: pattern across 2 rows × 2 columns. */
function applyXWing(board, cands) {
    let progress = false;

    for (let n = 1; n <= 9; n++) {
        // Row-based X-Wing
        const rowPositions = [];
        for (let r = 0; r < 9; r++) {
            const cols = [];
            for (let c = 0; c < 9; c++) {
                if (cands[r][c].has(n)) cols.push(c);
            }
            if (cols.length === 2) rowPositions.push({ row: r, cols });
        }
        for (let i = 0; i < rowPositions.length; i++) {
            for (let j = i + 1; j < rowPositions.length; j++) {
                if (rowPositions[i].cols[0] === rowPositions[j].cols[0] &&
                    rowPositions[i].cols[1] === rowPositions[j].cols[1]) {
                    const [c1, c2] = rowPositions[i].cols;
                    const r1 = rowPositions[i].row;
                    const r2 = rowPositions[j].row;
                    for (let r = 0; r < 9; r++) {
                        if (r === r1 || r === r2) continue;
                        if (cands[r][c1].delete(n)) progress = true;
                        if (cands[r][c2].delete(n)) progress = true;
                    }
                }
            }
        }

        // Column-based X-Wing
        const colPositions = [];
        for (let c = 0; c < 9; c++) {
            const rows = [];
            for (let r = 0; r < 9; r++) {
                if (cands[r][c].has(n)) rows.push(r);
            }
            if (rows.length === 2) colPositions.push({ col: c, rows });
        }
        for (let i = 0; i < colPositions.length; i++) {
            for (let j = i + 1; j < colPositions.length; j++) {
                if (colPositions[i].rows[0] === colPositions[j].rows[0] &&
                    colPositions[i].rows[1] === colPositions[j].rows[1]) {
                    const [r1, r2] = colPositions[i].rows;
                    const c1 = colPositions[i].col;
                    const c2 = colPositions[j].col;
                    for (let c = 0; c < 9; c++) {
                        if (c === c1 || c === c2) continue;
                        if (cands[r1][c].delete(n)) progress = true;
                        if (cands[r2][c].delete(n)) progress = true;
                    }
                }
            }
        }
    }

    return progress;
}

/** Level 6 — Swordfish: pattern across 3 rows × 3 columns (Optimized with Bitmasks). */
function applySwordfish(board, cands) {
    let progress = false;

    for (let n = 1; n <= 9; n++) {
        // --- Row-based Swordfish ---
        // 1. Identify rows that have candidate 'n' in 2 or 3 columns
        const rowMasks = [];
        for (let r = 0; r < 9; r++) {
            let mask = 0;
            for (let c = 0; c < 9; c++) {
                if (cands[r][c].has(n)) mask |= (1 << c);
            }
            const count = countSetBits(mask);
            if (count >= 2 && count <= 3) rowMasks.push({ idx: r, mask });
        }

        // 2. Look for triples of rows whose combined mask has exactly 3 bits
        if (rowMasks.length >= 3) {
            for (let i = 0; i < rowMasks.length; i++) {
                for (let j = i + 1; j < rowMasks.length; j++) {
                    for (let k = j + 1; k < rowMasks.length; k++) {
                        const combinedMask = rowMasks[i].mask | rowMasks[j].mask | rowMasks[k].mask;
                        if (countSetBits(combinedMask) === 3) {
                            // Swordfish found! Eliminate 'n' from other rows in these columns
                            const rowsInvolved = [rowMasks[i].idx, rowMasks[j].idx, rowMasks[k].idx];
                            if (eliminateFromColumns(cands, n, combinedMask, rowsInvolved)) {
                                progress = true;
                            }
                        }
                    }
                }
            }
        }

        // --- Column-based Swordfish ---
        // 1. Identify columns that have candidate 'n' in 2 or 3 rows
        const colMasks = [];
        for (let c = 0; c < 9; c++) {
            let mask = 0;
            for (let r = 0; r < 9; r++) {
                if (cands[r][c].has(n)) mask |= (1 << r);
            }
            const count = countSetBits(mask);
            if (count >= 2 && count <= 3) colMasks.push({ idx: c, mask });
        }

        // 2. Look for triples of cols whose combined mask has exactly 3 bits
        if (colMasks.length >= 3) {
            for (let i = 0; i < colMasks.length; i++) {
                for (let j = i + 1; j < colMasks.length; j++) {
                    for (let k = j + 1; k < colMasks.length; k++) {
                        const combinedMask = colMasks[i].mask | colMasks[j].mask | colMasks[k].mask;
                        if (countSetBits(combinedMask) === 3) {
                            // Swordfish found! Eliminate 'n' from other columns in these rows
                            const colsInvolved = [colMasks[i].idx, colMasks[j].idx, colMasks[k].idx];
                            if (eliminateFromRows(cands, n, combinedMask, colsInvolved)) {
                                progress = true;
                            }
                        }
                    }
                }
            }
        }
    }

    return progress;
}

/** Eliminate candidate 'val' from columns in 'colMask' for all rows NOT in 'exceptRows'. */
function eliminateFromColumns(cands, val, colMask, exceptRows) {
    let progress = false;
    for (let c = 0; c < 9; c++) {
        // If column 'c' is part of the Swordfish columns
        if ((colMask & (1 << c)) !== 0) {
            for (let r = 0; r < 9; r++) {
                if (!exceptRows.includes(r)) {
                    if (cands[r][c].delete(val)) progress = true;
                }
            }
        }
    }
    return progress;
}

/** Eliminate candidate 'val' from rows in 'rowMask' for all columns NOT in 'exceptCols'. */
function eliminateFromRows(cands, val, rowMask, exceptCols) {
    let progress = false;
    for (let r = 0; r < 9; r++) {
        // If row 'r' is part of the Swordfish rows
        if ((rowMask & (1 << r)) !== 0) {
            for (let c = 0; c < 9; c++) {
                if (!exceptCols.includes(c)) {
                    if (cands[r][c].delete(val)) progress = true;
                }
            }
        }
    }
    return progress;
}

/** Count set bits in a 32-bit integer (Hamming weight). */
function countSetBits(n) {
    n = n - ((n >> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
    return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

/**
 * Level 7 — XY-Wing: a pivot cell with 2 candidates (X,Y) sees two wing cells
 * with candidates (X,Z) and (Y,Z). Any cell that sees BOTH wings cannot be Z.
 */
function applyXYWing(board, cands) {
    let progress = false;

    for (let pr = 0; pr < 9; pr++) {
        for (let pc = 0; pc < 9; pc++) {
            if (cands[pr][pc].size !== 2) continue;
            const [x, y] = [...cands[pr][pc]];

            // Find peers of pivot with exactly 2 candidates sharing one value
            const peers = getPeers(pr, pc);
            const wingX = []; // cells with (X, Z) for some Z ≠ Y
            const wingY = []; // cells with (Y, Z) for some Z ≠ X

            for (const [wr, wc] of peers) {
                if (cands[wr][wc].size !== 2) continue;
                const wVals = [...cands[wr][wc]];
                if (wVals.includes(x) && !wVals.includes(y)) {
                    wingX.push({ r: wr, c: wc, z: wVals.find(v => v !== x) });
                }
                if (wVals.includes(y) && !wVals.includes(x)) {
                    wingY.push({ r: wr, c: wc, z: wVals.find(v => v !== y) });
                }
            }

            // Try all combinations of wingX × wingY where z matches
            for (const wx of wingX) {
                for (const wy of wingY) {
                    if (wx.z !== wy.z) continue;
                    const z = wx.z;

                    // OPTIMIZATION: Only check peers of one wing (intersection with other wing)
                    // instead of scanning the full 81 cells.
                    const peersOfWingX = getPeers(wx.r, wx.c);

                    for (const [r, c] of peersOfWingX) {
                        // 1. Must have candidate Z
                        if (!cands[r][c].has(z)) continue;

                        // 2. Avoid eliminating self/pivot (though isPeer/getPeers usually handles specific exclusion, strict check helps)
                        if ((r === wx.r && c === wx.c) || (r === wy.r && c === wy.c) || (r === pr && c === pc)) continue;

                        // 3. Must also see Wing Y
                        if (isPeer(r, c, wy.r, wy.c)) {
                            if (cands[r][c].delete(z)) progress = true;
                        }
                    }
                }
            }
        }
    }

    return progress;
}

/** Get all peer cells of (row, col) — same row, col, or box. */
function getPeers(row, col) {
    const peers = [];
    const seen = new Set();
    for (let c = 0; c < 9; c++) {
        if (c !== col) { peers.push([row, c]); seen.add(row * 9 + c); }
    }
    for (let r = 0; r < 9; r++) {
        const key = r * 9 + col;
        if (r !== row && !seen.has(key)) { peers.push([r, col]); seen.add(key); }
    }
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
        for (let c = bc; c < bc + 3; c++) {
            const key = r * 9 + c;
            if (!seen.has(key) && !(r === row && c === col)) {
                peers.push([r, c]); seen.add(key);
            }
        }
    }
    return peers;
}

/** Check if two cells are peers (same row, col, or box). */
function isPeer(r1, c1, r2, c2) {
    if (r1 === r2) return true;
    if (c1 === c2) return true;
    if (Math.floor(r1 / 3) === Math.floor(r2 / 3) &&
        Math.floor(c1 / 3) === Math.floor(c2 / 3)) return true;
    return false;
}

// --- Solver helpers ---

/** Remove a value from all peers of (r, c) in the candidate grid. */
function eliminateFromPeers(cands, row, col, val) {
    for (let c = 0; c < 9; c++) cands[row][c].delete(val);
    for (let r = 0; r < 9; r++) cands[r][col].delete(val);
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++)
        for (let c = bc; c < bc + 3; c++)
            cands[r][c].delete(val);
}

/** Return all 27 units (9 rows + 9 cols + 9 boxes) as arrays of [r,c]. */
function getUnits() {
    const units = [];
    for (let r = 0; r < 9; r++) {
        const row = [];
        for (let c = 0; c < 9; c++) row.push([r, c]);
        units.push(row);
    }
    for (let c = 0; c < 9; c++) {
        const col = [];
        for (let r = 0; r < 9; r++) col.push([r, c]);
        units.push(col);
    }
    for (let br = 0; br < 3; br++) {
        for (let bc = 0; bc < 3; bc++) {
            const box = [];
            for (let r = br * 3; r < br * 3 + 3; r++)
                for (let c = bc * 3; c < bc * 3 + 3; c++)
                    box.push([r, c]);
            units.push(box);
        }
    }
    return units;
}

/** Generate all k-combinations from an array. */
function combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = combinations(rest, k);
    return [...withFirst, ...withoutFirst];
}

/**
 * Attempt to solve a puzzle using only logic (no guessing).
 * Always tries the simplest technique first before escalating.
 * Returns { solved, maxLevel, techniquesUsed }.
 */
function solvePuzzleWithLogic(boardInput) {
    const board = boardInput.map(row => [...row]);
    const cands = getCandidates(board);
    let maxLevel = 0;
    const techniquesUsed = new Set();
    const techniqueNames = {
        1: 'Naked Single',
        2: 'Hidden Single',
        3: 'Naked/Hidden Subsets',
        4: 'Pointing Pairs',
        5: 'X-Wing',
        6: 'Swordfish',
        7: 'XY-Wing'
    };

    const techniques = [
        { level: 1, fn: () => applyNakedSingles(board, cands) },
        { level: 2, fn: () => applyHiddenSingles(board, cands) },
        { level: 3, fn: () => applyNakedSubsets(board, cands) },
        { level: 3, fn: () => applyHiddenSubsets(board, cands) },
        { level: 4, fn: () => applyPointingPairs(board, cands) },
        { level: 5, fn: () => applyXWing(board, cands) },
        { level: 6, fn: () => applySwordfish(board, cands) },
        { level: 7, fn: () => applyXYWing(board, cands) },
    ];

    let stuck = false;
    while (!stuck) {
        stuck = true;
        for (const tech of techniques) {
            if (tech.fn()) {
                if (tech.level > maxLevel) maxLevel = tech.level;
                techniquesUsed.add(techniqueNames[tech.level]);
                stuck = false;
                break;
            }
        }
    }

    const solved = board.every(row => row.every(v => v !== 0));
    return { solved, maxLevel, techniquesUsed: [...techniquesUsed] };
}

// ============================================
// Puzzle Generation (synchronous, for Worker)
// ============================================

/**
 * Generate a single puzzle attempt with symmetric cell removal.
 * Removes cells in pairs (r,c) + (8-r, 8-c) for rotational symmetry.
 * @returns {{puzzle, solution, removed, analysis}|null}
 */
function generatePuzzleAttempt(config) {
    const solution = generateSolution();
    const puzzle = solution.map(row => [...row]);

    // Build symmetric pairs
    const pairs = [];
    const visited = new Set();
    const coords = [];
    for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++)
            coords.push([r, c]);
    shuffleArray(coords);

    for (const [r, c] of coords) {
        const key = r * 9 + c;
        if (visited.has(key)) continue;
        const sr = 8 - r, sc = 8 - c;
        const skey = sr * 9 + sc;
        visited.add(key);
        visited.add(skey);
        if (r === sr && c === sc) {
            pairs.push([[r, c]]); // center cell, alone
        } else {
            pairs.push([[r, c], [sr, sc]]);
        }
    }

    let removed = 0;
    for (const pair of pairs) {
        if (removed >= config.maxRemove) break;
        // Would removing this pair exceed maxRemove?
        if (removed + pair.length > config.maxRemove + 1) continue;

        // Backup
        const backups = pair.map(([r, c]) => ({ r, c, val: puzzle[r][c] }));
        // Skip already-removed cells
        if (backups.some(b => b.val === 0)) continue;

        // Remove
        for (const { r, c } of backups) puzzle[r][c] = 0;

        if (countSolutions(puzzle) === 1) {
            removed += pair.length;
        } else {
            // Restore
            for (const { r, c, val } of backups) puzzle[r][c] = val;
        }
    }

    if (removed < config.minRemove) return null;

    const analysis = solvePuzzleWithLogic(puzzle);
    return { puzzle, solution, removed, analysis };
}

/**
 * Check if an attempt matches the target difficulty.
 */
function isLevelMatch(analysis, config) {
    if (!analysis.solved) return false;
    if (analysis.maxLevel > config.maxLevel) return false;
    // Medium (maxLevel 2): any solvable puzzle up to Hidden Single is fine
    if (config.maxLevel <= 2) return true;
    // Hard (3) and Expert (4): require exact target level
    if (config.maxLevel <= 4) return analysis.maxLevel === config.maxLevel;
    // Master (5): require at least Level 5 (X-Wing)
    if (config.maxLevel === 5) return analysis.maxLevel >= 5;
    // Extreme (7): require at least Level 6 (Swordfish) or 7 (XY-Wing)
    return analysis.maxLevel >= 6;
}

/**
 * Generate a puzzle synchronously (used by Worker).
 * @param {Object} config - Difficulty config with minRemove, maxRemove, maxLevel
 * @returns {{puzzle: number[][], solution: number[][], analysis: Object}}
 */
function generatePuzzleSync(config) {
    const maxAttempts = 1000;
    const timeBudgetMs = 45000;
    const startTime = Date.now();

    let bestResult = null;
    let bestScore = -1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (Date.now() - startTime > timeBudgetMs) break;

        const result = generatePuzzleAttempt(config);
        if (!result) continue;

        const { analysis } = result;
        if (!analysis.solved) continue;

        if (isLevelMatch(analysis, config)) {
            return {
                puzzle: result.puzzle,
                solution: result.solution,
                analysis: result.analysis
            };
        }

        const score = analysis.maxLevel <= config.maxLevel ? analysis.maxLevel : -1;
        if (score > bestScore) {
            bestScore = score;
            bestResult = result;
        }
    }

    if (bestResult) {
        return {
            puzzle: bestResult.puzzle,
            solution: bestResult.solution,
            analysis: bestResult.analysis
        };
    }

    // Last resort
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
        if (countSolutions(puzzle) === 1) {
            removed++;
        } else {
            puzzle[row][col] = backup;
        }
    }

    return { puzzle, solution, analysis: { solved: false, maxLevel: 0, techniquesUsed: [] } };
}
