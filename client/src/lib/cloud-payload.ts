import { getDataloom } from '@lark-apaas/client-toolkit/dataloom';
import { logger } from '@lark-apaas/client-toolkit/logger';

import type { StudyPayloadEnvelope } from '@shared/api.interface';

import { allDailyQuestions } from './daily-questions';
import { DEPLOYMENT_CONFIG } from './deployment-config';
import { seedCards, seedChapters, seedRelations, seedSubjects } from './seed';
import type {
  BackupPayload,
  Card,
  Chapter,
  DailyQuestion,
  Relation,
  Subject,
} from './types';

const CONTENT_BUCKET_ID = DEPLOYMENT_CONFIG.contentBucketId.trim();
const CONTENT_FILE_PATH = DEPLOYMENT_CONFIG.contentFilePath.trim();
const CONTENT_BASE_VERSION = DEPLOYMENT_CONFIG.contentBaseVersion;
const CONTENT_STORAGE_MODE = 'file-base-overlay-v1' as const;
const USER_DATA_FORMAT = 'fayi-user-data-v1' as const;
const USER_DATA_VERSION = 1;

export interface BaseStudyContent {
  subjects: Subject[];
  chapters: Chapter[];
  cards: Card[];
  relations: Relation[];
  dailyQuestions: DailyQuestion[];
}

interface BaseContentFile {
  format: 'fayi-base-content-v1';
  seedVersion: number;
  content: BaseStudyContent;
}

interface UserDataFile {
  format: typeof USER_DATA_FORMAT;
  version: number;
  payload: Omit<BackupPayload, 'subjects' | 'chapters' | 'cards' | 'relations' | 'dailyQuestions'>;
}

const BUILT_IN_CONTENT: BaseStudyContent = {
  subjects: seedSubjects,
  chapters: seedChapters,
  cards: seedCards,
  relations: seedRelations,
  dailyQuestions: allDailyQuestions,
};

let remoteContentPromise: Promise<BaseStudyContent> | undefined;
let currentUserDataFilePath: string | undefined;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => canonicalize(item));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) result[key] = canonicalize(record[key]);
  return result;
}

function signature(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function contentOverrides<T extends { id: string }>(items: T[], baseItems: T[]): T[] {
  const baseSignatures = new Map<string, string>(
    baseItems.map((item: T) => [item.id, signature(item)]),
  );
  return items.filter((item: T) => baseSignatures.get(item.id) !== signature(item));
}

function mergeById<T extends { id: string }>(baseItems: T[], overrides: T[]): T[] {
  const merged = new Map<string, T>(baseItems.map((item: T) => [item.id, item]));
  for (const item of overrides) merged.set(item.id, item);
  return [...merged.values()];
}

function isBaseContentFile(value: unknown): value is BaseContentFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BaseContentFile>;
  const content = candidate.content as Partial<BaseStudyContent> | undefined;
  return candidate.format === 'fayi-base-content-v1'
    && candidate.seedVersion === CONTENT_BASE_VERSION
    && Array.isArray(content?.subjects)
    && Array.isArray(content?.chapters)
    && Array.isArray(content?.cards)
    && Array.isArray(content?.relations)
    && Array.isArray(content?.dailyQuestions);
}

async function loadBaseContent(): Promise<BaseStudyContent> {
  if (!CONTENT_BUCKET_ID || !CONTENT_FILE_PATH) return BUILT_IN_CONTENT;
  remoteContentPromise ??= (async (): Promise<BaseStudyContent> => {
    try {
      const dataloom = await getDataloom();
      const response = await dataloom.storage
        .from(CONTENT_BUCKET_ID)
        .download(CONTENT_FILE_PATH);
      if (response.error || !response.data) throw response.error ?? new Error('文件内容为空');
      const parsed: unknown = JSON.parse(await response.data.text());
      if (!isBaseContentFile(parsed)) throw new Error('公共题库文件版本不兼容');
      return parsed.content;
    } catch (error) {
      logger.warn('公共题库文件读取失败，已使用应用内离线副本', error);
      return BUILT_IN_CONTENT;
    }
  })();
  return remoteContentPromise;
}

function isUserDataFile(value: unknown): value is UserDataFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UserDataFile>;
  return candidate.format === USER_DATA_FORMAT
    && candidate.version === USER_DATA_VERSION
    && Boolean(candidate.payload && typeof candidate.payload === 'object')
    && Array.isArray(candidate.payload?.reviewStates)
    && Array.isArray(candidate.payload?.reviewLogs)
    && Boolean(candidate.payload?.settings && typeof candidate.payload.settings === 'object');
}

function userDataFromPayload(payload: BackupPayload): UserDataFile {
  const {
    subjects: _subjects,
    chapters: _chapters,
    cards: _cards,
    relations: _relations,
    dailyQuestions: _dailyQuestions,
    contentStorage: _contentStorage,
    ...personalPayload
  } = payload;
  return {
    format: USER_DATA_FORMAT,
    version: USER_DATA_VERSION,
    payload: personalPayload,
  };
}

