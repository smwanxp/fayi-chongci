'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { repository } from '@/lib/repository';
import type { Card, Chapter, MasteryRating, ReviewState, StudyRoundProgress, Subject } from '@/lib/types';
import { buildStudyGroup, effectiveStudySize, filterStudyCards, studyScopeOptions, studySizeOptions, type StudyOrder } from '@/lib/study-selection';
import { filterQuickRecallCards, filterQuickRecallContent, quickRecallPoolSummary } from '@/lib/quick-recall';
import { remainingInStudyRound, studyRoundSummary } from '@/lib/study-rounds';

const cardTitle = (card: Card) => card.prompt.replace(/^请完整默写：\s*/, '');

function PracticeSetup({ title, description, mark, cards, candidates, subjects, chapters, subjectId, scopeId, orderMode, size, contentControl, onSubject, onScope, onOrder, onSize, onStart }: {
  title: string; description: string; mark: string; cards: Card[]; candidates: Card[]; subjects: Subject[]; chapters: Chapter[]; subjectId: string; scopeId: string; orderMode: StudyOrder; size: number; contentControl?: ReactNode;
  onSubject(value: string): void; onScope(value: string): void; onOrder(value: StudyOrder): void; onSize(value: number): void; onStart(): void;
}) {
  const scopes = studyScopeOptions(subjectId, chapters);
  const sizeOptions = studySizeOptions(candidates.length, size);
  return <section className="practice-page">
    <div className="practice-hero"><div><p className="section-kicker">快速学习 · 开始前设置</p><h2>{title}</h2><p>{description}</p></div><span>{mark}</span></div>
    <div className="practice-setup-grid">
      <section>
        <p className="section-kicker">01 · 学习范围</p><h3>选择科目</h3>
        <div className="exam-subjects">
          <button type="button" className={subjectId === 'all' ? 'active' : ''} onClick={() => onSubject('all')}><strong>全部科目</strong><small>{cards.length} 张可用</small></button>
          {subjects.map(subject => {
            const count = cards.filter(card => card.subjectId === subject.id).length;
            return <button type="button" className={subjectId === subject.id ? 'active' : ''} disabled={!count} onClick={() => onSubject(subject.id)} key={subject.id}><strong>{subject.name}</strong><small>{count ? count + ' 张可用' : '暂无资料'}</small></button>;
          })}
        </div>
      </section>
      <section>
        <div className="practice-scope-settings">
          <div>
            <p className="section-kicker">02 · 章节范围</p><h3>整科顺序或指定章节</h3>
            <select value={scopeId} onChange={event => onScope(event.target.value)} disabled={subjectId === 'all'}>
              <option value="all">{subjectId === 'all' ? '全部科目 · 全部章节' : '全部章节 · 从上到下'}</option>
              {scopes.map(scope => <option value={scope.id} key={scope.id}>{scope.label}</option>)}
            </select>
          </div>
          <div>
            <p className="section-kicker">03 · 出现顺序</p><h3>按体系捋或随机抽查</h3>
            <div className="study-order-options">
              <button type="button" className={orderMode === 'ordered' ? 'active' : ''} onClick={() => onOrder('ordered')}><strong>按顺序</strong><small>从所选范围第一条往下</small></button>
              <button type="button" className={orderMode === 'random' ? 'active' : ''} onClick={() => onOrder('random')}><strong>随机</strong><small>每次开始重新打乱</small></button>
            </div>
          </div>
        </div>
        {contentControl && <div className="practice-content-control"><p className="section-kicker">04 · 卡片构成</p>{contentControl}</div>}
        <p className="section-kicker practice-size-kicker">{contentControl ? '05' : '04'} · 每组数量</p><h3>选择本次实际学习量</h3>
        <div className="exam-sizes">{sizeOptions.map(value => <button type="button" className={size === value ? 'active' : ''} onClick={() => onSize(value)} key={value}><strong>{value}</strong><span>{value === candidates.length ? '全部可用' : '条一组'}</span></button>)}</div>
        <p className="exam-available">{candidates.length ? '当前范围共有 ' + candidates.length + ' 张可学习卡片；不足 5 条也可以直接开始。' : '当前范围没有符合条件的卡片'}</p>
        <button className="start-exam-button" type="button" disabled={!candidates.length} onClick={onStart}>开始本组 <span>{size} 条 →</span></button>
      </section>
    </div>
  </section>;
}
export function QuickRecallMode({ cards, subjects, chapters, initialCardIds, includeJudgment, onExit, onRecordsChanged }: {
  cards: Card[]; subjects: Subject[]; chapters: Chapter[]; initialCardIds?: string[]; includeJudgment: boolean; onExit(): void; onRecordsChanged(): Promise<void>;
}) {
  const [phase, setPhase] = useState<'setup' | 'study' | 'done'>(initialCardIds?.length ? 'study' : 'setup');
  const [quickStates, setQuickStates] = useState<ReviewState[]>([]);
  const [subjectId, setSubjectId] = useState('criminal-procedure');
  const [scopeId, setScopeId] = useState('all');
  const [orderMode, setOrderMode] = useState<StudyOrder>('ordered');
  const [size, setSize] = useState(10);
  const [cardIds, setCardIds] = useState<string[]>(initialCardIds ?? []);
  const [index, setIndex] = useState(0);
  const [recall, setRecall] = useState<'familiar' | 'unfamiliar' | 'vague' | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState({ again: 0, hard: 0, good: 0 });
  const [answered, setAnswered] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [judgPick, setJudgPick] = useState<boolean | null>(null);
  const [includeJudgmentCards, setIncludeJudgmentCards] = useState(includeJudgment);

  useEffect(() => {
    void repository.getReviewStates().then(setQuickStates);
  }, []);

  const scopes = useMemo(() => studyScopeOptions(subjectId, chapters), [subjectId, chapters]);
  const selectedScope = scopeId === 'all' ? undefined : scopes.find(scope => scope.id === scopeId);
  const quickModeCards = useMemo(() => filterQuickRecallContent(cards, includeJudgmentCards), [cards, includeJudgmentCards]);
  const scopeCards = useMemo(() => filterStudyCards(quickModeCards, subjectId, selectedScope), [quickModeCards, subjectId, selectedScope]);

  const candidates = useMemo(() => filterQuickRecallCards(scopeCards, quickStates), [scopeCards, quickStates]);
  const effectiveSize = effectiveStudySize(size, candidates.length);
  const group = cardIds.map(id => cards.find(card => card.id === id)).filter(Boolean) as Card[];
  const pool = quickRecallPoolSummary(scopeCards, quickStates);
  const current = group[index];
  const chooseSubject = (value: string) => { setSubjectId(value); setScopeId('all'); };
  const start = () => {
    setCardIds(buildStudyGroup(candidates, subjects, chapters, orderMode, effectiveSize).map(card => card.id));
    setIndex(0); setResults({ again: 0, hard: 0, good: 0 }); setAnswered(0); setRecall(null); setRevealed(false); setPhase('study');
  };
  const reveal = (value: 'familiar' | 'unfamiliar' | 'vague') => { setRecall(value); setRevealed(true); };
  const submitPaper = async () => {
    try { await repository.flushRemoteSync(); } catch {}
    await onRecordsChanged();
    setPhase('done');
  };
  const mark = async (value: 'again' | 'hard' | 'good', objectiveCorrectOverride?: boolean) => {
    if (!current) return;
    const rating: MasteryRating = value;
    await repository.recordReview({ cardId: current.id, rating, objectiveCorrect: objectiveCorrectOverride ?? value === 'good', elapsedMs: 0 });
    setResults(result => ({ ...result, [value]: result[value] + 1 }));
    setAnswered(count => count + 1);
    await repository.markQuickRecall(current.id, value);
    setQuickStates(await repository.getReviewStates());
    if (index >= group.length - 1) {
      await submitPaper();
      return;
    }
    setIndex(position => position + 1); setJudgPick(null); setRecall(null); setRevealed(false);
  };
  const resetQuickPool = async () => {
    if (!window.confirm(`\u786e\u5b9a\u91cd\u7f6e\u5f53\u524d\u8303\u56f4\u7684 ${pool.total} \u6761\u901f\u8bb0\u8fdb\u5ea6\u5417\uff1f\u5b83\u4eec\u4f1a\u91cd\u65b0\u8fdb\u5165\u901f\u8bb0\u9898\u5e93\uff0c\u5176\u4ed6\u6a21\u5f0f\u7684\u590d\u4e60\u72b6\u6001\u548c\u5386\u53f2\u8bb0\u5f55\u4e0d\u4f1a\u6539\u53d8\u3002`)) return;
    setResetting(true);
    try {
      await repository.resetQuickRecallProgress(scopeCards.map(card => card.id));
      try { await repository.flushRemoteSync(); } catch {}
      setQuickStates(await repository.getReviewStates());
      await onRecordsChanged();
    } finally {
      setResetting(false);
    }
  };
  if (phase === 'setup') return (
    <>
      <PracticeSetup
        title={'\u901f\u8bb0\u6a21\u5f0f\uff1a\u5148\u56de\u5fc6\uff0c\u518d\u5feb\u901f\u6807\u6ce8\u6f0f\u6d1e'}
        description={'\u8bb0\u5bf9\u5e76\u6807\u8bb0\u638c\u63e1\u7684\u5185\u5bb9\u4f1a\u9000\u51fa\u901f\u8bb0\u9898\u5e93\uff1b\u6a21\u7cca\u548c\u8bb0\u9519\u5185\u5bb9\u7ee7\u7eed\u7559\u5728\u6eda\u52a8\u590d\u4e60\u6c60\uff0c\u76f4\u5230\u771f\u6b63\u638c\u63e1\u3002'}
        mark={'速'} cards={quickModeCards} candidates={candidates} subjects={subjects} chapters={chapters}
        contentControl={<div className="practice-content-options"><button type="button" className={!includeJudgmentCards ? 'active' : ''} onClick={() => setIncludeJudgmentCards(false)}><strong>只复习口诀与背诵卡</strong><small>不出现正确 / 错误判断题</small></button><button type="button" className={includeJudgmentCards ? 'active' : ''} onClick={() => setIncludeJudgmentCards(true)}><strong>混入判断题卡</strong><small>口诀与判断题按所选顺序一起复习</small></button></div>}
        subjectId={subjectId} scopeId={scopeId} orderMode={orderMode} size={effectiveSize}
        onSubject={chooseSubject} onScope={setScopeId} onOrder={setOrderMode} onSize={setSize}
        onStart={start}
      />
      <div className="quick-pool-status quick-pool-status-standalone">
        <p>{`\u5f53\u524d\u8303\u56f4\u5df2\u638c\u63e1 ${pool.mastered} \u6761 \u00b7 \u6eda\u52a8\u56de\u7089 ${pool.rolling} \u6761 \u00b7 \u5269\u4f59 ${pool.remaining} \u6761`}</p>
        <button type="button" disabled={resetting} onClick={() => void resetQuickPool()}>
          {resetting ? '\u6b63\u5728\u91cd\u7f6e\u2026' : '\u91cd\u7f6e\u5f53\u524d\u8303\u56f4'}
        </button>
      </div>
    </>
  );
  if (phase === 'done') return (
    <section className="practice-page">
      <div className="practice-summary">
        <span>{'\u2713'}</span>
        <div>
          <p className="section-kicker">{'\u672c\u7ec4\u901f\u8bb0\u5b8c\u6210'}</p>
          <h2>{answered}{' \u6761\u5df2\u5feb\u901f\u7b5b\u67e5'}</h2>
          <p>{`\u8bb0\u5bf9 ${results.good} \u6761\u5df2\u9000\u51fa\u901f\u8bb0\u6c60\uff1b\u6a21\u7cca ${results.hard} \u6761\u3001\u8bb0\u9519 ${results.again} \u6761\u4ecd\u4f1a\u6eda\u52a8\u56de\u7089\u3002\u6240\u6709\u7ed3\u679c\u540c\u65f6\u5199\u5165\u590d\u4e60\u8fdb\u5ea6\u3002`}</p>
        </div>
      </div>
      <div className="practice-summary-actions">
        <button type="button" onClick={onExit}>{'\u8fd4\u56de\u4eca\u65e5\u51b2\u523a'}</button>
        <button type="button" onClick={() => setPhase('setup')}>{'\u7ee7\u7eed\u6eda\u52a8\u4e00\u7ec4 \u2192'}</button>
      </div>
    </section>
  );
  if (!current) return <section className="empty-state"><span>!</span><h2>没有可用卡片</h2><button type="button" onClick={() => setPhase('setup')}>重新选择</button></section>;
  const chapter = chapters.find(item => item.id === current.chapterId); const subject = subjects.find(item => item.id === current.subjectId); const progress = Math.round((index + 1) / Math.max(1, group.length) * 100);
  if (current.type === 'judgment') {
    const correct = judgPick !== null && judgPick === current.judgmentAnswer;
    return (
      <section className="practice-page">
        <div className="practice-session-bar">
          <button type="button" onClick={onExit}>← 结束本次</button>
          <div><span style={{ width: `${progress}%` }} /></div>
          <strong>{index + 1} / {group.length}</strong>
        </div>
        <article className="quick-card">
          <header><span>关联判断 · 速记</span><small>{subject?.name} · {chapter?.name}</small></header>
          <p className="quick-index">第 {index + 1} 条</p>
          <h2>{cardTitle(current)}</h2>
          {judgPick === null ? (
            <div className="dq-actions dq-self-grade">
              <p>判断下列说法：</p>
              <button className="dq-btn-correct" type="button"
                onClick={() => setJudgPick(true)}>
                ✓ 这个说法正确
              </button>
              <button className="dq-btn-wrong" type="button"
                onClick={() => setJudgPick(false)}>
                × 这个说法错误
              </button>
            </div>
          ) : (
            <>
              <div className={`dq-verdict ${correct ? 'correct' : 'wrong'}`}>
                <strong>{correct ? '判断正确' : '判断错误'}</strong>
                <span>本题说法{current.judgmentAnswer ? '正确' : '错误'}</span>
                <p>{current.explanation}</p>
              </div>
              <div className="dq-actions">
                <button className="primary-action" type="button" onClick={() => void mark(correct ? 'good' : 'again', correct)}>
                  {index < group.length - 1 ? '下一题 →' : '完成本组 →'}
                </button>
              </div>
            </>
          )}
        </article>
      </section>
    );
  }
  return <section className="practice-page"><div className="practice-session-bar"><button type="button" onClick={() => void submitPaper()}>⏹ 提前交卷</button><div><span style={{ width: `${progress}%` }} /></div><strong>{index + 1} / {group.length}</strong></div><article className="quick-card"><header><span>速记回忆</span><small>{subject?.name} · {chapter?.name}</small></header><p className="quick-index">第 {index + 1} 条</p><h2>{cardTitle(current)}</h2>{!revealed ? <section className="quick-first-step"><p>只根据标题和知识点回忆内容，现在感觉如何？</p><div><button type="button" onClick={() => reveal('familiar')}>熟悉</button><button type="button" onClick={() => reveal('unfamiliar')}>不熟悉</button><button type="button" onClick={() => reveal('vague')}>模糊</button></div></section> : <section className="quick-answer"><div className="quick-recall-label">初步判断：{recall === 'familiar' ? '熟悉' : recall === 'unfamiliar' ? '不熟悉' : '模糊'}</div><p className="answer-label">参考答案 / 口诀</p><h3>{current.answer}</h3>{current.explanation && <div className="quick-explanation"><strong>详细解释</strong><p>{current.explanation}</p></div>}{current.statute && <div className="quick-statute"><strong>法条 / 来源</strong><p>{current.statute}</p></div>}<p className="quick-final-prompt">对照答案后，做最终标记：</p><div className="quick-final-actions"><button className="wrong" type="button" onClick={() => void mark('again')}>记错了</button><button className="vague" type="button" onClick={() => void mark('hard')}>模糊</button><button className="correct" type="button" onClick={() => void mark('good')}>记对了</button></div></section>}</article></section>;
}

