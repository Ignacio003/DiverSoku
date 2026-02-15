// ============================================
// Puzzle Worker — Generates puzzles in background
// ============================================

importScripts('sudoku-engine.js');

self.onmessage = function (e) {
    const { type, difficulty, config } = e.data;

    if (type === 'generate') {
        const result = generatePuzzleSync(config);
        self.postMessage({
            type: 'result',
            difficulty: difficulty,
            puzzle: result.puzzle,
            solution: result.solution,
            analysis: {
                solved: result.analysis.solved,
                maxLevel: result.analysis.maxLevel,
                techniquesUsed: result.analysis.techniquesUsed
            }
        });
    }
};
