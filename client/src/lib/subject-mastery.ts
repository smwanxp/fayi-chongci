import type { Card, Chapter, ReviewState, Subject } from './types';

export interface SubjectMasterySummary {
  subjectId: string;
  totalPoints: number;
  masteredPoints: number;
  unmasteredPoints: number;
  unrecordedPoints: number;
  masteryPercent: number;
  trainingCardIds: string[];
}

const isMastered = (state: ReviewState | undefined) => state?.lastRating === 'good' || state?.lastRating === 'easy';
const belongsToPoint = (card: Card, chapterId: string) => card.chapterId === chapterId || Boolean(card.relatedChapterIds?.includes(chapterId));

export function buildSubjectMastery(subjects: Subject[], chapters: Chapter[], cards: Card[], states: ReviewState[]): SubjectMasterySummary[] {
  const stateMap = new Map(states.map(state => [state.cardId, state]));
  return subjects.map(subject => {
    const subjectCards = cards.filter(card => card.subjectId === subject.id);
    const points = chapters.filter(chapter => chapter.subjectId === subject.id);
    const pointCards = points.map(point => subjectCards.filter(card => belongsToPoint(card, point.id)));
    const masteredPoints = pointCards.filter(linkedCards => linkedCards.length > 0 && linkedCards.every(card => isMastered(stateMap.get(card.id)))).length;
    const unrecordedPoints = pointCards.filter(linkedCards => linkedCards.length === 0).length;
    const trainingCardIds = subjectCards.filter(card => !isMastered(stateMap.get(card.id))).map(card => card.id);
    const totalPoints = points.length;
    return {
      subjectId: subject.id,
      totalPoints,
      masteredPoints,
      unmasteredPoints: totalPoints - masteredPoints,
      unrecordedPoints,
      masteryPercent: totalPoints ? Math.round(masteredPoints / totalPoints * 100) : 0,
      trainingCardIds,
    };
  });
}
