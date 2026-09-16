import type { Card, Chapter, DailyQuestion, DQLog, DQState, ReviewState, Subject } from './types';
import { allDailyQuestions, dqSubjects as dqSubjectCatalog } from './daily-questions';
import { criminalProcedureModules } from './criminal-procedure-seed';
import { threeInternationalLawModules } from './three-international-laws-seed';

export type DashboardContentFilter = 'all' | 'memorize' | 'judgment' | 'dq';
export type DashboardStatusFilter = 'all' | 'new' | 'weak' | 'mastered' | 'due';

export interface DashboardSubjectDef {
  id: string;
  name: string;
  color: string;
  cardSubjectId?: string;
  dqSubjectId?: string;
}

export interface DashboardSubjectSummary {
  subject: DashboardSubjectDef;
  total: number;
  learned: number;
  newCount: number;
  learning: number;
  mastered: number;
  weak: number;
  due: number;
  cardsTotal: number;
  cardsStudied: number;
  cardsMastered: number;
  cardsWeak: number;
  dqTotal: number;
  dqAnswered: number;
  dqMastered: number;
  dqWeak: number;
  dqAttempts: number;
  dqCorrectAttempts: number;
  coverageRate: number;
  cardMasteryRate: number | null;
  dqAccuracyRate: number | null;
}

export interface DashboardTreeNode {
  id: string;
  label: string;
  kind: 'subject' | 'volume' | 'module' | 'chapter' | 'tag' | 'item';
  children: DashboardTreeNode[];
  cardIds: string[];
  qids: string[];
}

const DQ_TO_SUBJECT: Record<string, string> = {
  'dq-xingfa': 'criminal-law',
  'dq-xingsu': 'criminal-procedure',
  'dq-xingzheng': 'administrative-law',
  'dq-minshang': 'civil-commercial-law',
  'dq-minsu': 'civil-procedure',
  'dq-sanguo': 'three-international-laws',
  'dq-shangjingzhi': 'commercial-economic-ip',
};

const DQ_COLORS: Record<string, string> = {
  'dq-xingfa': '#7b6259',
  'dq-xingsu': '#63766b',
  'dq-xingzheng': '#71816f',
  'dq-minshang': '#8a725b',
  'dq-minsu': '#7f776c',
  'dq-sanguo': '#6d708b',
  'dq-shangjingzhi': '#8a7857',
};

export const dashboardSubjectIdForQuestion = (question: DailyQuestion) =>
  DQ_TO_SUBJECT[question.subjectId] ?? question.subjectId;

export function buildDashboardSubjects(subjects: Subject[], questions: DailyQuestion[] = allDailyQuestions): DashboardSubjectDef[] {
  const byId = new Map<string, DashboardSubjectDef>();
  for (const subject of subjects) {
    byId.set(subject.id, {
      id: subject.id,
      name: subject.name,
      color: subject.color,
      cardSubjectId: subject.id,
    });
  }
  const questionSubjectIds = new Set(questions.filter(question => !question.archivedAt).map(question => question.subjectId));
  const dailySubjects = [...dqSubjectCatalog.map(subject => subject.id), ...[...questionSubjectIds].filter(id => !dqSubjectCatalog.some(subject => subject.id === id))];
  for (const dqSubjectId of dailySubjects) {
    const id = DQ_TO_SUBJECT[dqSubjectId] ?? dqSubjectId;
    const current = byId.get(id);
    byId.set(id, {
      id,
      name: current?.name ?? dqSubjectCatalog.find(subject => subject.id === dqSubjectId)?.name ?? dqSubjectId,
      color: current?.color ?? DQ_COLORS[dqSubjectId] ?? '#63766b',
      cardSubjectId: current?.cardSubjectId,
      dqSubjectId,
    });
  }
  const preferred = ['civil-commercial-law', 'criminal-law', 'administrative-law', 'criminal-procedure', 'civil-procedure', 'commercial-economic-ip', 'theory', 'three-international-laws'];
  return [...byId.values()].sort((a, b) => {
    const ai = preferred.indexOf(a.id); const bi = preferred.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name, 'zh-CN');
  });
}
export const isCardMastered = (state?: ReviewState) => Boolean(
  state?.lastReviewedAt &&
  (state.lastRating === 'good' || state.lastRating === 'easy') &&
  state.lastCorrect !== false,
);

