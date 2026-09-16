jest.mock('@lark-apaas/client-toolkit/dataloom', () => ({
  getDataloom: jest.fn(),
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { warn: jest.fn() },
}));
jest.mock('../../client/src/lib/deployment-config', () => ({
  DEPLOYMENT_CONFIG: {
    contentBucketId: 'bucket_test',
    contentFilePath: 'base-content.json',
    contentBaseVersion: 1,
  },
}));

import {
  BUILT_IN_CONTENT,
  compactStudyPayload,
  hydrateStudyPayloadWithBase,
  prepareStudyPayloadForCloud,
} from '../../client/src/lib/cloud-payload';
import { getDataloom } from '@lark-apaas/client-toolkit/dataloom';
import { DEFAULT_SETTINGS, type BackupPayload } from '../../client/src/lib/types';

function fullPayload(): BackupPayload {
  return {
    schemaVersion: 7,
    exportedAt: '2026-09-02T00:00:00.000Z',
    subjects: structuredClone(BUILT_IN_CONTENT.subjects),
    chapters: structuredClone(BUILT_IN_CONTENT.chapters),
    cards: structuredClone(BUILT_IN_CONTENT.cards),
    relations: structuredClone(BUILT_IN_CONTENT.relations),
    dailyQuestions: structuredClone(BUILT_IN_CONTENT.dailyQuestions),
    reviewStates: [],
    reviewLogs: [],
    importBatches: [],
    drafts: [],
    notes: [],
    settings: DEFAULT_SETTINGS,
  };
}

describe('cloud payload compaction', () => {
  it('stores only content overrides and restores the full library', () => {
    const payload = fullPayload();
    payload.cards[0] = { ...payload.cards[0], answer: '管理员修订后的口诀' };
    const compact = compactStudyPayload(payload);

    expect(compact.contentStorage?.mode).toBe('file-base-overlay-v1');
    expect(compact.subjects).toHaveLength(0);
    expect(compact.chapters).toHaveLength(0);
    expect(compact.cards).toHaveLength(1);
    expect(compact.dailyQuestions).toHaveLength(0);

    const restored = hydrateStudyPayloadWithBase(compact, BUILT_IN_CONTENT);
    expect(restored.cards).toHaveLength(payload.cards.length);
    expect(restored.cards[0].answer).toBe('管理员修订后的口诀');
  });

  it('moves personal progress to file storage and leaves only content in the database payload', async () => {
    const upload = jest.fn().mockResolvedValue({ data: { path: 'ok' }, error: null });
    jest.mocked(getDataloom).mockResolvedValue({
      storage: { from: jest.fn(() => ({ upload })) },
    } as never);
    const payload = fullPayload();
    payload.reviewStates = [{
      cardId: payload.cards[0].id,
      dueAt: '2026-09-02T00:00:00.000Z',
      intervalIndex: 0,
      stability: 1,
      difficulty: 1,
      streak: 0,
      lapseCount: 0,
      lastGrade: 'remember',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }];

    const compact = await prepareStudyPayloadForCloud(payload);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toMatch(/^user-data\/[0-9a-f-]+\.json$/);
    expect(JSON.parse(upload.mock.calls[0][1] as string).payload.reviewStates).toHaveLength(1);
    expect(compact.reviewStates).toEqual([]);
    expect(compact.settings).toEqual({ id: 'app' });
    expect(compact.contentStorage?.userDataFilePath).toMatch(/^user-data\//);
  });
});
