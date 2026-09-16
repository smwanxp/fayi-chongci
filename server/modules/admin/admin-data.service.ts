import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray } from 'drizzle-orm';

import { fayiStudentRemarks, fayiUserData } from '@server/database/schema';
import type {
  AdminContentSyncRequest,
  AdminContentSyncResponse,
  AdminStudentSummary,
  ContentSyncSelection,
  ContentSyncStats,
  StudyPayloadEnvelope,
  UserSimpleDTO,
} from '@shared/api.interface';

type Item = Record<string, unknown>;

const items = (value: unknown): Item[] => Array.isArray(value)
  ? value.filter((item): item is Item => Boolean(item && typeof item === 'object'))
  : [];
const stringValue = (item: Item, key: string) => typeof item[key] === 'string' ? item[key] as string : '';
const selected = (value: string, choices: string[]) => !choices.length || choices.includes(value);
const newerThan = (value: unknown, threshold?: string) => !threshold
  || (typeof value === 'string' && value > threshold);
const blankStats = (): ContentSyncStats => ({
  addedCards: 0,
  updatedCards: 0,
  addedQuestions: 0,
  updatedQuestions: 0,
  addedSubjects: 0,
  addedChapters: 0,
  syncedRelations: 0,
});

function freshStudentPayload(source: StudyPayloadEnvelope): StudyPayloadEnvelope {
  const now = new Date().toISOString();
  const cards = items(source.cards).filter(card => !card.archivedAt);
  const sourceStorage = source.contentStorage;
  return {
    ...structuredClone(source),
    exportedAt: now,
    contentRevision: 0,
    reviewStates: cards.map(card => ({
      cardId: stringValue(card, 'id'),
      dueAt: now,
      intervalMinutes: 10,
      fixedStep: 0,
      stability: 0.35,
      difficulty: 5,
      correctStreak: 0,
      lapseCount: 0,
    })),
    reviewLogs: [],
    importBatches: [],
    drafts: [],
    notes: [],
    noteSources: [],
    personalKnowledgePoints: [],
    noteReviewLogs: [],
    examSessions: [],
    dqStates: [],
    dqLogs: [],
    studyRoundProgress: [],
    contentStorage: sourceStorage ? {
      ...sourceStorage,
      userDataFilePath: undefined,
      userDataVersion: undefined,
    } : undefined,
  };
}

function mergeById(target: Item[], source: Item[]) {
  const map = new Map(target.map(item => [stringValue(item, 'id'), item]));
  for (const item of source) map.set(stringValue(item, 'id'), structuredClone(item));
  return [...map.values()];
}

