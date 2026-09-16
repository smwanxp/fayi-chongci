import type { Card, Chapter, Relation, Subject } from './types';

const createdAt = '2026-01-01T00:00:00.000Z';

/**
 * 开源仓库仅附带虚构示例数据，用于演示功能与数据格式。
 * 正式题库、口诀和用户数据不属于本仓库。
 */
export const seedSubjects: Subject[] = [
  { id: 'demo-subject', name: '示例科目', color: '#63766b', order: 0 },
];

export const seedChapters: Chapter[] = [
  { id: 'demo-chapter-basics', subjectId: 'demo-subject', name: '示例章节：基础概念', order: 1 },
];

export const seedCards: Card[] = [
  {
    id: 'demo-mnemonic-01',
    subjectId: 'demo-subject',
    chapterId: 'demo-chapter-basics',
    type: 'mnemonic',
    prompt: '示例口诀：复习的三个动作',
    answer: '回忆、核对、标记',
    explanation: '先主动回忆，再核对答案，最后按真实掌握程度标记。',
    mnemonicSegments: [
      { text: '回忆', knowledgePoint: '不看答案主动复述' },
      { text: '核对', knowledgePoint: '对照完整答案查漏' },
      { text: '标记', knowledgePoint: '记录真实掌握程度' },
    ],
    tags: ['示例', '口诀'],
    source: '开源示例数据',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: 'demo-judgment-01',
    subjectId: 'demo-subject',
    chapterId: 'demo-chapter-basics',
    type: 'judgment',
    prompt: '只要看过答案，就等于已经掌握该知识点。',
    answer: '错误。看懂不等于能够独立回忆。',
    judgmentAnswer: false,
    explanation: '应通过主动回忆或默写检验掌握程度。',
    tags: ['示例', '判断'],
    source: '开源示例数据',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: 'demo-recall-01',
    subjectId: 'demo-subject',
    chapterId: 'demo-chapter-basics',
    type: 'recall',
    prompt: '间隔复习的核心目的是什么？',
    answer: '在即将遗忘时再次提取记忆，从而巩固长期记忆。',
    explanation: '这是功能演示卡，不是任何商业资料的摘录。',
    tags: ['示例', '知识卡'],
    source: '开源示例数据',
    createdAt,
    updatedAt: createdAt,
  },
];

export const seedRelations: Relation[] = [
  {
    id: 'demo-relation-01',
    fromCardId: 'demo-mnemonic-01',
    toCardId: 'demo-recall-01',
    kind: 'confusable',
    note: '两张卡都用于演示主动回忆与间隔复习之间的联系。',
  },
];

export const seedReviewStates: never[] = [];