export const isCardWeak = (state?: ReviewState) => Boolean(
  state?.lastReviewedAt && (
    state.lastRating === 'again' || state.lastRating === 'hard' ||
    state.lastCorrect === false || state.quickRecallStatus === 'vague' ||
    state.quickRecallStatus === 'unfamiliar'
  ),
);

export function cardMatchesContent(card: Card, filter: DashboardContentFilter) {
  if (filter === 'dq') return false;
  if (filter === 'judgment') return card.type === 'judgment';
  if (filter === 'memorize') return card.type === 'mnemonic' || card.type === 'recall';
  return true;
}

export function buildSubjectSummaries(input: {
  definitions: DashboardSubjectDef[];
  cards: Card[];
  questions: DailyQuestion[];
  states: ReviewState[];
  dqStates: DQState[];
  dqLogs: DQLog[];
  contentFilter: DashboardContentFilter;
  nowMs: number;
}): DashboardSubjectSummary[] {
  const stateMap = new Map(input.states.map(state => [state.cardId, state]));
  const dqStateMap = new Map(input.dqStates.map(state => [state.qid, state]));
  const questionMap = new Map(input.questions.map(question => [question.id, question]));
  return input.definitions.map(subject => {
    const subjectCards = subject.cardSubjectId
      ? input.cards.filter(card => card.subjectId === subject.cardSubjectId && cardMatchesContent(card, input.contentFilter))
      : [];
    const subjectQuestions = input.contentFilter === 'all' || input.contentFilter === 'dq'
      ? input.questions.filter(question => subject.dqSubjectId === question.subjectId)
      : [];
    let cardsStudied = 0, cardsMastered = 0, cardsWeak = 0, due = 0;
    for (const card of subjectCards) {
      const state = stateMap.get(card.id);
      if (state?.lastReviewedAt) cardsStudied += 1;
      if (isCardWeak(state)) cardsWeak += 1;
      else if (isCardMastered(state)) cardsMastered += 1;
      if (state?.lastReviewedAt && new Date(state.dueAt).getTime() <= input.nowMs) due += 1;
    }
    let dqAnswered = 0, dqMastered = 0, dqWeak = 0;
    const subjectQuestionIds = new Set(subjectQuestions.map(question => question.id));
    for (const question of subjectQuestions) {
      const state = dqStateMap.get(question.id);
      if (state?.answeredAt) dqAnswered += 1;
      if (state?.inWrongBook || (state?.answeredAt && state.correct === false)) dqWeak += 1;
      else if (state?.answeredAt && state.correct) dqMastered += 1;
    }
    const answerableIds = new Set(subjectQuestions.filter(question => Boolean(question.answer)).map(question => question.id));
    const attempts = input.dqLogs.filter(log => subjectQuestionIds.has(log.qid) && answerableIds.has(log.qid) && questionMap.has(log.qid));
    const total = subjectCards.length + subjectQuestions.length;
    const learned = cardsStudied + dqAnswered;
    const mastered = cardsMastered + dqMastered;
    const weak = cardsWeak + dqWeak;
    const newCount = total - learned;
    const learning = Math.max(0, learned - mastered - weak);
    return {
      subject,
      total,
      learned,
      newCount,
      learning,
      mastered,
      weak,
      due,
      cardsTotal: subjectCards.length,
      cardsStudied,
      cardsMastered,
      cardsWeak,
      dqTotal: subjectQuestions.length,
      dqAnswered,
      dqMastered,
      dqWeak,
      dqAttempts: attempts.length,
      dqCorrectAttempts: attempts.filter(log => log.correct).length,
      coverageRate: total ? Math.round(learned / total * 100) : 0,
      cardMasteryRate: subjectCards.length ? Math.round(cardsMastered / subjectCards.length * 100) : null,
      dqAccuracyRate: attempts.length ? Math.round(attempts.filter(log => log.correct).length / attempts.length * 100) : null,
    };
  }).filter(summary => summary.total > 0);
}

const cleanCardTitle = (card: Card) => card.prompt.replace(/^请完整默写：\s*/, '').trim();
const IGNORED_TAGS = new Set(['民法', '民商法', '刑法', '行政法', '刑诉', '刑诉法', '刑事诉讼法', '民诉法', '商经知', '理论法', '三国法', '每日一题']);
export function primaryQuestionTag(question: DailyQuestion) {
  return question.tags?.find(tag => !IGNORED_TAGS.has(tag)) ?? question.tags?.[0] ?? '未分类知识点';
}