function syncSelectedContent(
  source: StudyPayloadEnvelope,
  target: StudyPayloadEnvelope,
  selection: ContentSyncSelection,
): { payload: StudyPayloadEnvelope; stats: ContentSyncStats } {
  const targetCards = items(target.cards);
  const targetQuestions = items(target.dailyQuestions);
  const sourceCards = selection.includeCards ? items(source.cards).filter(card =>
    !card.archivedAt
    && selected(stringValue(card, 'subjectId'), selection.cardSubjectIds)
    && selected(stringValue(card, 'chapterId'), selection.cardChapterIds)
    && (!selection.cardTypes.length || selection.cardTypes.includes(stringValue(card, 'type')))
    && newerThan(card.updatedAt, selection.onlyUpdatedAfter)) : [];
  const sourceQuestions = selection.includeDailyQuestions ? items(source.dailyQuestions).filter(question =>
    !question.archivedAt
    && selected(stringValue(question, 'subjectId'), selection.dailyQuestionSubjectIds)
    && newerThan(question.updatedAt, selection.onlyUpdatedAfter)) : [];
  const targetCardIds = new Set(targetCards.map(card => stringValue(card, 'id')));
  const targetQuestionIds = new Set(targetQuestions.map(question => stringValue(question, 'id')));
  const selectedCardIds = new Set(sourceCards.map(card => stringValue(card, 'id')));
  const cards = mergeById(targetCards, sourceCards);
  const questions = mergeById(targetQuestions, sourceQuestions);
  const finalCardIds = new Set(cards.map(card => stringValue(card, 'id')));
  const neededSubjectIds = new Set(sourceCards.map(card => stringValue(card, 'subjectId')));
  const neededChapterIds = new Set(sourceCards.map(card => stringValue(card, 'chapterId')));
  const sourceSubjects = items(source.subjects).filter(item => neededSubjectIds.has(stringValue(item, 'id')));
  const sourceChapters = items(source.chapters).filter(item => neededChapterIds.has(stringValue(item, 'id')));
  const sourceRelations = items(source.relations).filter(relation => {
    const from = stringValue(relation, 'fromCardId');
    const to = stringValue(relation, 'toCardId');
    return (selectedCardIds.has(from) || selectedCardIds.has(to))
      && finalCardIds.has(from) && finalCardIds.has(to);
  });
  const targetSubjectIds = new Set(items(target.subjects).map(item => stringValue(item, 'id')));
  const targetChapterIds = new Set(items(target.chapters).map(item => stringValue(item, 'id')));
  const stats: ContentSyncStats = {
    addedCards: sourceCards.filter(card => !targetCardIds.has(stringValue(card, 'id'))).length,
    updatedCards: sourceCards.filter(card => targetCardIds.has(stringValue(card, 'id'))).length,
    addedQuestions: sourceQuestions.filter(question => !targetQuestionIds.has(stringValue(question, 'id'))).length,
    updatedQuestions: sourceQuestions.filter(question => targetQuestionIds.has(stringValue(question, 'id'))).length,
    addedSubjects: sourceSubjects.filter(item => !targetSubjectIds.has(stringValue(item, 'id'))).length,
    addedChapters: sourceChapters.filter(item => !targetChapterIds.has(stringValue(item, 'id'))).length,
    syncedRelations: sourceRelations.length,
  };
  return {
    payload: {
      ...target,
      exportedAt: new Date().toISOString(),
      contentRevision: Number(target.contentRevision ?? 0) + 1,
      subjects: mergeById(items(target.subjects), sourceSubjects),
      chapters: mergeById(items(target.chapters), sourceChapters),
      cards,
      relations: mergeById(items(target.relations), sourceRelations),
      dailyQuestions: questions,
    },
    stats,
  };
}

