import { describe, expect, it, vi } from 'vitest';
import { InterviewStateMachine, S, synthesizeInterviewPlan } from '../interviewAgent';

describe('InterviewStateMachine', () => {
  it('accepts the intended interview lifecycle', () => {
    const machine = new InterviewStateMachine();

    machine.transition(S.PLANNING_INTERVIEW);
    machine.transition(S.SPEAKING);
    machine.transition(S.AWAITING_RESPONSE);
    machine.transition(S.PROCESSING);
    machine.transition(S.SPEAKING);
    machine.transition(S.AWAITING_RESPONSE);

    expect(machine.state).toBe(S.AWAITING_RESPONSE);
  });

  it('rejects invalid transitions', () => {
    const machine = new InterviewStateMachine();
    expect(() => machine.transition(S.COMPLETE)).toThrow(/Invalid interview transition/);
  });

  it('fires wait timeout only while awaiting a response', () => {
    vi.useFakeTimers();
    const machine = new InterviewStateMachine();
    const timeout = vi.fn();

    machine.onWaitTimeout = timeout;
    machine.transition(S.PLANNING_INTERVIEW);
    machine.transition(S.SPEAKING);
    machine.transition(S.AWAITING_RESPONSE);

    vi.advanceTimersByTime(89_999);
    expect(timeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(timeout).toHaveBeenCalledTimes(1);

    machine.transition(S.PROCESSING);
    vi.advanceTimersByTime(90_000);
    expect(timeout).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

describe('synthesizeInterviewPlan', () => {
  it('preserves the planned topic order', () => {
    const plan = synthesizeInterviewPlan(
      { topics_planned: [{ topic: 'Systems', reasoning: 'Trade-offs' }, { topic: 'SQL' }] },
      'Kevin',
      'Backend Engineer',
      'resume',
    );

    expect(plan.todos.map((todo) => todo.area)).toEqual(['Systems', 'SQL']);
    expect(plan.todos[0].intent).toBe('Trade-offs');
  });
});