export function GuidedReviewMode({ cards, subjects, chapters, onExit, onStartQuick, onStartExam }: {
  cards: Card[]; subjects: Subject[]; chapters: Chapter[]; onExit(): void; onStartQuick(cardIds: string[]): void; onStartExam(cardIds: string[]): Promise<void>;
}) {
  const [phase, setPhase] = useState<'setup' | 'study' | 'done'>('setup');
  const [subjectId, setSubjectId] = useState('criminal-procedure');
  const [scopeId, setScopeId] = useState('all');
  const [orderMode, setOrderMode] = useState<StudyOrder>('ordered');
  const [size, setSize] = useState(10);
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [roundProgress, setRoundProgress] = useState<StudyRoundProgress[]>([]);
  const [resetting, setResetting] = useState(false);
  const mnemonicCards = useMemo(() => cards.filter(card => card.type === 'mnemonic'), [cards]);
  const scopes = useMemo(() => studyScopeOptions(subjectId, chapters), [subjectId, chapters]);
  const selectedScope = scopeId === 'all' ? undefined : scopes.find(scope => scope.id === scopeId);
  const scopeCards = useMemo(() => filterStudyCards(mnemonicCards, subjectId, selectedScope), [mnemonicCards, subjectId, selectedScope]);
  const candidates = useMemo(() => remainingInStudyRound(scopeCards, roundProgress, 'guided'), [scopeCards, roundProgress]);
  const round = useMemo(() => studyRoundSummary(scopeCards, roundProgress, 'guided'), [scopeCards, roundProgress]);
  const effectiveSize = effectiveStudySize(size, candidates.length);
  const group = cardIds.map(id => cards.find(card => card.id === id)).filter(Boolean) as Card[];
  const current = group[index];

  useEffect(() => { void repository.getStudyRoundProgress().then(setRoundProgress); }, []);

  const chooseSubject = (value: string) => { setSubjectId(value); setScopeId('all'); };
  const start = () => {
    setCardIds(buildStudyGroup(candidates, subjects, chapters, orderMode, effectiveSize).map(card => card.id));
    setIndex(0);
    setPhase('study');
  };
  const finish = async () => {
    await repository.markStudyRoundCompleted('guided', cardIds);
    setRoundProgress(await repository.getStudyRoundProgress());
    try { await repository.flushRemoteSync(); } catch {}
    setPhase('done');
  };
  const resetRound = async () => {
    if (!window.confirm(`确定重置当前范围的带背轮次吗？已完成的 ${round.completed} 条会重新进入带背题库；复习评分和历史记录不会改变。`)) return;
    setResetting(true);
    try {
      await repository.resetStudyRound('guided', scopeCards.map(card => card.id));
      setRoundProgress(await repository.getStudyRoundProgress());
      try { await repository.flushRemoteSync(); } catch {}
    } finally {
      setResetting(false);
    }
  };

  if (phase === 'setup') return <>
    <PracticeSetup title="带背模式：先理解，再进入主动回忆" description="完成过的内容会退出本轮带背题库，直到你重置这一轮；可按体系顺序学习，也可随机抽查。" mark="带" cards={mnemonicCards} candidates={candidates} subjects={subjects} chapters={chapters} subjectId={subjectId} scopeId={scopeId} orderMode={orderMode} size={effectiveSize} onSubject={chooseSubject} onScope={setScopeId} onOrder={setOrderMode} onSize={setSize} onStart={start} />
    <div className="quick-pool-status quick-pool-status-standalone"><p>当前范围已完成 {round.completed} 条 · 本轮剩余 {round.remaining} 条 · 共 {round.total} 条</p><button type="button" disabled={resetting || !round.completed} onClick={() => void resetRound()}>{resetting ? '正在重置…' : '重置当前范围这一轮'}</button></div>
  </>;
  if (phase === 'done') return <section className="practice-page"><div className="practice-summary"><span>完</span><div><p className="section-kicker">本组带背完成</p><h2>{group.length} 条已经完整过一遍</h2><p>这组已经移出本轮带背题库。现在趁记忆还新鲜，可用同一组继续主动回忆。</p></div></div><div className="handoff-actions"><button type="button" onClick={() => onStartQuick(cardIds)}><span>速</span><div><strong>进入速记模式</strong><small>只看标题，快速筛查漏洞</small></div></button><button type="button" onClick={() => void onStartExam(cardIds)}><span>默</span><div><strong>进入默写模式</strong><small>完整写出口诀并自动评分</small></div></button></div><div className="practice-summary-actions"><button type="button" onClick={onExit}>返回今日冲刺</button><button type="button" onClick={() => setPhase('setup')}>继续本轮下一组</button></div></section>;
  if (!current) return <section className="empty-state"><span>!</span><h2>没有可用口诀</h2><button type="button" onClick={() => setPhase('setup')}>重新选择</button></section>;
  const chapter = chapters.find(item => item.id === current.chapterId);
  const subject = subjects.find(item => item.id === current.subjectId);
  const progress = Math.round((index + 1) / Math.max(1, group.length) * 100);
  return <section className="practice-page"><div className="practice-session-bar"><button type="button" onClick={onExit}>← 结束本次</button><div><span style={{ width: `${progress}%` }} /></div><strong>{index + 1} / {group.length}</strong></div><article className="guided-card"><header><div><span>带背学习</span><small>{subject?.name} · {chapter?.name}</small></div><b>{String(index + 1).padStart(2, '0')}</b></header><h2>{cardTitle(current)}</h2><section className="guided-mnemonic"><p>口诀 / 答案</p><h3>{current.answer}</h3></section><section className="guided-knowledge"><strong>对应知识点</strong><p>{chapter?.name ?? '未归类知识点'}</p>{current.relatedChapterIds?.length ? <small>同时关联 {current.relatedChapterIds.map(id => chapters.find(item => item.id === id)?.name).filter(Boolean).join('、')}</small> : null}</section>{current.explanation && <section className="guided-explanation"><strong>详细解释</strong><p>{current.explanation}</p></section>}{current.statute && <section className="guided-statute"><strong>法条 / 来源</strong><p>{current.statute}</p></section>}<footer><button type="button" disabled={index === 0} onClick={() => setIndex(position => position - 1)}>← 上一个</button>{index < group.length - 1 ? <button className="primary" type="button" onClick={() => setIndex(position => position + 1)}>下一个 →</button> : <button className="primary" type="button" onClick={() => void finish()}>完成本组 →</button>}</footer></article></section>;
}
