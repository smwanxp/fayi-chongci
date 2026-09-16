import type {
  Card,
  Chapter,
  Note,
  NoteImportance,
  NoteQuestionSource,
  NoteReminder,
  NoteReviewLog,
  NoteSource,
  NoteStatus,
  PersonalKnowledgePoint,
} from './types';

export const NOTE_SUBJECTS = [
  { id: 'civil-commercial-law', name: '民法' },
  { id: 'criminal-law', name: '刑法' },
  { id: 'administrative-law', name: '行政法' },
  { id: 'criminal-procedure', name: '刑诉法' },
  { id: 'civil-procedure', name: '民诉法' },
  { id: 'commercial-economic-ip', name: '商经知' },
  { id: 'theory', name: '理论法' },
  { id: 'three-international-laws', name: '三国法' },
] as const;

export const NOTE_IMPORTANCE_LABELS: Record<NoteImportance, string> = {
  normal: '普通',
  important: '重点',
  frequent: '高频易错',
  exam: '考前必看',
};

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  inbox: '待整理',
  review: '待复习',
  understood: '已理解',
  mastered: '已掌握',
  archived: '已归档',
};

export const NOTE_SOURCE_TYPE_LABELS: Record<NoteSource['type'], string> = {
  'past-exam': '历年真题',
  mock: '模拟题',
  guide: '教辅资料',
  textbook: '教材',
  teacher: '老师补充',
  other: '其他',
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const plainTextToHtml = (value: string) => value
  ? value.split(/\r?\n/).map(line => `<p>${escapeHtml(line) || '<br>'}</p>`).join('')
  : '';

const decodeEntities = (value: string) => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'");

export const stripHtml = (value: string) => decodeEntities(value
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim());

export const sanitizeNoteHtml = (value: string) => value
  .replace(/<img\b[^>]*>/gi, '')
  .replace(/<[^>]+data-type=["']attachment["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '')
  .trim();

export function htmlToMarkdown(value: string) {
  if (!value) return '';
  const markdown = value
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<hr\s*\/?\s*>/gi, '\n\n---\n\n')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n')
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1')
    .replace(/<(s|strike)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text: string) => `\n${stripHtml(text).split('\n').map(line => `> ${line}`).join('\n')}\n`)
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text: string) => `\n- ${stripHtml(text)}`)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(markdown).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeNote(note: Note): Note {
  return {
    ...note,
    content: note.contentFormat === 'html' ? sanitizeNoteHtml(note.content) : plainTextToHtml(note.content),
    contentFormat: 'html',
    cardIds: note.cardIds ?? (note.cardId ? [note.cardId] : []),
    knowledgePointIds: note.knowledgePointIds ?? [],
    relatedSubjectIds: note.relatedSubjectIds ?? [],
    relatedNoteIds: note.relatedNoteIds ?? [],
    questionSources: note.questionSources ?? [],
    structured: note.structured ?? {},
    importance: note.importance ?? 'normal',
    status: note.status ?? 'inbox',
    reminder: note.reminder ?? { mode: 'none' },
  };
}

export function isNoteDue(note: Note, now = new Date()) {
  if (note.trashedAt || note.status === 'mastered' || note.status === 'archived') return false;
  const nextAt = note.reminder?.nextAt;
  return Boolean(nextAt && new Date(nextAt).getTime() <= now.getTime());
}

const atLocalNoon = (date: Date) => {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
};

export function reviewNote(note: Note, outcome: NoteReviewLog['outcome'], now = new Date()): { note: Note; log: NoteReviewLog } {
  let reminder: NoteReminder = note.reminder ?? { mode: 'none' };
  let status: NoteStatus = note.status ?? 'review';
  if (outcome === 'mastered') {
    reminder = { mode: 'none' };
    status = 'mastered';
  } else {
    const days = outcome === 'again' ? 1 : Math.max(7, reminder.intervalDays ?? 7);
    const next = new Date(now);
    next.setDate(next.getDate() + days);
    reminder = { ...reminder, mode: reminder.mode === 'none' ? 'once' : reminder.mode, nextAt: atLocalNoon(next) };
    status = outcome === 'again' ? 'review' : 'understood';
  }
  const reviewedAt = now.toISOString();
  const updated: Note = { ...note, status, reminder, updatedAt: reviewedAt };
  return {
    note: updated,
    log: {
      id: crypto.randomUUID(),
      noteId: note.id,
      reviewedAt,
      outcome,
      nextDueAt: reminder.nextAt,
    },
  };
}

