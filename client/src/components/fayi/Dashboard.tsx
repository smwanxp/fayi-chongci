'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Card, Chapter, DailyQuestion, DQLog, DQState, ReviewLog, ReviewState, Subject } from '@/lib/types';
import {
  buildDashboardHierarchy, buildDashboardSubjects, buildSubjectSummaries,
  cardMatchesContent, dashboardSubjectIdForQuestion, isCardMastered, isCardWeak,
  type DashboardContentFilter, type DashboardStatusFilter, type DashboardTreeNode,
} from '@/lib/dashboard-model';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const DAY = 86_400_000;
const STATUS_COLORS = { fresh: '#d8d3c8', learning: '#c7ad78', mastered: '#6f9276', weak: '#c85b50' };
const CARD_COLOR = '#385f50';
const DQ_COLOR = '#b06a4f';
const pct = (value: number, total: number) => total ? Math.round(value / total * 100) : null;
const dayKey = (iso: string) => iso.slice(0, 10);
const chartBase = () => ({
  textStyle: { color: '#565d58', fontFamily: 'Noto Sans SC, Microsoft YaHei, sans-serif' },
  animationDuration: 420,
  animationEasing: 'cubicOut' as const,
});

interface Props {
  questions: DailyQuestion[]; states: ReviewState[]; logs: ReviewLog[]; dqStates: DQState[]; dqLogs: DQLog[];
  cards: Card[]; chapters: Chapter[]; subjects: Subject[]; queue: Card[];
  onTrainQuick(cardIds: string[]): void;
  onTrainExam(cardIds: string[]): Promise<void>;
  onOpenDaily(): void;
}
interface TreeMetrics {
  total: number; learned: number; mastered: number; weak: number; due: number;
  cardsTotal: number; cardsMastered: number; dqTotal: number; dqMastered: number;
  weakCardIds: string[]; weakQIds: string[];
}

