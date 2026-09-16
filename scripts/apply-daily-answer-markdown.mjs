import fs from 'node:fs';

const [, , seedPath, answerPath, format] = process.argv;
if (!seedPath || !answerPath || !['inline', 'separate'].includes(format)) {
  throw new Error('用法：node scripts/apply-daily-answer-markdown.mjs <seed.ts> <answers.md> <inline|separate>');
}

const markdown = fs.readFileSync(answerPath, 'utf8');
const seedText = fs.readFileSync(seedPath, 'utf8');
const rows = seedText.split(/\r?\n/);
const parsed = new Map();
const pattern = format === 'inline'
  ? /^### 第(\d+)题\s+【答案】([A-D]+)[^\n]*\n([\s\S]*?)(?=^---\s*$|^### 第|$(?![\s\S]))/gm
  : /^### 第(\d+)题[^\n]*\n+\*\*答案[：:]\s*([A-D]+)\*\*\s*\n([\s\S]*?)(?=^---\s*$|^### 第|$(?![\s\S]))/gm;

for (const match of markdown.matchAll(pattern)) {
  const number = Number(match[1]);
  if (parsed.has(number)) throw new Error(`答案文件存在重复题号：${number}`);
  parsed.set(number, { answer: match[2], analysis: match[3].trim() });
}
if (!parsed.size) throw new Error('没有识别到任何带答案的题目');

const seedNumbers = new Set();
let updated = 0;
const output = rows.map(line => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return line;
  const trailingComma = trimmed.endsWith(',');
  const question = JSON.parse(trimmed.replace(/,$/, ''));
  seedNumbers.add(question.number);
  const official = parsed.get(question.number);
  if (!official) return line;
  const optionKeys = new Set(question.options.map(option => option.key));
  if ([...official.answer].some(key => !optionKeys.has(key))) {
    throw new Error(`第${question.number}题答案包含不存在的选项：${official.answer}`);
  }
  question.answer = official.answer;
  question.analysis = official.analysis;
  question.qtype = /不定项/.test(question.stem) ? 'uncertain' : official.answer.length === 1 ? 'single' : 'multiple';
  updated += 1;
  return `${JSON.stringify(question)}${trailingComma ? ',' : ''}`;
});

const missing = [...parsed.keys()].filter(number => !seedNumbers.has(number));
if (missing.length) throw new Error(`题库缺少答案文件中的题号：${missing.join('、')}`);
fs.writeFileSync(seedPath, output.join('\n'), 'utf8');
console.log(JSON.stringify({ parsed: parsed.size, updated, first: Math.min(...parsed.keys()), last: Math.max(...parsed.keys()) }));
