'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { parseImportFile, fingerprintFile } from '@/lib/importers';
import { repository } from '@/lib/repository';
import { formatInterval, daysUntilExam } from '@/lib/scheduler';
import { mnemonicScore, normalizeMnemonic } from '@/lib/mnemonic';
import type { AppSettings, BackupPayload, Card, DraftCard, ExamAnswer, ExamFeedbackMode, ExamPracticeKind, ExamSession, ImportBatch, MasteryRating, Note, Relation, ReviewLog, ReviewState, StudyRoundProgress, Subject, Chapter, DQState, DQLog, DailyQuestion } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { criminalProcedureModules } from '@/lib/criminal-procedure-seed';
import { threeInternationalLawModules } from '@/lib/three-international-laws-seed';
import { PwaStatus } from './PwaRegister';
import { useAuth } from './AuthGate';
import { GuidedReviewMode, QuickRecallMode } from './PracticeModes';
import { buildStudyGroup, buildTypeFocusPool, effectiveStudySize, filterStudyCards, studyScopeOptions, studySizeOptions, type StudyOrder } from '@/lib/study-selection';
import { examRoundMode, remainingInStudyRound, studyRoundSummary } from '@/lib/study-rounds';
import DailyQuestions from './DailyQuestions';
import Dashboard from './Dashboard';
import ContentLibrary from './ContentLibrary';
import UserManagement from './UserManagement';
import Notebook from './Notebook';
import { isNoteDue } from '@/lib/notebook';

type View = 'today' | 'quick' | 'guided' | 'focus' | 'exam' | 'daily' | 'dashboard' | 'system' | 'library' | 'notebook' | 'graph' | 'import' | 'settings' | 'users';
type PracticePreset = { kind: ExamPracticeKind; subjectId?: string };
const navItems: { id: View; label: string; short: string }[] = [
  { id: 'today', label: '今日冲刺', short: '今' }, { id: 'quick', label: '速记模式', short: '速' }, { id: 'guided', label: '带背模式', short: '带' }, { id: 'exam', label: '模拟组卷', short: '卷' }, { id: 'daily', label: '每日一题', short: '题' }, { id: 'dashboard', label: '数据看板', short: '盘' }, { id: 'system', label: '知识体系', short: '系' }, { id: 'library', label: '科目题库', short: '库' },
  { id: 'notebook', label: '复习笔记', short: '记' }, { id: 'graph', label: '知识关联', short: '联' },
  { id: 'import', label: '资料导入', short: '入' }, { id: 'settings', label: '设置备份', short: '设' }, { id: 'users', label: '用户管理', short: '户' },
];
const ratingOptions: { id: MasteryRating; label: string; hint: string; key: string }[] = [
  { id: 'again', label: '忘记', hint: '10 分钟后', key: '1' }, { id: 'hard', label: '模糊', hint: '缩短间隔', key: '2' },
  { id: 'good', label: '记住', hint: '正常推进', key: '3' }, { id: 'easy', label: '熟练', hint: '延长间隔', key: '4' },
];
const relationNames: Record<Relation['kind'], string> = { confusable: '易混', exception: '例外', counterexample: '反例', statute: '法条', trap: '陷阱' };
const cardTitle = (card: Card) => card.prompt.replace(/^请完整默写：\s*/, '');
const cardBelongsToChapter = (card: Card, chapterId: string) => card.chapterId === chapterId || Boolean(card.relatedChapterIds?.includes(chapterId));
const fontScaleClass = (scale: AppSettings['fontScale']) => scale === 0.9 ? 'font-scale-small' : scale === 1.12 ? 'font-scale-large' : scale === 1.25 ? 'font-scale-xlarge' : 'font-scale-standard';