export default function Dashboard(props: Props) {
  const { questions, states, logs, dqStates, dqLogs, cards, chapters, subjects, queue } = props;
  const [nowMs, setNowMs] = useState(0);
  const [rangeDays, setRangeDays] = useState<7 | 30 | null>(30);
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [contentFilter, setContentFilter] = useState<DashboardContentFilter>('all');
  const [statusFilter, setStatusFilter] = useState<DashboardStatusFilter>('all');
  const [trainingSize, setTrainingSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const statusRef = useRef<HTMLDivElement>(null);
  const masteryRef = useRef<HTMLDivElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setNowMs(Date.now()); }, []);

  const definitions = useMemo(() => buildDashboardSubjects(subjects, questions), [subjects, questions]);
  const stateMap = useMemo(() => new Map(states.map(item => [item.cardId, item])), [states]);
  const dqStateMap = useMemo(() => new Map(dqStates.map(item => [item.qid, item])), [dqStates]);
  const summaries = useMemo(() => buildSubjectSummaries({
    definitions, cards, questions: questions, states, dqStates, dqLogs, contentFilter, nowMs,
  }), [definitions, cards, questions, states, dqStates, dqLogs, contentFilter, nowMs]);
  const visible = useMemo(() => subjectFilter === 'all' ? summaries : summaries.filter(item => item.subject.id === subjectFilter), [summaries, subjectFilter]);
  const selectedDefinitions = useMemo(() => subjectFilter === 'all' ? definitions : definitions.filter(item => item.id === subjectFilter), [definitions, subjectFilter]);
  const hierarchy = useMemo(() => buildDashboardHierarchy({
    definitions: selectedDefinitions, chapters, cards, questions: questions, contentFilter,
  }), [selectedDefinitions, chapters, cards, questions, contentFilter]);

  const metricsMap = useMemo(() => {
    const result = new Map<string, TreeMetrics>();
    const cardIncluded = (id: string) => {
      if (statusFilter === 'all') return true;
      const state = stateMap.get(id);
      if (statusFilter === 'new') return !state?.lastReviewedAt;
      if (statusFilter === 'weak') return isCardWeak(state);
      if (statusFilter === 'mastered') return isCardMastered(state) && !isCardWeak(state);
      return Boolean(state?.lastReviewedAt && nowMs && new Date(state.dueAt).getTime() <= nowMs);
    };
    const questionIncluded = (id: string) => {
      if (statusFilter === 'all') return true;
      const state = dqStateMap.get(id);
      if (statusFilter === 'new') return !state?.answeredAt;
      if (statusFilter === 'weak') return Boolean(state?.inWrongBook || (state?.answeredAt && state.correct === false));
      if (statusFilter === 'mastered') return Boolean(state?.answeredAt && state.correct && !state.inWrongBook);
      return false;
    };
    const visit = (node: DashboardTreeNode): { cardIds: string[]; qids: string[] } => {
      const childItems = node.children.map(visit);
      const cardIds = [...new Set([...node.cardIds, ...childItems.flatMap(item => item.cardIds)])].filter(cardIncluded);
      const qids = [...new Set([...node.qids, ...childItems.flatMap(item => item.qids)])].filter(questionIncluded);
      let cardsStudied = 0, cardsMastered = 0, dqAnswered = 0, dqMastered = 0, due = 0;
      const weakCardIds: string[] = [], weakQIds: string[] = [];
      cardIds.forEach(id => {
        const state = stateMap.get(id);
        if (state?.lastReviewedAt) cardsStudied += 1;
        if (isCardWeak(state)) weakCardIds.push(id);
        else if (isCardMastered(state)) cardsMastered += 1;
        if (state?.lastReviewedAt && nowMs && new Date(state.dueAt).getTime() <= nowMs) due += 1;
      });
      qids.forEach(id => {
        const state = dqStateMap.get(id);
        if (state?.answeredAt) dqAnswered += 1;
        if (state?.inWrongBook || (state?.answeredAt && state.correct === false)) weakQIds.push(id);
        else if (state?.answeredAt && state.correct) dqMastered += 1;
      });
      result.set(node.id, {
        total: cardIds.length + qids.length, learned: cardsStudied + dqAnswered,
        mastered: cardsMastered + dqMastered, weak: weakCardIds.length + weakQIds.length, due,
        cardsTotal: cardIds.length, cardsMastered, dqTotal: qids.length, dqMastered,
        weakCardIds, weakQIds,
      });
      return { cardIds, qids };
    };
    hierarchy.forEach(visit);
    return result;
  }, [hierarchy, stateMap, dqStateMap, statusFilter, nowMs]);

  const treeRows = useMemo(() => {
    const rows: { node: DashboardTreeNode; depth: number; metrics: TreeMetrics }[] = [];
    const walk = (node: DashboardTreeNode, depth: number) => {
      const metrics = metricsMap.get(node.id);
      if (!metrics?.total) return;
      rows.push({ node, depth, metrics });
      if (expanded.has(node.id)) node.children.forEach(child => walk(child, depth + 1));
    };
    hierarchy.forEach(root => walk(root, 0));
    return rows;
  }, [hierarchy, metricsMap, expanded]);

  const priorityCards = useMemo(() => {
    const queued = new Set(queue.map(item => item.id));
    return [...queue, ...cards.filter(item => !queued.has(item.id))];
  }, [queue, cards]);
  const trainingGroup = (ids: string[]) => {
    const targets = new Set(ids);
    return priorityCards.filter(item => targets.has(item.id)).slice(0, trainingSize).map(item => item.id);
  };

  const selectedSubjectIds = useMemo(() => new Set(visible.map(item => item.subject.id)), [visible]);
  const selectedCardIds = useMemo(() => new Set(cards.filter(item => selectedSubjectIds.has(item.subjectId) && cardMatchesContent(item, contentFilter)).map(item => item.id)), [cards, selectedSubjectIds, contentFilter]);
  const selectedQuestionIds = useMemo(() => new Set(questions.filter(item => selectedSubjectIds.has(dashboardSubjectIdForQuestion(item)) && (contentFilter === 'all' || contentFilter === 'dq')).map(item => item.id)), [questions, selectedSubjectIds, contentFilter]);

  const trend = useMemo(() => {
    if (!nowMs) return { labels: [] as string[], series: [] as { name: string; color: string; data: number[] }[] };
    const dates = [
      ...logs.filter(item => selectedCardIds.has(item.cardId)).map(item => new Date(item.reviewedAt).getTime()),
      ...dqLogs.filter(item => selectedQuestionIds.has(item.qid)).map(item => new Date(item.answeredAt).getTime()),
    ].filter(Number.isFinite);
    const days = rangeDays ?? Math.min(365, Math.max(7, dates.length ? Math.ceil((nowMs - Math.min(...dates)) / DAY) + 1 : 7));
    const buckets = Array.from({ length: days }, (_, index) => {
      const date = new Date(nowMs - (days - 1 - index) * DAY);
      return { key: date.toISOString().slice(0, 10), label: (date.getMonth() + 1) + '/' + date.getDate() };
    });
    const positions = new Map(buckets.map((item, index) => [item.key, index]));
    if (subjectFilter !== 'all') {
      const cardData = buckets.map(() => 0), dqData = buckets.map(() => 0);
      logs.forEach(item => { const index = positions.get(dayKey(item.reviewedAt)); if (index !== undefined && selectedCardIds.has(item.cardId)) cardData[index] += 1; });
      dqLogs.forEach(item => { const index = positions.get(dayKey(item.answeredAt)); if (index !== undefined && selectedQuestionIds.has(item.qid)) dqData[index] += 1; });
      const series: { name: string; color: string; data: number[] }[] = [];
      if (contentFilter !== 'dq') series.push({ name: '背诵复习', color: CARD_COLOR, data: cardData });
      if (contentFilter === 'all' || contentFilter === 'dq') series.push({ name: '每日一题', color: DQ_COLOR, data: dqData });
      return { labels: buckets.map(item => item.label), series };
    }
    const series = visible.map(summary => {
      const data = buckets.map(() => 0);
      const cardIds = new Set(cards.filter(item => item.subjectId === summary.subject.cardSubjectId && cardMatchesContent(item, contentFilter)).map(item => item.id));
      const qids = new Set(questions.filter(item => item.subjectId === summary.subject.dqSubjectId && (contentFilter === 'all' || contentFilter === 'dq')).map(item => item.id));
      logs.forEach(item => { const index = positions.get(dayKey(item.reviewedAt)); if (index !== undefined && cardIds.has(item.cardId)) data[index] += 1; });
      dqLogs.forEach(item => { const index = positions.get(dayKey(item.answeredAt)); if (index !== undefined && qids.has(item.qid)) data[index] += 1; });
      return { name: summary.subject.name, color: summary.subject.color, data };
    });
    return { labels: buckets.map(item => item.label), series };
  }, [nowMs, rangeDays, logs, dqLogs, selectedCardIds, selectedQuestionIds, subjectFilter, contentFilter, visible, cards, questions]);

  const pressure = useMemo(() => Array.from({ length: 7 }, (_, offset) => {
    const start = new Date(nowMs || 0); start.setDate(start.getDate() + offset); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return states.filter(item => selectedCardIds.has(item.cardId) && new Date(item.dueAt) >= start && new Date(item.dueAt) < end).length;
  }), [states, selectedCardIds, nowMs]);

  useEffect(() => {
    if (!statusRef.current) return;
    const chart = echarts.init(statusRef.current);
    chart.setOption({
      ...chartBase(), tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 98, right: 22, top: 8, bottom: 26 },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#ece8df' } } },
      yAxis: { type: 'category', inverse: true, data: visible.map(item => item.subject.name), axisTick: { show: false }, axisLine: { show: false } },
      series: [
        { name: '未学习', type: 'bar', stack: 'state', barWidth: 18, data: visible.map(item => item.newCount), itemStyle: { color: STATUS_COLORS.fresh } },
        { name: '学习中', type: 'bar', stack: 'state', data: visible.map(item => item.learning), itemStyle: { color: STATUS_COLORS.learning } },
        { name: '已掌握', type: 'bar', stack: 'state', data: visible.map(item => item.mastered), itemStyle: { color: STATUS_COLORS.mastered } },
        { name: '薄弱', type: 'bar', stack: 'state', data: visible.map(item => item.weak), itemStyle: { color: STATUS_COLORS.weak } },
      ],
    });
    const resize = () => chart.resize(); window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [visible]);

  useEffect(() => {
    if (!masteryRef.current) return;
    const chart = echarts.init(masteryRef.current);
    chart.setOption({
      ...chartBase(), tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 98, right: 38, top: 8, bottom: 26 },
      xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: '#ece8df' } } },
      yAxis: { type: 'category', inverse: true, data: visible.map(item => item.subject.name), axisTick: { show: false }, axisLine: { show: false } },
      series: [
        { name: '背诵掌握率', type: 'bar', barWidth: 12, data: visible.map(item => item.cardMasteryRate), itemStyle: { color: CARD_COLOR, borderRadius: [0, 4, 4, 0] } },
        { name: '做题正确率', type: 'bar', barWidth: 12, data: visible.map(item => item.dqAccuracyRate), itemStyle: { color: DQ_COLOR, borderRadius: [0, 4, 4, 0] } },
      ],
    });
    const resize = () => chart.resize(); window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [visible]);

  useEffect(() => {
    if (!trendRef.current) return;
    const chart = echarts.init(trendRef.current);
    chart.setOption({
      ...chartBase(), tooltip: { trigger: 'axis' },
      grid: { left: 44, right: 20, top: 16, bottom: rangeDays === null ? 46 : 30 },
      xAxis: { type: 'category', boundaryGap: false, data: trend.labels, axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#ece8df' } } },
      series: trend.series.map(item => ({
        name: item.name, type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
        showSymbol: trend.labels.length <= 30, data: item.data,
        lineStyle: { width: 2, color: item.color }, itemStyle: { color: item.color },
        areaStyle: { color: item.color, opacity: .06 },
      })),
    });
    const resize = () => chart.resize(); window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [trend, rangeDays]);

  const totals = visible.reduce((acc, item) => ({
    total: acc.total + item.total, learned: acc.learned + item.learned, weak: acc.weak + item.weak, due: acc.due + item.due,
    cardsTotal: acc.cardsTotal + item.cardsTotal, cardsMastered: acc.cardsMastered + item.cardsMastered,
    dqAttempts: acc.dqAttempts + item.dqAttempts, dqCorrect: acc.dqCorrect + item.dqCorrectAttempts,
  }), { total: 0, learned: 0, weak: 0, due: 0, cardsTotal: 0, cardsMastered: 0, dqAttempts: 0, dqCorrect: 0 });
  const coverage = pct(totals.learned, totals.total);
  const cardMastery = pct(totals.cardsMastered, totals.cardsTotal);
  const dqAccuracy = pct(totals.dqCorrect, totals.dqAttempts);
  const activeDays = new Set([
    ...logs.filter(item => selectedCardIds.has(item.cardId)).map(item => dayKey(item.reviewedAt)),
    ...dqLogs.filter(item => selectedQuestionIds.has(item.qid)).map(item => dayKey(item.answeredAt)),
  ]).size;
  const maxPressure = Math.max(1, ...pressure);
  const selectedName = subjectFilter === 'all' ? '全部科目' : definitions.find(item => item.id === subjectFilter)?.name ?? '当前科目';

  return (
    <section className="dash-page dash-v2">
      <header className="dash-hero-v2">
        <div><p className="section-kicker">数据看板 · 科目视角</p><h2>{selectedName}学习全景</h2><p>背诵掌握、做题正确和学习覆盖分开计算；所有内容按科目向下展开。</p></div>
        <div className="dash-hero-seal"><strong>{coverage ?? 0}%</strong><span>学习覆盖</span></div>
      </header>

      <section className="dash-filter-panel" aria-label="数据筛选">
        <div className="dash-filter-row"><span>科目</span><div className="dash-subject-filter"><button type="button" className={subjectFilter === 'all' ? 'active' : ''} onClick={() => { setSubjectFilter('all'); setExpanded(new Set()); }}>全部科目</button>{definitions.map(subject => <button type="button" className={subjectFilter === subject.id ? 'active' : ''} onClick={() => { setSubjectFilter(subject.id); setExpanded(new Set(['subject:' + subject.id])); }} key={subject.id}><i style={{ background: subject.color }} />{subject.name}</button>)}</div></div>
        <div className="dash-filter-row dash-filter-row-secondary">
          <span>时间</span><div>{([7, 30, null] as const).map(value => <button type="button" className={rangeDays === value ? 'active' : ''} onClick={() => setRangeDays(value)} key={String(value)}>{value === null ? '全部' : value + '天'}</button>)}</div>
          <span>内容</span><div>{([['all', '全部'], ['memorize', '口诀背诵'], ['judgment', '判断题'], ['dq', '每日一题']] as const).map(([value, label]) => <button type="button" className={contentFilter === value ? 'active' : ''} onClick={() => { setContentFilter(value); setExpanded(subjectFilter === 'all' ? new Set() : new Set(['subject:' + subjectFilter])); }} key={value}>{label}</button>)}</div>
          <label><span>明细状态</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as DashboardStatusFilter)}><option value="all">全部状态</option><option value="new">未学习</option><option value="weak">薄弱</option><option value="mastered">已掌握</option><option value="due">已到期</option></select></label>
        </div>
      </section>

      <div className="dash-kpis-v2">
        <article><span>学习覆盖率</span><strong>{coverage === null ? '—' : coverage + '%'}</strong><small>{totals.learned} / {totals.total} 项已接触</small></article>
        <article><span>背诵掌握率</span><strong>{cardMastery === null ? '—' : cardMastery + '%'}</strong><small>{totals.cardsMastered} / {totals.cardsTotal} 张卡已掌握</small></article>
        <article><span>做题正确率</span><strong>{dqAccuracy === null ? '—' : dqAccuracy + '%'}</strong><small>{totals.dqCorrect} / {totals.dqAttempts} 次标准答案作答</small></article>
        <article className="weak"><span>薄弱内容</span><strong>{totals.weak}</strong><small>忘记、模糊或错题在册</small></article>
        <article><span>今日到期</span><strong>{totals.due}</strong><small>进入当前复习队列</small></article>
        <article><span>累计学习天数</span><strong>{activeDays}</strong><small>有背诵或做题记录的日期</small></article>
      </div>

      <div className="dash-overview-grid">
        <ChartCard kicker="宏观进度" title="各科当前状态" legend={[
          ['未学习', STATUS_COLORS.fresh], ['学习中', STATUS_COLORS.learning], ['已掌握', STATUS_COLORS.mastered], ['薄弱', STATUS_COLORS.weak],
        ]}><div ref={statusRef} className="dash-chart" style={{ height: Math.max(250, visible.length * 54 + 54) }} /></ChartCard>
        <ChartCard kicker="双轨口径" title="背诵掌握与做题正确" legend={[['背诵掌握率', CARD_COLOR], ['做题正确率', DQ_COLOR]]}>
          <div ref={masteryRef} className="dash-chart" style={{ height: Math.max(250, visible.length * 58 + 54) }} />
          <p className="dash-chart-note">“—”表示暂无对应内容或标准答案作答记录，不按 0 分处理。</p>
        </ChartCard>
      </div>

      <div className="dash-trend-grid">
        <ChartCard kicker="学习节奏" title={subjectFilter === 'all' ? '各科学习趋势' : selectedName + '学习趋势'} legend={trend.series.map(item => [item.name, item.color])} className="dash-trend-card">
          <div ref={trendRef} className="dash-chart" style={{ height: 290 }} />
        </ChartCard>
        <section className="dash-pressure-v2"><div className="dash-card-head"><div><p className="section-kicker">记忆曲线</p><h3>未来七天复习压力</h3></div></div><div className="dash-pressure-bars">{pressure.map((count, index) => <div key={index}><strong>{count}</strong><span><i className={index === 0 ? 'today' : ''} style={{ height: Math.max(5, count / maxPressure * 100) + '%' }} /></span><small>{index === 0 ? '今天' : (index + 1) + '天后'}</small></div>)}</div></section>
      </div>

      <section className="dash-hierarchy">
        <header><div><p className="section-kicker">从科目到具体内容</p><h2>知识体系明细</h2><p>父级数字严格由下级汇总；每日一题只按已有知识点标签归类，不擅自编造章节。</p></div><div className="training-size-picker"><span>专项每组</span>{[5, 10, 15, 20].map(size => <button type="button" className={trainingSize === size ? 'active' : ''} onClick={() => setTrainingSize(size)} key={size}>{size}</button>)}</div></header>
        <div className="dash-tree-head"><span>层级 / 内容</span><span>内容构成</span><span>已学习</span><span>已掌握</span><span>薄弱 / 到期</span><span>掌握情况</span><span>专项</span></div>
        <div className="dash-tree-body">
          {treeRows.map(({ node, depth, metrics }) => {
            const hasChildren = node.children.some(child => (metricsMap.get(child.id)?.total ?? 0) > 0);
            const cardRate = pct(metrics.cardsMastered, metrics.cardsTotal);
            const dqRate = pct(metrics.dqMastered, metrics.dqTotal);
            const quickIds = trainingGroup(metrics.weakCardIds);
            return <div className={'dash-tree-row kind-' + node.kind} key={node.id}>
              <button type="button" className="dash-tree-name" style={{ paddingLeft: 14 + depth * 22 }} disabled={!hasChildren} onClick={() => hasChildren && setExpanded(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}><b>{hasChildren ? (expanded.has(node.id) ? '−' : '+') : '·'}</b><span>{node.label}</span></button>
              <span className="dash-tree-composition">{metrics.cardsTotal ? '背 ' + metrics.cardsTotal : ''}{metrics.cardsTotal && metrics.dqTotal ? ' · ' : ''}{metrics.dqTotal ? '题 ' + metrics.dqTotal : ''}</span>
              <strong>{metrics.learned}<small> / {metrics.total}</small></strong><strong className="mastered">{metrics.mastered}</strong>
              <span className="dash-tree-risk"><b>{metrics.weak} 薄弱</b><small>{metrics.due} 到期</small></span>
              <span className="dash-tree-rates">{cardRate !== null && <small>背 {cardRate}%</small>}{dqRate !== null && <small>题 {dqRate}%</small>}</span>
              <span className="dash-tree-actions">{quickIds.length > 0 && <><button type="button" onClick={() => props.onTrainQuick(quickIds)}>速记</button><button type="button" onClick={() => void props.onTrainExam(quickIds)}>默写</button></>}{metrics.weakQIds.length > 0 && <button type="button" onClick={props.onOpenDaily}>错题</button>}</span>
            </div>;
          })}
          {!treeRows.length && <div className="dash-tree-empty">当前筛选下没有内容。可以切换科目、内容类型或明细状态。</div>}
        </div>
      </section>
    </section>
  );
}

function ChartCard({ kicker, title, legend, className = '', children }: {
  kicker: string; title: string; legend: string[][]; className?: string; children: React.ReactNode;
}) {
  return <section className={'dash-chart-card-v2 ' + className}><div className="dash-card-head"><div><p className="section-kicker">{kicker}</p><h3>{title}</h3></div><div className="dash-legend">{legend.map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div></div>{children}</section>;
}