const node = (id: string, label: string, kind: DashboardTreeNode['kind'], children: DashboardTreeNode[] = [], cardIds: string[] = [], qids: string[] = []): DashboardTreeNode => ({ id, label, kind, children, cardIds, qids });

export function buildDashboardHierarchy(input: {
  definitions: DashboardSubjectDef[];
  chapters: Chapter[];
  cards: Card[];
  questions: DailyQuestion[];
  contentFilter: DashboardContentFilter;
}): DashboardTreeNode[] {
  const chapterMap = new Map(input.chapters.map(chapter => [chapter.id, chapter]));
  const cardLeaves = (chapterId: string, subjectId: string) => input.cards
    .filter(card => card.subjectId === subjectId && card.chapterId === chapterId && cardMatchesContent(card, input.contentFilter))
    .map(card => node(`card:${card.id}`, cleanCardTitle(card), 'item', [], [card.id]));
  const chapterNode = (chapterId: string, subjectId: string) => {
    const chapter = chapterMap.get(chapterId);
    const children = cardLeaves(chapterId, subjectId);
    return children.length ? node(`chapter:${chapterId}`, chapter?.name ?? chapterId, 'chapter', children) : null;
  };

  return input.definitions.map(subject => {
    const children: DashboardTreeNode[] = [];
    if (subject.cardSubjectId && input.contentFilter !== 'dq') {
      const cardGroups: DashboardTreeNode[] = [];
      if (subject.cardSubjectId === 'criminal-procedure') {
        const volumes = new Map<string, DashboardTreeNode[]>();
        for (const studyModule of criminalProcedureModules) {
          const moduleChildren = studyModule.chapterIds.map(id => chapterNode(id, subject.cardSubjectId!)).filter(Boolean) as DashboardTreeNode[];
          if (!moduleChildren.length) continue;
          const volume = studyModule.description.split(' · ')[0] || '刑事诉讼法';
          volumes.set(volume, [...(volumes.get(volume) ?? []), node(`module:${studyModule.id}`, studyModule.name, 'module', moduleChildren)]);
        }
        for (const [volume, modules] of volumes) cardGroups.push(node(`volume:${subject.id}:${volume}`, volume, 'volume', modules));
      } else if (subject.cardSubjectId === 'three-international-laws') {
        for (const studyModule of threeInternationalLawModules) {
          const moduleChildren = studyModule.chapterIds.map(id => chapterNode(id, subject.cardSubjectId!)).filter(Boolean) as DashboardTreeNode[];
          if (moduleChildren.length) cardGroups.push(node(`module:${studyModule.id}`, studyModule.name, 'module', moduleChildren));
        }
      } else {
        const subjectChapters = input.chapters.filter(chapter => chapter.subjectId === subject.cardSubjectId).sort((a, b) => a.order - b.order);
        const chapterNodes = subjectChapters.map(chapter => chapterNode(chapter.id, subject.cardSubjectId!)).filter(Boolean) as DashboardTreeNode[];
        if (subject.cardSubjectId === 'theory' && chapterNodes.length) cardGroups.push(node('module:theory:constitution', '宪法', 'module', chapterNodes));
        else cardGroups.push(...chapterNodes);
      }
      if (cardGroups.length) {
        const label = input.contentFilter === 'judgment' ? '判断题' : input.contentFilter === 'memorize' ? '口诀与背诵卡' : '口诀、背诵与判断卡';
        children.push(node(`cards:${subject.id}`, label, 'module', cardGroups));
      }
    }
    if (subject.dqSubjectId && (input.contentFilter === 'all' || input.contentFilter === 'dq')) {
      const groups = new Map<string, DailyQuestion[]>();
      for (const question of input.questions.filter(item => item.subjectId === subject.dqSubjectId)) {
        const tag = primaryQuestionTag(question);
        groups.set(tag, [...(groups.get(tag) ?? []), question]);
      }
      const tagNodes = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')).map(([tag, questions]) =>
        node(`tag:${subject.id}:${tag}`, tag, 'tag', questions.map(question => node(`dq:${question.id}`, `第${question.number}题 · ${question.stem.replace(/\s+/g, ' ').slice(0, 72)}`, 'item', [], [], [question.id]))),
      );
      if (tagNodes.length) children.push(node(`dq:${subject.id}`, '每日一题 · 知识点标签', 'module', tagNodes));
    }
    return node(`subject:${subject.id}`, subject.name, 'subject', children);
  }).filter(root => root.children.length > 0);
}
