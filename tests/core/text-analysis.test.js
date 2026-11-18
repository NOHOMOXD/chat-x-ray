import { describe, expect, it } from 'vitest';

import {
  clamp,
  countWords,
  detectRhythm,
  findSelfSimilarity,
  hasEmoji,
  hasNumericSuffixPattern,
  hasSlang,
  isCharacterFlood,
  isSolicitation,
  isSterileText,
  levenshteinDistance,
  mean,
  normalizeText,
  normalizedLevenshtein,
  round,
  standardDeviation,
  tokenJaccard,
  trigramJaccard,
  zScore,
} from '../../src/core/text-analysis.js';

describe('normalizeText', () => {
  it('lowercases and collapses repeated letters', () => {
    expect(normalizeText('SOOOO GOOOOD')).toBe('so god');
  });

  it('turns punctuation into spaces and strips invisible characters', () => {
    expect(normalizeText('A  B... C')).toBe('a b c');
    expect(normalizeText('Привеееет!!! Мир\u200B')).toBe('привет мир');
  });

  it('returns an empty string for non-strings', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(42)).toBe('');
  });
});

describe('similarity helpers', () => {
  it('scores identical token sets as 1', () => {
    expect(tokenJaccard('hello world', 'hello world')).toBe(1);
    expect(tokenJaccard('hello world', 'hello there')).toBeCloseTo(1 / 3);
  });

  it('returns 0 when either side is empty', () => {
    expect(tokenJaccard('', 'hello')).toBe(0);
  });

  it('counts edit distance', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('same', 'same')).toBe(0);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('maps edit distance to a 0..1 similarity', () => {
    expect(normalizedLevenshtein('abc', 'abc')).toBe(1);
    expect(normalizedLevenshtein('abc', 'abd')).toBeCloseTo(2 / 3);
    expect(normalizedLevenshtein('', '')).toBe(1);
  });

  it('compares character trigrams', () => {
    expect(trigramJaccard('rofl', 'rofl')).toBe(1);
    expect(trigramJaccard('rofl', 'rofls')).toBeCloseTo(2 / 3);
    expect(trigramJaccard('ab', 'ab')).toBe(0);
  });
});

describe('statistics', () => {
  it('handles empty input', () => {
    expect(mean([])).toBe(0);
    expect(standardDeviation([])).toBe(0);
  });

  it('computes population mean and deviation', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(standardDeviation([2, 4, 6])).toBeCloseTo(1.632993, 5);
  });

  it('returns 0 for z-score without history', () => {
    expect(zScore(10, [])).toBe(0);
  });

  it('returns Infinity when a flat baseline is exceeded', () => {
    expect(zScore(5, [1, 1, 1])).toBe(Infinity);
    expect(zScore(1, [1, 1, 1])).toBe(0);
    expect(zScore(0, [1, 1, 1])).toBe(0);
  });

  it('measures distance in standard deviations', () => {
    expect(zScore(6, [2, 4, 6])).toBeCloseTo(1.224745, 5);
  });

  it('clamps and rounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(round(1.2345, 2)).toBe(1.23);
    expect(round(1.235, 2)).toBe(1.24);
  });
});

describe('text classifiers', () => {
  it('detects emoji', () => {
    expect(hasEmoji('hello 🍅')).toBe(true);
    expect(hasEmoji('just words')).toBe(false);
  });

  it('detects latin and russian chat slang', () => {
    expect(hasSlang('LMAO')).toBe(true);
    expect(hasSlang('ахахах')).toBe(true);
    expect(hasSlang('кринж')).toBe(true);
    expect(hasSlang('ordinary sentence')).toBe(false);
  });

  it('counts only word-like tokens', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('-- !! ??')).toBe(0);
  });

  it('flags long plain sentences from badge-less accounts as sterile', () => {
    const sterile =
      'the weather today is quite pleasant across the northern regions';
    expect(isSterileText(sterile, [])).toBe(true);
  });

  it('never flags badged, short or lively text as sterile', () => {
    const long = 'the weather today is quite pleasant across the northern regions';
    expect(isSterileText(long, ['moderator'])).toBe(false);
    expect(isSterileText('hi there', [])).toBe(false);
    expect(isSterileText(long + ' lol', [])).toBe(false);
    expect(isSterileText(long + ' 🍅', [])).toBe(false);
    expect(isSterileText(long + ' @someone', [])).toBe(false);
  });

  it('catches dominant-character floods', () => {
    expect(isCharacterFlood('wwwwwwwww')).toBe(true);
    expect(isCharacterFlood('🍅🍅🍅🍅')).toBe(true);
    expect(isCharacterFlood('hello world')).toBe(false);
    expect(isCharacterFlood('abc')).toBe(false);
  });

  it('recognises scam scripts but not normal chat', () => {
    expect(isSolicitation('free nitro for everyone')).toBe(true);
    expect(isSolicitation('dm me and send me crypto')).toBe(true);
    expect(isSolicitation('selling accounts cheap')).toBe(true);
    expect(isSolicitation('dm me the clip')).toBe(false);
    expect(isSolicitation('nice play')).toBe(false);
    expect(isSolicitation('ok')).toBe(false);
  });

  it('needs a steady, plausible cadence for rhythm', () => {
    expect(detectRhythm([0, 5000, 10000, 15000])).toBe(true);
    expect(detectRhythm([0, 100, 20000, 21000])).toBe(false);
    expect(detectRhythm([0, 5000])).toBe(false);
    expect(detectRhythm([0, 0, 0])).toBe(false);
  });

  it('needs at least three comparable messages for self-similarity', () => {
    expect(findSelfSimilarity(['hello world', 'hello world'], 0.65)).toBe(0);
    const repeated = ['hello world', 'hello world', 'hello world'];
    expect(findSelfSimilarity(repeated, 0.65)).toBeGreaterThan(0.65);
  });

  it('spots bot-farm nicknames', () => {
    expect(hasNumericSuffixPattern('gamer_4892')).toBe(true);
    expect(hasNumericSuffixPattern('alex91823')).toBe(true);
    expect(hasNumericSuffixPattern('john7')).toBe(false);
    expect(hasNumericSuffixPattern('ordinary_user')).toBe(false);
    expect(hasNumericSuffixPattern(null)).toBe(false);
  });
});
