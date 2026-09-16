import type { Card, ReviewState } from './types';

export type QuickRecallStatus = NonNullable<ReviewState['quickRecallStatus']>;

export function quickRecallStatusForRating(rating: 'again' | 'hard' | 'good'): QuickRecallStatus {
  if (rating === 'good') return 'mastered';
  if (rating === 'hard') return 'vague';
  return 'unfamiliar';
}

export function isQuickRecallEligible(state?: ReviewState): boolean {
  return state?.quickRecallStatus !== 'mastered';
}

export function filterQuickRecallContent(cards: Card[], includeJudgment: boolean) {
  return cards.filter(card => card.type !== 'judgment' || includeJudgment);
}
export function filterQuickRecallCards(cards: Card[], states: ReviewState[]): Card[] {
  const stateMap = new Map(states.map(state => [state.cardId, state]));
  return cards.filter(card => isQuickRecallEligible(stateMap.get(card.id)));
}

export function quickRecallPoolSummary(cards: Card[], states: ReviewState[]) {
  const stateMap = new Map(states.map(state => [state.cardId, state]));
  let mastered = 0;
  let rolling = 0;
  for (const card of cards) {
    const status = stateMap.get(card.id)?.quickRecallStatus;
    if (status === 'mastered') mastered += 1;
    if (status === 'unfamiliar' || status === 'vague') rolling += 1;
  }
  return { total: cards.length, mastered, rolling, remaining: cards.length - mastered };
}
