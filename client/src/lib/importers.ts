'use client';

import type { Card, DraftCard } from './types';

const DEFAULT_SUBJECT = 'theory';
const DEFAULT_CHAPTER = 'theory-constitution-24';

export async function fingerprintFile(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function baseDraft(batchId: string, source: string, index: number): DraftCard {
  return {
    id: `${batchId}-${index}`,
    batchId,
    selected: true,
    subjectId: DEFAULT_SUBJECT,
    chapterId: DEFAULT_CHAPTER,
    type: 'recall',
    prompt: '',
    answer: '',
    explanation: '导入草稿，请核对并补充解析。',
    tags: ['待审核'],
    source,
  };
}

function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function structuredCards(value: unknown, batchId: string, source: string): DraftCard[] {
  const list = Array.isArray(value) ? value : (value && typeof value === 'object' && 'cards' in value ? (value as { cards: unknown }).cards : []);
  if (!Array.isArray(list)) throw new Error('JSON 中未找到 cards 数组');
  return list.map((item, index): DraftCard => {
    const raw = item as Partial<Card> & { question?: string };
    return {
      ...baseDraft(batchId, source, index),
      subjectId: raw.subjectId || DEFAULT_SUBJECT,
      chapterId: raw.chapterId || DEFAULT_CHAPTER,
      type: raw.type === 'judgment' ? 'judgment' as const : raw.type === 'mnemonic' ? 'mnemonic' as const : 'recall' as const,
      prompt: String(raw.prompt || raw.question || ''),
      answer: String(raw.answer || ''),
      judgmentAnswer: typeof raw.judgmentAnswer === 'boolean' ? raw.judgmentAnswer : undefined,
      mnemonicSegments: Array.isArray(raw.mnemonicSegments) ? raw.mnemonicSegments : undefined,
      explanation: String(raw.explanation || '导入草稿，请核对并补充解析。'),
      statute: raw.statute ? String(raw.statute) : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : ['待审核'],
      source: raw.source ? String(raw.source) : source,
    };
  }).filter(card => card.prompt || card.answer);
}

function textToDrafts(text: string, batchId: string, source: string, pages?: number[]): DraftCard[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  const blocks = clean.split(/\n{2,}|(?=^#{1,4}\s+)/gm).map(block => block.trim()).filter(block => block.length > 12);
  let currentHeading = '资料摘录';
  return blocks.slice(0, 500).map((block, index): DraftCard => {
    const heading = block.match(/^#{1,4}\s+(.+)/);
    if (heading) currentHeading = heading[1].trim();
    const body = block.replace(/^#{1,4}\s+.+\n?/, '').trim() || block.replace(/^#{1,4}\s+/, '').trim();
    const firstSentence = body.split(/(?<=[。？！；])/)[0] || body;
    const prompt = heading ? `请完整复述：${currentHeading}` : `如何理解“${firstSentence.slice(0, 42)}${firstSentence.length > 42 ? '…' : ''}”？`;
    const mnemonic = /口诀|速记|记忆法/.test(`${currentHeading}${body.slice(0,30)}`);
    return { ...baseDraft(batchId, source, index), type: mnemonic ? 'mnemonic' as const : 'recall' as const, prompt, answer: body, sourcePage: pages?.[index], tags: [currentHeading, mnemonic ? '口诀' : '待审核'] };
  }).filter(card => card.answer.length > 4);
}

export async function parseImportFile(file: File, batchId: string): Promise<DraftCard[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext) throw new Error('无法识别文件类型');
  if (file.size > 30 * 1024 * 1024) throw new Error('单个文件请控制在 30MB 以内');

  if (ext === 'json') return structuredCards(JSON.parse(await file.text()), batchId, file.name);
  if (ext === 'csv') {
    const rows = parseDelimited(await file.text());
    const header = rows.shift()?.map(cell => cell.toLowerCase()) ?? [];
    return rows.map((row, index): DraftCard => {
      const get = (...names: string[]) => row[header.findIndex(name => names.includes(name))] ?? '';
      const judgment = get('judgmentanswer', '判断答案');
      return {
        ...baseDraft(batchId, file.name, index),
        subjectId: get('subjectid', '科目') || DEFAULT_SUBJECT,
        chapterId: get('chapterid', '章节') || DEFAULT_CHAPTER,
        type: get('type', '类型') === 'judgment' || judgment ? 'judgment' as const : get('type', '类型') === 'mnemonic' || get('type', '类型') === '口诀' ? 'mnemonic' as const : 'recall' as const,
        prompt: get('prompt', 'question', '题目'), answer: get('answer', '答案'), explanation: get('explanation', '解析') || '导入草稿，请核对并补充解析。',
        judgmentAnswer: judgment ? ['true','1','对','正确'].includes(judgment.toLowerCase()) : undefined,
        statute: get('statute', '法条') || undefined, tags: (get('tags', '标签') || '待审核').split(/[|;；]/).filter(Boolean), source: get('source', '来源') || file.name,
      };
    }).filter(card => card.prompt || card.answer);
  }
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') return textToDrafts(await file.text(), batchId, file.name);
  if (ext === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return textToDrafts(result.value, batchId, file.name);
  }
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 300); pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
      pageTexts.push(`## 第 ${pageNumber} 页\n${text}`);
    }
    return textToDrafts(pageTexts.join('\n\n'), batchId, file.name);
  }
  throw new Error('支持 JSON、CSV、Markdown、TXT、PDF 和 DOCX');
}
