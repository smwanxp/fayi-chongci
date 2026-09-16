'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { repository } from '@/lib/repository';
import { dqSubjectName, dqSubjects as dqSubjectCatalog } from '@/lib/daily-questions';
import { gradeDQ, pickPaper } from '@/lib/dq-grading';
import type { AppSettings, DailyQuestion, DQState, Subject } from '@/lib/types';

const SIZES = [5, 10, 15, 20];

type DQView = 'overview' | 'practice' | 'setup' | 'run' | 'result' | 'wrong';

interface PaperConfig {
  subjectId: string;
  status: 'all' | 'unanswered' | 'correct' | 'wrong';
  size: number;
  random: boolean;
}

const qTypeLabel = (q: DailyQuestion) =>
  q.qtype === 'multiple' ? '多选' : q.qtype === 'uncertain' ? '不定项' : '单选';

export default function DailyQuestions({ settings, questions, subjects }: { settings: AppSettings; questions: DailyQuestion[]; subjects: Subject[] }) {
  const activeQuestions = useMemo(() => questions.filter(question => !question.archivedAt), [questions]);
  const dqSubjects = useMemo(() => {
    const groups = new Map<string, DailyQuestion[]>();
    for (const question of activeQuestions) groups.set(question.subjectId, [...(groups.get(question.subjectId) ?? []), question]);
    const catalogIds = new Set(dqSubjectCatalog.map(subject => subject.id));
    const known = dqSubjectCatalog.map(subject => ({ id: subject.id, name: subject.name, questions: groups.get(subject.id) ?? [] }));
    const custom = [...groups.entries()].filter(([id]) => !catalogIds.has(id)).map(([id, grouped]) => ({ id, name: subjects.find(subject => subject.id === id)?.name ?? dqSubjectName(id), questions: grouped }));
    return [...known, ...custom];
  }, [activeQuestions, subjects]);
  const [view, setView] = useState<DQView>('overview');
  const [dqStates, setDqStates] = useState<DQState[]>([]);
  const [returnTo, setReturnTo] = useState<DQView>('overview');

  const [practiceQueue, setPracticeQueue] = useState<DailyQuestion[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [graded, setGraded] = useState(false);
  const [gradedCorrect, setGradedCorrect] = useState(false);

  const [cfg, setCfg] = useState<PaperConfig>({ subjectId: dqSubjectCatalog[0]?.id ?? questions[0]?.subjectId ?? '', status: 'all', size: 10, random: true });
  const [paperIds, setPaperIds] = useState<string[]>([]);
  const [paperIndex, setPaperIndex] = useState(0);
  const [paperPicks, setPaperPicks] = useState<Record<string, string[]>>({});
  const [paperSelfGrades, setPaperSelfGrades] = useState<Record<string, boolean>>({});
  const [paperScore, setPaperScoreLocal] = useState(0);

  const refreshStates = useCallback(async () => {
    setDqStates(await repository.getDQStates());
  }, []);
  useEffect(() => {
    let alive = true;
    void repository.getDQStates().then(next => { if (alive) setDqStates(next); });
    return () => { alive = false; };
  }, [refreshStates]);

  const stateMap = useMemo(() => new Map(dqStates.map(s => [s.qid, s])), [dqStates]);
  const questionMap = useMemo(() => new Map(activeQuestions.map(q => [q.id, q])), [activeQuestions]);

  const statsOf = useCallback((subjectId: string) => {
    const meta = dqSubjects.find(s => s.id === subjectId);
    const total = meta?.questions.length ?? 0;
    let answered = 0, correct = 0;
    for (const q of meta?.questions ?? []) {
      const st = stateMap.get(q.id);
      if (st?.answeredAt) {
        answered += 1;
        if (st.correct) correct += 1;
      }
    }
    return { total, answered, correct, remaining: total - answered };
  }, [stateMap, dqSubjects]);

  const totalRemaining = dqSubjects.reduce((sum, s) => sum + statsOf(s.id).remaining, 0);

  const wrongEntries = useMemo(() => dqStates
    .filter(st => st.inWrongBook)
    .map(st => ({ state: st, question: questionMap.get(st.qid) }))
    .filter(x => Boolean(x.question))
    .sort((a, b) => a.question!.id.localeCompare(b.question!.id)), [dqStates, questionMap]);

  // ---------- 练习模式 ----------
  const startPractice = useCallback((subjectId: string) => {
    const meta = dqSubjects.find(s => s.id === subjectId);
    if (!meta) return;
    const sorted = [...meta.questions].sort((a, b) => a.number - b.number);
    const firstUnanswered = sorted.findIndex(q => !stateMap.get(q.id)?.answeredAt);
    setPracticeQueue(sorted);
    setPracticeIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
    setPicked([]); setGraded(false); setReturnTo('overview');
    setView('practice');
  }, [stateMap, dqSubjects]);

  const startSingle = useCallback((question: DailyQuestion, from: DQView) => {
    setPracticeQueue([question]);
    setPracticeIndex(0);
    setPicked([]); setGraded(false); setReturnTo(from);
    setView('practice');
  }, []);

  const current = practiceQueue[practiceIndex];

  const finishPractice = useCallback(async (correct: boolean) => {
    if (!current) return;
    await repository.recordDQAnswer({
      qid: current.id, picked, correct,
      removeThreshold: Math.max(1, settings.dqWrongRemoveThreshold),
    });
    setGradedCorrect(correct);
    setGraded(true);
    await refreshStates();
  }, [current, picked, refreshStates, settings.dqWrongRemoveThreshold]);

  const nextPractice = useCallback(() => {
    if (practiceQueue.length > 1 && practiceIndex < practiceQueue.length - 1) {
      setPracticeIndex(i => i + 1); setPicked([]); setGraded(false);
    } else {
      setView(returnTo);
    }
  }, [practiceIndex, practiceQueue.length, returnTo]);

  // ---------- 组卷 ----------
  const openSetup = useCallback((status: PaperConfig['status'] = 'all', subjectId?: string) => {
    setCfg(c => ({ ...c, status, subjectId: subjectId ?? c.subjectId }));
    setView('setup');
  }, []);

  const paperCandidates = useMemo(() => {
    const meta = dqSubjects.find(s => s.id === cfg.subjectId);
    if (!meta) return [];
    return meta.questions.filter(q => {
      const st = stateMap.get(q.id);
      if (cfg.status === 'unanswered') return !st?.answeredAt;
      if (cfg.status === 'correct') return Boolean(st?.answeredAt && st.correct && !st.inWrongBook);
      if (cfg.status === 'wrong') return Boolean(st?.inWrongBook);
      return true;
    });
  }, [cfg.subjectId, cfg.status, stateMap, dqSubjects]);

  const startPaper = useCallback(() => {
    const ids = pickPaper({
      numbers: paperCandidates.map(q => ({
        number: q.number,
        answered: Boolean(stateMap.get(q.id)?.answeredAt),
        correct: stateMap.get(q.id)?.correct,
      })),
      status: cfg.status, size: cfg.size, random: cfg.random,
    });
    if (!ids.length) return;
    const numberSet = new Set(ids);
    setPaperIds(paperCandidates.filter(q => numberSet.has(q.number)).map(q => q.id));
    setPaperIndex(0); setPaperPicks({}); setPaperSelfGrades({}); setReturnTo('overview');
    setView('run');
  }, [paperCandidates, cfg, stateMap]);

  const paperQuestions = useMemo(
    () => paperIds.map(id => questionMap.get(id)).filter(Boolean) as DailyQuestion[],
    [paperIds, questionMap],
  );

  const submitPaper = useCallback(async () => {
    let score = 0;
    for (const q of paperQuestions) {
      const pickedNow = paperPicks[q.id] ?? [];
      const correct = q.answer ? gradeDQ(q.answer, pickedNow) : (paperSelfGrades[q.id] ?? false);
      if (correct) score += 1;
      await repository.recordDQAnswer({
        qid: q.id, picked: pickedNow, correct,
        removeThreshold: Math.max(1, settings.dqWrongRemoveThreshold),
      });
    }
    setPaperScoreLocal(score);
    await refreshStates();
    setView('result');
  }, [paperQuestions, paperPicks, paperSelfGrades, refreshStates, settings.dqWrongRemoveThreshold]);

  // ---------- 渲染辅助 ----------
  const optionClass = (key: string, q: DailyQuestion, revealed: boolean, sel: string[]) => {
    let cls = 'dq-option';
    if (sel.includes(key)) cls += ' selected';
    if (revealed && q.answer) {
      if (q.answer.includes(key)) cls += ' right';
      else if (sel.includes(key)) cls += ' wrong';
    }
    return cls;
  };

  const renderOptions = (
    q: DailyQuestion,
    sel: string[],
    revealed: boolean,
    onToggle: (key: string) => void,
  ) => (
    <div className="dq-options">
      {q.options.map(o => (
        <button
          key={o.key}
          type="button"
          className={optionClass(o.key, q, revealed, sel)}
          disabled={revealed}
          onClick={() => onToggle(o.key)}
        >
          <b>{o.key}</b><span>{o.text}</span>
        </button>
      ))}
    </div>
  );

  const analysisBlock = (q: DailyQuestion) => (
    <>
      {q.analysis ? <p className="dq-analysis">{q.analysis}</p> : <p className="dq-note">官方未提供文字解析。</p>}
    </>
  );

  // ---------- 总览 ----------
  if (view === 'overview') {
    return (
      <section className="dq-page">
        <div className="dq-hero">
          <div>
            <p className="section-kicker">题库总览</p>
            <h2>共 {activeQuestions.length} 题</h2>
            <p>还剩 <strong>{totalRemaining}</strong> 题未作答。选择科目开始练习，或组卷检验。</p>
          </div>
          <button className="primary-action" type="button" onClick={() => setView('wrong')}>
            错题本（{wrongEntries.length}）
          </button>
        </div>
        <div className="dq-subject-grid">
          {dqSubjects.map(subject => {
            const st = statsOf(subject.id);
            const rate = st.answered ? Math.round(st.correct / st.answered * 100) : null;
            return (
              <article key={subject.id} className="dq-subject-card">
                <header><h3>{subject.name}</h3><small>共 {st.total} 题</small></header>
                <p>还剩 <strong>{st.remaining}</strong> 题未答</p>
                <small>{st.answered ? `已答 ${st.answered} · 正确率 ${rate}%` : '尚未开始'}</small>
                <div>
                  <button type="button" disabled={st.total===0} onClick={() => startPractice(subject.id)}>练习模式</button>
                  <button type="button" disabled={st.total===0} onClick={() => openSetup('all', subject.id)}>组卷模式</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  // ---------- 组卷设置 ----------
  if (view === 'setup') {
    return (
      <section className="dq-page">
        <div className="practice-hero">
          <div><p className="section-kicker">快速学习 · 开始前设置</p><h2>每日一题 · 组卷模式</h2>
            <p>按科目与作答状态选题，交卷后统一判分并回顾解析。</p></div>
          <button type="button" onClick={() => setView('overview')}>← 返回</button>
        </div>
        <section className="practice-setup-grid">
          <section>
            <p className="section-kicker">01 · 科目</p>
            <div className="exam-subjects">
              {dqSubjects.map(subject => (
                <button key={subject.id} type="button"
                  className={cfg.subjectId === subject.id ? 'active' : ''}
                  onClick={() => setCfg(c => ({ ...c, subjectId: subject.id }))}>
                  <strong>{subject.name}</strong>
                  <small>{subject.questions.length} 题</small>
                </button>
              ))}
            </div>
          </section>
          <section>
            <p className="section-kicker">02 · 作答状态</p>
            <div className="study-order-options">
              {([['all', '全部'], ['unanswered', '仅未答'], ['correct', '已答对'], ['wrong', '仅错题']] as const).map(([v, label]) => (
                <button key={v} type="button" className={cfg.status === v ? 'active' : ''}
                  onClick={() => setCfg(c => ({ ...c, status: v }))}>{label}</button>
              ))}
            </div>
            <p className="section-kicker" style={{ marginTop: 14 }}>03 · 题量</p>
            <div className="exam-sizes">
              {SIZES.map(n => (
                <button key={n} type="button" className={cfg.size === n ? 'active' : ''}
                  disabled={paperCandidates.length < n}
                  onClick={() => setCfg(c => ({ ...c, size: n }))}><strong>{n}</strong></button>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <input type="checkbox" checked={cfg.random}
                onChange={e => setCfg(c => ({ ...c, random: e.target.checked }))} />
              随机打乱顺序
            </label>
            <p className="exam-available">当前筛选共有 {paperCandidates.length} 题可选</p>
            <button className="start-exam-button" type="button" disabled={paperCandidates.length === 0} onClick={startPaper}>
              开始答题 →
            </button>
          </section>
        </section>
      </section>
    );
  }

  // ---------- 练习模式 ----------
  if (view === 'practice') {
    const q = current;
    if (!q) return <section className="empty-state"><span>✓</span><h2>本科目已全部答完</h2>
      <button type="button" onClick={() => setView('overview')}>返回总览</button></section>;
    const qt = qTypeLabel(q);
    const toggleKey = (key: string) => {
      if (q.qtype === 'single' && q.answer && !graded) {
        setPicked([key]);
        void finishPractice(gradeDQ(q.answer, [key]));
        return;
      }
      setPicked(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    };
    return (
      <section className="dq-page">
        <div className="practice-session-bar">
          <button type="button" onClick={() => setView(returnTo)}>← 结束本次</button>
          <div><span style={{ width: `${((practiceIndex + 1) / Math.max(1, practiceQueue.length)) * 100}%` }} /></div>
          <strong>{practiceIndex + 1} / {practiceQueue.length}</strong>
        </div>
        <article className="dq-question-card">
          <header><span className="dq-qmeta">第 {q.number} 题 · {qt} · 来源 {q.source}{q.tags?.length ? ` · ${q.tags.join('／')}` : ''}</span></header>
          <p className="dq-stem">{q.stem}</p>
          {renderOptions(q, picked, graded, toggleKey)}
        </article>
        {!graded && (
          <div className="dq-actions">
            {q.answer ? (
              <button className="primary-action" type="button" disabled={picked.length === 0}
                onClick={() => void finishPractice(gradeDQ(q.answer!, picked))}>
                提交答案（{picked.join('') || '未选择'}）
              </button>
            ) : (
              <div className="dq-self-grade">
                <p>本题官方未提供文字答案，请根据讲义或视频解析自行评判。</p>
                <button className="dq-btn-correct" type="button" disabled={picked.length === 0}
                  onClick={() => void finishPractice(true)}>✓ 我答对了</button>
                <button className="dq-btn-wrong" type="button" disabled={picked.length === 0}
                  onClick={() => void finishPractice(false)}>× 我答错了</button>
              </div>
            )}
          </div>
        )}
        {graded && (
          <div className={`dq-verdict ${gradedCorrect ? 'correct' : 'wrong'}`}>
            <strong>{gradedCorrect ? '回答正确' : '回答错误'}</strong>
            {q.answer && <span>正确答案：{q.answer.split('').join(' ')}</span>}
            {analysisBlock(q)}
            <button className="primary-action" type="button" onClick={nextPractice}>
              {practiceIndex < practiceQueue.length - 1 ? '下一题 →' : '完成，返回'}
            </button>
          </div>
        )}
      </section>
    );
  }

  // ---------- 组卷答题 ----------
  if (view === 'run') {
    const q = paperQuestions[paperIndex];
    if (!q) return null;
    const sel = paperPicks[q.id] ?? [];
    return (
      <section className="dq-page">
        <div className="practice-session-bar">
          <button type="button" onClick={() => setView('setup')}>← 放弃本卷</button>
          <div><span style={{ width: `${((paperIndex + 1) / Math.max(1, paperQuestions.length)) * 100}%` }} /></div>
          <strong>{paperIndex + 1} / {paperQuestions.length}</strong>
        </div>
        <article className="dq-question-card">
          <header><span className="dq-qmeta">第 {paperIndex + 1} 题 · {qTypeLabel(q)} · 来源 {q.source}</span></header>
          <p className="dq-stem">{q.stem}</p>
          {renderOptions(q, sel, false, key => {
            setPaperPicks(prev => ({
              ...prev,
              [q.id]: q.qtype === 'single' ? [key]
                : prev[q.id]?.includes(key) ? prev[q.id].filter(k => k !== key)
                : [...(prev[q.id] ?? []), key],
            }));
          })}
        </article>
        {!q.answer && (
          <div className="dq-actions dq-self-grade">
            <p>本题没有文字答案，请根据讲义或视频解析先完成自评：</p>
            <button className="dq-btn-correct" type="button" disabled={sel.length === 0}
              aria-pressed={paperSelfGrades[q.id] === true}
              onClick={() => setPaperSelfGrades(prev => ({ ...prev, [q.id]: true }))}>✓ 自评答对</button>
            <button className="dq-btn-wrong" type="button" disabled={sel.length === 0}
              aria-pressed={paperSelfGrades[q.id] === false}
              onClick={() => setPaperSelfGrades(prev => ({ ...prev, [q.id]: false }))}>× 自评答错</button>
          </div>
        )}
        <div className="dq-paper-nav">
          <button type="button" disabled={paperIndex === 0}
            onClick={() => setPaperIndex(i => i - 1)}>← 上一题</button>
          {paperIndex < paperQuestions.length - 1
            ? <button className="primary-action" type="button" onClick={() => setPaperIndex(i => i + 1)}>下一题 →</button>
            : <button className="primary-action" type="button"
                disabled={paperQuestions.some(item => !item.answer && paperSelfGrades[item.id] === undefined)}
                onClick={() => void submitPaper()}>交卷</button>}
        </div>
      </section>
    );
  }

  // ---------- 成绩页 ----------
  if (view === 'result') {
    return (
      <section className="dq-page">
        <div className="practice-summary">
          <span>{paperScore === paperQuestions.length ? '✓' : String(paperScore)}</span>
          <div>
            <p className="section-kicker">组卷完成</p>
            <h2>得分 {paperScore} / {paperQuestions.length}</h2>
            <p>正确率 {Math.round(paperScore / Math.max(1, paperQuestions.length) * 100)}%。答错的题目已进入错题本。</p>
          </div>
        </div>
        {paperQuestions.map((q, i) => {
          const pickedNow = paperPicks[q.id] ?? [];
          const ok = q.answer ? gradeDQ(q.answer, pickedNow) : (paperSelfGrades[q.id] ?? false);
          return (
            <details key={q.id} className={`dq-result-row ${ok ? 'right' : 'wrong'}`}>
              <summary>第 {i + 1} 题 · 你的答案 {pickedNow.join('') || '—'} · {q.answer ? `正确 ${q.answer}` : `自评${ok ? '答对' : '答错'}`} {ok ? '✓' : '×'}</summary>
              <p className="dq-stem">{q.stem}</p>
              {analysisBlock(q)}
            </details>
          );
        })}
        <div className="practice-summary-actions">
          <button type="button" onClick={() => setView('overview')}>返回总览</button>
          <button type="button" onClick={() => setView('setup')}>再组一卷 →</button>
        </div>
      </section>
    );
  }

  // ---------- 错题本 ----------
  const grouped = new Map<string, typeof wrongEntries>();
  for (const entry of wrongEntries) {
    const sid = entry.question!.subjectId;
    grouped.set(sid, [...(grouped.get(sid) ?? []), entry]);
  }
  return (
    <section className="dq-page">
      <div className="practice-hero">
        <div>
          <p className="section-kicker">每日一题</p>
          <h2>错题本（{wrongEntries.length}）</h2>
          <p>连对 {settings.dqWrongRemoveThreshold} 次自动移出；也可手动移除。可在组卷模式中选择「仅错题」批量重练。</p>
        </div>
        <button type="button" onClick={() => setView('overview')}>← 返回</button>
      </div>
      {[...grouped.entries()].map(([sid, entries]) => (
        <section key={sid} className="dq-wrong-group">
          <h3>{dqSubjects.find(s => s.id === sid)?.name ?? sid}（{entries.length}）</h3>
          {entries.map(({ state, question }) => (
            <article key={question!.id} className="dq-wrong-row">
              <div>
                <strong>第 {question!.number} 题 · {question!.source}</strong>
                <p>{question!.stem.slice(0, 80)}…</p>
                <small>上次作答：{state.picked?.join('') || '—'}｜正确：{question!.answer ?? '自评'}</small>
              </div>
              <div>
                <button type="button" onClick={() => startSingle(question!, 'wrong')}>单独重练</button>
                <button type="button" onClick={() => void repository.removeDQFromWrongBook(question!.id).then(refreshStates)}>
                  移出
                </button>
              </div>
            </article>
          ))}
        </section>
      ))}
      {wrongEntries.length === 0 && (
        <div className="empty-state"><span>✓</span><h2>错题本是空的</h2>
          <button type="button" onClick={() => setView('overview')}>返回总览</button></div>
      )}
    </section>
  );
}
