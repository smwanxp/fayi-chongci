'use client';

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { saveStudyData } from '@/api';
import { queuePriority, scheduleNext } from './scheduler';
import { quickRecallStatusForRating } from './quick-recall';
import { seedCards, seedChapters, seedRelations, seedSubjects } from './seed';
import { allDailyQuestions, hasOfficialAnswerRevision } from './daily-questions';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackupPayload,
  type Card,
  type DraftCard,
  type ExamSession,
  type ImportBatch,
  type MasteryRating,
  type Note,
  type NoteReviewLog,
  type NoteSource,
  type PersonalKnowledgePoint,
  type Relation,
  type ReviewLog,
  type ReviewState,
  type Subject,
  type Chapter,
  type DQLog,
  type DQState,
  type DailyQuestion,
  type StudyRoundMode,
  type StudyRoundProgress,
} from './types';

const DB_NAME = 'fayi-chongci';
const DB_VERSION = 7;
// IndexedDB is the immediate, durable store.  The cloud copy is a whole-user
// snapshot, so coalescing edits avoids writing several large snapshots during
// one study session; explicit submit/logout actions still flush immediately.
const REMOTE_SYNC_DEBOUNCE_MS = 90_000;
const STORE_NAMES = ['subjects','chapters','cards','relations','reviewStates','reviewLogs','importBatches','drafts','notes','noteSources','personalKnowledgePoints','noteReviewLogs','examSessions','settings','dqStates','dqLogs','dailyQuestions','studyRoundProgress'] as const;

interface StudyDB extends DBSchema {
  subjects: { key: string; value: Subject };
  chapters: { key: string; value: Chapter; indexes: { 'by-subject': string } };
  cards: { key: string; value: Card; indexes: { 'by-subject': string; 'by-chapter': string } };
  relations: { key: string; value: Relation; indexes: { 'by-from': string; 'by-to': string } };
  reviewStates: { key: string; value: ReviewState; indexes: { 'by-due': string } };
  reviewLogs: { key: string; value: ReviewLog; indexes: { 'by-card': string; 'by-reviewed': string } };
  importBatches: { key: string; value: ImportBatch; indexes: { 'by-fingerprint': string } };
  drafts: { key: string; value: DraftCard; indexes: { 'by-batch': string } };
  notes: { key: string; value: Note; indexes: { 'by-updated': string; 'by-subject': string; 'by-card': string } };
  noteSources: { key: string; value: NoteSource; indexes: { 'by-updated': string } };
  personalKnowledgePoints: { key: string; value: PersonalKnowledgePoint; indexes: { 'by-subject': string; 'by-chapter': string } };
  noteReviewLogs: { key: string; value: NoteReviewLog; indexes: { 'by-note': string; 'by-reviewed': string } };
  examSessions: { key: string; value: ExamSession };
  settings: { key: string; value: AppSettings };
  dqStates: { key: string; value: DQState };
  dqLogs: { key: string; value: DQLog; indexes: { 'by-qid': string } };
  dailyQuestions: { key: string; value: DailyQuestion; indexes: { 'by-subject': string } };
  studyRoundProgress: { key: string; value: StudyRoundProgress; indexes: { 'by-mode': StudyRoundMode } };
}

export interface ReviewSubmission { cardId: string; rating: MasteryRating; objectiveCorrect?: boolean; elapsedMs: number; quickRecall?: boolean; }

