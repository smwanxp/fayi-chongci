import type { StudyContentStorage } from '@shared/api.interface';

export type CardType = 'recall' | 'judgment' | 'mnemonic';
export type RelationKind = 'confusable' | 'exception' | 'counterexample' | 'statute' | 'trap';
export type MasteryRating = 'again' | 'hard' | 'good' | 'easy';
export type ReviewMode = 'adaptive' | 'fixed';

export interface Subject { id: string; name: string; order: number; color: string; }
export interface Chapter { id: string; subjectId: string; name: string; order: number; }
export interface Card {
  id: string;
  subjectId: string;
  chapterId: string;
  relatedChapterIds?: string[];
  type: CardType;
  prompt: string;
  answer: string;
  judgmentAnswer?: boolean;
  mnemonicSegments?: MnemonicSegment[];
  explanation: string;
  statute?: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
export interface MnemonicSegment { text: string; knowledgePoint: string; }
export interface Relation { id: string; fromCardId: string; toCardId: string; kind: RelationKind; note: string; }
export interface ReviewState {
  cardId: string;
  dueAt: string;
  intervalMinutes: number;
  fixedStep: number;
  stability: number;
  difficulty: number;
  correctStreak: number;
  lapseCount: number;
  lastRating?: MasteryRating;
  lastCorrect?: boolean;
  lastReviewedAt?: string;
  quickRecallStatus?: 'mastered' | 'vague' | 'unfamiliar';
}
export interface ReviewLog {
  id: string;
  cardId: string;
  reviewedAt: string;
  objectiveCorrect?: boolean;
  rating: MasteryRating;
  mode: ReviewMode;
  nextDueAt: string;
  elapsedMs: number;
}
export interface ImportBatch {
  id: string;
  filename: string;
  fingerprint: string;
  format: string;
  status: 'draft' | 'confirmed' | 'failed';
  createdAt: string;
  draftCount: number;
  error?: string;
}
export interface DraftCard extends Omit<Card, 'id' | 'createdAt' | 'updatedAt'> {
  id: string;
  batchId: string;
  selected: boolean;
  sourcePage?: number;
}
export type DQType = 'single' | 'multiple' | 'uncertain';

export interface DailyQuestion {
  id: string;
  subjectId: string;
  chapterId?: string;
  number: number;
  source: string;
  qtype: DQType | null;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string | null;
  analysis?: string;
  tags?: string[];
  law?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
}

export interface DQState {
  qid: string;
  picked?: string[];
  correct?: boolean;
  answeredAt?: string;
  correctStreak: number;
  inWrongBook?: boolean;
  starred?: boolean;
}

export interface DQLog {
  id: string;
  qid: string;
  picked: string[];
  correct: boolean;
  answeredAt: string;
}

export interface AppSettings {
  id: 'app';
  reviewMode: ReviewMode;
  fixedIntervals: number[];
  dailyGoal: number;
  newCardLimit: number;
  examDate?: string;
  dqWrongRemoveThreshold: number;
  quickRecallIncludeJudgment: boolean;
  fontScale?: 0.9 | 1 | 1.12 | 1.25;
  contentScopeVersion?: number;
  seedVersion?: number;
  masteryBaselineVersion?: number;
  adminConstitutionVersion?: number;
}
export type NoteImportance = 'normal' | 'important' | 'frequent' | 'exam';
export type NoteStatus = 'inbox' | 'review' | 'understood' | 'mastered' | 'archived';
export type NoteSourceType = 'past-exam' | 'mock' | 'guide' | 'textbook' | 'teacher' | 'other';
export type NoteReminderMode = 'none' | 'once' | 'interval' | 'custom' | 'exam';

export interface NoteSource {
  id: string;
  type: NoteSourceType;
  name: string;
  detail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteQuestionSource {
  id: string;
  sourceId?: string;
  paper?: string;
  year?: string;
  questionNo?: string;
  questionType?: string;
  stem?: string;
  options?: string;
  answer?: string;
  analysis?: string;
}

export interface PersonalKnowledgePoint {
  id: string;
  subjectId: string;
  chapterId?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteStructuredContent {
  coreConclusion?: string;
  ruleExplanation?: string;
  exceptions?: string;
  confusable?: string;
  statute?: string;
  mistakeReason?: string;
  mnemonic?: string;
  extraReminder?: string;
}

export interface NoteReminder {
  mode: NoteReminderMode;
  nextAt?: string;
  intervalDays?: number;
  customDates?: string[];
}

export interface NoteReviewLog {
  id: string;
  noteId: string;
  reviewedAt: string;
  outcome: 'again' | 'understood' | 'mastered';
  nextDueAt?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  contentFormat?: 'plain' | 'html';
  subjectId?: string;
  chapterId?: string;
  customChapterName?: string;
  cardId?: string;
  cardIds?: string[];
  knowledgePointIds?: string[];
  relatedSubjectIds?: string[];
  relatedNoteIds?: string[];
  structured?: NoteStructuredContent;
  questionSources?: NoteQuestionSource[];
  importance?: NoteImportance;
  status?: NoteStatus;
  reminder?: NoteReminder;
  tags: string[];
  pinned: boolean;
  trashedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export type ExamFeedbackMode = 'instant' | 'submit';
export type ExamPracticeKind = 'mixed' | 'mnemonic' | 'judgment' | 'recall';
export type StudyRoundMode = 'guided' | `exam:${ExamPracticeKind}`;
export interface StudyRoundProgress {
  id: string;
  mode: StudyRoundMode;
  cardId: string;
  completedAt: string;
}
export interface ExamAnswer {
  response: string | boolean | null;
  score?: number;
  checked?: boolean;
}
export interface ExamSession {
  id: 'active';
  cardIds: string[];
  subjectId: string;
  practiceKind?: ExamPracticeKind;
  feedbackMode: ExamFeedbackMode;
  answers: Record<string, ExamAnswer>;
  currentIndex: number;
  status: 'active' | 'completed';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
export interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  contentRevision?: number;
  subjects: Subject[];
  chapters: Chapter[];
  cards: Card[];
  relations: Relation[];
  reviewStates: ReviewState[];
  reviewLogs: ReviewLog[];
  importBatches: ImportBatch[];
  drafts: DraftCard[];
  notes: Note[];
  noteSources?: NoteSource[];
  personalKnowledgePoints?: PersonalKnowledgePoint[];
  noteReviewLogs?: NoteReviewLog[];
  examSessions?: ExamSession[];
  dqStates?: DQState[];
  dqLogs?: DQLog[];
  dailyQuestions?: DailyQuestion[];
  studyRoundProgress?: StudyRoundProgress[];
  contentStorage?: StudyContentStorage;
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  reviewMode: 'adaptive',
  fixedIntervals: [10, 1440, 4320, 10080, 21600, 43200],
  dailyGoal: 42,
  newCardLimit: 15,
  examDate: '2026-09-12',
  dqWrongRemoveThreshold: 1,
  quickRecallIncludeJudgment: true,
  fontScale: 1,
  contentScopeVersion: 1,
  seedVersion: 7,
};
