'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  BlockquoteToolbarButton,
  ColorHighlightToolbarButton,
  CompleteKit,
  HeadingToolbarButton,
  HorizontalRuleToolbarButton,
  LinkToolbarButton,
  ListToolbarButton,
  MarkToolbarButton,
  TiptapEditor,
  TiptapEditorContent,
  TiptapEditorToolbar,
  TiptapEditorToolbarSeparator,
  UndoRedoToolbarButton,
} from '@/components/business-ui/tiptap-editor';
import { repository } from '@/lib/repository';
import {
  buildNotesMarkdown,
  isNoteDue,
  NOTE_IMPORTANCE_LABELS,
  NOTE_SOURCE_TYPE_LABELS,
  NOTE_STATUS_LABELS,
  NOTE_SUBJECTS,
  normalizeNote,
  reviewNote,
  sanitizeNoteHtml,
  stripHtml,
} from '@/lib/notebook';
import type {
  Card,
  Chapter,
  Note,
  NoteImportance,
  NoteQuestionSource,
  NoteReminderMode,
  NoteReviewLog,
  NoteSource,
  NoteSourceType,
  NoteStatus,
  PersonalKnowledgePoint,
} from '@/lib/types';

const now = () => new Date().toISOString();
const emptyStructured = () => ({
  coreConclusion: '',
  ruleExplanation: '',
  exceptions: '',
  confusable: '',
  statute: '',
  mistakeReason: '',
  mnemonic: '',
  extraReminder: '',
});