async function storageApi() {
  if (!CONTENT_BUCKET_ID) {
    throw new Error('未配置 VITE_CONTENT_BUCKET_ID，无法使用云端文件存储');
  }
  const dataloom = await getDataloom();
  return dataloom.storage.from(CONTENT_BUCKET_ID);
}

async function uploadUserData(payload: BackupPayload): Promise<string> {
  currentUserDataFilePath ??= `user-data/${crypto.randomUUID()}.json`;
  const response = await (await storageApi()).upload(
    currentUserDataFilePath,
    JSON.stringify(userDataFromPayload(payload)),
    { contentType: 'application/json', upsert: true },
  );
  if (response.error || !response.data) {
    throw response.error ?? new Error('个人学习数据文件写入失败');
  }
  return currentUserDataFilePath;
}

async function downloadUserData(filePath: string): Promise<UserDataFile> {
  const response = await (await storageApi()).download(filePath);
  if (response.error || !response.data) {
    throw response.error ?? new Error('个人学习数据文件读取失败');
  }
  const parsed: unknown = JSON.parse(await response.data.text());
  if (!isUserDataFile(parsed)) throw new Error('个人学习数据文件格式不兼容');
  return parsed;
}

export function configureStudyFileStorage(payload?: StudyPayloadEnvelope | null): void {
  currentUserDataFilePath = payload?.contentStorage?.userDataFilePath;
}

export function compactStudyPayload(
  payload: BackupPayload,
  userDataFilePath?: string,
): StudyPayloadEnvelope {
  return {
    ...payload,
    subjects: contentOverrides(payload.subjects, BUILT_IN_CONTENT.subjects),
    chapters: contentOverrides(payload.chapters, BUILT_IN_CONTENT.chapters),
    cards: contentOverrides(payload.cards, BUILT_IN_CONTENT.cards),
    relations: contentOverrides(payload.relations, BUILT_IN_CONTENT.relations),
    dailyQuestions: contentOverrides(
      payload.dailyQuestions ?? [],
      BUILT_IN_CONTENT.dailyQuestions,
    ),
    contentStorage: {
      mode: CONTENT_STORAGE_MODE,
      baseVersion: CONTENT_BASE_VERSION,
      bucketId: CONTENT_BUCKET_ID,
      filePath: CONTENT_FILE_PATH,
      userDataFilePath,
      userDataVersion: userDataFilePath ? USER_DATA_VERSION : undefined,
      counts: {
        subjects: payload.subjects.length,
        chapters: payload.chapters.length,
        cards: payload.cards.length,
        relations: payload.relations.length,
        dailyQuestions: payload.dailyQuestions?.length ?? 0,
      },
    },
  };
}

export async function prepareStudyPayloadForCloud(
  payload: BackupPayload,
): Promise<StudyPayloadEnvelope> {
  const userDataFilePath = await uploadUserData(payload);
  const compact = compactStudyPayload(payload, userDataFilePath);
  return {
    ...compact,
    reviewStates: [],
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
    settings: { id: 'app' },
  };
}

export function hydrateStudyPayloadWithBase(
  payload: StudyPayloadEnvelope,
  baseContent: BaseStudyContent,
): BackupPayload {
  if (payload.contentStorage?.mode !== CONTENT_STORAGE_MODE) {
    return payload as unknown as BackupPayload;
  }
  return {
    ...payload,
    subjects: mergeById(baseContent.subjects, payload.subjects as Subject[]),
    chapters: mergeById(baseContent.chapters, payload.chapters as Chapter[]),
    cards: mergeById(baseContent.cards, payload.cards as Card[]),
    relations: mergeById(baseContent.relations, payload.relations as Relation[]),
    dailyQuestions: mergeById(
      baseContent.dailyQuestions,
      (payload.dailyQuestions ?? []) as DailyQuestion[],
    ),
  } as BackupPayload;
}

export async function hydrateStudyPayload(
  payload: StudyPayloadEnvelope,
): Promise<BackupPayload> {
  if (payload.contentStorage?.mode !== CONTENT_STORAGE_MODE) {
    return payload as unknown as BackupPayload;
  }
  const hydrated = hydrateStudyPayloadWithBase(payload, await loadBaseContent());
  const userDataFilePath = payload.contentStorage.userDataFilePath;
  if (!userDataFilePath) return hydrated;
  const userData = await downloadUserData(userDataFilePath);
  return {
    ...hydrated,
    ...userData.payload,
    contentRevision: payload.contentRevision,
    contentStorage: payload.contentStorage,
  };
}

export function isCompactStudyPayload(payload: StudyPayloadEnvelope): boolean {
  return payload.contentStorage?.mode === CONTENT_STORAGE_MODE
    && Boolean(payload.contentStorage.userDataFilePath);
}

export { BUILT_IN_CONTENT };
