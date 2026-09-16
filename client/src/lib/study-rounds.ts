import type { Card, ExamPracticeKind, StudyRoundMode, StudyRoundProgress } from './types';

export function examRoundMode(kind: ExamPracticeKind): StudyRoundMode {
  return `exam:${kind}`;
}

export function studyRoundProgressId(mode: StudyRoundMode, cardId: string) {
  return `${mode}:${cardId}`;
}

export function remainingInStudyRound(cards: Card[], progress: StudyRoundProgress[], mode: StudyRoundMode) {
  const completed = new Set(progress.filter(item => item.mode === mode).map(item => item.cardId));
  return cards.filter(card => !completed.has(card.id));
}

export function studyRoundSummary(cards: Card[], progress: StudyRoundProgress[], mode: StudyRoundMode) {
  const ids = new Set(cards.map(card => card.id));
  const completed = new Set(progress.filter(item => item.mode === mode && ids.has(item.cardId)).map(item => item.cardId)).size;
  return { total: cards.length, completed, remaining: Math.max(0, cards.length - completed) };
}