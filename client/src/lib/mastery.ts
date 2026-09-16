import type { MasteryRating, ReviewState } from './types';

export type MasteryFilter = 'all' | 'weak' | 'new' | MasteryRating;

export function matchesMastery(state: ReviewState | undefined, filter: MasteryFilter) {
  if (filter === 'all') return true;
  const rating = state?.lastRating;
  if (filter === 'new') return !rating;
  if (filter === 'weak') return rating === 'again' || rating === 'hard';
  return rating === filter;
}

export function masteryLabel(state: ReviewState | undefined) {
  switch (state?.lastRating) {
    case 'again': return '忘记';
    case 'hard': return '模糊';
    case 'good': return '记住';
    case 'easy': return '熟练';
    default: return '未学习';
  }
}
