import { allDailyQuestions, dqSubjectName, dqSubjects } from '../../client/src/lib/daily-questions';

describe('开源示例每日一题', () => {
  it('只包含虚构示例科目和示例题', () => {
    expect(dqSubjects.map(subject => [subject.id, subject.name])).toEqual([
      ['demo-subject', '示例科目'],
    ]);
    expect(allDailyQuestions).toHaveLength(1);
    expect(allDailyQuestions[0]).toMatchObject({
      id: 'demo-dq-001',
      subjectId: 'demo-subject',
      source: '开源示例数据',
      answer: 'B',
    });
    expect(dqSubjectName('demo-subject')).toBe('示例科目');
  });
});