@Injectable()
export class AdminDataService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async summarizeStudents(adminUserId: string, users: UserSimpleDTO[]): Promise<AdminStudentSummary[]> {
    const userIds = users.flatMap(user => user.userID ? [user.userID] : []);
    const [rows, remarkRows] = await Promise.all([
      userIds.length ? this.db.select().from(fayiUserData)
        .where(inArray(fayiUserData.ownerUserId, userIds)) : Promise.resolve([]),
      userIds.length ? this.db.select().from(fayiStudentRemarks)
        .where(and(
          eq(fayiStudentRemarks.adminUserId, adminUserId),
          inArray(fayiStudentRemarks.studentUserId, userIds),
        )) : Promise.resolve([]),
    ]);
    const byId = new Map(rows.map(row => [row.ownerUserId, row]));
    const remarksById = new Map(remarkRows.map(row => [row.studentUserId, row.remark]));
    return users.flatMap(user => {
      if (!user.userID) return [];
      const row = byId.get(user.userID);
      const payload = row?.payload as StudyPayloadEnvelope | undefined;
      const storedCounts = payload?.contentStorage?.counts;
      return [{
        userId: user.userID,
        name: user.name?.zh_cn || user.name?.en_us || user.userID,
        avatar: user.avatar,
        email: user.email,
        hasData: Boolean(row),
        cardCount: storedCounts?.cards ?? items(payload?.cards).length,
        dailyQuestionCount: storedCounts?.dailyQuestions ?? items(payload?.dailyQuestions).length,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        remark: remarksById.get(user.userID) ?? '',
      }];
    });
  }

  async updateStudentRemark(adminUserId: string, studentUserId: string, rawRemark: string) {
    const userId = String(studentUserId ?? '').trim();
    const remark = String(rawRemark ?? '').trim();
    if (!userId) throw new BadRequestException('请选择需要备注的学习用户');
    if (remark.length > 200) throw new BadRequestException('备注不能超过 200 个字符');
    if (!remark) {
      await this.db.delete(fayiStudentRemarks).where(and(
        eq(fayiStudentRemarks.adminUserId, adminUserId),
        eq(fayiStudentRemarks.studentUserId, userId),
      ));
      return { userId, remark: '' };
    }
    const updatedAt = new Date();
    await this.db.insert(fayiStudentRemarks)
      .values({ adminUserId, studentUserId: userId, remark, updatedAt })
      .onConflictDoUpdate({
        target: [fayiStudentRemarks.adminUserId, fayiStudentRemarks.studentUserId],
        set: { remark, updatedAt },
      });
    return { userId, remark };
  }

  async deleteStudentRemarks(adminUserId: string, userIds: string[]) {
    if (!userIds.length) return;
    await this.db.delete(fayiStudentRemarks).where(and(
      eq(fayiStudentRemarks.adminUserId, adminUserId),
      inArray(fayiStudentRemarks.studentUserId, [...new Set(userIds)]),
    ));
  }

  async initializeStudents(adminUserId: string, userIds: string[]) {
    const [source] = await this.db.select().from(fayiUserData)
      .where(eq(fayiUserData.ownerUserId, adminUserId)).limit(1);
    if (!source) throw new BadRequestException('管理员题库尚未初始化');
    const existing = userIds.length ? await this.db.select({ ownerUserId: fayiUserData.ownerUserId })
      .from(fayiUserData).where(inArray(fayiUserData.ownerUserId, userIds)) : [];
    const existingIds = new Set(existing.map(row => row.ownerUserId));
    const newIds = [...new Set(userIds)].filter(id => id && !existingIds.has(id));
    for (const ownerUserId of newIds) {
      const payload = freshStudentPayload(source.payload as StudyPayloadEnvelope);
      await this.db.insert(fayiUserData).values({ ownerUserId, payload, contentRevision: 0 });
    }
    return { initialized: newIds.length };
  }

  async deleteStudentData(userIds: string[]) {
    if (!userIds.length) return { deleted: 0 };
    const deleted = await this.db.delete(fayiUserData)
      .where(inArray(fayiUserData.ownerUserId, [...new Set(userIds)]))
      .returning({ ownerUserId: fayiUserData.ownerUserId });
    return { deleted: deleted.length };
  }

  async syncContent(adminUserId: string, request: AdminContentSyncRequest): Promise<AdminContentSyncResponse> {
    const [source] = await this.db.select().from(fayiUserData)
      .where(eq(fayiUserData.ownerUserId, adminUserId)).limit(1);
    if (!source) throw new BadRequestException('管理员题库尚未初始化');
    const targetIds = [...new Set(request.targetUserIds)].filter(id => id && id !== adminUserId);
    const targets = targetIds.length ? await this.db.select().from(fayiUserData)
      .where(inArray(fayiUserData.ownerUserId, targetIds)) : [];
    const targetMap = new Map(targets.map(row => [row.ownerUserId, row]));
    const byUser: AdminContentSyncResponse['byUser'] = [];
    const total = blankStats();
    for (const userId of targetIds) {
      const row = targetMap.get(userId);
      const targetPayload = row
        ? row.payload as StudyPayloadEnvelope
        : freshStudentPayload(source.payload as StudyPayloadEnvelope);
      const result = syncSelectedContent(
        source.payload as StudyPayloadEnvelope,
        targetPayload,
        request.selection,
      );
      byUser.push({ userId, stats: result.stats });
      for (const key of Object.keys(total) as Array<keyof ContentSyncStats>) total[key] += result.stats[key];
      if (!request.preview) {
        const contentRevision = Number(result.payload.contentRevision ?? 0);
        await this.db.insert(fayiUserData)
          .values({ ownerUserId: userId, payload: result.payload, contentRevision, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: fayiUserData.ownerUserId,
            set: { payload: result.payload, contentRevision, updatedAt: new Date() },
          });
      }
    }
    return { preview: request.preview, syncedUsers: targetIds.length, total, byUser };
  }
}
