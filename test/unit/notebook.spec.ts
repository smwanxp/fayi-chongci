import {
  buildNotesMarkdown,
  isNoteDue,
  NOTE_SUBJECTS,
  normalizeNote,
  reviewNote,
  sanitizeNoteHtml,
} from '../../client/src/lib/notebook';
import type { Note } from '../../client/src/lib/types';

const baseNote = (changes: Partial<Note> = {}): Note => ({
  id: 'note-1',
  title: '附条件不起诉的适用条件',
  content: '<p><strong>未成年人</strong>案件应当特别保护。</p>',
  contentFormat: 'html',
  subjectId: 'criminal-procedure',
  chapterId: 'chapter-20',
  tags: ['未成年人', '高频'],
  pinned: false,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  ...changes,
});

describe('复习笔记知识体系', () => {
  it('固定提供完整八科，即使某科暂无笔记', () => {
    expect(NOTE_SUBJECTS.map(subject => subject.name)).toEqual([
      '民法', '刑法', '行政法', '刑诉法', '民诉法', '商经知', '理论法', '三国法',
    ]);
  });

  it('旧版纯文本笔记可以无损升级为富文本结构', () => {
    const normalized = normalizeNote(baseNote({ content: '第一行\n第二行', contentFormat: undefined, cardId: 'card-1' }));
    expect(normalized.content).toBe('<p>第一行</p><p>第二行</p>');
    expect(normalized.cardIds).toEqual(['card-1']);
    expect(normalized.status).toBe('inbox');
    expect(normalized.reminder).toEqual({ mode: 'none' });
  });

  it('正文禁止保留图片和附件节点', () => {
    const clean = sanitizeNoteHtml('<p>规则</p><img src="data:image/png;base64,abc"><div data-type="attachment">附件</div>');
    expect(clean).toBe('<p>规则</p>');
  });

  it('只把到期且未掌握的笔记列入独立提醒', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    expect(isNoteDue(baseNote({ reminder: { mode:'once', nextAt:'2026-08-25T12:00:00.000Z' } }), now)).toBe(true);
    expect(isNoteDue(baseNote({ status:'mastered', reminder: { mode:'once', nextAt:'2026-08-25T12:00:00.000Z' } }), now)).toBe(false);
    expect(isNoteDue(baseNote({ trashedAt:'2026-08-25T12:00:00.000Z', reminder: { mode:'once', nextAt:'2026-08-25T12:00:00.000Z' } }), now)).toBe(false);
  });

  it('三档回看结果按约定安排明天、七天后或停止提醒', () => {
    const now = new Date('2026-08-26T04:00:00.000Z');
    const again = reviewNote(baseNote(), 'again', now);
    const understood = reviewNote(baseNote(), 'understood', now);
    const mastered = reviewNote(baseNote(), 'mastered', now);
    expect(again.note.status).toBe('review');
    expect(new Date(again.note.reminder?.nextAt ?? '').getTime()).toBeGreaterThan(now.getTime());
    expect(understood.note.status).toBe('understood');
    expect(new Date(understood.note.reminder?.nextAt ?? '').getTime() - now.getTime()).toBeGreaterThanOrEqual(6 * 86400000);
    expect(mastered.note.status).toBe('mastered');
    expect(mastered.note.reminder).toEqual({ mode:'none' });
  });

  it('Markdown 按科目、章节、知识点分层导出且不含图片', () => {
    const markdown = buildNotesMarkdown([
      baseNote({
        content:'<p>核心规则<img src="x"></p>',
        structured:{ statute:'刑诉法相关规定' },
        questionSources:[{ id:'q-1', sourceId:'source-1', questionNo:'12', stem:'下列说法何者正确？' }],
      }),
    ], {
      chapters:[{ id:'chapter-20', subjectId:'criminal-procedure', name:'未成年人刑事案件诉讼程序', order:20 }],
      cards:[],
      knowledgePoints:[],
      sources:[{ id:'source-1', type:'past-exam', name:'2025年真题', createdAt:'2026-08-20T00:00:00.000Z', updatedAt:'2026-08-20T00:00:00.000Z' }],
    });
    expect(markdown).toContain('## 刑诉法');
    expect(markdown).toContain('### 未成年人刑事案件诉讼程序');
    expect(markdown).toContain('#### 附条件不起诉的适用条件');
    expect(markdown).toContain('2025年真题');
    expect(markdown).not.toContain('<img');
  });
});
