import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  addAdminStudents,
  getAdminStudents,
  removeAdminStudents,
  syncAdminContent,
  updateAdminStudentRemark,
} from '@/api';
import { UserSelect } from '@/components/business-ui/user-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { dqSubjectName } from '@/lib/daily-questions';
import { repository } from '@/lib/repository';
import type { Card, CardType, Chapter, DailyQuestion, Subject } from '@/lib/types';
import type {
  AdminContentSyncResponse,
  AdminStudentSummary,
  ContentSyncSelection,
} from '@shared/api.interface';

export default function UserManagement({ cards, questions, subjects, chapters }: {
  cards: Card[];
  questions: DailyQuestion[];
  subjects: Subject[];
  chapters: Chapter[];
}) {
  const [students, setStudents] = useState<AdminStudentSummary[]>([]);
  const [newUserIds, setNewUserIds] = useState<string[]>([]);
  const [removeCandidate, setRemoveCandidate] = useState<AdminStudentSummary | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [includeCards, setIncludeCards] = useState(true);
  const [includeDaily, setIncludeDaily] = useState(true);
  const [cardSubjects, setCardSubjects] = useState<Set<string>>(new Set(subjects.map(subject => subject.id)));
  const [questionSubjects, setQuestionSubjects] = useState<Set<string>>(new Set(questions.map(question => question.subjectId)));
  const [cardTypes, setCardTypes] = useState<Set<CardType>>(new Set(['mnemonic', 'recall', 'judgment']));
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [onlyRecent, setOnlyRecent] = useState(false);
  const [updatedAfter, setUpdatedAfter] = useState('');
  const [preview, setPreview] = useState<AdminContentSyncResponse | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const data = await getAdminStudents();
    const nextStudents = Array.isArray(data.students) ? data.students : [];
    setStudents(nextStudents);
    setRemarkDrafts(Object.fromEntries(nextStudents.map(student => [student.userId, student.remark ?? ''])));
    setSelectedUsers(current => current.size
      ? new Set([...current].filter(id => nextStudents.some(student => student.userId === id)))
      : new Set(nextStudents.map(student => student.userId)));
  }, []);

  useEffect(() => {
    void repository.flushRemoteSync().then(load).catch(error => {
      setMessage(error instanceof Error ? error.message : '无法读取用户');
    });
  }, [load]);

  const visibleChapters = chapters.filter(chapter => cardSubjects.has(chapter.subjectId));
  const qSubjects = useMemo(() => [...new Set(questions.map(question => question.subjectId))], [questions]);
  const qName = (id: string) => dqSubjectName(id);
  const toggle = <T extends string>(set: Set<T>, value: T, update: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
    setPreview(null);
  };

  const saveRemark = async (student: AdminStudentSummary) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await updateAdminStudentRemark({ userId: student.userId, remark: remarkDrafts[student.userId] ?? '' });
      setStudents(current => current.map(item => item.userId === student.userId ? { ...item, remark: result.remark } : item));
      setRemarkDrafts(current => ({ ...current, [student.userId]: result.remark }));
      setMessage(result.remark ? `已保存“${student.name}”的备注。` : `已清除“${student.name}”的备注。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '备注保存失败');
    } finally {
      setBusy(false);
    }
  };

  const addUsers = async () => {
    if (!newUserIds.length) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await addAdminStudents({ userIds: newUserIds });
      setNewUserIds([]);
      setMessage(`已添加 ${result.added} 名学习用户，其中 ${result.initialized} 个账号已复制当前题库，学习进度从零开始。`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async () => {
    if (!removeCandidate) return;
    setBusy(true);
    setMessage('');
    try {
      await removeAdminStudents({ userIds: [removeCandidate.userId], deleteData: true });
      setMessage(`已移除“${removeCandidate.name}”的使用权限并删除其独立学习数据。`);
      setRemoveCandidate(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '移除失败');
    } finally {
      setBusy(false);
    }
  };

  const selection = (): ContentSyncSelection => ({
    includeCards,
    includeDailyQuestions: includeDaily,
    cardSubjectIds: [...cardSubjects],
    cardChapterIds: [...selectedChapters],
    cardTypes: [...cardTypes],
    dailyQuestionSubjectIds: [...questionSubjects],
    onlyUpdatedAfter: onlyRecent && updatedAfter ? new Date(`${updatedAfter}T00:00:00`).toISOString() : undefined,
  });

  const runSync = async (previewOnly: boolean) => {
    if (!selectedUsers.size) {
      setMessage('请至少选择一个接收用户');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await repository.flushRemoteSync();
      const data = await syncAdminContent({ targetUserIds: [...selectedUsers], selection: selection(), preview: previewOnly });
      if (previewOnly) {
        setPreview(data);
        setMessage('预览已生成，请核对后确认执行');
      } else {
        setPreview(null);
        setMessage(`同步完成：${data.syncedUsers} 个账号，新增 ${data.total.addedCards} 张知识卡和 ${data.total.addedQuestions} 道题，更新 ${data.total.updatedCards} 张知识卡和 ${data.total.updatedQuestions} 道题。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同步失败');
    } finally {
      setBusy(false);
    }
  };

  const selectedCardCount = includeCards ? cards.filter(card => cardSubjects.has(card.subjectId) && cardTypes.has(card.type) && (!selectedChapters.size || selectedChapters.has(card.chapterId))).length : 0;
  const selectedQuestionCount = includeDaily ? questions.filter(question => questionSubjects.has(question.subjectId)).length : 0;

  return <section className="users-page">
    <div className="users-intro"><div><p className="section-kicker">飞书角色 · 管理员专属</p><h2>用户与内容分发中心</h2><p>添加用户会授予“法忆学习用户”角色并复制当前内容；每个人的学习进度、笔记与设置继续独立保存。</p></div><span><strong>{students.length}</strong> 名学习用户</span></div>
    <div className="users-grid">
      <section className="user-create"><p className="section-kicker">添加用户</p><h3>从飞书联系人中选择</h3><UserSelect multiple value={newUserIds} onChange={setNewUserIds} placeholder="搜索并选择飞书用户" /><Button type="button" disabled={busy || !newUserIds.length} onClick={() => void addUsers()}>{busy ? '正在处理…' : '授权并复制题库'}</Button><small>不再设置独立密码，用户使用自己的飞书身份进入。</small></section>
      <section className="user-list"><div><p className="section-kicker">已授权用户</p><h3>可添加仅管理员可见的备注</h3></div>{students.map(student => <article key={student.userId}><span>{student.name.slice(0, 1)}</span><div><strong>{student.name}</strong><small>{student.cardCount} 张知识卡 · {student.dailyQuestionCount} 道题 · {student.hasData ? '数据已初始化' : '等待初始化'}</small><div className="user-remark-row"><input aria-label={`${student.name}的备注`} maxLength={200} value={remarkDrafts[student.userId] ?? ''} onChange={event => setRemarkDrafts(current => ({ ...current, [student.userId]: event.target.value }))} placeholder="添加备注，例如真实姓名、班级或联系方式" /><button type="button" disabled={busy || (remarkDrafts[student.userId] ?? '').trim() === student.remark} onClick={() => void saveRemark(student)}>保存备注</button></div></div><button className="user-remove-button" type="button" disabled={busy} onClick={() => setRemoveCandidate(student)}>移除</button></article>)}{!students.length && <p className="no-notes">尚未添加学习用户。</p>}</section>
    </div>
    <section className="content-sync-panel"><header><div><p className="section-kicker">内容同步</p><h2>把管理员题库分发给学习用户</h2><p>只新增或更新所选内容，不覆盖对方的掌握程度、作答记录、笔记和设置。</p></div><span>先预览再执行</span></header>
      <div className="sync-scope-grid">
        <section><strong>01 · 接收用户</strong><div className="sync-check-list"><label><Checkbox checked={students.length > 0 && selectedUsers.size === students.length} onCheckedChange={checked => { setSelectedUsers(new Set(checked ? students.map(user => user.userId) : [])); setPreview(null); }} />全部学习用户</label>{students.map(student => <label key={student.userId}><Checkbox checked={selectedUsers.has(student.userId)} onCheckedChange={() => toggle(selectedUsers, student.userId, setSelectedUsers)} />{student.name}<small>{student.userId}</small></label>)}</div></section>
        <section><strong>02 · 同步内容</strong><div className="sync-content-kinds"><label><Checkbox checked={includeCards} onCheckedChange={checked => { setIncludeCards(Boolean(checked)); setPreview(null); }} /><b>知识卡库</b><small>{cards.length} 张</small></label><label><Checkbox checked={includeDaily} onCheckedChange={checked => { setIncludeDaily(Boolean(checked)); setPreview(null); }} /><b>每日一题库</b><small>{questions.length} 道</small></label></div>{includeCards && <><p>知识卡科目</p><div className="sync-pills">{subjects.map(subject => <button type="button" className={cardSubjects.has(subject.id) ? 'active' : ''} onClick={() => toggle(cardSubjects, subject.id, setCardSubjects)} key={subject.id}>{subject.name}</button>)}</div><p>卡片类型</p><div className="sync-pills">{([['mnemonic', '口诀'], ['recall', '背诵卡'], ['judgment', '判断题']] as const).map(([id, label]) => <button type="button" className={cardTypes.has(id) ? 'active' : ''} onClick={() => toggle(cardTypes, id, setCardTypes)} key={id}>{label}</button>)}</div><details><summary>进一步限定章节（默认全部）</summary><div className="sync-check-list chapter-list">{visibleChapters.map(chapter => <label key={chapter.id}><Checkbox checked={selectedChapters.has(chapter.id)} onCheckedChange={() => toggle(selectedChapters, chapter.id, setSelectedChapters)} />{chapter.name}</label>)}</div></details></>}{includeDaily && <><p>每日一题科目</p><div className="sync-pills">{qSubjects.map(id => <button type="button" className={questionSubjects.has(id) ? 'active' : ''} onClick={() => toggle(questionSubjects, id, setQuestionSubjects)} key={id}>{qName(id)}</button>)}</div></>}<label className="sync-date"><Checkbox checked={onlyRecent} onCheckedChange={checked => { setOnlyRecent(Boolean(checked)); setPreview(null); }} />仅同步该日期后修改的内容<input type="date" disabled={!onlyRecent} value={updatedAfter} onChange={event => { setUpdatedAfter(event.target.value); setPreview(null); }} /></label></section>
        <section><strong>03 · 预览与执行</strong><div className="sync-summary"><span>接收账号<b>{selectedUsers.size}</b></span><span>知识卡范围<b>{selectedCardCount}</b></span><span>每日一题范围<b>{selectedQuestionCount}</b></span></div><button className="sync-preview-button" disabled={busy || !selectedUsers.size || (!includeCards && !includeDaily)} onClick={() => void runSync(true)}>{busy ? '正在计算…' : '预览同步结果'}</button>{preview && <div className="sync-preview-result"><h3>将影响 {preview.syncedUsers} 个账号</h3><p>知识卡：新增 {preview.total.addedCards}，更新 {preview.total.updatedCards}</p><p>每日一题：新增 {preview.total.addedQuestions}，更新 {preview.total.updatedQuestions}</p><p>章节：补入 {preview.total.addedChapters}；关联：同步 {preview.total.syncedRelations}</p><button disabled={busy} onClick={() => void runSync(false)}>确认并立即同步 →</button></div>}<aside><strong>不会被覆盖</strong><p>掌握程度、记忆曲线、速记状态、错题本、收藏、作答记录、笔记、设置及未完成试卷。</p></aside></section>
      </div>
    </section>
    {message && <div className="settings-message" role="status">{message}</div>}
    <AlertDialog open={Boolean(removeCandidate)} onOpenChange={open => { if (!open) setRemoveCandidate(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除学习用户</AlertDialogTitle><AlertDialogDescription>将撤销“{removeCandidate?.name}”的使用权限，并删除该用户在法忆冲刺中的独立题库、笔记和全部学习记录。此操作无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => void removeUser()}>确认移除并删除数据</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