export interface StudyRepository {
  initialize(applyContentSeeds?: boolean): Promise<void>;
  getCards(): Promise<Card[]>;
  getAllCards(): Promise<Card[]>;
  archiveCard(id: string, archived: boolean): Promise<void>;
  saveCard(card: Card, resetProgress?: boolean): Promise<void>;
  saveChapter(chapter: Chapter): Promise<void>;
  getDailyQuestions(): Promise<DailyQuestion[]>;
  getAllDailyQuestions(): Promise<DailyQuestion[]>;
  archiveDailyQuestion(id: string, archived: boolean): Promise<void>;
  saveDailyQuestion(question: DailyQuestion, resetProgress?: boolean): Promise<void>;
  getSubjects(): Promise<Subject[]>;
  getChapters(): Promise<Chapter[]>;
  getRelations(): Promise<Relation[]>;
  getReviewStates(): Promise<ReviewState[]>;
  getReviewLogs(): Promise<ReviewLog[]>;
  getSettings(): Promise<AppSettings>;
  getDailyQueue(): Promise<Card[]>;
  recordReview(input: ReviewSubmission): Promise<ReviewState>;
  resetQuickRecallProgress(cardIds: string[]): Promise<void>;
  markQuickRecall(cardId: string, rating: 'again' | 'hard' | 'good'): Promise<void>;
  getStudyRoundProgress(): Promise<StudyRoundProgress[]>;
  markStudyRoundCompleted(mode: StudyRoundMode, cardIds: string[]): Promise<void>;
  resetStudyRound(mode: StudyRoundMode, cardIds: string[]): Promise<void>;
  clearAllProgress(): Promise<void>;
  getDQStates(): Promise<DQState[]>;
  getDQLogs(): Promise<DQLog[]>;
  recordDQAnswer(input: { qid: string; picked: string[]; correct: boolean; removeThreshold: number }): Promise<DQState>;
  setDQStarred(qid: string, starred: boolean): Promise<void>;
  removeDQFromWrongBook(qid: string): Promise<void>;
  saveSettings(settings: AppSettings): Promise<void>;
  hasFingerprint(fingerprint: string): Promise<boolean>;
  addImport(batch: ImportBatch, drafts: DraftCard[]): Promise<void>;
  getImportBatches(): Promise<ImportBatch[]>;
  getDrafts(batchId?: string): Promise<DraftCard[]>;
  getNotes(): Promise<Note[]>;
  saveNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  getNoteSources(): Promise<NoteSource[]>;
  saveNoteSource(source: NoteSource): Promise<void>;
  deleteNoteSource(id: string): Promise<void>;
  getPersonalKnowledgePoints(): Promise<PersonalKnowledgePoint[]>;
  savePersonalKnowledgePoint(point: PersonalKnowledgePoint): Promise<void>;
  deletePersonalKnowledgePoint(id: string): Promise<void>;
  getNoteReviewLogs(): Promise<NoteReviewLog[]>;
  recordNoteReview(log: NoteReviewLog): Promise<void>;
  getExamSession(): Promise<ExamSession | undefined>;
  saveExamSession(session: ExamSession): Promise<void>;
  clearExamSession(): Promise<void>;
  updateDraft(draft: DraftCard): Promise<void>;
  confirmDrafts(batchId: string): Promise<number>;
  exportBackup(): Promise<BackupPayload>;
  restoreBackup(payload: BackupPayload): Promise<void>;
  replaceUserData(payload: BackupPayload): Promise<void>;
  enableRemoteSync(): void;
  disableRemoteSync(): void;
  flushRemoteSync(): Promise<void>;
}

class IndexedDbStudyRepository implements StudyRepository {
  private dbPromise?: Promise<IDBPDatabase<StudyDB>>;
  private remoteSyncEnabled = false;
  private remoteDirty = false;
  private remoteTimer?: ReturnType<typeof setTimeout>;
  private remoteInFlight?: Promise<void>;
  private contentRevision = 0;

  enableRemoteSync() {
    this.remoteSyncEnabled = true;
  }

  disableRemoteSync() {
    this.remoteSyncEnabled = false;
    this.remoteDirty = false;
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = undefined;
  }

  private changed() {
    if (!this.remoteSyncEnabled) return;
    this.remoteDirty = true;
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = setTimeout(() => void this.pushRemote(), REMOTE_SYNC_DEBOUNCE_MS);
  }

  private async pushRemote() {
    if (!this.remoteSyncEnabled || !this.remoteDirty) return;
    if (this.remoteInFlight) return this.remoteInFlight;
    this.remoteInFlight = (async () => {
      while (this.remoteSyncEnabled && this.remoteDirty) {
        this.remoteDirty = false;
        const payload = await this.exportBackup();
        const result = await saveStudyData({ payload });
        if (result.contentRefreshRequired && typeof window !== 'undefined') window.dispatchEvent(new Event('fayi-content-refresh-required'));
      }
    })();
    try {
      await this.remoteInFlight;
    } catch {
      if (this.remoteSyncEnabled) this.remoteTimer = setTimeout(() => void this.pushRemote(), 5000);
    } finally {
      this.remoteInFlight = undefined;
    }
  }

