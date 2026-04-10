// ═══════════════════════════════════════════════════════════════════
// sommNI — Quiz Engine for G2 Glasses
// Generates multiple-choice questions from wine tasting notes
// Port of generateQuestions() from sommNI Android App.jsx
// ═══════════════════════════════════════════════════════════════════

import {
  Wine, WineType, WINE_TYPES, COUNTRIES, WINES, TYPE_DISPLAY,
} from './constants';

export interface QuizQuestion {
  category: string;
  question: string;
  correct: string;
  options: string[];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

/** Collect all wines flat */
function allWinesFlat(): { wine: Wine; type: WineType; country: string }[] {
  const result: { wine: Wine; type: WineType; country: string }[] = [];
  for (const t of WINE_TYPES) {
    for (const c of COUNTRIES[t]) {
      for (const w of (WINES[t]?.[c] || [])) {
        result.push({ wine: w, type: t, country: c });
      }
    }
  }
  return result;
}

/**
 * Generate quiz questions for a specific wine.
 * Returns 4-5 multiple-choice questions covering:
 *   - Country (origin)
 *   - Grape variety
 *   - Region
 *   - Nose descriptors
 *   - Finish
 * Each question has 4 options (1 correct + 3 distractors).
 */
export function generateQuestions(
  wine: Wine, wineType: WineType, wineCountry: string,
): QuizQuestion[] {
  const all = allWinesFlat();
  const others = all.filter(w => w.wine.name !== wine.name);
  const qs: QuizQuestion[] = [];

  // ── Country ──
  const otherCountries = [...new Set(others.map(w => w.country))].filter(c => c !== wineCountry);
  if (otherCountries.length >= 3) {
    qs.push({
      category: "Origin",
      question: "What country does this wine come from?",
      correct: wineCountry,
      options: shuffle([wineCountry, ...pickN(otherCountries, 3)]),
    });
  }

  // ── Grape ──
  const otherGrapes = [...new Set(others.map(w => w.wine.grape))].filter(g => g !== wine.grape);
  if (otherGrapes.length >= 3) {
    qs.push({
      category: "Grape",
      question: "What grape(s) is this wine made from?",
      correct: wine.grape,
      options: shuffle([wine.grape, ...pickN(otherGrapes, 3)]),
    });
  }

  // ── Region ──
  const otherRegions = [...new Set(others.map(w => w.wine.region))].filter(r => r !== wine.region);
  if (otherRegions.length >= 3) {
    qs.push({
      category: "Region",
      question: "What region is this wine from?",
      correct: wine.region,
      options: shuffle([wine.region, ...pickN(otherRegions, 3)]),
    });
  }

  // ── Type ──
  const otherTypes = WINE_TYPES.filter(t => t !== wineType);
  if (otherTypes.length >= 3) {
    qs.push({
      category: "Type",
      question: "What type of wine is this?",
      correct: TYPE_DISPLAY[wineType],
      options: shuffle([TYPE_DISPLAY[wineType], ...pickN(otherTypes.map(t => TYPE_DISPLAY[t]), 3)]),
    });
  }

  // ── Nose ──
  if (wine.nose) {
    const otherNose = others.filter(w => w.wine.nose).map(w => w.wine.nose);
    const unique = [...new Set(otherNose)].filter(n => n !== wine.nose);
    if (unique.length >= 3) {
      // Truncate long nose strings for readability on the 576px display
      const trunc = (s: string) => s.length > 50 ? s.slice(0, 48) + ".." : s;
      qs.push({
        category: "Nose",
        question: "Which describes the nose?",
        correct: trunc(wine.nose),
        options: shuffle([trunc(wine.nose), ...pickN(unique, 3).map(trunc)]),
      });
    }
  }

  // ── Finish ──
  if (wine.finish) {
    const otherFinish = others.filter(w => w.wine.finish).map(w => w.wine.finish);
    const unique = [...new Set(otherFinish)].filter(f => f !== wine.finish);
    if (unique.length >= 3) {
      const trunc = (s: string) => s.length > 50 ? s.slice(0, 48) + ".." : s;
      qs.push({
        category: "Finish",
        question: "How would you describe the finish?",
        correct: trunc(wine.finish),
        options: shuffle([trunc(wine.finish), ...pickN(unique, 3).map(trunc)]),
      });
    }
  }

  // ── Style ──
  const otherStyles = [...new Set(others.map(w => w.wine.style))].filter(s => s !== wine.style);
  if (otherStyles.length >= 3) {
    qs.push({
      category: "Style",
      question: "What is the style of this wine?",
      correct: wine.style,
      options: shuffle([wine.style, ...pickN(otherStyles, 3)]),
    });
  }

  // Return 5 shuffled questions (cap for glasses screen time)
  return shuffle(qs).slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════════
// Quiz State Machine — tracks in-progress quiz on the glasses
// ═══════════════════════════════════════════════════════════════════

export interface QuizState {
  wine: Wine;
  wineType: WineType;
  wineCountry: string;
  wineId: string;
  questions: QuizQuestion[];
  currentQ: number;       // 0-based index
  score: number;          // correct answers so far
  answered: boolean;      // has current question been answered?
  selectedIdx: number;    // which option was selected (-1 = none)
}

let _quiz: QuizState | null = null;

export function getQuizState(): QuizState | null { return _quiz; }

export function startQuizSession(
  wine: Wine, wineType: WineType, wineCountry: string, wineId: string,
): QuizState | null {
  const questions = generateQuestions(wine, wineType, wineCountry);
  if (questions.length === 0) return null;
  _quiz = {
    wine, wineType, wineCountry, wineId,
    questions,
    currentQ: 0, score: 0, answered: false, selectedIdx: -1,
  };
  return _quiz;
}

export function answerQuiz(optionIdx: number): { correct: boolean; correctAnswer: string } | null {
  if (!_quiz || _quiz.answered) return null;
  const q = _quiz.questions[_quiz.currentQ];
  const selected = q.options[optionIdx];
  const correct = selected === q.correct;
  if (correct) _quiz.score++;
  _quiz.answered = true;
  _quiz.selectedIdx = optionIdx;
  return { correct, correctAnswer: q.correct };
}

export function nextQuizQuestion(): 'next' | 'done' {
  if (!_quiz) return 'done';
  if (_quiz.currentQ >= _quiz.questions.length - 1) return 'done';
  _quiz.currentQ++;
  _quiz.answered = false;
  _quiz.selectedIdx = -1;
  return 'next';
}

export function endQuiz(): { score: number; total: number; pct: number } | null {
  if (!_quiz) return null;
  const result = {
    score: _quiz.score,
    total: _quiz.questions.length,
    pct: Math.round((_quiz.score / _quiz.questions.length) * 100),
  };
  _quiz = null;
  return result;
}

export function clearQuiz(): void { _quiz = null; }
