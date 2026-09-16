import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { allDailyQuestions } from '../client/src/lib/daily-questions';
import {
  seedCards,
  seedChapters,
  seedRelations,
  seedSubjects,
} from '../client/src/lib/seed';

const outputDirectory = resolve(process.cwd(), '.generated-storage');
const outputPath = resolve(outputDirectory, 'fayi-base-content-v7.json');

const payload = {
  format: 'fayi-base-content-v1',
  seedVersion: 7,
  generatedAt: new Date().toISOString(),
  content: {
    subjects: seedSubjects,
    chapters: seedChapters,
    cards: seedCards,
    relations: seedRelations,
    dailyQuestions: allDailyQuestions,
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload), 'utf8');
process.stdout.write(outputPath);
