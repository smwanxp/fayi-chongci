import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, lt } from 'drizzle-orm';

import { fayiDataUploadChunks, fayiUserData } from '@server/database/schema';
import type {
  GetStudyDataResponse,
  SaveStudyDataResponse,
  StudyPayloadEnvelope,
} from '@shared/api.interface';

const CONTENT_KEYS = ['subjects', 'chapters', 'cards', 'relations', 'dailyQuestions'] as const;
const UPLOAD_CHUNK_RETENTION_MS = 24 * 60 * 60 * 1000;

function isStudyPayload(value: unknown): value is StudyPayloadEnvelope {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<StudyPayloadEnvelope>;
  return Number.isFinite(payload.schemaVersion)
    && Array.isArray(payload.subjects)
    && Array.isArray(payload.chapters)
    && Array.isArray(payload.cards)
    && Array.isArray(payload.relations)
    && Array.isArray(payload.reviewStates)
    && Array.isArray(payload.reviewLogs)
    && Boolean(payload.settings && typeof payload.settings === 'object');
}

function preserveNewerContent(
  incoming: StudyPayloadEnvelope,
  latest: StudyPayloadEnvelope,
  latestRevision: number,
): StudyPayloadEnvelope {
  const incomingRevision = Number(incoming.contentRevision ?? 0);
  if (incomingRevision >= latestRevision) {
    return { ...incoming, contentRevision: latestRevision };
  }

  const merged: StudyPayloadEnvelope = {
    ...incoming,
    contentRevision: latestRevision,
  };
  for (const key of CONTENT_KEYS) {
    (merged as unknown as Record<string, unknown>)[key] = structuredClone(
      (latest as unknown as Record<string, unknown>)[key],
    );
  }
  if (latest.contentStorage) {
    merged.contentStorage = structuredClone(latest.contentStorage);
  }
  return merged;
}

function storedContent(payload: StudyPayloadEnvelope) {
  return {
    contentRevision: Number(payload.contentRevision ?? 0),
    subjects: payload.subjects,
    chapters: payload.chapters,
    cards: payload.cards,
    relations: payload.relations,
    dailyQuestions: payload.dailyQuestions ?? [],
    contentStorage: payload.contentStorage,
  };
}

@Injectable()
export class StudyDataService {
  private readonly logger = new Logger(StudyDataService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private async removeUploadChunks(ownerUserId: string, uploadId: string) {
    await this.db
      .delete(fayiDataUploadChunks)
      .where(and(
        eq(fayiDataUploadChunks.ownerUserId, ownerUserId),
        eq(fayiDataUploadChunks.uploadId, uploadId),
      ));
  }

  /**
   * Uploads are only a transport for a full study-data snapshot.  A failed or
   * interrupted upload cannot be resumed after a day, so retaining its chunks
   * only consumes database storage and risks quota exhaustion.
   */
  private async removeExpiredUploadChunks(ownerUserId: string) {
    const cutoff = new Date(Date.now() - UPLOAD_CHUNK_RETENTION_MS);
    await this.db
      .delete(fayiDataUploadChunks)
      .where(and(
        eq(fayiDataUploadChunks.ownerUserId, ownerUserId),
        lt(fayiDataUploadChunks.createdAt, cutoff),
      ));
  }

  async getForUser(ownerUserId: string): Promise<GetStudyDataResponse> {
    const [row] = await this.db
      .select()
      .from(fayiUserData)
      .where(eq(fayiUserData.ownerUserId, ownerUserId))
      .limit(1);

    if (!row) return { payload: null, contentRevision: 0, updatedAt: null };

    return {
      payload: row.payload as StudyPayloadEnvelope,
      contentRevision: row.contentRevision,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async saveForUser(ownerUserId: string, rawPayload: unknown): Promise<SaveStudyDataResponse> {
    if (!isStudyPayload(rawPayload)) throw new BadRequestException('学习数据格式不完整');

    // Normal autosaves also reclaim abandoned uploads from a previous attempt.
    await this.removeExpiredUploadChunks(ownerUserId);

    const [current] = await this.db
      .select()
      .from(fayiUserData)
      .where(eq(fayiUserData.ownerUserId, ownerUserId))
      .limit(1);

    const contentRevision = current?.contentRevision ?? Number(rawPayload.contentRevision ?? 0);
    const payload = current
      ? preserveNewerContent(rawPayload, current.payload as StudyPayloadEnvelope, contentRevision)
      : { ...rawPayload, contentRevision };
    const contentRefreshRequired = Number(rawPayload.contentRevision ?? 0) < contentRevision;
    const updatedAt = new Date();

    if (current
      && payload.contentStorage?.userDataFilePath
      && isDeepStrictEqual(
        storedContent(payload),
        storedContent(current.payload as StudyPayloadEnvelope),
      )) {
      return {
        contentRevision,
        contentRefreshRequired,
        updatedAt: current.updatedAt.toISOString(),
      };
    }

    await this.db
      .insert(fayiUserData)
      .values({ ownerUserId, payload, contentRevision, updatedAt })
      .onConflictDoUpdate({
        target: fayiUserData.ownerUserId,
        set: { payload, contentRevision, updatedAt },
      });

    this.logger.log(`Saved study data for user ${ownerUserId}`);
    return { contentRevision, contentRefreshRequired, updatedAt: updatedAt.toISOString() };
  }

  async saveUploadChunk(ownerUserId: string, uploadId: string, chunkIndex: number, data: unknown) {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)
      || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 499
      || typeof data !== 'string' || data.length < 1 || data.length > 80_000) {
      throw new BadRequestException('上传分片格式不正确');
    }

    // Do the lightweight cleanup once per new upload, not once per chunk.
    if (chunkIndex === 0) await this.removeExpiredUploadChunks(ownerUserId);

    await this.db
      .insert(fayiDataUploadChunks)
      .values({ ownerUserId, uploadId, chunkIndex, chunkData: data })
      .onConflictDoUpdate({
        target: [
          fayiDataUploadChunks.ownerUserId,
          fayiDataUploadChunks.uploadId,
          fayiDataUploadChunks.chunkIndex,
        ],
        set: { chunkData: data },
      });
    return { received: chunkIndex };
  }

  async commitUpload(ownerUserId: string, uploadId: string, totalChunks: number) {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)
      || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 500) {
      throw new BadRequestException('上传批次格式不正确');
    }

    try {
      const rows = await this.db
        .select()
        .from(fayiDataUploadChunks)
        .where(and(
          eq(fayiDataUploadChunks.ownerUserId, ownerUserId),
          eq(fayiDataUploadChunks.uploadId, uploadId),
        ))
        .orderBy(asc(fayiDataUploadChunks.chunkIndex));
      if (rows.length !== totalChunks
        || rows.some((row, index) => row.chunkIndex !== index)) {
        throw new BadRequestException('上传分片不完整，请重新同步');
      }

      let rawPayload: unknown;
      try {
        const bytes = Buffer.concat(rows.map(row => Buffer.from(row.chunkData, 'base64')));
        rawPayload = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new BadRequestException('上传内容无法解析');
      }

      return await this.saveForUser(ownerUserId, rawPayload);
    } finally {
      // Completed, malformed, and interrupted commits are all disposable: the
      // browser keeps the authoritative copy in IndexedDB and can retry cleanly.
      try {
        await this.removeUploadChunks(ownerUserId, uploadId);
      } catch (error) {
        this.logger.warn(`Unable to clear upload chunks for ${ownerUserId}: ${String(error)}`);
      }
    }
  }
}