const blankNote = (subjectId: string = NOTE_SUBJECTS[0].id): Note => {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    title: '',
    content: '',
    contentFormat: 'html',
    subjectId,
    cardIds: [],
    knowledgePointIds: [],
    relatedSubjectIds: [],
    relatedNoteIds: [],
    questionSources: [],
    structured: emptyStructured(),
    importance: 'normal',
    status: 'inbox',
    reminder: { mode: 'none' },
    tags: [],
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const blankSource = (): NoteSource => {
  const timestamp = now();
  return { id: crypto.randomUUID(), type: 'guide', name: '', detail: '', createdAt: timestamp, updatedAt: timestamp };
};

const blankQuestion = (): NoteQuestionSource => ({
  id: crypto.randomUUID(),
  sourceId: '',
  paper: '',
  year: '',
  questionNo: '',
  questionType: '',
  stem: '',
  options: '',
  answer: '',
  analysis: '',
});

const isoFromDate = (date: string) => date ? new Date(`${date}T12:00:00`).toISOString() : undefined;
const dateFromIso = (date?: string) => date ? date.slice(0, 10) : '';

const mergeIds = (left: string[] = [], right: string[] = []) => [...new Set([...left, ...right])];

export default function Notebook({
  notes,
  cards,
  chapters,
  onChanged,
  onOpenCard,
}: {
  notes: Note[];
  cards: Card[];
  chapters: Chapter[];
  onChanged(): Promise<void>;
  onOpenCard(card: Card): void;
}) {
  const initial = notes.find(note => !note.trashedAt);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [draft, setDraft] = useState<Note>(() => normalizeNote(initial ?? blankNote()));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [chapterFilter, setChapterFilter] = useState('all');
  const [importanceFilter, setImportanceFilter] = useState<'all' | NoteImportance>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | NoteStatus>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [trashMode, setTrashMode] = useState(false);
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [knowledgePoints, setKnowledgePoints] = useState<PersonalKnowledgePoint[]>([]);
  const [reviewLogs, setReviewLogs] = useState<NoteReviewLog[]>([]);
  const [sourceLibraryOpen, setSourceLibraryOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<NoteSource>(() => blankSource());
  const [newPointName, setNewPointName] = useState('');
  const [pendingPurgeId, setPendingPurgeId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const loadSupportData = useCallback(async () => {
    const [nextSources, nextPoints, nextLogs] = await Promise.all([
      repository.getNoteSources(),
      repository.getPersonalKnowledgePoints(),
      repository.getNoteReviewLogs(),
    ]);
    setSources(nextSources.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    setKnowledgePoints(nextPoints.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
    setReviewLogs(nextLogs);
  }, []);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  const normalizedNotes = useMemo(() => notes.map(normalizeNote), [notes]);
  const duplicate = useMemo(() => {
    if (allowDuplicate || notes.some(note => note.id === draft.id) || !draft.title.trim()) return undefined;
    return normalizedNotes.find(note =>
      !note.trashedAt
      && note.subjectId === draft.subjectId
      && note.chapterId === draft.chapterId
      && note.title.trim().toLocaleLowerCase() === draft.title.trim().toLocaleLowerCase());
  }, [allowDuplicate, draft.chapterId, draft.id, draft.subjectId, draft.title, normalizedNotes, notes]);

  const meaningful = Boolean(
    draft.title.trim()
    || stripHtml(draft.content).trim()
    || Object.values(draft.structured ?? {}).some(value => value?.trim())
    || draft.questionSources?.length,
  );

  const saveNow = useCallback(async () => {
    if (!dirty || !meaningful || duplicate) return;
    setSaveState('saving');
    const timestamp = now();
    const next: Note = {
      ...draft,
      title: draft.title.trim() || '未命名知识点',
      content: sanitizeNoteHtml(draft.content),
      contentFormat: 'html',
      cardId: undefined,
      updatedAt: timestamp,
    };
    await repository.saveNote(next);
    setDraft(next);
    setSelectedId(next.id);
    setDirty(false);
    setSaveState('saved');
    await onChanged();
  }, [dirty, draft, duplicate, meaningful, onChanged]);

  useEffect(() => {
    if (!dirty || !meaningful || duplicate) return;
    const timer = window.setTimeout(() => void saveNow(), 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, duplicate, meaningful, saveNow]);

  const updateDraft = <K extends keyof Note>(key: K, value: Note[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setDirty(true);
    setSaveState('dirty');
  };

  const selectNote = async (note: Note) => {
    await saveNow();
    setDraft(normalizeNote(note));
    setSelectedId(note.id);
    setDirty(false);
    setSaveState('saved');
    setAllowDuplicate(false);
    setPendingPurgeId(null);
  };

  const createNote = async () => {
    await saveNow();
    const subjectId = subjectFilter !== 'all' ? subjectFilter : NOTE_SUBJECTS[0].id;
    setDraft(blankNote(subjectId));
    setSelectedId(null);
    setDirty(false);
    setSaveState('saved');
    setAllowDuplicate(false);
    setTrashMode(false);
  };

  const appendToDuplicate = async () => {
    if (!duplicate) return;
    const next: Note = {
      ...duplicate,
      questionSources: [...(duplicate.questionSources ?? []), ...(draft.questionSources ?? [])],
      cardIds: mergeIds(duplicate.cardIds, draft.cardIds),
      knowledgePointIds: mergeIds(duplicate.knowledgePointIds, draft.knowledgePointIds),
      relatedSubjectIds: mergeIds(duplicate.relatedSubjectIds, draft.relatedSubjectIds),
      tags: mergeIds(duplicate.tags, draft.tags),
      updatedAt: now(),
    };
    await repository.saveNote(next);
    await onChanged();
    await selectNote(next);
    setMessage('已打开原笔记，并追加本次关联内容。');
  };

  const activeChapters = useMemo(
    () => chapters.filter(chapter => !draft.subjectId || chapter.subjectId === draft.subjectId).sort((a, b) => a.order - b.order),
    [chapters, draft.subjectId],
  );
  const availablePoints = knowledgePoints.filter(point =>
    point.subjectId === draft.subjectId && (!draft.chapterId || !point.chapterId || point.chapterId === draft.chapterId));
  const availableCards = cards.filter(card => !card.archivedAt && card.subjectId === draft.subjectId);

  const visibleNotes = useMemo(() => normalizedNotes.filter(note => {
    if (trashMode !== Boolean(note.trashedAt)) return false;
    if (subjectFilter !== 'all' && note.subjectId !== subjectFilter) return false;
    if (chapterFilter !== 'all' && note.chapterId !== chapterFilter && note.customChapterName !== chapterFilter) return false;
    if (importanceFilter !== 'all' && note.importance !== importanceFilter) return false;
    if (statusFilter === 'due' && !isNoteDue(note)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'due' && note.status !== statusFilter) return false;
    if (sourceFilter !== 'all' && !(note.questionSources ?? []).some(question => question.sourceId === sourceFilter)) return false;
    const relatedText = [
      note.title,
      stripHtml(note.content),
      note.tags.join(' '),
      Object.values(note.structured ?? {}).join(' '),
      ...(note.questionSources ?? []).flatMap(question => [question.paper, question.year, question.questionNo, question.stem, question.answer]),
      ...(note.knowledgePointIds ?? []).map(id => knowledgePoints.find(point => point.id === id)?.name),
      ...(note.cardIds ?? []).map(id => cards.find(card => card.id === id)?.prompt),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return relatedText.includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)), [
    cards,
    chapterFilter,
    importanceFilter,
    knowledgePoints,
    normalizedNotes,
    query,
    sourceFilter,
    statusFilter,
    subjectFilter,
    trashMode,
  ]);

  const subjectCounts = NOTE_SUBJECTS.map(subject => ({
    ...subject,
    count: normalizedNotes.filter(note => !note.trashedAt && note.subjectId === subject.id).length,
  }));
  const dueCount = normalizedNotes.filter(note => isNoteDue(note)).length;

  const addPoint = async () => {
    if (!newPointName.trim() || !draft.subjectId) return;
    const timestamp = now();
    const existing = knowledgePoints.find(point =>
      point.subjectId === draft.subjectId
      && point.chapterId === draft.chapterId
      && point.name.trim().toLocaleLowerCase() === newPointName.trim().toLocaleLowerCase());
    const point = existing ?? {
      id: crypto.randomUUID(),
      subjectId: draft.subjectId,
      chapterId: draft.chapterId,
      name: newPointName.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!existing) await repository.savePersonalKnowledgePoint(point);
    updateDraft('knowledgePointIds', mergeIds(draft.knowledgePointIds, [point.id]));
    setNewPointName('');
    await loadSupportData();
  };

  const saveSource = async () => {
    if (!sourceDraft.name.trim()) return;
    const next = { ...sourceDraft, name: sourceDraft.name.trim(), updatedAt: now() };
    await repository.saveNoteSource(next);
    setSourceDraft(blankSource());
    await loadSupportData();
    setMessage('资料已保存，以后可以直接选择。');
  };

  const deleteSource = async (id: string) => {
    if (normalizedNotes.some(note => note.questionSources?.some(question => question.sourceId === id))) {
      setMessage('该资料已被笔记引用，不能删除；可以修改名称继续使用。');
      return;
    }
    await repository.deleteNoteSource(id);
    await loadSupportData();
  };

  const addQuestionSource = () => updateDraft('questionSources', [...(draft.questionSources ?? []), blankQuestion()]);
  const updateQuestionSource = (id: string, patch: Partial<NoteQuestionSource>) => updateDraft(
    'questionSources',
    (draft.questionSources ?? []).map(question => question.id === id ? { ...question, ...patch } : question),
  );
  const removeQuestionSource = (id: string) => updateDraft(
    'questionSources',
    (draft.questionSources ?? []).filter(question => question.id !== id),
  );

  const moveToTrash = async () => {
    if (!notes.some(note => note.id === draft.id)) return;
    const next = { ...draft, trashedAt: now(), updatedAt: now() };
    await repository.saveNote(next);
    await onChanged();
    await createNote();
    setMessage('笔记已移入回收站，30天内可以恢复。');
  };

  const restoreNote = async (note: Note) => {
    await repository.saveNote({ ...note, trashedAt: undefined, updatedAt: now() });
    await onChanged();
    setMessage('笔记已恢复。');
  };

  const purgeNote = async (id: string) => {
    if (pendingPurgeId !== id) {
      setPendingPurgeId(id);
      return;
    }
    await repository.deleteNote(id);
    await onChanged();
    setPendingPurgeId(null);
    setMessage('笔记已永久删除。');
  };

  const applyReview = async (outcome: NoteReviewLog['outcome']) => {
    const result = reviewNote(draft, outcome);
    await repository.saveNote(result.note);
    await repository.recordNoteReview(result.log);
    setDraft(result.note);
    setDirty(false);
    setSaveState('saved');
    await Promise.all([onChanged(), loadSupportData()]);
    setMessage(outcome === 'mastered' ? '已掌握，停止提醒。' : outcome === 'again' ? '已安排明天再次回看。' : '已理解，七天后再看。');
  };

  const exportMarkdown = async () => {
    if (trashMode) {
      setMessage('回收站内容不参与导出；返回笔记库后再导出。');
      return;
    }
    await saveNow();
    const latest = (await repository.getNotes()).map(normalizeNote);
    const ids = new Set(visibleNotes.map(note => note.id));
    if (draft.id && !draft.trashedAt && meaningful) ids.add(draft.id);
    const chosen = latest.filter(note => ids.has(note.id));
    if (!chosen.length) {
      setMessage('当前筛选没有可以导出的笔记。');
      return;
    }
    const markdown = buildNotesMarkdown(chosen, { chapters, cards, sources, knowledgePoints });
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `法忆冲刺复习笔记-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`已导出 ${chosen.length} 条纯文字笔记。`);
  };

  const reminderMode = draft.reminder?.mode ?? 'none';
  const updateReminderMode = (mode: NoteReminderMode) => {
    const current = draft.reminder ?? { mode: 'none' };
    updateDraft('reminder', {
      ...current,
      mode,
      nextAt: mode === 'none' ? undefined : current.nextAt,
      intervalDays: mode === 'interval' ? current.intervalDays ?? 7 : current.intervalDays,
    });
    if (mode !== 'none' && draft.status === 'mastered') updateDraft('status', 'review');
  };

  const existingNote = notes.some(note => note.id === draft.id);
  const lastReview = [...reviewLogs].filter(log => log.noteId === draft.id).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0];

  return (
    <section className="notebook-v2">
      <header className="notebook-hero">
        <div>
          <p className="section-kicker">独立知识笔记 · 题目只作来源</p>
          <h2>把纸质真题与模拟题，沉淀成自己的知识体系</h2>
          <p>按科目、章节和知识点整理；来源题目默认折叠，笔记不会自动混入背诵任务。</p>
        </div>
        <div className="notebook-kpis">
          <span><strong>{normalizedNotes.filter(note => !note.trashedAt).length}</strong>知识点</span>
          <span><strong>{dueCount}</strong>今日回看</span>
          <span><strong>{sources.length}</strong>资料来源</span>
        </div>
      </header>

      <div className="note-subject-strip">
        <button className={subjectFilter === 'all' ? 'active' : ''} onClick={() => { setSubjectFilter('all'); setChapterFilter('all'); }}>全部 <b>{normalizedNotes.filter(note => !note.trashedAt).length}</b></button>
        {subjectCounts.map(subject => <button className={subjectFilter === subject.id ? 'active' : ''} onClick={() => { setSubjectFilter(subject.id); setChapterFilter('all'); }} key={subject.id}>{subject.name}<b>{subject.count}</b></button>)}
      </div>

      <div className="notebook-commandbar">
        <button className="primary" type="button" onClick={() => void createNote()}>＋ 新建知识点</button>
        <button type="button" onClick={() => setSourceLibraryOpen(true)}>资料库</button>
        <button type="button" disabled={trashMode} onClick={() => void exportMarkdown()}>导出当前筛选 Markdown</button>
        <button className={trashMode ? 'active danger' : ''} type="button" onClick={() => setTrashMode(value => !value)}>{trashMode ? '返回笔记库' : '回收站'}</button>
        <span>{message}</span>
      </div>

      <div className="notebook-workspace">
        <aside className="note-browser">
          <div className="note-filters">
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文、法条、资料或题号" />
            <select value={chapterFilter} onChange={event => setChapterFilter(event.target.value)}>
              <option value="all">全部章节/考点</option>
              {chapters.filter(chapter => subjectFilter === 'all' || chapter.subjectId === subjectFilter).sort((a, b) => a.order - b.order).map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}
            </select>
            <select value={importanceFilter} onChange={event => setImportanceFilter(event.target.value as 'all' | NoteImportance)}>
              <option value="all">全部重要程度</option>
              {Object.entries(NOTE_IMPORTANCE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | 'due' | NoteStatus)}>
              <option value="all">全部状态</option>
              <option value="due">今日到期</option>
              {Object.entries(NOTE_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
              <option value="all">全部资料来源</option>
              {sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </div>
          <div className="note-result-count">显示 {visibleNotes.length} 条</div>
          <div className="note-result-list">
            {visibleNotes.map(note => <article className={selectedId === note.id ? 'active' : ''} key={note.id}>
              <button type="button" onClick={() => void selectNote(note)}>
                <span>{NOTE_SUBJECTS.find(subject => subject.id === note.subjectId)?.name ?? '未分类'} · {NOTE_IMPORTANCE_LABELS[note.importance ?? 'normal']}</span>
                <strong>{note.title || '未命名知识点'}</strong>
                <p>{stripHtml(note.content).slice(0, 72) || '尚未填写正文'}</p>
                <small>{note.pinned ? '置顶 · ' : ''}{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</small>
              </button>
              {trashMode && <div><button type="button" onClick={() => void restoreNote(note)}>恢复</button><button className="danger" type="button" onClick={() => void purgeNote(note.id)}>{pendingPurgeId === note.id ? '再次点击永久删除' : '永久删除'}</button></div>}
            </article>)}
            {!visibleNotes.length && <p className="no-notes">{trashMode ? '回收站是空的。' : '当前范围还没有知识点笔记。'}</p>}
          </div>
        </aside>

        {!trashMode && <article className="note-composer">
          {duplicate && <div className="note-duplicate-warning"><div><strong>同一位置已有同名知识点</strong><p>{duplicate.title} · {new Date(duplicate.updatedAt).toLocaleDateString('zh-CN')}</p></div><button onClick={() => void appendToDuplicate()}>打开原笔记并追加</button><button onClick={() => setAllowDuplicate(true)}>仍然新建</button></div>}
          <div className="note-meta-grid">
            <label>主科目<select value={draft.subjectId ?? ''} onChange={event => { updateDraft('subjectId', event.target.value); updateDraft('chapterId', undefined); updateDraft('knowledgePointIds', []); }}>
              {NOTE_SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select></label>
            <label>章节 / 已有考点<select value={draft.chapterId ?? ''} onChange={event => updateDraft('chapterId', event.target.value || undefined)}>
              <option value="">暂不指定</option>
              {activeChapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}
            </select></label>
            <label>自定义章节<input value={draft.customChapterName ?? ''} onChange={event => updateDraft('customChapterName', event.target.value)} placeholder="没有现成章节时填写" /></label>
            <label>重要程度<select value={draft.importance ?? 'normal'} onChange={event => updateDraft('importance', event.target.value as NoteImportance)}>
              {Object.entries(NOTE_IMPORTANCE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select></label>
            <label>状态<select value={draft.status ?? 'inbox'} onChange={event => updateDraft('status', event.target.value as NoteStatus)}>
              {Object.entries(NOTE_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select></label>
            <button className={draft.pinned ? 'active' : ''} type="button" onClick={() => updateDraft('pinned', !draft.pinned)}>{draft.pinned ? '已置顶' : '置顶笔记'}</button>
          </div>

          <input className="note-v2-title" value={draft.title} onChange={event => updateDraft('title', event.target.value)} placeholder="知识点标题，例如：附条件不起诉与酌定不起诉的适用顺序" />

          <NoteRichEditor value={draft.content} onChange={value => updateDraft('content', value)} />

          <details className="note-section">
            <summary>结构化补充（按需填写）</summary>
            <div className="note-structured-grid">
              {([
                ['coreConclusion', '核心结论'],
                ['ruleExplanation', '规则解释'],
                ['exceptions', '例外情况'],
                ['confusable', '易混知识'],
                ['statute', '法条依据'],
                ['mistakeReason', '个人错因（可选）'],
                ['mnemonic', '自编口诀'],
                ['extraReminder', '补充提醒'],
              ] as const).map(([key, label]) => <label key={key}>{label}<textarea value={draft.structured?.[key] ?? ''} onChange={event => updateDraft('structured', { ...(draft.structured ?? {}), [key]: event.target.value })} /></label>)}
            </div>
          </details>

          <details className="note-section" open>
            <summary>知识体系关联</summary>
            <div className="note-link-block">
              <strong>个人知识点</strong>
              <div className="note-chip-list">
                {availablePoints.map(point => <button className={draft.knowledgePointIds?.includes(point.id) ? 'active' : ''} type="button" key={point.id} onClick={() => updateDraft('knowledgePointIds', draft.knowledgePointIds?.includes(point.id) ? draft.knowledgePointIds.filter(id => id !== point.id) : [...(draft.knowledgePointIds ?? []), point.id])}>{point.name}</button>)}
              </div>
              <div className="note-inline-add"><input value={newPointName} onChange={event => setNewPointName(event.target.value)} placeholder="新建个人知识点" /><button type="button" onClick={() => void addPoint()}>新建并关联</button></div>
              <strong>关联知识卡（可多选）</strong>
              <select value="" onChange={event => { if (event.target.value) updateDraft('cardIds', mergeIds(draft.cardIds, [event.target.value])); }}>
                <option value="">选择一张知识卡</option>
                {availableCards.filter(card => !draft.cardIds?.includes(card.id)).map(card => <option key={card.id} value={card.id}>{card.prompt.replace(/^请完整默写：\s*/, '').slice(0, 60)}</option>)}
              </select>
              <div className="note-linked-items">{(draft.cardIds ?? []).map(id => {
                const card = cards.find(item => item.id === id);
                return card ? <span key={id}><button type="button" onClick={() => onOpenCard(card)}>{card.prompt.replace(/^请完整默写：\s*/, '')}</button><button type="button" aria-label="取消关联" onClick={() => updateDraft('cardIds', draft.cardIds?.filter(cardId => cardId !== id))}>×</button></span> : null;
              })}</div>
              <strong>相关科目</strong>
              <div className="note-chip-list">{NOTE_SUBJECTS.filter(subject => subject.id !== draft.subjectId).map(subject => <button className={draft.relatedSubjectIds?.includes(subject.id) ? 'active' : ''} type="button" key={subject.id} onClick={() => updateDraft('relatedSubjectIds', draft.relatedSubjectIds?.includes(subject.id) ? draft.relatedSubjectIds.filter(id => id !== subject.id) : [...(draft.relatedSubjectIds ?? []), subject.id])}>{subject.name}</button>)}</div>
              <strong>关联其他笔记</strong>
              <select value="" onChange={event => { if (event.target.value) updateDraft('relatedNoteIds', mergeIds(draft.relatedNoteIds, [event.target.value])); }}>
                <option value="">选择其他笔记</option>
                {normalizedNotes.filter(note => note.id !== draft.id && !note.trashedAt && !draft.relatedNoteIds?.includes(note.id)).map(note => <option key={note.id} value={note.id}>{note.title}</option>)}
              </select>
              <div className="note-linked-items">{(draft.relatedNoteIds ?? []).map(id => {
                const note = normalizedNotes.find(item => item.id === id);
                return note ? <span key={id}><button type="button" onClick={() => void selectNote(note)}>{note.title}</button><button type="button" aria-label="取消关联" onClick={() => updateDraft('relatedNoteIds', draft.relatedNoteIds?.filter(noteId => noteId !== id))}>×</button></span> : null;
              })}</div>
            </div>
          </details>

          <details className="note-section">
            <summary>来源题目（次要信息，默认折叠） · {draft.questionSources?.length ?? 0} 道</summary>
            <div className="note-question-list">
              {(draft.questionSources ?? []).map((question, index) => <article key={question.id}>
                <header><strong>来源题目 {index + 1}</strong><button type="button" onClick={() => removeQuestionSource(question.id)}>移除</button></header>
                <div>
                  <label>资料<select value={question.sourceId ?? ''} onChange={event => updateQuestionSource(question.id, { sourceId: event.target.value || undefined })}><option value="">不指定资料</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                  <label>套卷 / 章节<input value={question.paper ?? ''} onChange={event => updateQuestionSource(question.id, { paper: event.target.value })} /></label>
                  <label>年份<input value={question.year ?? ''} onChange={event => updateQuestionSource(question.id, { year: event.target.value })} /></label>
                  <label>题号<input value={question.questionNo ?? ''} onChange={event => updateQuestionSource(question.id, { questionNo: event.target.value })} /></label>
                  <label>题型<input value={question.questionType ?? ''} onChange={event => updateQuestionSource(question.id, { questionType: event.target.value })} placeholder="单选、多选、不定项、主观题" /></label>
                  <label className="wide">题干（可选）<textarea value={question.stem ?? ''} onChange={event => updateQuestionSource(question.id, { stem: event.target.value })} /></label>
                  <label className="wide">选项（可选）<textarea value={question.options ?? ''} onChange={event => updateQuestionSource(question.id, { options: event.target.value })} /></label>
                  <label>答案（可选）<input value={question.answer ?? ''} onChange={event => updateQuestionSource(question.id, { answer: event.target.value })} /></label>
                  <label className="wide">解析（可选）<textarea value={question.analysis ?? ''} onChange={event => updateQuestionSource(question.id, { analysis: event.target.value })} /></label>
                </div>
              </article>)}
              <div className="note-source-actions"><button type="button" onClick={addQuestionSource}>＋ 附上一道来源题目</button><button type="button" onClick={() => setSourceLibraryOpen(true)}>管理资料库</button></div>
            </div>
          </details>

          <details className="note-section">
            <summary>提醒与回看</summary>
            <div className="note-reminder-grid">
              <label>提醒方式<select value={reminderMode} onChange={event => updateReminderMode(event.target.value as NoteReminderMode)}>
                <option value="none">不提醒</option><option value="once">指定日期一次</option><option value="interval">每隔若干天</option><option value="custom">自定义多个日期</option><option value="exam">考前指定日期</option>
              </select></label>
              {reminderMode !== 'none' && <label>下次回看<input type="date" value={dateFromIso(draft.reminder?.nextAt)} onChange={event => updateDraft('reminder', { ...(draft.reminder ?? { mode: reminderMode }), mode: reminderMode, nextAt: isoFromDate(event.target.value) })} /></label>}
              {reminderMode === 'interval' && <label>间隔天数<input type="number" min="1" value={draft.reminder?.intervalDays ?? 7} onChange={event => updateDraft('reminder', { ...(draft.reminder ?? { mode:'interval' }), mode:'interval', intervalDays: Math.max(1, Number(event.target.value) || 1) })} /></label>}
              {reminderMode === 'custom' && <label className="wide">多个日期（逗号分隔）<input value={draft.reminder?.customDates?.join('，') ?? ''} onChange={event => { const dates = event.target.value.split(/[，,]/).map(value => value.trim()).filter(Boolean); updateDraft('reminder', { ...(draft.reminder ?? { mode:'custom' }), mode:'custom', customDates: dates, nextAt: isoFromDate(dates.sort()[0] ?? '') }); }} placeholder="2026-08-30，2026-09-05" /></label>}
            </div>
            {existingNote && <div className="note-review-actions"><span>{lastReview ? `上次回看：${new Date(lastReview.reviewedAt).toLocaleDateString('zh-CN')}` : '尚未回看'}</span><button type="button" onClick={() => void applyReview('again')}>仍需看 · 明天</button><button type="button" onClick={() => void applyReview('understood')}>已理解 · 7天后</button><button className="mastered" type="button" onClick={() => void applyReview('mastered')}>已掌握 · 停止提醒</button></div>}
          </details>

          <label className="note-v2-tags">标签<input value={draft.tags.join('，')} onChange={event => updateDraft('tags', event.target.value.split(/[，,]/).map(tag => tag.trim()).filter(Boolean))} placeholder="数字期限，原则例外，新法变化" /></label>

          <footer className="note-v2-footer">
            <button className="danger" type="button" disabled={!existingNote} onClick={() => void moveToTrash()}>移入回收站</button>
            <span>{saveState === 'saving' ? '正在自动保存…' : saveState === 'dirty' ? duplicate ? '请先处理同名笔记' : '等待自动保存…' : `已自动保存${draft.updatedAt ? ` · ${new Date(draft.updatedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })}` : ''}`}</span>
            <button className="primary" type="button" disabled={!meaningful || Boolean(duplicate)} onClick={() => void saveNow()}>立即保存</button>
          </footer>
        </article>}
      </div>

      {sourceLibraryOpen && <div className="note-source-overlay" onClick={() => setSourceLibraryOpen(false)}>
        <section className="note-source-dialog" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
          <header><div><p className="section-kicker">统一资料库</p><h2>资料名称只建一次，以后直接选择</h2></div><button type="button" onClick={() => setSourceLibraryOpen(false)}>×</button></header>
          <div className="source-editor-grid">
            <label>类型<select value={sourceDraft.type} onChange={event => setSourceDraft(current => ({ ...current, type:event.target.value as NoteSourceType }))}>{Object.entries(NOTE_SOURCE_TYPE_LABELS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label>资料名称<input value={sourceDraft.name} onChange={event => setSourceDraft(current => ({ ...current, name:event.target.value }))} placeholder="例如：某机构刑诉模拟题" /></label>
            <label className="wide">补充说明<input value={sourceDraft.detail ?? ''} onChange={event => setSourceDraft(current => ({ ...current, detail:event.target.value }))} placeholder="老师、出版社、版本等，均可不填" /></label>
            <button className="primary" type="button" onClick={() => void saveSource()}>{sources.some(source => source.id === sourceDraft.id) ? '保存修改' : '新增资料'}</button>
          </div>
          <div className="source-library-list">{sources.map(source => <article key={source.id}><button type="button" onClick={() => setSourceDraft(source)}><span>{NOTE_SOURCE_TYPE_LABELS[source.type]}</span><strong>{source.name}</strong><small>{source.detail || '无补充说明'}</small></button><button className="danger" type="button" onClick={() => void deleteSource(source.id)}>删除</button></article>)}{!sources.length && <p className="no-notes">还没有资料，可以先新建一本教辅或一套真题。</p>}</div>
        </section>
      </div>}
    </section>
  );
}

function NoteRichEditor({ value, onChange }: { value: string; onChange(value: string): void }) {
  const extensions = useMemo(() => [CompleteKit.configure({
    image: false,
    attachment: false,
    codeBlock: false,
    placeholder: { placeholder: '围绕一个知识点记录结论、规则、例外和易混内容……' },
  })], []);

  return <TiptapEditor className="note-rich-editor" value={value} onValueChange={onChange} extensions={extensions}>
    <TiptapEditorToolbar>
      <UndoRedoToolbarButton action="undo" />
      <UndoRedoToolbarButton action="redo" />
      <TiptapEditorToolbarSeparator />
      <HeadingToolbarButton />
      <ListToolbarButton />
      <TiptapEditorToolbarSeparator />
      <MarkToolbarButton format="bold" />
      <MarkToolbarButton format="italic" />
      <MarkToolbarButton format="underline" />
      <MarkToolbarButton format="strike" />
      <ColorHighlightToolbarButton />
      <TiptapEditorToolbarSeparator />
      <BlockquoteToolbarButton />
      <HorizontalRuleToolbarButton />
      <LinkToolbarButton />
    </TiptapEditorToolbar>
    <TiptapEditorContent />
  </TiptapEditor>;
}
