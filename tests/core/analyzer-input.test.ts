import { describe, expect, it } from 'vitest';
import { normalizeAnalyzerInput } from '../../src/core/analyzer-input.ts';

describe('analyzer input', () => {
  it('normalizes the login and limits message length', () => {
    expect(normalizeAnalyzerInput({ login: '  Viewer  ', text: 'x'.repeat(2001) })).toEqual({
      login: 'viewer', text: 'x'.repeat(2000),
    });
  });

  it('uses the display name and rejects inputs without text or an author', () => {
    expect(normalizeAnalyzerInput({ displayName: ' Viewer ', text: 'hello' })).toEqual({ login: 'viewer', text: 'hello' });
    expect(normalizeAnalyzerInput({ login: 'viewer', text: '   ' })).toBeNull();
    expect(normalizeAnalyzerInput({ text: 'hello' })).toBeNull();
    expect(normalizeAnalyzerInput(null)).toBeNull();
  });
});
