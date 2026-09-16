import type { DailyQuestion } from '../types';

export interface DQSubjectMeta {
  id: string;
  name: string;
  questions: DailyQuestion[];
}

const demoQuestions: DailyQuestion[] = [
  {
    id: 'demo-dq-001',
    subjectId: 'demo-subject',
    chapterId: 'demo-chapter-basics',
    number: 1,
    source: '开源示例数据',
    qtype: 'single',
    stem: '哪一种做法更适合检验是否真正掌握知识？',
    options: [
      { key: 'A', text: '反复浏览答案' },
      { key: 'B', text: '遮住答案后主动复述' },
      { key: 'C', text: '只收藏不复习' },
      { key: 'D', text: '只统计学习时长' },
    ],
    answer: 'B',
    analysis: '主动提取比单纯重复阅读更能检验记忆。',
    tags: ['示例'],
  },
];

export const dqSubjects: DQSubjectMeta[] = [
  { id: 'demo-subject', name: '示例科目', questions: demoQuestions },
];

export const allDailyQuestions: DailyQuestion[] = dqSubjects.flatMap(subject => subject.questions);

export const hasOfficialAnswerRevision = (_question: DailyQuestion): boolean => false;

export const dqSubjectName = (subjectId: string): string =>
  dqSubjects.find(subject => subject.id === subjectId)?.name ?? subjectId;
