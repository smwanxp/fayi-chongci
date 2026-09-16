/** 每日一题判分引擎：选项集合比对（法考标准，多选须全对） */
export function normalizeLetters(input: string[] | string): string[] {
  const raw = Array.isArray(input) ? input : input.split('');
  return [...new Set(raw.map(x => x.trim().toUpperCase()).filter(Boolean))].sort();
}

export function gradeDQ(answer: string | undefined | null, picked: string[]): boolean {
  if (!answer) return false;
  return normalizeLetters(answer).join('') === normalizeLetters(picked).join('');
}

export interface PaperBuildOptions {
  numbers: { number: number; answered?: boolean; correct?: boolean }[];
  status: 'all' | 'unanswered' | 'correct' | 'wrong';
  size: number;
  random?: boolean;
  rng?: () => number;
}

/** 组卷选题器 */
export function pickPaper(opts: PaperBuildOptions): number[] {
  const filtered = opts.numbers.filter(n => {
    if (opts.status === 'unanswered') return !n.answered;
    if (opts.status === 'correct') return Boolean(n.answered && n.correct);
    if (opts.status === 'wrong') return Boolean(n.answered && !n.correct);
    return true;
  });
  const ids = filtered.map(n => n.number);
  if (opts.random ?? true) {
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor((opts.rng ?? Math.random)() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  return ids.slice(0, Math.max(1, opts.size));
}
