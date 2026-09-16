import type { AppSettings, MasteryRating, ReviewState } from './types';

const RATING_WEIGHT: Record<MasteryRating, number> = { again: 0, hard: 1, good: 2, easy: 3 };

export interface ScheduleInput {
  state: ReviewState;
  rating: MasteryRating;
  objectiveCorrect?: boolean;
  settings: AppSettings;
  now?: Date;
}

export function daysUntilExam(settings: AppSettings, now: Date = new Date()): number | null {
  if (!settings.examDate) return null;
  const exam = new Date(`${settings.examDate}T23:59:59`).getTime();
  if (!Number.isFinite(exam)) return null;
  const days = Math.ceil((exam - now.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

function examIntervalCapMinutes(settings: AppSettings, now: Date): number | null {
  const daysLeft = daysUntilExam(settings, now);
  if (daysLeft === null) return null;
  const examTime = new Date(`${settings.examDate}T23:59:59`).getTime();
  const minutesLeft = Math.floor((examTime - now.getTime()) / 60_000);
  if (minutesLeft <= 0) return null;
  // 平时按剩余天数的60%收紧；临近考试时再留出20%缓冲，确保到期时间不会越过考试日。
  const capDays = Math.max(2, Math.min(30, Math.round(daysLeft * 0.6)));
  return Math.max(1, Math.min(capDays * 1440, Math.floor(minutesLeft * 0.8)));
}

export function scheduleNext({ state, rating, objectiveCorrect, settings, now = new Date() }: ScheduleInput): ReviewState {
  const remembered = rating !== 'again' && objectiveCorrect !== false;
  let intervalMinutes = state.intervalMinutes;
  let fixedStep = state.fixedStep;
  let stability = state.stability || 0.35;
  let difficulty = state.difficulty || 5;

  if (settings.reviewMode === 'fixed') {
    fixedStep = remembered ? Math.min(fixedStep + 1, settings.fixedIntervals.length - 1) : 0;
    intervalMinutes = settings.fixedIntervals[fixedStep] ?? 10;
    if (rating === 'hard' && fixedStep > 0) intervalMinutes = Math.max(10, Math.round(intervalMinutes * 0.65));
    if (rating === 'easy') intervalMinutes = Math.round(intervalMinutes * 1.25);
  } else {
    const quality = RATING_WEIGHT[rating];
    if (!remembered) {
      stability = Math.max(0.2, stability * 0.48);
      difficulty = Math.min(10, difficulty + 0.8);
      intervalMinutes = 10;
    } else {
      const growth = 1.6 + quality * 0.55 + state.correctStreak * 0.08;
      stability = Math.min(365, Math.max(0.5, stability * growth));
      difficulty = Math.max(1, Math.min(10, difficulty + (rating === 'hard' ? 0.35 : rating === 'easy' ? -0.45 : -0.12)));
      const difficultyFactor = 1.18 - difficulty * 0.045;
      intervalMinutes = Math.max(10, Math.round(stability * difficultyFactor * 1440));
    }
  }

  const cap = examIntervalCapMinutes(settings, now);
  if (cap !== null && intervalMinutes > cap) intervalMinutes = cap;
  const dueAt = new Date(now.getTime() + intervalMinutes * 60_000).toISOString();
  return {
    ...state,
    dueAt,
    intervalMinutes,
    fixedStep,
    stability,
    difficulty,
    correctStreak: remembered ? state.correctStreak + 1 : 0,
    lapseCount: remembered ? state.lapseCount : state.lapseCount + 1,
    lastRating: rating,
    lastCorrect: objectiveCorrect,
    lastReviewedAt: now.toISOString(),
  };
}

export function queuePriority(state: ReviewState | undefined, now = Date.now()): number {
  if (!state) return 50;
  const due = new Date(state.dueAt).getTime();
  const overdueHours = Math.max(0, (now - due) / 3_600_000);
  if (due < now) return 1000 + Math.min(500, overdueHours);
  if (state.lastCorrect === false) return 900;
  if (state.lastRating === 'again' || state.lastRating === 'hard') return 800;
  return 100 - Math.max(0, (due - now) / 3_600_000);
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.round(minutes / 1440)} 天`;
}