  async flushRemoteSync() {
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = undefined;
    await this.pushRemote();
  }

  private async keepOnlyTheory(db: IDBPDatabase<StudyDB>, settings: AppSettings) {
    const stores = ['subjects','chapters','cards','relations','reviewStates','reviewLogs','drafts','notes','examSessions','settings'] as const;
    const tx = db.transaction([...stores], 'readwrite');
    const [subjects, chapters, cards, relations, states, logs, drafts, notes, examSession] = await Promise.all([
      tx.objectStore('subjects').getAll(), tx.objectStore('chapters').getAll(), tx.objectStore('cards').getAll(),
      tx.objectStore('relations').getAll(), tx.objectStore('reviewStates').getAll(), tx.objectStore('reviewLogs').getAll(),
      tx.objectStore('drafts').getAll(), tx.objectStore('notes').getAll(), tx.objectStore('examSessions').get('active'),
    ]);
    const theoryCardIds = new Set(cards.filter(card => card.subjectId === 'theory').map(card => card.id));
    const removals: Promise<unknown>[] = [
      ...subjects.filter(subject => subject.id !== 'theory').map(subject => tx.objectStore('subjects').delete(subject.id)),
      ...chapters.filter(chapter => chapter.subjectId !== 'theory').map(chapter => tx.objectStore('chapters').delete(chapter.id)),
      ...cards.filter(card => card.subjectId !== 'theory').map(card => tx.objectStore('cards').delete(card.id)),
      ...relations.filter(relation => !theoryCardIds.has(relation.fromCardId) || !theoryCardIds.has(relation.toCardId)).map(relation => tx.objectStore('relations').delete(relation.id)),
      ...states.filter(state => !theoryCardIds.has(state.cardId)).map(state => tx.objectStore('reviewStates').delete(state.cardId)),
      ...logs.filter(log => !theoryCardIds.has(log.cardId)).map(log => tx.objectStore('reviewLogs').delete(log.id)),
      ...drafts.filter(draft => draft.subjectId !== 'theory').map(draft => tx.objectStore('drafts').delete(draft.id)),
      ...notes.filter(note => note.subjectId && note.subjectId !== 'theory' || note.cardId && !theoryCardIds.has(note.cardId)).map(note => tx.objectStore('notes').delete(note.id)),
    ];
    if (examSession) {
      const cardIds = examSession.cardIds.filter(id => theoryCardIds.has(id));
      if (!cardIds.length) removals.push(tx.objectStore('examSessions').delete('active'));
      else removals.push(tx.objectStore('examSessions').put({ ...examSession, cardIds, subjectId: 'theory', answers: Object.fromEntries(Object.entries(examSession.answers).filter(([id]) => theoryCardIds.has(id))), currentIndex: 0, updatedAt: new Date().toISOString() }));
    }
    removals.push(tx.objectStore('settings').put({ ...settings, contentScopeVersion: 1 }));
    await Promise.all(removals);
    await tx.done;
  }