export default function StudyApp() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>('today');
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [ready, setReady] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [libraryCards,setLibraryCards]=useState<Card[]>([]);
  const [queue, setQueue] = useState<Card[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [reviewStates, setReviewStates] = useState<ReviewState[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [examSession,setExamSession]=useState<ExamSession|undefined>();
  const [examPreset,setExamPreset]=useState<PracticePreset>({kind:'mixed'});
  const [dqStates, setDqStates] = useState<DQState[]>([]);
  const [dqLogs, setDqLogs] = useState<DQLog[]>([]);
  const [dailyQuestions, setDailyQuestions] = useState<DailyQuestion[]>([]);
  const [libraryQuestions,setLibraryQuestions]=useState<DailyQuestion[]>([]);
  const [quickPreset,setQuickPreset]=useState<string[]|undefined>();
  const [focusPool,setFocusPool]=useState<Card[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [focusOverride, setFocusOverride] = useState<Card | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [judgmentChoice, setJudgmentChoice] = useState<boolean | null>(null);
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [mnemonicResult, setMnemonicResult] = useState<number | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [clock, setClock] = useState(0);
  const [contentUpdateAvailable,setContentUpdateAvailable]=useState(false);
  const cardStartedAt = useRef(0);

  const reload = useCallback(async () => {
    // 内置版本化题库只补充缺失 ID，不覆盖任何用户自行新增或修改的内容。
    await repository.initialize(true);
    const [nextCards, nextQueue, nextSubjects, nextChapters, nextRelations, nextStates, nextLogs, nextNotes, nextExamSession, nextSettings, nextDqStates, nextDqLogs, nextDailyQuestions, nextLibraryCards, nextLibraryQuestions] = await Promise.all([
      repository.getCards(), repository.getDailyQueue(), repository.getSubjects(), repository.getChapters(), repository.getRelations(),
      repository.getReviewStates(), repository.getReviewLogs(), repository.getNotes(), repository.getExamSession(), repository.getSettings(),
      repository.getDQStates(), repository.getDQLogs(), repository.getDailyQuestions(), repository.getAllCards(), repository.getAllDailyQuestions(),
    ]);
    setCards(nextCards); setQueue(nextQueue); setSubjects(nextSubjects.sort((a,b) => a.order-b.order)); setChapters(nextChapters);
    setRelations(nextRelations); setReviewStates(nextStates); setLogs(nextLogs); setNotes(nextNotes); setExamSession(nextExamSession); setSettings(nextSettings); setDqStates(nextDqStates); setDqLogs(nextDqLogs); setDailyQuestions(nextDailyQuestions); setLibraryCards(nextLibraryCards); setLibraryQuestions(nextLibraryQuestions); setReady(true);
    setClock(Date.now());
  }, []);

  // Repository initialization is asynchronous and only runs once on mount.
  useEffect(() => { reload().catch(console.error); }, [reload]);
  useEffect(()=>{const notify=()=>setContentUpdateAvailable(true);window.addEventListener('fayi-content-refresh-required',notify);return()=>window.removeEventListener('fayi-content-refresh-required',notify)},[]);
  const activeFocusPool = focusPool.length ? focusPool : queue;
  const currentCard = focusOverride ?? activeFocusPool[focusIndex];

  const openFocus = useCallback((card?: Card, pool?: Card[]) => {
    setFocusPool(pool ?? (card ? [card] : [])); setFocusIndex(0); setSessionDone(0); setSessionCorrect(0); setFocusOverride(card ?? null); setRevealed(false); setJudgmentChoice(null); setMnemonicInput(''); setMnemonicResult(null); cardStartedAt.current = Date.now(); setView('focus');
  }, []);

  const startPresetExam = useCallback(async (cardIds: string[]) => {
    const timestamp = new Date().toISOString();
    const selectedCards = cardIds.map(id => cards.find(card => card.id === id)).filter(Boolean) as Card[];
    const subjectId = selectedCards[0]?.subjectId ?? 'all';
    const typeSet = new Set(selectedCards.map(card => card.type));
    const practiceKind: ExamPracticeKind = typeSet.size === 1 ? selectedCards[0]?.type ?? 'mixed' : 'mixed';
    const next: ExamSession = { id:'active', cardIds, subjectId, practiceKind, feedbackMode:'instant', answers:{}, currentIndex:0, status:'active', startedAt:timestamp, updatedAt:timestamp };
    await repository.clearExamSession(); await repository.saveExamSession(next); setExamSession(next); setExamPreset({kind:practiceKind,subjectId}); setView('exam');
  }, [cards]);

  const openPracticeSetup = useCallback(async (preset: PracticePreset) => {
    if (examSession?.status === 'active') {
      const activeKind = examSession.practiceKind ?? 'mixed';
      if (activeKind === preset.kind && (!preset.subjectId || preset.subjectId === examSession.subjectId)) {
        setExamPreset({kind:activeKind,subjectId:examSession.subjectId});
        setView('exam');
        return;
      }
      if (!window.confirm('当前还有一组未完成训练。确定放弃旧组并进入新的设置页吗？取消会继续保留旧组。')) return;
      await repository.clearExamSession();
      setExamSession(undefined);
    } else if (examSession?.status === 'completed') {
      await repository.clearExamSession();
      setExamSession(undefined);
    }
    setExamPreset(preset);
    setView('exam');
  }, [examSession]);

  const rate = useCallback(async (rating: MasteryRating) => {
    if (!currentCard || !revealed) return;
    const objectiveCorrect = currentCard.type === 'judgment' ? judgmentChoice === currentCard.judgmentAnswer : currentCard.type === 'mnemonic' ? (mnemonicResult ?? 0) >= 85 : undefined;
    await repository.recordReview({ cardId: currentCard.id, rating, objectiveCorrect, elapsedMs: cardStartedAt.current ? Date.now() - cardStartedAt.current : 0 });
    setSessionDone(value => value + 1);
    if (objectiveCorrect !== false) setSessionCorrect(value => value + 1);
    setFocusOverride(null); setFocusIndex(value => value + 1); setRevealed(false); setJudgmentChoice(null); setMnemonicInput(''); setMnemonicResult(null); cardStartedAt.current = Date.now();
    const [nextQueue, nextStates, nextLogs] = await Promise.all([repository.getDailyQueue(), repository.getReviewStates(), repository.getReviewLogs()]);
    setQueue(nextQueue); setReviewStates(nextStates); setLogs(nextLogs);
    setClock(Date.now());
  }, [currentCard, judgmentChoice, mnemonicResult, revealed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (view !== 'focus' || ['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement).tagName)) return;
      if (event.code === 'Space' && currentCard?.type === 'recall') { event.preventDefault(); setRevealed(true); }
      if (currentCard?.type === 'judgment' && !revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        setJudgmentChoice(event.key === 'ArrowRight'); setRevealed(true);
      }
      const option = ratingOptions.find(item => item.key === event.key);
      if (option && revealed) void rate(option.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, currentCard, revealed, rate]);

  const subjectMap = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects]);
  const chapterMap = useMemo(() => new Map(chapters.map(chapter => [chapter.id, chapter])), [chapters]);
  const stateMap = useMemo(() => new Map(reviewStates.map(state => [state.cardId, state])), [reviewStates]);
  const visibleNavItems = user.role === 'admin' ? navItems : navItems.filter(item => item.id !== 'users');

  if (!ready) return <div className="loading-screen"><span>法</span><p>正在整理今日复习队列…</p></div>;

  return (
    <main className={`app-shell ${fontScaleClass(settings.fontScale)}`}>
      {contentUpdateAvailable&&<div className="content-update-banner" role="status"><span>管理员已同步新题库；你的学习进度已保存。</span><button type="button" onClick={()=>window.location.reload()}>刷新载入内容</button><button type="button" aria-label="稍后刷新" onClick={()=>setContentUpdateAvailable(false)}>×</button></div>}
      <button className="mobile-menu-toggle" type="button" aria-label="打开导航" aria-expanded={mobileMenuOpen} aria-controls="mobile-drawer" onClick={()=>setMobileMenuOpen(true)}><span/><span/><span/></button>
      <button className={`mobile-drawer-backdrop ${mobileMenuOpen?'open':''}`} type="button" aria-label="关闭导航" onClick={()=>setMobileMenuOpen(false)}/>
      <aside id="mobile-drawer" className={`mobile-drawer ${mobileMenuOpen?'open':''}`} aria-hidden={!mobileMenuOpen}>
        <div className="mobile-drawer-head"><button type="button" onClick={()=>{setView('today');setMobileMenuOpen(false)}}>法</button><div><strong>法忆冲刺</strong><small>第三轮 · 冲刺背诵</small></div><button type="button" aria-label="关闭导航" onClick={()=>setMobileMenuOpen(false)}>×</button></div>
        <nav>{visibleNavItems.map(item=><button type="button" className={view===item.id?'active':''} onClick={()=>{if(item.id==='exam'&&!examSession)setExamPreset({kind:'mixed'});setView(item.id);setMobileMenuOpen(false)}} key={item.id}><span>{item.short}</span><strong>{item.label}</strong><b>›</b></button>)}</nav>
        <div className="mobile-drawer-foot"><strong>{user.displayName}</strong><small>@{user.username} · {user.role==='admin'?'管理员':'独立账号'}</small><PwaStatus/><button type="button" onClick={()=>void logout()}>立即同步</button></div>
      </aside>
      <aside className="side-nav" aria-label="主导航">
        <button className="brand-mark" type="button" onClick={() => setView('today')} aria-label="回到今日冲刺">法</button>
        <nav>{visibleNavItems.map(item => <button className={`nav-item ${view === item.id ? 'active' : ''}`} type="button" key={item.id} onClick={() => { if(item.id==='exam'&&!examSession)setExamPreset({kind:'mixed'}); setView(item.id); }}><span>{item.short}</span>{item.label}</button>)}</nav>
        <div className="nav-foot"><strong>{user.displayName}</strong><small>@{user.username}</small><PwaStatus /><button type="button" onClick={()=>void logout()}>立即同步</button></div>
      </aside>

      <section className="workspace">
        <Header view={view} examKind={examSession?.practiceKind ?? examPreset.kind} />
        {view === 'today' && <TodayView queue={queue} subjects={subjects} cards={cards} states={reviewStates} logs={logs} notes={notes} settings={settings} now={clock} hasActiveExam={examSession?.status==='active'} onFocus={openFocus} onExam={()=>{if(!examSession)setExamPreset({kind:'mixed'});setView('exam')}} onPractice={preset=>void openPracticeSetup(preset)} onNavigate={setView} />}
        {view === 'quick' && <QuickRecallMode key={quickPreset?.join('|')??'free'} cards={cards} subjects={subjects} chapters={chapters} initialCardIds={quickPreset} onExit={()=>{setQuickPreset(undefined);setView('today')}} onRecordsChanged={reload} includeJudgment={settings.quickRecallIncludeJudgment} />}
        {view === 'guided' && <GuidedReviewMode cards={cards} subjects={subjects} chapters={chapters} onExit={()=>setView('today')} onStartQuick={cardIds=>{setQuickPreset(cardIds);setView('quick')}} onStartExam={startPresetExam} />}
        {view === 'exam' && <ExamMode preset={examPreset} session={examSession} cards={cards} subjects={subjects} chapters={chapters} onSessionChange={setExamSession} onExit={()=>setView('today')} onRecordsChanged={reload}/>}
        {view === 'daily' && <DailyQuestions settings={settings} questions={dailyQuestions} subjects={subjects} />}
    {view === 'dashboard' && <Dashboard questions={dailyQuestions} states={reviewStates} logs={logs} dqStates={dqStates} dqLogs={dqLogs} cards={cards} chapters={chapters} subjects={subjects} queue={queue} onTrainQuick={cardIds=>{setQuickPreset(cardIds);setView('quick')}} onTrainExam={startPresetExam} onOpenDaily={()=>setView('daily')} />}
    {view === 'system' && <KnowledgeSystemView subjects={subjects} chapters={chapters} cards={cards} onOpen={openFocus} />}
        {view === 'focus' && <FocusView card={currentCard} queueLength={activeFocusPool.length} index={sessionDone + 1} subject={currentCard ? subjectMap.get(currentCard.subjectId) : undefined} chapter={currentCard ? chapterMap.get(currentCard.chapterId) : undefined} revealed={revealed} choice={judgmentChoice} mnemonicInput={mnemonicInput} mnemonicResult={mnemonicResult} onMnemonicInput={setMnemonicInput} onMnemonicSubmit={() => { if (!currentCard || !mnemonicInput.trim()) return; setMnemonicResult(mnemonicScore(currentCard.answer, mnemonicInput, currentCard.mnemonicSegments)); setRevealed(true); }} onReveal={() => setRevealed(true)} onJudge={choice => { setJudgmentChoice(choice); setRevealed(true); }} onRate={rate} relations={relations} cards={cards} onOpenCard={openFocus} nextState={currentCard ? stateMap.get(currentCard.id) : undefined} sessionDone={sessionDone} sessionCorrect={sessionCorrect} onExit={() => setView('today')} />}
        {view === 'library' && <ContentLibrary cards={libraryCards} questions={libraryQuestions} subjects={subjects} chapters={chapters} states={reviewStates} relations={relations} constitutionView={(selected,onSelect)=><ConstitutionSystem chapters={chapters} cards={cards} selected={selected} onSelect={onSelect}/>} onChanged={reload} onOpen={openFocus} onQuick={card=>{setQuickPreset([card.id]);setView('quick')}} onExam={card=>void startPresetExam([card.id])} />}
        {view === 'notebook' && <Notebook notes={notes} cards={cards} chapters={chapters} onChanged={async () => setNotes(await repository.getNotes())} onOpenCard={openFocus} />}
        {view === 'graph' && <GraphView cards={cards} relations={relations} subjects={subjects} onOpen={openFocus} />}
        {view === 'import' && <ImportView subjects={subjects} chapters={chapters} onImported={reload} />}
        {view === 'settings' && <SettingsView settings={settings} onSave={async value => { await repository.saveSettings(value); setSettings(value); }} onRestored={reload} />}
        {view === 'users' && user.role === 'admin' && <UserManagement cards={cards} questions={dailyQuestions} subjects={subjects} chapters={chapters} />}

      </section>
    </main>
  );
}

function Header({ view, examKind }: { view: View; examKind: ExamPracticeKind }) {
  const date = new Date();
  const examLabel: [string,string] = examKind === 'mnemonic' ? ['限量分组 · 自动续答','口诀完整默写'] : examKind === 'judgment' ? ['正确错误 · 专项自测','判断题自测'] : examKind === 'recall' ? ['主动回忆 · 分组训练','背诵卡自测'] : ['限量组卷 · 自动续答','模拟组卷'];
  const names: Record<View, [string,string]> = { daily: ['每日一题','题'], dashboard: ['数据看板','盘'],
    today: ['第三轮 · 冲刺背诵','法忆冲刺'], quick: ['只看标题 · 两段确认','速记模式'], guided: ['逐条讲解 · 快速过卷','带背模式'], focus: ['主动回忆 · 沉浸模式','专注背诵'], exam: examLabel, system: ['科目 · 模块 · 考点','知识体系'], library: ['自由选择 · 查漏补缺','科目题库'],
    notebook: ['纸质题复盘 · 独立知识库','复习笔记'], graph: ['相似 · 例外 · 易混','知识关联'], import: ['本地处理 · 审核入库','资料导入'], settings: ['个人数据 · 备份恢复','设置与数据'], users: ['管理员专属 · 飞书角色','用户管理'],
  };
  return <header className="topbar"><div><p className="eyebrow">{names[view][0]}</p><h1>{names[view][1]}</h1></div><div className="date-chip"><span>{date.toLocaleDateString('zh-CN',{month:'long'})}</span><strong>{date.getDate()}</strong></div></header>;
}

function TodayView({ queue, subjects, cards, states, logs, notes, settings, now, hasActiveExam, onFocus, onExam, onPractice, onNavigate }: { queue: Card[]; subjects: Subject[]; cards: Card[]; states: ReviewState[]; logs: ReviewLog[]; notes: Note[]; settings: AppSettings; now: number; hasActiveExam:boolean; onFocus(card?: Card, pool?: Card[]): void; onExam():void; onPractice(preset:PracticePreset):void; onNavigate(view: View): void }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const done = logs.filter(log => new Date(log.reviewedAt) >= today).length;
  const due = states.filter(state => new Date(state.dueAt).getTime() <= now).length;
  const progress = Math.min(100, Math.round(done / settings.dailyGoal * 100));
  const examDays = daysUntilExam(settings, new Date());
  const subjectCounts = subjects.map(subject => ({ subject, count: cards.filter(card => card.subjectId === subject.id).length, due: states.filter(state => cards.find(card => card.id === state.cardId)?.subjectId === subject.id && new Date(state.dueAt).getTime() <= now).length }));
  const weak = [...states].sort((a,b) => (b.lapseCount + (b.lastRating === 'hard' ? 2 : 0)) - (a.lapseCount + (a.lastRating === 'hard' ? 2 : 0))).slice(0,2).map(state => cards.find(card => card.id === state.cardId)).filter(Boolean) as Card[];
  const dueNotes = notes.filter(note => !note.trashedAt && isNoteDue(note));
  const dayCounts = Array.from({length: 7}, (_, offset) => { const start = new Date(); start.setDate(start.getDate() - (6-offset)); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(end.getDate()+1); return logs.filter(log => new Date(log.reviewedAt)>=start && new Date(log.reviewedAt)<end).length; });
  const maxDay = Math.max(1, ...dayCounts);
  return <div className="content-grid">
    <div className="main-column">
      <section className="hero-card"><div className="hero-copy"><p className="section-kicker">今日任务</p><h2>把遗忘拦在<br />下一次复习之前</h2><p className="hero-note">已优先排列逾期、答错与模糊知识点。今日还有 {Math.max(0, settings.dailyGoal-done)} 条。{examDays !== null && <><strong>距法考 {examDays} 天</strong>，复习间隔已按考试日自动收紧。</>}</p><button className="primary-action" type="button" onClick={onExam}>{hasActiveExam?'继续上次训练':'选择题量并开始'} <span>→</span></button></div><div className="progress-seal"><div className="progress-ring" style={{background:`conic-gradient(#d6c691 0 ${progress}%, rgba(255,255,255,.13) ${progress}% 100%)`}}><div><strong>{done}</strong><span>/ {settings.dailyGoal} 条</span></div></div><p>今日完成</p></div></section>
      <section className="study-modes"><div className="section-heading"><div><p className="section-kicker">四种训练</p><h2>带背理解、速记筛查、默写巩固</h2></div></div><div><button className="guided-mode" type="button" onClick={()=>onNavigate('guided')}><span>带</span><div><small>快速过卷</small><strong>带背模式</strong><p>直接学习标题、口诀、知识点与详细解释。</p></div><b>选择题量 →</b></button><button className="quick-mode" type="button" onClick={()=>onNavigate('quick')}><span>速</span><div><small>查找漏洞</small><strong>速记模式</strong><p>先看标题回忆，再两段确认熟悉程度。</p></div><b>快速标注 →</b></button><button className="mnemonic-mode" type="button" disabled={!cards.some(card=>card.type==='mnemonic')} onClick={() => onPractice({kind:'mnemonic'})}><span>默</span><div><small>主要训练</small><strong>口诀完整默写</strong><p>按提示复述全部口诀，并逐句对应到知识点。</p></div><b>{cards.filter(card=>card.type==='mnemonic').length} 张 →</b></button><button className="judgment-mode" type="button" disabled={!cards.some(card=>card.type==='judgment')} onClick={() => onPractice({kind:'judgment'})}><span>判</span><div><small>辅助检验</small><strong>判断题自测</strong><p>先作对错判断，再看陷阱、法条与关联。</p></div><b>{cards.filter(card=>card.type==='judgment').length} 张 →</b></button></div></section>
      {queue[0] && <section className="focus-preview"><div className="preview-topline"><span className="tag danger">当前优先</span><span className="muted">{queue[0].type === 'judgment' ? '判断自测' : '主动回忆'}</span></div><p className="question-index">今日队列第 1 / {queue.length} 条</p><h3>{queue[0].prompt}</h3><p className="prompt">先在心里完整作答，再进入专注模式查看答案与关联规则。</p><button className="reveal-button" type="button" onClick={() => onFocus(queue[0])}>进入这张卡</button><div className="card-progress"><span /></div></section>}
      <section className="subjects"><div className="section-heading"><div><p className="section-kicker">自由复习</p><h2>按科目进入</h2></div><button type="button" onClick={() => onNavigate('library')}>查看全部</button></div><div className="subject-grid">{subjectCounts.slice(0,8).map(({subject,count,due},index) => <button className={`subject-card tone-${index%4}`} type="button" onClick={() => onPractice({kind:'mixed',subjectId:subject.id})} key={subject.id}><span className="subject-number">{String(index+1).padStart(2,'0')}</span><div><strong>{subject.name}</strong><small>{due ? `${due} 条已到期` : `${count} 张知识卡`}</small></div><span>↗</span></button>)}</div></section>
    </div>
    <aside className="right-column">
      <section className="metric-card"><div className="metric-heading"><span>今日概览</span><small>本机实时</small></div><div className="metric-row"><div><strong>{due}</strong><span>已到期</span></div><div><strong>{logs.length ? Math.round(logs.filter(log => log.objectiveCorrect !== false).length/logs.length*100) : 100}%</strong><span>累计记忆率</span></div></div><div className="week-bars">{dayCounts.map((count,index) => <div key={index}><span style={{height:`${Math.max(12,count/maxDay*100)}%`}} className={index===6?'today':''}/><small>{['一','二','三','四','五','六','日'][index]}</small></div>)}</div></section>
      <section className="weak-card"><p className="section-kicker">薄弱提醒</p><h3>这两处值得再看一遍</h3>{weak.map((card,index) => <button type="button" onClick={() => onFocus(card)} key={card.id}><span className="weak-rank">0{index+1}</span><div><strong>{card.prompt.slice(0,18)}</strong><small>{card.tags.slice(0,2).join(' · ')}</small></div><b>{subjects.find(subject=>subject.id===card.subjectId)?.name}</b></button>)}</section>
      {dueNotes.length > 0 && <section className="note-reminder-card"><div><p className="section-kicker">笔记回看</p><h3>{dueNotes.length} 条知识点笔记到期</h3><p>{dueNotes.slice(0,2).map(note=>note.title||'未命名知识点').join(' · ')}</p></div><button type="button" onClick={()=>onNavigate('notebook')}>进入复盘 →</button></section>}
      <section className="curve-card"><span className="curve-icon">⌁</span><div><strong>{settings.reviewMode === 'adaptive' ? '自适应记忆曲线' : '固定艾宾浩斯节点'}</strong><p>每次作答都会重新计算下次复习</p></div></section>
      <div className="demo-notice">理论法·宪法、刑诉与三国法口诀均已按你提供的资料收录；未提供资料的内容不擅自补写。</div>
    </aside>
  </div>;
}

function examScore(card:Card,response:ExamAnswer['response']){
  if(card.type==='judgment') return typeof response==='boolean'&&response===card.judgmentAnswer?100:0;
  if(typeof response!=='string'||!response.trim()) return 0;
  return mnemonicScore(card.answer,response,card.type==='mnemonic'?card.mnemonicSegments:undefined);
}

function ExamMode({ preset, session, cards, subjects, chapters, onSessionChange, onExit, onRecordsChanged }: { preset:PracticePreset;session?:ExamSession;cards:Card[];subjects:Subject[];chapters:Chapter[];onSessionChange(value:ExamSession|undefined):void;onExit():void;onRecordsChanged():Promise<void> }) {
  const firstSubjectFor = (kind: ExamPracticeKind) => subjects.find(subject => cards.some(card => card.subjectId === subject.id && (kind === 'mixed' || card.type === kind)))?.id ?? 'all';
  const [practiceKind,setPracticeKind]=useState<ExamPracticeKind>(preset.kind);
  const [size,setSize]=useState(5);
  const [feedbackMode,setFeedbackMode]=useState<ExamFeedbackMode>('submit');
  const [subjectId,setSubjectId]=useState(()=>preset.subjectId ?? firstSubjectFor(preset.kind));
  const [scopeId,setScopeId]=useState('all');
  const [orderMode,setOrderMode]=useState<StudyOrder>('ordered');
  const [submitting,setSubmitting]=useState(false);
  const [roundProgress,setRoundProgress]=useState<StudyRoundProgress[]>([]);
  const [resettingRound,setResettingRound]=useState(false);
  const modeCards=useMemo(()=>practiceKind==='mixed'?cards:buildTypeFocusPool(cards,[],practiceKind),[cards,practiceKind]);
  const scopes=useMemo(()=>studyScopeOptions(subjectId,chapters),[subjectId,chapters]);
  const selectedScope=scopeId==='all'?undefined:scopes.find(scope=>scope.id===scopeId);
  const scopeCards=useMemo(()=>filterStudyCards(modeCards,subjectId,selectedScope),[modeCards,subjectId,selectedScope]);
  const roundMode=examRoundMode(practiceKind);
  const candidates=useMemo(()=>remainingInStudyRound(scopeCards,roundProgress,roundMode),[scopeCards,roundProgress,roundMode]);
  const round=useMemo(()=>studyRoundSummary(scopeCards,roundProgress,roundMode),[scopeCards,roundProgress,roundMode]);
  const effectiveSize=effectiveStudySize(size,candidates.length);
  const sizeOptions=studySizeOptions(candidates.length,effectiveSize);
  useEffect(()=>{void repository.getStudyRoundProgress().then(setRoundProgress)},[]);
  const persist=async(next:ExamSession)=>{onSessionChange(next);await repository.saveExamSession(next)};
  const chooseSubject=(value:string)=>{setSubjectId(value);setScopeId('all')};
  const chooseKind=(value:ExamPracticeKind)=>{setPracticeKind(value);setScopeId('all');if(value!=='mixed'&&subjectId!=='all'&&!cards.some(card=>card.subjectId===subjectId&&card.type===value))setSubjectId(firstSubjectFor(value))};
  const start=async()=>{if(!effectiveSize)return;const timestamp=new Date().toISOString();const group=buildStudyGroup(candidates,subjects,chapters,orderMode,effectiveSize);const next:ExamSession={id:'active',cardIds:group.map(card=>card.id),subjectId,practiceKind,feedbackMode,answers:{},currentIndex:0,status:'active',startedAt:timestamp,updatedAt:timestamp};await repository.clearExamSession();await persist(next)};
  const resetRound=async()=>{
    const label=practiceKind==='mixed'?'综合卡片':practiceKind==='mnemonic'?'口诀默写':practiceKind==='judgment'?'判断自测':'背诵自测';
    if(!window.confirm(`确定重置当前范围的本轮进度吗？已完成的 ${round.completed} 题会重新进入“${label}”题库；复习评分和历史记录不会改变。`))return;
    setResettingRound(true);
    try{
      await repository.resetStudyRound(roundMode,scopeCards.map(card=>card.id));
      setRoundProgress(await repository.getStudyRoundProgress());
      try{await repository.flushRemoteSync()}catch{}
    }finally{setResettingRound(false)}
  };
  const abandon=async()=>{if(!window.confirm('确定放弃这一组吗？已作答内容将被清除。'))return;await repository.clearExamSession();onSessionChange(undefined)};
  if(!session) {
    const copy = practiceKind === 'mnemonic'
      ? { kicker:'口诀完整默写 · 开始前设置', title:'先选科目、章节和题量，再开始默写', note:'本组只会出现口诀卡；输入和当前题号会自动保存。', mark:'默' }
      : practiceKind === 'judgment'
        ? { kicker:'正确 / 错误 · 开始前设置', title:'先选范围，再进行判断题专项自测', note:'本组只会出现判断题；作答后显示结论、解析与陷阱。', mark:'判' }
        : practiceKind === 'recall'
          ? { kicker:'主动回忆 · 开始前设置', title:'先选范围，再开始背诵卡自测', note:'本组只会出现普通背诵卡，退出后可以继续。', mark:'背' }
          : { kicker:'自由复习 · 开始前设置', title:'按自己的压力选择范围和数量', note:'不会一上来载入整科；默认每组 5 条，也可指定章节和内容类型。', mark:'选' };
    const kindOptions:{id:ExamPracticeKind;label:string;note:string}[] = [
      {id:'mixed',label:'综合卡片',note:'口诀、判断与背诵卡'},
      {id:'mnemonic',label:'只练口诀',note:'完整输入并核对'},
      {id:'judgment',label:'只练判断',note:'正确 / 错误自测'},
      {id:'recall',label:'只练背诵卡',note:'主动回忆答案'},
    ];
    return <section className="exam-setup-page">
      <div className="exam-setup-hero"><div><p className="section-kicker">{copy.kicker}</p><h2>{copy.title}</h2><p>{copy.note}</p></div><span>{copy.mark}</span></div>
      <div className="exam-setup-grid">
        <section><p className="section-kicker">01 · 组卷范围</p><h3>选择科目</h3><div className="exam-subjects"><button type="button" className={subjectId==='all'?'active':''} disabled={!modeCards.length} onClick={()=>chooseSubject('all')}><strong>全部科目</strong><small>{modeCards.length} 张可用</small></button>{subjects.map(subject=>{const count=modeCards.filter(card=>card.subjectId===subject.id).length;return <button type="button" className={subjectId===subject.id?'active':''} disabled={!count} onClick={()=>chooseSubject(subject.id)} key={subject.id}><strong>{subject.name}</strong><small>{count?count+' 张可用':'暂无此类卡片'}</small></button>})}</div></section>
        <section>
          <p className="section-kicker">02 · 卡片类型</p><h3>这一组练什么？</h3>
          <div className="exam-content-types">{kindOptions.map(option=><button type="button" className={practiceKind===option.id?'active':''} onClick={()=>chooseKind(option.id)} key={option.id}><strong>{option.label}</strong><small>{option.note}</small></button>)}</div>
          <div className="exam-scope-settings">
            <div><p className="section-kicker">03 · 章节范围</p><h3>整科顺序或指定章节</h3><select value={scopeId} onChange={event=>setScopeId(event.target.value)} disabled={subjectId==='all'}><option value="all">{subjectId==='all'?'全部科目 · 全部章节':'全部章节 · 从上到下'}</option>{scopes.map(scope=><option value={scope.id} key={scope.id}>{scope.label}</option>)}</select></div>
            <div><p className="section-kicker">04 · 出题顺序</p><h3>按体系捋或随机抽查</h3><div className="study-order-options"><button type="button" className={orderMode==='ordered'?'active':''} onClick={()=>setOrderMode('ordered')}><strong>按顺序</strong><small>从所选范围第一条往下</small></button><button type="button" className={orderMode==='random'?'active':''} onClick={()=>setOrderMode('random')}><strong>随机</strong><small>每次开始重新打乱</small></button></div></div>
          </div>
          <p className="section-kicker practice-size-kicker">05 · 每组题量</p><h3>选择本次实际训练量</h3><div className="exam-sizes">{sizeOptions.map(value=><button type="button" className={effectiveSize===value?'active':''} onClick={()=>setSize(value)} key={value}><strong>{value}</strong><span>{value===candidates.length?'全部可用':'题一组'}</span></button>)}</div><p className="exam-available">{candidates.length?'当前范围共有 '+candidates.length+' 张卡；不足 5 张也可以直接开始。':'当前范围没有符合条件的卡片'}</p>
          <div className="quick-pool-status"><p>当前范围本轮已完成 {round.completed} 题 · 剩余 {round.remaining} 题 · 共 {round.total} 题</p><button type="button" disabled={resettingRound || !round.completed} onClick={()=>void resetRound()}>{resettingRound?'正在重置…':'重置当前范围这一轮'}</button></div>
          <p className="section-kicker exam-mode-kicker">06 · 答案模式</p><h3>什么时候显示答案？</h3><div className="exam-feedback-modes"><button type="button" className={feedbackMode==='instant'?'active':''} onClick={()=>setFeedbackMode('instant')}><span>逐</span><div><strong>逐题显示答案</strong><p>每答一题立即核对，再进入下一题。</p></div></button><button type="button" className={feedbackMode==='submit'?'active':''} onClick={()=>setFeedbackMode('submit')}><span>卷</span><div><strong>交卷后统一显示</strong><p>考试过程中不出现答案，最后统一批改。</p></div></button></div>
          <button className="start-exam-button" type="button" disabled={!effectiveSize} onClick={()=>void start()}>开始本组 <span>{effectiveSize} 题 →</span></button>
        </section>
      </div>
    </section>;
  }
  const examCards=session.cardIds.map(id=>cards.find(card=>card.id===id)).filter(Boolean) as Card[];
  const current=examCards[Math.min(session.currentIndex,Math.max(0,examCards.length-1))];
  const currentAnswer=current?session.answers[current.id]:undefined;
  const hasResponse=(answer?:ExamAnswer)=>typeof answer?.response==='boolean'||(typeof answer?.response==='string'&&Boolean(answer.response.trim()));
  const answeredCount=examCards.filter(card=>hasResponse(session.answers[card.id])).length;
  const saveAnswer=async(response:ExamAnswer['response'])=>{if(!current||session.status!=='active'||currentAnswer?.checked)return;const next={...session,answers:{...session.answers,[current.id]:{...currentAnswer,response}},updatedAt:new Date().toISOString()};await persist(next)};
  const move=async(index:number)=>{const next={...session,currentIndex:Math.max(0,Math.min(examCards.length-1,index)),updatedAt:new Date().toISOString()};await persist(next)};
  const checkCurrent=async()=>{if(!current||!hasResponse(currentAnswer))return;const score=examScore(current,currentAnswer!.response);const next={...session,answers:{...session.answers,[current.id]:{...currentAnswer!,score,checked:true}},updatedAt:new Date().toISOString()};await persist(next)};
  const submit=async()=>{
    if(submitting||session.status!=='active')return;
    const unanswered=examCards.length-answeredCount;
    if(unanswered&&!window.confirm(`还有 ${unanswered} 题未作答，确定交卷吗？`))return;
    setSubmitting(true);
    try{
      const answers={...session.answers};
      for(const card of examCards){const answer=answers[card.id]??{response:null};answers[card.id]={...answer,score:examScore(card,answer.response),checked:true}}
      const timestamp=new Date().toISOString();
      const next:ExamSession={...session,answers,status:'completed',completedAt:timestamp,updatedAt:timestamp};
      await persist(next);
      const elapsed=Math.max(0,new Date(timestamp).getTime()-new Date(session.startedAt).getTime());
      for(const card of examCards){
        const score=answers[card.id].score??0;
        const rating:MasteryRating=score>=95?'easy':score>=85?'good':score>=60?'hard':'again';
        await repository.recordReview({cardId:card.id,rating,objectiveCorrect:score>=85,elapsedMs:Math.round(elapsed/Math.max(1,examCards.length))});
      }
      await repository.markStudyRoundCompleted(examRoundMode(session.practiceKind??'mixed'),examCards.map(card=>card.id));
      setRoundProgress(await repository.getStudyRoundProgress());
      await onRecordsChanged();
    }finally{setSubmitting(false)}
  };
  if(session.status==='completed'){
    const correct=examCards.filter(card=>(session.answers[card.id]?.score??0)>=85).length;const average=Math.round(examCards.reduce((sum,card)=>sum+(session.answers[card.id]?.score??0),0)/Math.max(1,examCards.length));const accuracy=Math.round(correct/Math.max(1,examCards.length)*100);
    return <section className="exam-summary-page"><div className="exam-summary-hero"><div><p className="section-kicker">本组已交卷</p><h2>{accuracy}% 正确率</h2><p>{correct} 题达标 · {examCards.length-correct} 题需要回炉 · 平均完整度 {average}%</p></div><div className="summary-seal"><strong>{correct}</strong><span>/ {examCards.length}</span></div></div><div className="summary-actions"><button type="button" onClick={onExit}>返回今日冲刺</button><button type="button" onClick={async()=>{await repository.clearExamSession();onSessionChange(undefined)}}>再开一组 →</button></div><div className="exam-result-list">{examCards.map((card,index)=>{const answer=session.answers[card.id]??{response:null};const score=answer.score??0;return <article className={score>=85?'passed':'failed'} key={card.id}><header><span>{String(index+1).padStart(2,'0')}</span><div><small>{card.type==='mnemonic'?'口诀默写':card.type==='judgment'?'判断题':'背诵卡'}</small><h3>{cardTitle(card)}</h3></div><strong>{score}%</strong></header><div><section><b>你的作答</b><p>{typeof answer.response==='boolean'?(answer.response?'正确':'错误'):answer.response||'未作答'}</p></section><section><b>参考答案</b><p>{card.type==='judgment'?(card.judgmentAnswer?'正确':'错误'):`${card.answer}`}</p></section></div></article>})}</div></section>;
  }
  if(!current) return <section className="empty-state"><span>!</span><h2>本组题目不存在</h2><p>可能有卡片已经被删除，请放弃本组后重新组卷。</p><button type="button" onClick={()=>void abandon()}>重新组卷</button></section>;
  const checked=Boolean(currentAnswer?.checked);const progress=Math.round((session.currentIndex+1)/Math.max(1,examCards.length)*100);
  return <section className="exam-room"><div className="exam-room-bar"><button type="button" onClick={onExit}>← 退出并保存</button><div><span style={{width:`${progress}%`}}/></div><strong>{session.currentIndex+1} / {examCards.length}</strong><button type="button" onClick={()=>void abandon()}>放弃本组</button></div><div className="exam-room-grid"><article className="exam-paper"><div className="exam-question-meta"><span>{current.type==='mnemonic'?'口诀默写':current.type==='judgment'?'判断题':'背诵题'}</span><small>{session.feedbackMode==='instant'?'本题作答后显示答案':'交卷前不显示答案'}</small></div><p className="exam-question-number">第 {session.currentIndex+1} 题</p><h2>{cardTitle(current)}</h2>{current.type==='judgment'?<div className="exam-judge-input"><button type="button" className={currentAnswer?.response===false?'active wrong':''} disabled={checked} onClick={()=>void saveAnswer(false)}>× 错误</button><button type="button" className={currentAnswer?.response===true?'active':''} disabled={checked} onClick={()=>void saveAnswer(true)}>✓ 正确</button></div>:<textarea className="exam-text-answer" value={typeof currentAnswer?.response==='string'?currentAnswer.response:''} disabled={checked} onChange={event=>void saveAnswer(event.target.value)} placeholder={current.type==='mnemonic'?'在这里完整默写口诀……':'在这里写出你的答案……'}/>} {session.feedbackMode==='instant'&&checked&&<div className="exam-instant-answer"><div><strong>本题完整度 {currentAnswer?.score??0}%</strong><span>{(currentAnswer?.score??0)>=85?'达标':'需要回炉'}</span></div><p><b>参考答案</b>{current.type==='judgment'?(current.judgmentAnswer?'正确':'错误'):current.answer}</p>{current.mnemonicSegments?.length&&<section>{current.mnemonicSegments.map((segment,index)=><div key={index}><span>{segment.text}</span><i>→</i><p>{segment.knowledgePoint}</p></div>)}</section>}</div>}<div className="exam-paper-actions"><button type="button" disabled={session.currentIndex===0} onClick={()=>void move(session.currentIndex-1)}>← 上一题</button>{session.feedbackMode==='instant'&&!checked?<button type="button" className="primary" disabled={!hasResponse(currentAnswer)} onClick={()=>void checkCurrent()}>核对本题</button>:session.currentIndex<examCards.length-1?<button type="button" className="primary" onClick={()=>void move(session.currentIndex+1)}>下一题 →</button>:<button type="button" className="primary" disabled={submitting} onClick={()=>void submit()}>{submitting?'正在交卷…':'交卷并查看结果'}</button>}</div></article><aside className="exam-answer-sheet"><div><p className="section-kicker">答题卡</p><h3>本组进度</h3><strong>{answeredCount}<span>/ {examCards.length}</span></strong><small>已作答</small></div><div className="answer-sheet-grid">{examCards.map((card,index)=>{const answer=session.answers[card.id];return <button type="button" className={`${index===session.currentIndex?'current ':''}${hasResponse(answer)?'answered ':''}${answer?.checked?'checked':''}`} onClick={()=>void move(index)} key={card.id}>{index+1}</button>})}</div><p>作答会实时保存在本机，中途退出后可继续。</p><button className="submit-paper" type="button" disabled={submitting} onClick={()=>void submit()}>{submitting?'正在交卷…':`交卷（已答 ${answeredCount}）`}</button></aside></div></section>;
}

function FocusView({ card, queueLength, index, subject, chapter, revealed, choice, mnemonicInput, mnemonicResult, onMnemonicInput, onMnemonicSubmit, onReveal, onJudge, onRate, relations, cards, onOpenCard, nextState, sessionDone, sessionCorrect, onExit }: { card?: Card; queueLength: number; index: number; subject?: Subject; chapter?: Chapter; revealed: boolean; choice: boolean | null; mnemonicInput:string; mnemonicResult:number|null; onMnemonicInput(value:string):void; onMnemonicSubmit():void; onReveal(): void; onJudge(value:boolean): void; onRate(value:MasteryRating): void; relations: Relation[]; cards: Card[]; onOpenCard(card:Card):void; nextState?:ReviewState; sessionDone:number; sessionCorrect:number; onExit():void }) {
  if (!card) return <section className="empty-state"><span>✓</span><h2>当前队列已经完成</h2><p>你可以自由选择科目继续背诵，或稍后回来查看新的到期内容。</p><button type="button" onClick={onExit}>返回今日冲刺</button></section>;
  const cardRelations = relations.filter(rel => rel.fromCardId === card.id || rel.toCardId === card.id);
  return <section className="study-layout">
    <div className="session-bar"><button type="button" onClick={onExit}>← 结束本次</button><div><span style={{width:`${Math.min(100,index/Math.max(1,queueLength)*100)}%`}}/></div><p>{index} / {queueLength}</p></div>
    <article className="study-card">
      <div className="study-meta"><div><span className={`tag ${card.type==='judgment'?'danger':card.type==='mnemonic'?'mnemonic':''}`}>{card.type==='judgment'?'判断自测':card.type==='mnemonic'?'口诀默写':'主动回忆'}</span><span>{subject?.name} · {chapter?.name}</span></div><small>{card.type==='mnemonic'?'完整输入口诀后核对':'按空格显示答案'} · 1—4 评分</small></div>
      <div className="study-question"><p>题目</p><h2>{card.prompt}</h2></div>
      {!revealed && card.type === 'recall' && <button className="big-reveal" type="button" onClick={onReveal}>已经想好，查看答案 <span>SPACE</span></button>}
      {!revealed && card.type === 'judgment' && <div className="judgment-actions"><button type="button" onClick={() => onJudge(false)}><strong>×</strong>错误 <small>←</small></button><button type="button" onClick={() => onJudge(true)}><strong>✓</strong>正确 <small>→</small></button></div>}
      {!revealed && card.type === 'mnemonic' && <div className="mnemonic-entry"><label htmlFor="mnemonic-answer">完整默写口诀</label><textarea id="mnemonic-answer" autoFocus value={mnemonicInput} onChange={event=>onMnemonicInput(event.target.value)} placeholder="不要看答案，把口诀从头到尾完整写出来……"/><div><small>标点与空格不影响判定</small><button type="button" disabled={!mnemonicInput.trim()} onClick={onMnemonicSubmit}>提交默写并核对</button></div></div>}
      {!revealed && cardRelations.length > 0 && <details className="inline-relations pre-reveal-hints"><summary>关联提示 · 实在想不起来再展开（{cardRelations.length} 条）</summary>{cardRelations.map(rel => { const targetId = rel.fromCardId===card.id?rel.toCardId:rel.fromCardId; const target = cards.find(item=>item.id===targetId); return target ? <div className="pre-hint-row" key={rel.id}><span>{relationNames[rel.kind]}</span><div><strong>{cardTitle(target).replace(/^【[^】]+】/,'')}</strong><em>{target.answer}</em><small>{rel.note}</small></div></div> : null; })}<p className="pre-hint-warn">提示仅供对比记忆，展开后请如实自评。</p></details>}
      {revealed && <div className="answer-panel">
        {card.type === 'judgment' && <div className={`judgment-result ${choice===card.judgmentAnswer?'correct':'wrong'}`}><strong>{choice===card.judgmentAnswer?'判断正确':'判断有误'}</strong><span>正确答案：{card.judgmentAnswer?'正确':'错误'}</span></div>}
        {card.type === 'mnemonic' && <div className={`mnemonic-result ${(mnemonicResult??0)>=85?'correct':(mnemonicResult??0)>=60?'partial':'wrong'}`}><div><strong>{mnemonicResult}%</strong><span>口诀完整度</span></div><p>{(mnemonicResult??0)>=85?'复述完整，继续保持逐句对应。':(mnemonicResult??0)>=60?'主体已经记住，重点补齐遗漏片段。':'遗漏较多，建议对照逐句知识点后重新默写。'}</p></div>}
        <p className="answer-label">参考答案</p><h3>{card.answer}</h3><div className="explanation"><strong>理解与陷阱</strong><p>{card.explanation}</p></div>{card.statute && <div className="statute"><span>法条 / 来源</span><p>{card.statute}</p></div>}
        {card.type==='mnemonic' && card.mnemonicSegments?.length && <div className="mnemonic-map"><div><strong>口诀逐句对应</strong><small>绿色为已默写，红色为需要补齐</small></div>{card.mnemonicSegments.map((segment,segmentIndex)=>{const matched=normalizeMnemonic(mnemonicInput).includes(normalizeMnemonic(segment.text));return <article className={matched?'matched':'missed'} key={`${segment.text}-${segmentIndex}`}><span>{matched?'✓':'!'}</span><div><strong>{segment.text}</strong><p>{segment.knowledgePoint}</p></div></article>})}</div>}
        {cardRelations.length > 0 && <div className="inline-relations"><strong>关联知识</strong>{cardRelations.map(rel => { const targetId = rel.fromCardId===card.id?rel.toCardId:rel.fromCardId; const target = cards.find(item=>item.id===targetId); return target ? <button type="button" key={rel.id} onClick={() => onOpenCard(target)}><span>{relationNames[rel.kind]}</span><div>{target.prompt}<small>{rel.note}</small></div>→</button> : null; })}</div>}
      </div>}
      {revealed && <div className="rating-zone"><p>这次记得怎么样？{nextState && <small>上次间隔 {formatInterval(nextState.intervalMinutes)}</small>}</p><div>{ratingOptions.map(option => <button className={option.id} type="button" onClick={() => onRate(option.id)} key={option.id}><kbd>{option.key}</kbd><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div></div>}
    </article>
    <aside className="session-side"><p className="section-kicker">本次进度</p><strong>{sessionDone}</strong><span>已完成卡片</span><div><span>记忆率</span><b>{sessionDone ? Math.round(sessionCorrect/sessionDone*100) : 100}%</b></div><p>所有记录已实时保存在本机。</p></aside>
  </section>;
}

type KnowledgeModule = { id:string; name:string; description:string; chapterIds:string[] };

function LegacyKnowledgeSystemView({ subjects, chapters, cards, onOpen }: { subjects:Subject[]; chapters:Chapter[]; cards:Card[]; onOpen(card:Card):void }) {
  const constitutionIds=chapters.filter(chapter=>chapter.id.startsWith('theory-constitution-')).sort((a,b)=>a.order-b.order).map(chapter=>chapter.id);
  const modulesFor=(subjectId:string):KnowledgeModule[]=>{
    if(subjectId==='theory') return [
      {id:'theory-rule-of-law',name:'法治思想',description:'等待你提供对应背诵资料',chapterIds:[]},
      {id:'theory-jurisprudence',name:'法理学',description:'等待你提供对应背诵资料',chapterIds:[]},
      {id:'theory-constitution',name:'宪法学',description:'专题二 · 考点24—46',chapterIds:constitutionIds},
      {id:'theory-history',name:'中国法律史',description:'等待你提供对应背诵资料',chapterIds:[]},
      {id:'theory-judicial',name:'司法制度与法律职业道德',description:'等待你提供对应背诵资料',chapterIds:[]},
    ];
    const subjectChapters=chapters.filter(chapter=>chapter.subjectId===subjectId).sort((a,b)=>a.order-b.order);
    return subjectChapters.length?subjectChapters.map(chapter=>({id:`module-${chapter.id}`,name:chapter.name,description:`${cards.filter(card=>card.chapterId===chapter.id).length} 张知识卡`,chapterIds:[chapter.id]})):[{id:`${subjectId}-pending`,name:'模块待整理',description:'导入资料后会按章节自动生长',chapterIds:[]}];
  };
  const initialSubject=subjects.find(subject=>subject.id==='theory')?.id??subjects[0]?.id??'theory';
  const [subjectId,setSubjectId]=useState(initialSubject);
  const [moduleId,setModuleId]=useState('theory-constitution');
  const [chapterId,setChapterId]=useState('theory-constitution-25');
  const modules=modulesFor(subjectId);
  const selectedModule=modules.find(module=>module.id===moduleId)??modules[0];
  const topics=chapters.filter(chapter=>selectedModule?.chapterIds.includes(chapter.id)).sort((a,b)=>a.order-b.order);
  const selectedTopic=topics.find(topic=>topic.id===chapterId)??topics.find(topic=>cards.some(card=>card.chapterId===topic.id))??topics[0];
  const topicCards=selectedTopic?cards.filter(card=>cardBelongsToChapter(card,selectedTopic.id)):[];
  const chooseSubject=(id:string)=>{
    const nextModules=modulesFor(id); const nextModule=nextModules.find(module=>module.chapterIds.some(chapter=>cards.some(card=>card.chapterId===chapter)))??nextModules[0];
    const nextTopics=chapters.filter(chapter=>nextModule?.chapterIds.includes(chapter.id)).sort((a,b)=>a.order-b.order);
    const nextTopic=nextTopics.find(topic=>cards.some(card=>card.chapterId===topic.id))??nextTopics[0];
    setSubjectId(id);setModuleId(nextModule?.id??'');setChapterId(nextTopic?.id??'');
  };
  const chooseModule=(module:KnowledgeModule)=>{
    const nextTopics=chapters.filter(chapter=>module.chapterIds.includes(chapter.id)).sort((a,b)=>a.order-b.order);
    const nextTopic=nextTopics.find(topic=>cards.some(card=>card.chapterId===topic.id))??nextTopics[0];
    setModuleId(module.id);setChapterId(nextTopic?.id??'');
  };
  return <section className="knowledge-system-page">
    <div className="knowledge-system-intro"><div><p className="section-kicker">整体复习地图</p><h2>从一科走到一个考点，再看完整口诀</h2><p>左到右依次是科目、模块、考点和知识内容。这里只展示结构与原文，不改变你的背诵卡。</p></div><div><strong>{subjects.length}</strong><span>科目</span><strong>{cards.length}</strong><span>知识卡</span></div></div>
    <div className="mind-map-shell">
      <aside className="mind-column subject-column"><header><span>01</span><strong>选择科目</strong></header>{subjects.map(subject=>{const count=cards.filter(card=>card.subjectId===subject.id).length;return <button type="button" className={subjectId===subject.id?'active':''} onClick={()=>chooseSubject(subject.id)} key={subject.id}><i style={{background:subject.color}}>{subject.name.slice(0,1)}</i><span><strong>{subject.name}</strong><small>{count? `${count} 张卡片`:'待整理'}</small></span><b>›</b></button>})}</aside>
      <section className="mind-column module-column"><header><span>02</span><strong>科内模块</strong></header>{modules.map(module=><button type="button" className={selectedModule?.id===module.id?'active':''} onClick={()=>chooseModule(module)} key={module.id}><span><strong>{module.name}</strong><small>{module.description}</small></span><b>›</b></button>)}</section>
      <section className="mind-column topic-column"><header><span>03</span><strong>考点体系</strong></header>{topics.length?topics.map(topic=>{const count=cards.filter(card=>cardBelongsToChapter(card,topic.id)).length;return <button type="button" className={selectedTopic?.id===topic.id?'active':''} onClick={()=>setChapterId(topic.id)} key={topic.id}><em>{topic.order}</em><span><strong>{topic.name.replace(/^考点\d+：/,'')}</strong><small>{count? `${count} 条口诀 / 知识卡`:'待整理'}</small></span><b>›</b></button>}):<div className="mind-empty"><span>○</span><strong>等待资料</strong><p>这个模块暂时只建立位置，不擅自补入内容。</p></div>}</section>
      <section className="topic-detail"><header><div><p className="section-kicker">04 · 口诀与知识点</p><h2>{selectedTopic?.name??selectedModule?.name??'等待资料'}</h2></div>{topicCards.length>0&&<span>{topicCards.length} 张</span>}</header>{topicCards.length?topicCards.map((card,index)=><article className="system-card-detail" key={card.id}><div className="system-card-title"><span>{String(index+1).padStart(2,'0')}</span><div><small>{card.type==='mnemonic'?'口诀默写':card.type==='judgment'?'判断题':'背诵卡'}</small><h3>{cardTitle(card)}</h3></div><button type="button" onClick={()=>onOpen(card)}>{card.type==='mnemonic'?'开始默写':'开始复习'} →</button></div><div className="system-answer"><strong>完整口诀 / 答案</strong><p>{card.answer}</p></div>{card.mnemonicSegments?.length&&<div className="system-point-map"><strong>逐句对应</strong>{card.mnemonicSegments.map((segment,segmentIndex)=><div key={`${card.id}-${segmentIndex}`}><span>{segment.text}</span><i>→</i><p>{segment.knowledgePoint}</p></div>)}</div>}</article>):<div className="topic-empty"><span>卷</span><h3>这个位置已经留好</h3><p>等你提供该模块或考点的背诵卷后，再逐条建立口诀与知识点对应。</p></div>}</section>
    </div>
  </section>;
}

type CanvasNode = { id:string; kind:'root'|'subject'|'module'|'topic'|'card'; label:string; meta:string; x:number; y:number; width:number; height:number; active?:boolean; expandable?:boolean; onClick():void };

function KnowledgeSystemView({ subjects, chapters, cards, onOpen }: { subjects:Subject[]; chapters:Chapter[]; cards:Card[]; onOpen(card:Card):void }) {
  const [rootOpen,setRootOpen]=useState(false);
  const [subjectId,setSubjectId]=useState<string|null>(null);
  const [moduleId,setModuleId]=useState<string|null>(null);
  const [chapterId,setChapterId]=useState<string|null>(null);
  const [cardId,setCardId]=useState<string|null>(null);
  const [viewState,setViewState]=useState({x:28,y:28,scale:.9});
  const dragRef=useRef<{pointerId:number;x:number;y:number;panX:number;panY:number}|null>(null);
  const constitutionIds=chapters.filter(chapter=>chapter.id.startsWith('theory-constitution-')).sort((a,b)=>a.order-b.order).map(chapter=>chapter.id);
  const modulesFor=(id:string):KnowledgeModule[]=>{
    if(id==='theory') return [
      {id:'theory-rule-of-law',name:'法治思想',description:'待整理',chapterIds:[]},
      {id:'theory-jurisprudence',name:'法理学',description:'待整理',chapterIds:[]},
      {id:'theory-constitution',name:'宪法学',description:'考点24—46',chapterIds:constitutionIds},
      {id:'theory-history',name:'中国法律史',description:'待整理',chapterIds:[]},
      {id:'theory-judicial',name:'司法制度与法律职业道德',description:'待整理',chapterIds:[]},
    ];
    if(id==='criminal-procedure') return criminalProcedureModules;
    if(id==='three-international-laws') return threeInternationalLawModules;
    const list=chapters.filter(chapter=>chapter.subjectId===id).sort((a,b)=>a.order-b.order);
    return list.map(chapter=>({id:`module-${chapter.id}`,name:chapter.name,description:`${cards.filter(card=>card.chapterId===chapter.id).length} 张`,chapterIds:[chapter.id]}));
  };
  const modules=subjectId?modulesFor(subjectId):[];
  const selectedModule=modules.find(module=>module.id===moduleId);
  const topics=selectedModule?chapters.filter(chapter=>selectedModule.chapterIds.includes(chapter.id)).sort((a,b)=>a.order-b.order):[];
  const topicCards=chapterId?cards.filter(card=>cardBelongsToChapter(card,chapterId)):[];
  const selectedCard=cards.find(card=>card.id===cardId);
  const canvasHeight=Math.max(920,subjects.length*92+180,modules.length*104+180,topics.length*74+180,topicCards.length*100+180);
  const centeredStart=(count:number,gap:number)=>Math.max(60,canvasHeight/2-count*gap/2);
  const nodes:CanvasNode[]=[];
  nodes.push({id:'root',kind:'root',label:'法考知识体系',meta:rootOpen?'点击收起全部科目':'点击展开科目',x:70,y:canvasHeight/2-35,width:190,height:70,active:rootOpen,expandable:true,onClick:()=>{setRootOpen(value=>!value);setSubjectId(null);setModuleId(null);setChapterId(null);setCardId(null)}});
  if(rootOpen){
    const start=centeredStart(subjects.length,92);
    subjects.forEach((subject,index)=>{const cardCount=cards.filter(card=>card.subjectId===subject.id).length,pointCount=chapters.filter(chapter=>chapter.subjectId===subject.id).length;nodes.push({id:`subject-${subject.id}`,kind:'subject',label:subject.name,meta:cardCount?`${pointCount} 个知识点 · ${cardCount} 张知识卡`:`${pointCount} 个知识点 · 待录口诀`,x:360,y:start+index*92,width:180,height:64,active:subjectId===subject.id,expandable:true,onClick:()=>{const closing=subjectId===subject.id;setSubjectId(closing?null:subject.id);setModuleId(null);setChapterId(null);setCardId(null)}})});
  }
  if(subjectId){
    const start=centeredStart(Math.max(1,modules.length),104);
    modules.forEach((module,index)=>nodes.push({id:`module-${module.id}`,kind:'module',label:module.name,meta:module.description,x:660,y:start+index*104,width:210,height:72,active:moduleId===module.id,expandable:Boolean(module.chapterIds.length),onClick:()=>{if(!module.chapterIds.length)return;const closing=moduleId===module.id;setModuleId(closing?null:module.id);setChapterId(null);setCardId(null)}}));
  }
  if(selectedModule){
    const start=centeredStart(Math.max(1,topics.length),74);
    topics.forEach((topic,index)=>{const count=cards.filter(card=>cardBelongsToChapter(card,topic.id)).length;nodes.push({id:`topic-${topic.id}`,kind:'topic',label:topic.name.replace(/^考点\d+：/,''),meta:count?`${count} 条口诀 / 知识卡`:'待整理',x:1000,y:start+index*74,width:220,height:58,active:chapterId===topic.id,expandable:Boolean(count),onClick:()=>{if(!count)return;const closing=chapterId===topic.id;setChapterId(closing?null:topic.id);setCardId(null)}})});
  }
  if(chapterId){
    const start=centeredStart(Math.max(1,topicCards.length),100);
    topicCards.forEach((card,index)=>nodes.push({id:`card-${card.id}`,kind:'card',label:cardTitle(card),meta:card.type==='mnemonic'?'口诀默写':card.type==='judgment'?'判断题':'背诵卡',x:1340,y:start+index*100,width:250,height:76,active:cardId===card.id,expandable:true,onClick:()=>setCardId(value=>value===card.id?null:card.id)}));
  }
  const nodeMap=new Map(nodes.map(node=>[node.id,node]));
  const edges:{id:string;from:CanvasNode;to:CanvasNode}[]=[];
  const connect=(fromId:string,toId:string)=>{const from=nodeMap.get(fromId),to=nodeMap.get(toId);if(from&&to)edges.push({id:`${fromId}-${toId}`,from,to})};
  if(rootOpen) subjects.forEach(subject=>connect('root',`subject-${subject.id}`));
  if(subjectId) modules.forEach(module=>connect(`subject-${subjectId}`,`module-${module.id}`));
  if(selectedModule) topics.forEach(topic=>connect(`module-${selectedModule.id}`,`topic-${topic.id}`));
  if(chapterId) topicCards.forEach(card=>connect(`topic-${chapterId}`,`card-${card.id}`));
  const detailX=1700,detailY=selectedCard?Math.max(50,(nodeMap.get(`card-${selectedCard.id}`)?.y??100)-80):100;
  const scaleBy=(amount:number)=>setViewState(value=>({...value,scale:Math.min(1.45,Math.max(.45,Number((value.scale+amount).toFixed(2))))}));
  const resetView=()=>setViewState({x:28,y:28,scale:.9});
  const onPointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{if(event.button!==0)return;dragRef.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,panX:viewState.x,panY:viewState.y};event.currentTarget.setPointerCapture(event.pointerId)};
  const onPointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;setViewState(value=>({...value,x:drag.panX+event.clientX-drag.x,y:drag.panY+event.clientY-drag.y}))};
  const endDrag=(event:React.PointerEvent<HTMLDivElement>)=>{if(dragRef.current?.pointerId===event.pointerId)dragRef.current=null};
  const onCanvasWheel=(event:React.WheelEvent<HTMLDivElement>)=>{event.preventDefault();scaleBy(event.deltaY>0?-.08:.08)};
  return <section className="canvas-page">
    <div className="canvas-toolbar"><div><p className="section-kicker">可探索知识画布</p><h2>拖动画布，点击节点逐级展开</h2></div><div className="canvas-actions"><span>{Math.round(viewState.scale*100)}%</span><button type="button" onClick={()=>scaleBy(-.1)} aria-label="缩小">−</button><button type="button" onClick={()=>scaleBy(.1)} aria-label="放大">＋</button><button type="button" onClick={resetView}>回到中心</button></div></div>
    <div className="knowledge-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={onCanvasWheel}>
      <div className="canvas-hint">拖动空白处移动 · 点击节点展开/收起 · 使用右上角缩放</div>
      <div className="canvas-world" style={{width:2250,height:canvasHeight,transform:`translate(${viewState.x}px,${viewState.y}px) scale(${viewState.scale})`}}>
        {edges.map((edge,edgeIndex)=>{const x1=edge.from.x+edge.from.width,y1=edge.from.y+edge.from.height/2,x2=edge.to.x,y2=edge.to.y+edge.to.height/2,dx=x2-x1,dy=y2-y1,length=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx)*180/Math.PI;return <div className="canvas-edge" key={edge.id} style={{left:x1,top:y1,width:length,transform:`rotate(${angle}deg)`,animationDelay:`${Math.min(180,edgeIndex*14)}ms`}}/>})}
        {nodes.map((node,nodeIndex)=><button type="button" className={`canvas-node ${node.kind} ${node.active?'active':''} ${node.expandable===false?'disabled':''}`} style={{left:node.x,top:node.y,width:node.width,minHeight:node.height,animationDelay:`${Math.min(240,nodeIndex*20)}ms`}} onPointerDown={event=>event.stopPropagation()} onClick={node.onClick} aria-expanded={node.expandable?node.active:undefined} key={node.id}><span className="node-kind">{node.kind==='root'?'总':node.kind==='subject'?'科':node.kind==='module'?'模':node.kind==='topic'?'点':'诀'}</span><span><strong>{node.label}</strong><small>{node.meta}</small></span>{node.expandable!==false&&<b>{node.active?'−':'＋'}</b>}</button>)}
        {selectedCard&&<article className="canvas-detail-node" style={{left:detailX,top:detailY,animationDelay:'110ms'}} onPointerDown={event=>event.stopPropagation()}><div className="detail-node-head"><div><small>{selectedCard.type==='mnemonic'?'口诀默写':selectedCard.type==='judgment'?'判断题':'背诵卡'}</small><h3>{cardTitle(selectedCard)}</h3></div><button type="button" onClick={()=>onOpen(selectedCard)}>{selectedCard.type==='mnemonic'?'开始默写':'开始复习'} →</button></div><section><strong>完整口诀 / 答案</strong><p>{selectedCard.answer}</p></section>{selectedCard.mnemonicSegments?.length&&<section className="detail-point-list"><strong>逐句对应</strong>{selectedCard.mnemonicSegments.map((segment,index)=><div key={index}><span>{segment.text}</span><i>→</i><p>{segment.knowledgePoint}</p></div>)}</section>}</article>}
        {selectedCard&&(()=>{const from=nodeMap.get(`card-${selectedCard.id}`);if(!from)return null;const x1=from.x+from.width,y1=from.y+from.height/2,x2=detailX,y2=detailY+48,dx=x2-x1,dy=y2-y1,length=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx)*180/Math.PI;return <div className="canvas-edge detail-edge" style={{left:x1,top:y1,width:length,transform:`rotate(${angle}deg)`}}/>})()}
      </div>
    </div>
  </section>;
}

function ConstitutionSystem({ chapters, cards, selected, onSelect }: { chapters:Chapter[]; cards:Card[]; selected:string; onSelect(chapterId:string):void }) {
  const constitutionChapters=chapters.filter(chapter=>chapter.id.startsWith('theory-constitution-')).sort((left,right)=>left.order-right.order);
  return <section className="constitution-system">
    <div className="system-heading">
      <div><p className="section-kicker">理论法 · 宪法学</p><h2>专题二 · 考点24—46</h2></div>
      <button type="button" className={selected==='all'?'active':''} onClick={()=>onSelect('all')}>全部考点</button>
    </div>
    <div className="system-layers">
      <article>
        <div><strong>宪法学考点</strong><p>点击考点可筛选下方知识卡，再点“全部考点”恢复显示。</p></div>
        <div>{constitutionChapters.map(chapter=>{
          const count=cards.filter(card=>cardBelongsToChapter(card,chapter.id)).length;
          return <button type="button" className={selected===chapter.id?'active':''} onClick={()=>onSelect(chapter.id)} key={chapter.id}>
            <span>{String(chapter.order)}</span><strong>{chapter.name.replace(/^考点\d+：/,'')}</strong><small>{count?`${count} 张知识卡`:'待整理'}</small>
          </button>;
        })}</div>
      </article>
    </div>
  </section>;
}

function NotebookView({ notes, cards, subjects, onChanged, onOpenCard }: { notes:Note[]; cards:Card[]; subjects:Subject[]; onChanged():Promise<void>; onOpenCard(card:Card):void }) {
  const blank = (): Note => ({ id:crypto.randomUUID(), title:'', content:'', tags:[], pinned:false, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  const [draft,setDraft]=useState<Note>(()=>notes[0]??blank());
  const [query,setQuery]=useState(''); const [saved,setSaved]=useState(false);
  const filtered=[...notes].filter(note=>`${note.title}${note.content}${note.tags.join('')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
  const select=(note:Note)=>{setDraft(note);setSaved(false)};
  const create=()=>select(blank());
  const save=async()=>{if(!draft.title.trim()&&!draft.content.trim())return;const timestamp=new Date().toISOString();await repository.saveNote({...draft,title:draft.title.trim()||'未命名笔记',updatedAt:timestamp});await onChanged();setDraft(value=>({...value,title:value.title.trim()||'未命名笔记',updatedAt:timestamp}));setSaved(true)};
  const remove=async()=>{if(!notes.some(note=>note.id===draft.id)||!window.confirm('确定删除这篇笔记吗？'))return;await repository.deleteNote(draft.id);await onChanged();create()};
  const linkedCard=cards.find(card=>card.id===draft.cardId);
  return <section className="notebook-page"><aside className="notes-list"><div className="notes-actions"><button type="button" onClick={create}>＋ 新建笔记</button><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索笔记"/></div><div>{filtered.map(note=><button type="button" className={note.id===draft.id?'active':''} key={note.id} onClick={()=>select(note)}><span>{note.pinned?'置顶':'笔记'}</span><strong>{note.title||'未命名笔记'}</strong><p>{note.content.slice(0,48)||'开始记录口诀、易错点和自己的理解…'}</p><small>{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</small></button>)}{!filtered.length&&<p className="no-notes">还没有笔记。可以在这里记录口诀拆解、错题原因和易混点。</p>}</div></aside><article className="note-editor"><div className="note-toolbar"><select value={draft.subjectId||''} onChange={event=>setDraft({...draft,subjectId:event.target.value||undefined})}><option value="">全部科目</option>{subjects.map(subject=><option value={subject.id} key={subject.id}>{subject.name}</option>)}</select><select value={draft.cardId||''} onChange={event=>setDraft({...draft,cardId:event.target.value||undefined})}><option value="">不关联知识卡</option>{cards.filter(card=>!draft.subjectId||card.subjectId===draft.subjectId).map(card=><option value={card.id} key={card.id}>{card.prompt.slice(0,35)}</option>)}</select><button className={draft.pinned?'active':''} type="button" onClick={()=>setDraft({...draft,pinned:!draft.pinned})}>{draft.pinned?'已置顶':'置顶'}</button></div><input className="note-title" value={draft.title} onChange={event=>{setDraft({...draft,title:event.target.value});setSaved(false)}} placeholder="笔记标题"/><textarea className="note-body" value={draft.content} onChange={event=>{setDraft({...draft,content:event.target.value});setSaved(false)}} placeholder={'在这里记录：\n· 口诀完整文本与拆分方法\n· 每一句对应的知识点\n· 判断题陷阱和自己的易错原因'}/><label className="note-tags">标签<input value={draft.tags.join('，')} onChange={event=>setDraft({...draft,tags:event.target.value.split(/[，,]/).map(tag=>tag.trim()).filter(Boolean)})} placeholder="口诀，易错，待回看"/></label>{linkedCard&&<button className="linked-card" type="button" onClick={()=>onOpenCard(linkedCard)}><span>关联知识卡</span><strong>{linkedCard.prompt}</strong> →</button>}<div className="note-footer"><button className="delete-note" type="button" onClick={()=>void remove()}>删除</button><span>{saved?'已保存到本机':'尚未保存'}</span><button className="save-note" type="button" onClick={()=>void save()}>保存笔记</button></div></article></section>;
}

function GraphView({ cards, relations, subjects, onOpen }: { cards:Card[]; relations:Relation[]; subjects:Subject[]; onOpen(card:Card):void }) {
  const nodes=cards.slice(0,8); const positions=[[9,45],[31,18],[33,70],[56,44],[76,17],[78,68],[56,84],[91,43]];
  return <section className="graph-page"><div className="graph-intro"><div><p className="section-kicker">知识图谱</p><h2>从一条规则，找到它的例外与陷阱</h2><p>点击节点进入对应卡片。导入资料后，图谱会按你建立的关联持续生长。</p></div><div className="legend">{Object.entries(relationNames).map(([key,value])=><span key={key} className={key}><i/>{value}</span>)}</div></div><div className="graph-canvas">{relations.map(rel=>{const from=nodes.findIndex(c=>c.id===rel.fromCardId),to=nodes.findIndex(c=>c.id===rel.toCardId);if(from<0||to<0)return null;const [x1,y1]=positions[from],[x2,y2]=positions[to],dx=x2-x1,dy=y2-y1,length=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx)*180/Math.PI;return <div className={`graph-line ${rel.kind}`} key={rel.id} style={{left:`${x1}%`,top:`${y1}%`,width:`${length}%`,transform:`rotate(${angle}deg)`}}><span>{relationNames[rel.kind]}</span></div>})}{nodes.map((card,index)=>{const title=cardTitle(card);return <button className={`graph-node node-${index%4}`} type="button" key={card.id} style={{left:`${positions[index][0]}%`,top:`${positions[index][1]}%`}} onClick={()=>onOpen(card)}><small>{subjects.find(s=>s.id===card.subjectId)?.name}</small><strong>{title.slice(0,15)}{title.length>15?'…':''}</strong></button>})}</div><div className="graph-list">{relations.map(rel=>{const from=cards.find(c=>c.id===rel.fromCardId),to=cards.find(c=>c.id===rel.toCardId);return from&&to?<button key={rel.id} type="button" onClick={()=>onOpen(to)}><span>{relationNames[rel.kind]}</span><div><strong>{cardTitle(from)}</strong><small>{rel.note}</small><b>关联至：{cardTitle(to)}</b></div></button>:null})}</div></section>;
}

function ImportView({ subjects, chapters, onImported }: { subjects:Subject[]; chapters:Chapter[]; onImported():Promise<void> }) {
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [batch,setBatch]=useState<ImportBatch|null>(null); const [drafts,setDrafts]=useState<DraftCard[]>([]); const inputRef=useRef<HTMLInputElement>(null);
  const loadFile=async(file?:File)=>{if(!file)return;setBusy(true);setMessage('正在本机解析资料…');try{const fingerprint=await fingerprintFile(file);if(await repository.hasFingerprint(fingerprint))throw new Error('这份资料已经导入过，无需重复添加');const batchId=crypto.randomUUID();const nextDrafts=await parseImportFile(file,batchId);if(!nextDrafts.length)throw new Error('没有识别到可用正文，请检查文件内容');const nextBatch:ImportBatch={id:batchId,filename:file.name,fingerprint,format:file.name.split('.').pop()?.toUpperCase()||'',status:'draft',createdAt:new Date().toISOString(),draftCount:nextDrafts.length};await repository.addImport(nextBatch,nextDrafts);setBatch(nextBatch);setDrafts(nextDrafts);setMessage(`已提取 ${nextDrafts.length} 条草稿，请审核后入库`);}catch(error){setMessage(error instanceof Error?error.message:'解析失败，请更换文件重试');}finally{setBusy(false);if(inputRef.current)inputRef.current.value='';}};
  const update=async(id:string,changes:Partial<DraftCard>)=>{const next=drafts.map(d=>d.id===id?{...d,...changes}:d);setDrafts(next);const changed=next.find(d=>d.id===id);if(changed)await repository.updateDraft(changed);};
  const confirm=async()=>{if(!batch)return;setBusy(true);const count=await repository.confirmDrafts(batch.id);setMessage(`已确认并加入 ${count} 张知识卡`);setBatch(null);setDrafts([]);await onImported();setBusy(false);};
  return <section className="import-page"><div className="import-hero"><div><p className="section-kicker">资料只在本机处理</p><h2>把讲义变成口诀、判断与知识卡</h2><p>支持 PDF、Word、Markdown、TXT、CSV 与 JSON。系统只提取草稿，不擅自制造法律结论；确认后才会进入题库。</p></div><label className={busy?'disabled':''}><input ref={inputRef} type="file" accept=".pdf,.docx,.md,.markdown,.txt,.csv,.json" onChange={e=>void loadFile(e.target.files?.[0])} disabled={busy}/><span>{busy?'正在解析…':'选择资料文件'}</span><small>单个文件不超过 30MB</small></label></div>{message&&<div className="import-message" role="status">{message}</div>}{batch&&<div className="draft-review"><div className="draft-header"><div><p className="section-kicker">审核队列</p><h3>{batch.filename}</h3><span>{drafts.filter(d=>d.selected).length} / {drafts.length} 条将入库</span></div><button type="button" onClick={()=>void confirm()} disabled={busy||!drafts.some(d=>d.selected)}>确认所选并入库</button></div><div className="draft-list">{drafts.slice(0,100).map((draft,index)=><article className={draft.selected?'selected':''} key={draft.id}><div className="draft-number"><input type="checkbox" checked={draft.selected} onChange={e=>void update(draft.id,{selected:e.target.checked})}/><span>{String(index+1).padStart(2,'0')}</span></div><div className="draft-fields"><div className="draft-meta"><select value={draft.type} onChange={e=>void update(draft.id,{type:e.target.value as DraftCard['type']})}><option value="mnemonic">口诀默写</option><option value="judgment">判断题</option><option value="recall">背诵卡</option></select><select value={draft.subjectId} onChange={e=>void update(draft.id,{subjectId:e.target.value,chapterId:chapters.find(c=>c.subjectId===e.target.value)?.id||draft.chapterId})}>{subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><select value={draft.chapterId} onChange={e=>void update(draft.id,{chapterId:e.target.value})}>{chapters.filter(c=>c.subjectId===draft.subjectId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><label>题目<textarea value={draft.prompt} onChange={e=>void update(draft.id,{prompt:e.target.value})}/></label><label>{draft.type==='mnemonic'?'完整口诀':'答案'}<textarea value={draft.answer} onChange={e=>void update(draft.id,{answer:e.target.value})}/></label></div></article>)}</div>{drafts.length>100&&<p className="draft-limit">为保证审核流畅，当前先显示前 100 条；确认时仍会处理所有已选草稿。</p>}</div>} {!batch&&<div className="import-guide"><div><span>01</span><strong>本机提取</strong><p>文件不会上传，含“口诀”的段落会优先标为默写卡。</p></div><div><span>02</span><strong>逐条审核</strong><p>核对完整口诀、判断结论、科目与知识点对应。</p></div><div><span>03</span><strong>确认入库</strong><p>通过审核的内容才会进入今日队列与记忆曲线。</p></div></div>}</section>;
}

function SettingsView({ settings, onSave, onRestored }: { settings:AppSettings;onSave(value:AppSettings):Promise<void>;onRestored():Promise<void> }) {
  const [draft,setDraft]=useState(settings); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false); const restoreRef=useRef<HTMLInputElement>(null);
  const save=async()=>{await onSave(draft);setMessage('设置已保存，下次评分立即生效');};
  const setFontScale=async(value:NonNullable<AppSettings['fontScale']>)=>{const next={...draft,fontScale:value};setDraft(next);await onSave(next);setMessage(`字号已切换为${value===.9?'小':value===1?'标准':value===1.12?'大':'特大'}，并保存到当前账号`)};
  const clearProgress=async()=>{if(!window.confirm('确定清空本账号全部学习记录吗？题目、章节、笔记会保留；复习状态、作答日志和未完成试卷将删除且不可恢复。（旧版本预置的演示进度也会一并清除）'))return;setBusy(true);try{await repository.clearAllProgress();await repository.flushRemoteSync();await onRestored();setMessage('学习记录已清空，题库和笔记保留，进度从零开始');}catch(error){setMessage(error instanceof Error?error.message:'清空失败')}finally{setBusy(false)}};
  const backup=async()=>{const data=await repository.exportBackup();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`法忆冲刺-备份-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);setMessage('完整备份已导出，请妥善保存');};
  const restore=async(file?:File)=>{if(!file)return;try{const payload=JSON.parse(await file.text()) as BackupPayload;await repository.replaceUserData(payload);await onRestored();setMessage('备份已完整恢复，并同步到当前账号');}catch(error){setMessage(error instanceof Error?error.message:'备份恢复失败');}finally{if(restoreRef.current)restoreRef.current.value='';}};
  return <section className="settings-page"><div className="settings-grid">
    <section><p className="section-kicker">记忆曲线</p><h2>复习算法</h2><div className="mode-cards"><button className={draft.reviewMode==='adaptive'?'active':''} onClick={()=>setDraft({...draft,reviewMode:'adaptive'})}><span>⌁</span><div><strong>自适应间隔</strong><p>根据对错、评分、连续记住与遗忘次数动态调整。</p></div></button><button className={draft.reviewMode==='fixed'?'active':''} onClick={()=>setDraft({...draft,reviewMode:'fixed'})}><span>日</span><div><strong>固定记忆节点</strong><p>按预设分钟与天数逐级推进，忘记后回到首节点。</p></div></button></div><label className="settings-field"><span>固定节点（分钟，逗号分隔）</span><input value={draft.fixedIntervals.join(', ')} onChange={e=>{const values=e.target.value.split(/[,，\s]+/).map(Number).filter(v=>Number.isFinite(v)&&v>0);setDraft({...draft,fixedIntervals:values.length?values:draft.fixedIntervals})}}/><small>默认：10 分钟、1 天、3 天、7 天、15 天、30 天</small></label><label className="settings-field"><span>每日目标</span><input type="number" min="1" max="500" value={draft.dailyGoal} onChange={e=>setDraft({...draft,dailyGoal:Number(e.target.value)||1})}/><small>首页进度与今日任务数量将按此目标计算</small></label><label className="settings-field"><span>每日新卡上限</span><input type="number" min="1" max="200" value={draft.newCardLimit} onChange={e=>setDraft({...draft,newCardLimit:Number(e.target.value)||1})}/><small>今日冲刺每天最多引入的新卡数量，其余新卡留给后续日子</small></label><label className="settings-field"><span>考试日期</span><input type="date" value={draft.examDate??''} onChange={e=>setDraft({...draft,examDate:e.target.value||undefined})}/><small>设置后复习间隔会自动收进考试前（通常为剩余天数×0.6，最高30天；临考会进一步缩短），首页显示倒计时；清空则恢复长期记忆模式</small></label><label className="settings-field"><span>错题移除阈值（连对次数）</span><input type="number" min="1" max="3" value={draft.dqWrongRemoveThreshold} onChange={e=>setDraft({...draft,dqWrongRemoveThreshold:Math.max(1,Math.min(3,Number(e.target.value)||1))})}/><small>每日一题错题本中，连对达到该次数自动移出</small></label><label className="settings-field"><span>速记模式包含判断题</span><div style={{display:"flex",gap:10}}><button type="button" className={draft.quickRecallIncludeJudgment?"active":""} onClick={()=>setDraft({...draft,quickRecallIncludeJudgment:true})}>包含</button><button type="button" className={!draft.quickRecallIncludeJudgment?"active":""} onClick={()=>setDraft({...draft,quickRecallIncludeJudgment:false})}>不包含</button></div><small>开启后，关联辨析判断卡将混入速记卡片流</small></label><button className="save-settings" type="button" onClick={()=>void save()}>保存复习设置</button></section>
    <section><p className="section-kicker">显示与个人数据</p><h2>字号、同步与备份</h2><div className="font-scale-setting"><div><strong>全局字体大小</strong><p>会同步调整正文、题目、按钮和表格；选择后立即生效并自动保存。</p></div><div>{([{value:.9,label:'小'},{value:1,label:'标准'},{value:1.12,label:'大'},{value:1.25,label:'特大'}] as const).map(option=><button type="button" className={(draft.fontScale??1)===option.value?'active':''} onClick={()=>void setFontScale(option.value)} key={option.value}><span style={{fontSize:`${option.value}em`}}>字</span><small>{option.label}</small></button>)}</div></div><div className="privacy-note"><strong>只同步到当前登录账号</strong><p>题库、口诀、笔记、作答记录和记忆状态会保存在该账号的独立云端空间，同时保留本机缓存。其他用户无法读取或覆盖。</p></div><button className="data-action" type="button" onClick={()=>void backup()}><span>↓</span><div><strong>导出当前账号完整 JSON</strong><small>包含题库、关联、记录、设置、草稿与未完成组卷</small></div></button><label className="data-action"><input ref={restoreRef} type="file" accept=".json" onChange={e=>void restore(e.target.files?.[0])}/><span>↑</span><div><strong>恢复到当前账号</strong><small>只替换当前登录用户的数据，不影响其他用户</small></div></label><div className="sync-roadmap"><span>云</span><div><strong>账号间完全独立</strong><p>创建用户时只复制知识内容；之后每个人的新增资料和学习进度分别保存。</p></div></div><button className="data-action" type="button" disabled={busy} onClick={()=>void clearProgress()}><span>⌫</span><div><strong>清空本账号学习记录</strong><small>删除复习状态、作答日志与未完成试卷；题库、笔记保留，进度从零开始</small></div></button></section>
  </div>{message&&<div className="settings-message" role="status">{message}</div>}</section>;
}
