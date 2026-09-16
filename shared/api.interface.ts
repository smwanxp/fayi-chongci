/**
 * The browser owns the versioned learning model. The server validates the
 * payload envelope and stores one isolated document per authenticated user.
 */
export interface StudyPayloadEnvelope {
  schemaVersion: number;
  contentRevision?: number;
  subjects: unknown[];
  chapters: unknown[];
  cards: unknown[];
  relations: unknown[];
  reviewStates: unknown[];
  reviewLogs: unknown[];
  settings: object;
  exportedAt?: string;
  importBatches?: unknown[];
  drafts?: unknown[];
  notes?: unknown[];
  noteSources?: unknown[];
  personalKnowledgePoints?: unknown[];
  noteReviewLogs?: unknown[];
  examSessions?: unknown[];
  dqStates?: unknown[];
  dqLogs?: unknown[];
  dailyQuestions?: unknown[];
  studyRoundProgress?: unknown[];
  contentStorage?: StudyContentStorage;
}

export interface StudyContentStorage {
  mode: 'file-base-overlay-v1';
  baseVersion: number;
  bucketId: string;
  filePath: string;
  userDataFilePath?: string;
  userDataVersion?: number;
  counts: {
    subjects: number;
    chapters: number;
    cards: number;
    relations: number;
    dailyQuestions: number;
  };
}

export interface GetStudyDataResponse {
  payload: StudyPayloadEnvelope | null;
  contentRevision: number;
  updatedAt: string | null;
}

export interface SaveStudyDataRequest {
  payload: StudyPayloadEnvelope;
}

export interface UploadStudyDataChunkRequest {
  data: string;
}

export interface CommitStudyDataUploadRequest {
  totalChunks: number;
}

export interface SaveStudyDataResponse {
  contentRevision: number;
  contentRefreshRequired: boolean;
  updatedAt: string;
}

export type {
  MemberMutationData,
  RoleMemberDTO,
  UserSimpleDTO,
} from '@lark-apaas/fullstack-nestjs-core';

export interface AdminStudentSummary {
  userId: string;
  name: string;
  avatar?: string;
  email?: string;
  hasData: boolean;
  cardCount: number;
  dailyQuestionCount: number;
  updatedAt: string | null;
  remark: string;
}

export interface ListAdminStudentsResponse {
  students: AdminStudentSummary[];
}

export interface AddAdminStudentsRequest {
  userIds: string[];
}

export interface RemoveAdminStudentsRequest {
  userIds: string[];
  deleteData: boolean;
}

export interface UpdateAdminStudentRemarkRequest {
  userId: string;
  remark: string;
}

export interface ContentSyncSelection {
  includeCards: boolean;
  includeDailyQuestions: boolean;
  cardSubjectIds: string[];
  cardChapterIds: string[];
  cardTypes: string[];
  dailyQuestionSubjectIds: string[];
  onlyUpdatedAfter?: string;
}

export interface ContentSyncStats {
  addedCards: number;
  updatedCards: number;
  addedQuestions: number;
  updatedQuestions: number;
  addedSubjects: number;
  addedChapters: number;
  syncedRelations: number;
}

export interface AdminContentSyncRequest {
  targetUserIds: string[];
  selection: ContentSyncSelection;
  preview: boolean;
}

export interface AdminContentSyncResponse {
  preview: boolean;
  syncedUsers: number;
  total: ContentSyncStats;
  byUser: Array<{ userId: string; stats: ContentSyncStats }>;
}