  private db() {
    this.dbPromise ??= openDB<StudyDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('subjects')) db.createObjectStore('subjects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chapters')) {
          const store = db.createObjectStore('chapters', { keyPath: 'id' }); store.createIndex('by-subject', 'subjectId');
        }
        if (!db.objectStoreNames.contains('cards')) {
          const store = db.createObjectStore('cards', { keyPath: 'id' }); store.createIndex('by-subject', 'subjectId'); store.createIndex('by-chapter', 'chapterId');
        }
        if (!db.objectStoreNames.contains('relations')) {
          const store = db.createObjectStore('relations', { keyPath: 'id' }); store.createIndex('by-from', 'fromCardId'); store.createIndex('by-to', 'toCardId');
        }
        if (!db.objectStoreNames.contains('reviewStates')) {
          const store = db.createObjectStore('reviewStates', { keyPath: 'cardId' }); store.createIndex('by-due', 'dueAt');
        }
        if (!db.objectStoreNames.contains('reviewLogs')) {
          const store = db.createObjectStore('reviewLogs', { keyPath: 'id' }); store.createIndex('by-card', 'cardId'); store.createIndex('by-reviewed', 'reviewedAt');
        }
        if (!db.objectStoreNames.contains('importBatches')) {
          const store = db.createObjectStore('importBatches', { keyPath: 'id' }); store.createIndex('by-fingerprint', 'fingerprint', { unique: true });
        }
        if (!db.objectStoreNames.contains('drafts')) {
          const store = db.createObjectStore('drafts', { keyPath: 'id' }); store.createIndex('by-batch', 'batchId');
        }
        if (!db.objectStoreNames.contains('notes')) {
          const store = db.createObjectStore('notes', { keyPath: 'id' }); store.createIndex('by-updated', 'updatedAt'); store.createIndex('by-subject', 'subjectId'); store.createIndex('by-card', 'cardId');
        }
        if (!db.objectStoreNames.contains('noteSources')) {
          const store = db.createObjectStore('noteSources', { keyPath: 'id' }); store.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('personalKnowledgePoints')) {
          const store = db.createObjectStore('personalKnowledgePoints', { keyPath: 'id' }); store.createIndex('by-subject', 'subjectId'); store.createIndex('by-chapter', 'chapterId');
        }
        if (!db.objectStoreNames.contains('noteReviewLogs')) {
          const store = db.createObjectStore('noteReviewLogs', { keyPath: 'id' }); store.createIndex('by-note', 'noteId'); store.createIndex('by-reviewed', 'reviewedAt');
        }
        if (!db.objectStoreNames.contains('examSessions')) db.createObjectStore('examSessions', { keyPath: 'id' });
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains('dqStates')) {
            const store = db.createObjectStore('dqStates', { keyPath: 'qid' });
            void store;
          }
          if (!db.objectStoreNames.contains('dqLogs')) {
            const logStore = db.createObjectStore('dqLogs', { keyPath: 'id' });
            logStore.createIndex('by-qid', 'qid');
          }
        }
        if (!db.objectStoreNames.contains('dailyQuestions')) {
          const questionStore = db.createObjectStore('dailyQuestions', { keyPath: 'id' });
          questionStore.createIndex('by-subject', 'subjectId');
          for (const question of allDailyQuestions) void questionStore.put(question);
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('studyRoundProgress')) {
          const roundStore = db.createObjectStore('studyRoundProgress', { keyPath: 'id' });
          roundStore.createIndex('by-mode', 'mode');
        }
      },
    });
    return this.dbPromise;
  }

  async initialize(applyContentSeeds = true) {
    const db = await this.db();
    const expiredBefore = new Date(Date.now() - 30 * 86400000).toISOString();
    const expiredNotes = (await db.getAll('notes')).filter(note => note.trashedAt && note.trashedAt < expiredBefore);
    for (const note of expiredNotes) await this.deleteNote(note.id);
    let settings = await db.get('settings', 'app');
    if (settings && (settings.contentScopeVersion ?? 0) < 1) {
      await this.keepOnlyTheory(db, settings);
      settings = { ...settings, contentScopeVersion: 1 };
    }
    if (settings && applyContentSeeds && (settings.seedVersion ?? 0) < 7) {
      const tx = db.transaction(['subjects','chapters','cards','relations','reviewStates','dailyQuestions'], 'readwrite');
      for (const subject of seedSubjects) if (!(await tx.objectStore('subjects').get(subject.id))) await tx.objectStore('subjects').put(subject);
      for (const chapter of seedChapters) if (!(await tx.objectStore('chapters').get(chapter.id))) await tx.objectStore('chapters').put(chapter);
      for (const card of seedCards) if (!(await tx.objectStore('cards').get(card.id))) await tx.objectStore('cards').put(card);
      for (const relation of seedRelations) if (!(await tx.objectStore('relations').get(relation.id))) await tx.objectStore('relations').put(relation);
      for (const question of allDailyQuestions) {
        const existing = await tx.objectStore('dailyQuestions').get(question.id);
        if (!existing) await tx.objectStore('dailyQuestions').put(question);
        else if (hasOfficialAnswerRevision(question) && question.answer) {
          await tx.objectStore('dailyQuestions').put({
            ...existing,
            answer: question.answer,
            analysis: question.analysis,
            qtype: question.qtype,
            updatedAt: '2026-08-26T00:00:00.000Z',
          });
        }
      }
      await tx.done;
      await db.put('settings', {
        ...settings,
        newCardLimit: 15,
        examDate: settings.examDate ?? DEFAULT_SETTINGS.examDate,
        dqWrongRemoveThreshold: settings.dqWrongRemoveThreshold ?? DEFAULT_SETTINGS.dqWrongRemoveThreshold,
        quickRecallIncludeJudgment: settings.quickRecallIncludeJudgment ?? DEFAULT_SETTINGS.quickRecallIncludeJudgment,
        seedVersion: 7,
      });
      this.changed();
      return;
    }
    if (settings) return;
    const tx = db.transaction(['subjects','chapters','cards','relations','reviewStates','settings'], 'readwrite');
    await Promise.all([
      ...seedSubjects.map(item => tx.objectStore('subjects').put(item)),
      ...seedChapters.map(item => tx.objectStore('chapters').put(item)),
      ...seedCards.map(item => tx.objectStore('cards').put(item)),
      ...seedRelations.map(item => tx.objectStore('relations').put(item)),
      tx.objectStore('settings').put(DEFAULT_SETTINGS),
    ]);
    await tx.done;
  }

  async getAllCards() { return (await this.db()).getAll('cards'); }
  async getCards() { return (await this.getAllCards()).filter(card => !card.archivedAt); }
  async archiveCard(id: string, archived: boolean) { const db=await this.db(); const card=await db.get('cards',id); if(card){await db.put('cards',{...card,archivedAt:archived?new Date().toISOString():undefined,updatedAt:new Date().toISOString()});this.changed();} }
  async saveCard(card: Card, resetProgress = false) {
    const db = await this.db();
    const tx = db.transaction(['cards','reviewStates'], 'readwrite');
    await tx.objectStore('cards').put(card);
    if (resetProgress) await tx.objectStore('reviewStates').delete(card.id);
    await tx.done;
    this.changed();
  }
  async saveChapter(chapter: Chapter) { await (await this.db()).put('chapters', chapter); this.changed(); }
  async getAllDailyQuestions() { return (await this.db()).getAll('dailyQuestions'); }
  async getDailyQuestions() { return (await this.getAllDailyQuestions()).filter(question => !question.archivedAt); }
  async archiveDailyQuestion(id: string, archived: boolean) { const db=await this.db(); const question=await db.get('dailyQuestions',id); if(question){await db.put('dailyQuestions',{...question,archivedAt:archived?new Date().toISOString():undefined,updatedAt:new Date().toISOString()});this.changed();} }
  async saveDailyQuestion(question: DailyQuestion, resetProgress = false) {
    const db = await this.db();
    const tx = db.transaction(['dailyQuestions','dqStates'], 'readwrite');
    await tx.objectStore('dailyQuestions').put(question);
    if (resetProgress) await tx.objectStore('dqStates').delete(question.id);
    await tx.done;
    this.changed();
  }
  async getSubjects() { return (await this.db()).getAll('subjects'); }
  async getChapters() { return (await this.db()).getAll('chapters'); }
  async getRelations() { return (await this.db()).getAll('relations'); }
  async getReviewStates() { return (await this.db()).getAll('reviewStates'); }
  async getReviewLogs() { return (await this.db()).getAll('reviewLogs'); }
  async getImportBatches() { return (await this.db()).getAll('importBatches'); }
  async getNotes() { return (await this.db()).getAll('notes'); }
  async saveNote(note: Note) { await (await this.db()).put('notes', note); this.changed(); }
  async deleteNote(id: string) {
    const db = await this.db();
    const tx = db.transaction(['notes','noteReviewLogs'], 'readwrite');
    await tx.objectStore('notes').delete(id);
    for (const log of await tx.objectStore('noteReviewLogs').index('by-note').getAll(id)) await tx.objectStore('noteReviewLogs').delete(log.id);
    await tx.done;
    this.changed();
  }
  async getNoteSources() { return (await this.db()).getAll('noteSources'); }
  async saveNoteSource(source: NoteSource) { await (await this.db()).put('noteSources', source); this.changed(); }
  async deleteNoteSource(id: string) { await (await this.db()).delete('noteSources', id); this.changed(); }
  async getPersonalKnowledgePoints() { return (await this.db()).getAll('personalKnowledgePoints'); }
  async savePersonalKnowledgePoint(point: PersonalKnowledgePoint) { await (await this.db()).put('personalKnowledgePoints', point); this.changed(); }
  async deletePersonalKnowledgePoint(id: string) { await (await this.db()).delete('personalKnowledgePoints', id); this.changed(); }
  async getNoteReviewLogs() { return (await this.db()).getAll('noteReviewLogs'); }
  async recordNoteReview(log: NoteReviewLog) { await (await this.db()).put('noteReviewLogs', log); this.changed(); }
  async getExamSession() { return (await this.db()).get('examSessions', 'active'); }
  async saveExamSession(session: ExamSession) { await (await this.db()).put('examSessions', session); this.changed(); }
  async clearExamSession() { await (await this.db()).delete('examSessions', 'active'); this.changed(); }
  async getSettings(): Promise<AppSettings> {
    const stored = await (await this.db()).get('settings', 'app');
    return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
  }

  async getDailyQueue() {
    const [cards, states, settings] = await Promise.all([this.getCards(), this.getReviewStates(), this.getSettings()]);
    const stateMap = new Map(states.map(state => [state.cardId, state]));
    const sorted = cards.sort((a, b) => queuePriority(stateMap.get(b.id)) - queuePriority(stateMap.get(a.id)));
    const now = Date.now();
    let introducedNew = 0;
    const newLimit = Math.max(1, Number.isFinite(settings.newCardLimit) ? settings.newCardLimit : DEFAULT_SETTINGS.newCardLimit);
    const queue: Card[] = [];
    for (const card of sorted) {
      const state = stateMap.get(card.id);
      if (!state) {
        // 从未学过的新卡：每天只注入 newCardLimit 张，其余留给后续日子
        if (introducedNew >= newLimit) continue;
        introducedNew += 1;
        queue.push(card);
        continue;
      }
      const due = new Date(state.dueAt).getTime() <= now;
      const weak = state.lastCorrect === false || state.lastRating === 'again' || state.lastRating === 'hard';
      if (due || weak) queue.push(card);
      // 未到期且不薄弱的卡不进今日队列，交给对应日期
    }
    return queue.slice(0, Math.max(1, settings.dailyGoal));
  }

  async clearAllProgress() {
    const db = await this.db();
    const tx = db.transaction(['reviewStates', 'reviewLogs', 'examSessions', 'dqStates', 'dqLogs', 'studyRoundProgress'], 'readwrite');
    await Promise.all([
      tx.objectStore('reviewStates').clear(),
      tx.objectStore('reviewLogs').clear(),
      tx.objectStore('examSessions').clear(),
      tx.objectStore('dqStates').clear(),
      tx.objectStore('dqLogs').clear(),
      tx.objectStore('studyRoundProgress').clear(),
    ]);
    await tx.done;
    this.changed();
  }

  async getDQStates(): Promise<DQState[]> { return (await this.db()).getAll('dqStates'); }
  async getDQLogs(): Promise<DQLog[]> {
    return (await this.db()).getAll('dqLogs');
  }
  async recordDQAnswer(input: { qid: string; picked: string[]; correct: boolean; removeThreshold: number }): Promise<DQState> {
    const db = await this.db();
    const current = await db.get('dqStates', input.qid);
    const prevStreak = input.correct ? (current?.correctStreak ?? 0) : 0;
    const nextStreak = input.correct ? prevStreak + 1 : 0;
    const answeredAt = new Date().toISOString();
    const next: DQState = {
      qid: input.qid,
      picked: input.picked,
      correct: input.correct,
      answeredAt,
      correctStreak: nextStreak,
      inWrongBook: !input.correct
        ? true
        : ((current?.inWrongBook ?? false) && nextStreak < Math.max(1, input.removeThreshold)),
    };
    const log: DQLog = {
      id: crypto.randomUUID(), qid: input.qid, picked: input.picked,
      correct: input.correct, answeredAt,
    };
    const tx = db.transaction(['dqStates', 'dqLogs'], 'readwrite');
    await Promise.all([tx.objectStore('dqStates').put(next), tx.objectStore('dqLogs').put(log)]);
    await tx.done;
    this.changed();
    return next;
  }
  async setDQStarred(qid: string, starred: boolean) {
    const db = await this.db();
    const state = await db.get('dqStates', qid);
    await db.put('dqStates', { qid, correctStreak: 0, ...(state ?? {}), starred });
    this.changed();
  }
  async removeDQFromWrongBook(qid: string) {
    const db = await this.db();
    const state = await db.get('dqStates', qid);
    if (!state) return;
    await db.put('dqStates', { ...state, inWrongBook: false });
    this.changed();
  }

  async recordReview(input: ReviewSubmission) {
    const db = await this.db();
    const [current, settings] = await Promise.all([
      db.get('reviewStates', input.cardId),
      this.getSettings(),
    ]);
    const state = current ?? {
      cardId: input.cardId, dueAt: new Date().toISOString(), intervalMinutes: 10, fixedStep: 0,
      stability: .35, difficulty: 5, correctStreak: 0, lapseCount: 0,
    };
    const scheduled = scheduleNext({ state, rating: input.rating, objectiveCorrect: input.objectiveCorrect, settings });
    const next: ReviewState = input.quickRecall && input.rating !== 'easy'
      ? { ...scheduled, quickRecallStatus: quickRecallStatusForRating(input.rating) }
      : scheduled;
    const log: ReviewLog = {
      id: crypto.randomUUID(), cardId: input.cardId, reviewedAt: next.lastReviewedAt!, rating: input.rating,
      objectiveCorrect: input.objectiveCorrect, mode: settings.reviewMode, nextDueAt: next.dueAt, elapsedMs: input.elapsedMs,
    };
    const tx = db.transaction(['reviewStates','reviewLogs'], 'readwrite');
    await Promise.all([tx.objectStore('reviewStates').put(next), tx.objectStore('reviewLogs').put(log)]);
    await tx.done;
    this.changed();
    return next;
  }

  async saveSettings(settings: AppSettings) { await (await this.db()).put('settings', settings); this.changed(); }
  async resetQuickRecallProgress(cardIds: string[]) {
    const db = await this.db();
    const tx = db.transaction('reviewStates', 'readwrite');
    const store = tx.objectStore('reviewStates');
    for (const cardId of new Set(cardIds)) {
      const state = await store.get(cardId);
      if (!state?.quickRecallStatus) continue;
      const { quickRecallStatus: _quickRecallStatus, ...preservedState } = state;
      await store.put(preservedState);
    }
    await tx.done;
    this.changed();
  }
  async markQuickRecall(cardId: string, rating: 'again' | 'hard' | 'good') {
    const db = await this.db();
    const state = await db.get('reviewStates', cardId);
    if (!state) return;
    await db.put('reviewStates', { ...state, quickRecallStatus: quickRecallStatusForRating(rating) });
    this.changed();
  }
  async getStudyRoundProgress() { return (await this.db()).getAll('studyRoundProgress'); }
  async markStudyRoundCompleted(mode: StudyRoundMode, cardIds: string[]) {
    const db = await this.db();
    const tx = db.transaction('studyRoundProgress', 'readwrite');
    const completedAt = new Date().toISOString();
    for (const cardId of new Set(cardIds)) {
      await tx.store.put({ id: `${mode}:${cardId}`, mode, cardId, completedAt });
    }
    await tx.done;
    this.changed();
  }
  async resetStudyRound(mode: StudyRoundMode, cardIds: string[]) {
    const db = await this.db();
    const tx = db.transaction('studyRoundProgress', 'readwrite');
    for (const cardId of new Set(cardIds)) await tx.store.delete(`${mode}:${cardId}`);
    await tx.done;
    this.changed();
  }


  async hasFingerprint(fingerprint: string) { return Boolean(await (await this.db()).getFromIndex('importBatches', 'by-fingerprint', fingerprint)); }

  async addImport(batch: ImportBatch, drafts: DraftCard[]) {
    const db = await this.db();
    const tx = db.transaction(['importBatches','drafts'], 'readwrite');
    await tx.objectStore('importBatches').put(batch);
    for (const draft of drafts) await tx.objectStore('drafts').put(draft);
    await tx.done;
    this.changed();
  }

  async getDrafts(batchId?: string) {
    const db = await this.db();
    return batchId ? db.getAllFromIndex('drafts', 'by-batch', batchId) : db.getAll('drafts');
  }

  async updateDraft(draft: DraftCard) { await (await this.db()).put('drafts', draft); this.changed(); }

  async confirmDrafts(batchId: string) {
    const db = await this.db();
    const drafts = await db.getAllFromIndex('drafts', 'by-batch', batchId);
    const selected = drafts.filter(draft => draft.selected && draft.prompt.trim() && draft.answer.trim());
    const batch = await db.get('importBatches', batchId);
    const tx = db.transaction(['cards','reviewStates','drafts','importBatches'], 'readwrite');
    const timestamp = new Date().toISOString();
    for (const draft of selected) {
      const card: Card = { ...draft, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp };
      delete (card as Partial<DraftCard>).batchId;
      delete (card as Partial<DraftCard>).selected;
      delete (card as Partial<DraftCard>).sourcePage;
      await tx.objectStore('cards').put(card);
      await tx.objectStore('reviewStates').put({ cardId: card.id, dueAt: timestamp, intervalMinutes: 10, fixedStep: 0, stability: .35, difficulty: 5, correctStreak: 0, lapseCount: 0 });
    }
    for (const draft of drafts) await tx.objectStore('drafts').delete(draft.id);
    if (batch) await tx.objectStore('importBatches').put({ ...batch, status: 'confirmed' });
    await tx.done;
    this.changed();
    return selected.length;
  }

  async exportBackup(): Promise<BackupPayload> {
    const [subjects, chapters, cards, relations, reviewStates, reviewLogs, importBatches, drafts, notes, noteSources, personalKnowledgePoints, noteReviewLogs, examSession, settings, dqStates, dqLogs, dailyQuestions, studyRoundProgress] = await Promise.all([
      this.getSubjects(), this.getChapters(), this.getAllCards(), this.getRelations(), this.getReviewStates(), this.getReviewLogs(),
      this.getImportBatches(), this.getDrafts(), this.getNotes(), this.getNoteSources(), this.getPersonalKnowledgePoints(), this.getNoteReviewLogs(), this.getExamSession(), this.getSettings(),
      this.getDQStates(), this.getDQLogs(), this.getAllDailyQuestions(), this.getStudyRoundProgress(),
    ]);
    return { schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), contentRevision: this.contentRevision, subjects, chapters, cards, relations, reviewStates, reviewLogs, importBatches, drafts, notes, noteSources, personalKnowledgePoints, noteReviewLogs, examSessions: examSession ? [examSession] : [], settings, dqStates, dqLogs, dailyQuestions, studyRoundProgress };
  }

  async restoreBackup(payload: BackupPayload) {
    if (!payload || ![1,2,3,4,5,6,DB_VERSION].includes(payload.schemaVersion) || !Array.isArray(payload.cards)) throw new Error('备份格式或版本不兼容');
    const db = await this.db();
    const tx = db.transaction([...STORE_NAMES], 'readwrite');
    for (const name of STORE_NAMES) await tx.objectStore(name).clear();
    const groups = {
      subjects: payload.subjects, chapters: payload.chapters, cards: payload.cards, relations: payload.relations,
      reviewStates: payload.reviewStates, reviewLogs: payload.reviewLogs, importBatches: payload.importBatches,
      drafts: payload.drafts, notes: payload.notes ?? [], noteSources: payload.noteSources ?? [], personalKnowledgePoints: payload.personalKnowledgePoints ?? [], noteReviewLogs: payload.noteReviewLogs ?? [], examSessions: payload.examSessions ?? [], settings: [payload.settings],
      dqStates: payload.dqStates ?? [], dqLogs: payload.dqLogs ?? [], dailyQuestions: payload.dailyQuestions ?? allDailyQuestions, studyRoundProgress: payload.studyRoundProgress ?? [],
    };
    this.contentRevision = payload.contentRevision ?? 0;
    for (const name of STORE_NAMES) for (const item of groups[name]) await tx.objectStore(name).put(item as never);
    await tx.done;
  }

  async replaceUserData(payload: BackupPayload) {
    await this.restoreBackup(payload);
    this.changed();
  }
}

export const repository: StudyRepository = new IndexedDbStudyRepository();
