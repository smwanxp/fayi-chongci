import type { MnemonicSegment } from './types';

const numeralDigits: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 两: 2, 贰: 2, 三: 3, 叁: 3,
  四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7,
  八: 8, 捌: 8, 九: 9, 玖: 9,
};
const numeralUnits: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10_000, 亿: 100_000_000 };
const numeralRun = /[0-9零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]+/g;

function normalizeNumeral(run: string) {
  if (!/[十拾百佰千仟万亿]/.test(run)) {
    return [...run].map(character => numeralDigits[character] ?? character).join('');
  }

  let total = 0;
  let section = 0;
  let number = 0;
  for (const character of run) {
    const digit = /[0-9]/.test(character) ? Number(character) : numeralDigits[character];
    if (digit !== undefined) {
      number = number * 10 + digit;
      continue;
    }
    const unit = numeralUnits[character];
    if (unit < 10_000) {
      section += (number || 1) * unit;
    } else {
      total += (section + number || 1) * unit;
      section = 0;
    }
    number = 0;
  }
  return String(total + section + number);
}

export function normalizeMnemonic(value: string) {
  return value.normalize('NFKC').replace(numeralRun, normalizeNumeral).replace(/[\s，。、“”‘’；：,.;:!！?？、（）()\-—]/g, '').toLowerCase();
}

export function mnemonicScore(answer: string, input: string, segments?: MnemonicSegment[]) {
  const normalizedInput = normalizeMnemonic(input);
  if (!normalizedInput) return 0;
  const parts = segments?.map(segment => segment.text) ?? answer.split(/[，。；、]/).filter(Boolean);
  if (!parts.length) return normalizeMnemonic(answer) === normalizedInput ? 100 : 0;
  const matched = parts.filter(part => normalizedInput.includes(normalizeMnemonic(part))).length;
  const coverage = matched / parts.length;
  const lengthRatio = Math.min(1, normalizedInput.length / Math.max(1, normalizeMnemonic(answer).length));
  return Math.round((coverage * .8 + lengthRatio * .2) * 100);
}
