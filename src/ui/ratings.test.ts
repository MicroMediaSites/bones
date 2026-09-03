import { describe, expect, test } from 'bun:test';

import { generate } from '../engine/index';
import type { Rating } from './ratings';
import { ratingId } from './ratings';
import { mergeCorpus } from './ratingsPage';

const puzzle = generate('easy', 99);

function rating(over: Partial<Rating> = {}): Rating {
  return {
    id: ratingId(puzzle),
    at: '2026-09-02T12:00:00.000Z',
    verdict: 'good',
    note: '',
    regions: [],
    solved: false,
    puzzle,
    ...over,
  };
}

describe('mergeCorpus', () => {
  test('adds unsent local records the server has not seen', () => {
    const local = rating({ id: 'easy-1', note: 'queued' });
    const merged = mergeCorpus([], [local], new Set(['easy-1']));
    expect(merged.map((r) => r.note)).toEqual(['queued']);
  });

  test('ignores local records already acknowledged by the server', () => {
    const remote = rating({ id: 'easy-1', note: 'from server' });
    const local = rating({ id: 'easy-1', note: 'stale mirror' });
    const merged = mergeCorpus([remote], [local], new Set());
    expect(merged.map((r) => r.note)).toEqual(['from server']);
  });

  test('a newer unsent record wins over the server copy, newest first', () => {
    const remote = rating({ id: 'easy-1', at: '2026-09-01T00:00:00.000Z', note: 'old' });
    const other = rating({ id: 'easy-2', at: '2026-09-03T00:00:00.000Z', note: 'other' });
    const local = rating({ id: 'easy-1', at: '2026-09-02T00:00:00.000Z', note: 'new' });
    const merged = mergeCorpus([remote, other], [local], new Set(['easy-1']));
    expect(merged.map((r) => r.note)).toEqual(['other', 'new']);
  });
});