export interface NotesMarkdownContext {
  chapters: Chapter[];
  cards: Card[];
  sources: NoteSource[];
  knowledgePoints: PersonalKnowledgePoint[];
}

const questionMarkdown = (question: NoteQuestionSource, sources: NoteSource[]) => {
  const source = sources.find(item => item.id === question.sourceId);
  const heading = [source?.name, question.paper, question.year, question.questionNo ? `第${question.questionNo}题` : ''].filter(Boolean).join(' · ');
  const parts = [heading ? `**来源题目：** ${heading}` : ''];
  if (question.questionType) parts.push(`- 题型：${question.questionType}`);
  if (question.stem) parts.push(`- 题干：${question.stem}`);
  if (question.options) parts.push(`- 选项：\n\n${question.options}`);
  if (question.answer) parts.push(`- 答案：${question.answer}`);
  if (question.analysis) parts.push(`- 解析：${question.analysis}`);
  return parts.filter(Boolean).join('\n');
};

export function buildNotesMarkdown(notes: Note[], context: NotesMarkdownContext) {
  const subjectOrder = new Map<string, number>(NOTE_SUBJECTS.map((subject, index) => [subject.id, index]));
  const active = notes.filter(note => !note.trashedAt).map(normalizeNote).sort((left, right) =>
    (subjectOrder.get(left.subjectId ?? '') ?? 99) - (subjectOrder.get(right.subjectId ?? '') ?? 99)
    || (left.chapterId ?? left.customChapterName ?? '').localeCompare(right.chapterId ?? right.customChapterName ?? '', 'zh-CN')
    || Number(right.pinned) - Number(left.pinned)
    || right.updatedAt.localeCompare(left.updatedAt));
  const lines = ['# 法忆冲刺复习笔记', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  for (const subject of NOTE_SUBJECTS) {
    const subjectNotes = active.filter(note => note.subjectId === subject.id);
    if (!subjectNotes.length) continue;
    lines.push(`## ${subject.name}`, '');
    const groups = new Map<string, Note[]>();
    for (const note of subjectNotes) {
      const chapter = context.chapters.find(item => item.id === note.chapterId);
      const name = chapter?.name ?? note.customChapterName ?? '未指定章节';
      groups.set(name, [...(groups.get(name) ?? []), note]);
    }
    for (const [chapterName, chapterNotes] of groups) {
      lines.push(`### ${chapterName}`, '');
      for (const note of chapterNotes) {
        lines.push(`#### ${note.title || '未命名知识点'}`, '');
        const meta = [NOTE_IMPORTANCE_LABELS[note.importance ?? 'normal'], ...(note.tags ?? [])].filter(Boolean);
        if (meta.length) lines.push(`> ${meta.join(' · ')}`, '');
        const body = htmlToMarkdown(note.content);
        if (body) lines.push(body, '');
        const structured = note.structured ?? {};
        const structuredRows: Array<[string, string | undefined]> = [
          ['核心结论', structured.coreConclusion],
          ['规则解释', structured.ruleExplanation],
          ['例外情况', structured.exceptions],
          ['易混知识', structured.confusable],
          ['法条依据', structured.statute],
          ['个人错因', structured.mistakeReason],
          ['自编口诀', structured.mnemonic],
          ['补充提醒', structured.extraReminder],
        ];
        for (const [label, value] of structuredRows) if (value?.trim()) lines.push(`**${label}：** ${value.trim()}`, '');
        const pointNames = (note.knowledgePointIds ?? []).map(id => context.knowledgePoints.find(point => point.id === id)?.name).filter(Boolean);
        if (pointNames.length) lines.push(`**个人知识点：** ${pointNames.join('、')}`, '');
        const cardNames = (note.cardIds ?? []).map(id => context.cards.find(card => card.id === id)?.prompt).filter(Boolean);
        if (cardNames.length) lines.push(`**关联知识卡：** ${cardNames.join('、')}`, '');
        for (const question of note.questionSources ?? []) {
          const text = questionMarkdown(question, context.sources);
          if (text) lines.push('<details>', '<summary>来源题目</summary>', '', text, '', '</details>', '');
        }
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
