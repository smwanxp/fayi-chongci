import type { Card, Chapter, Subject } from './types';
import { criminalProcedureModules } from './criminal-procedure-seed';
import { threeInternationalLawModules } from './three-international-laws-seed';

export type StudyOrder = 'ordered' | 'random';

export function effectiveStudySize(requested: number, available: number) {
  return available > 0 ? Math.min(Math.max(1, requested), available) : 0;
}

export function studySizeOptions(available: number, selected?: number) {
  if (available <= 0) return [];
  const values = [5, 10, 15, 20].filter(value => value <= available).concat(available);
  if (selected && selected <= available) values.push(selected);
  return [...new Set(values)].sort((a, b) => a - b);
}
export interface StudyScopeOption {
  id: string;
  label: string;
  chapterIds: string[];
}

export function studyScopeOptions(subjectId: string, chapters: Chapter[]): StudyScopeOption[] {
  if (subjectId === 'all') return [];
  if (subjectId === 'criminal-procedure') {
    return criminalProcedureModules.map(module => ({ id: module.id, label: module.name, chapterIds: module.chapterIds }));
  }
  if (subjectId === 'three-international-laws') {
    return threeInternationalLawModules.map(module => ({ id: module.id, label: module.name, chapterIds: module.chapterIds }));
  }
  return chapters
    .filter(chapter => chapter.subjectId === subjectId)
    .sort((left, right) => left.order - right.order)
    .map(chapter => ({ id: chapter.id, label: chapter.name, chapterIds: [chapter.id] }));
}

export function filterStudyCards(cards: Card[], subjectId: string, scope?: StudyScopeOption) {
  const chapterIds = scope ? new Set(scope.chapterIds) : null;
  return cards.filter(card => (subjectId === 'all' || card.subjectId === subjectId)
    && (!chapterIds || chapterIds.has(card.chapterId) || card.relatedChapterIds?.some(chapterId => chapterIds.has(chapterId))));
}

export function orderStudyCards(cards: Card[], subjects: Subject[], chapters: Chapter[]) {
  const sourceIndex = new Map(cards.map((card, index) => [card.id, index]));
  const subjectOrder = new Map(subjects.map(subject => [subject.id, subject.order]));
  const chapterOrder = new Map(chapters.map(chapter => [chapter.id, chapter.order]));
  return [...cards].sort((left, right) =>
    (subjectOrder.get(left.subjectId) ?? Number.MAX_SAFE_INTEGER) - (subjectOrder.get(right.subjectId) ?? Number.MAX_SAFE_INTEGER)
    || (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER)
    || (sourceIndex.get(left.id) ?? 0) - (sourceIndex.get(right.id) ?? 0));
}

export function shuffleStudyCards(cards: Card[], random: () => number = Math.random) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function buildStudyGroup(cards: Card[], subjects: Subject[], chapters: Chapter[], order: StudyOrder, size: number) {
  const arranged = order === 'random' ? shuffleStudyCards(cards) : orderStudyCards(cards, subjects, chapters);
  return arranged.slice(0, size);
}

export function buildTypeFocusPool(cards: Card[], priorityCards: Card[], type: Card['type']) {
  const seen = new Set<string>();
  return [...priorityCards, ...cards].filter(card => {
    if (card.type !== type || seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}
