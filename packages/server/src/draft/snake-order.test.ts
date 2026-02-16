import { describe, it, expect } from 'vitest';
import { generateSnakeOrder, generateLinearOrder } from './snake-order.js';

describe('generateSnakeOrder', () => {
  it('generates correct pick count', () => {
    const queue = generateSnakeOrder(8, 15);
    expect(queue.length).toBe(120); // 8 * 15
  });

  it('reverses order on even rounds (snake)', () => {
    const queue = generateSnakeOrder(4, 3);

    // Round 1: 0, 1, 2, 3
    expect(queue[0].memberIndex).toBe(0);
    expect(queue[1].memberIndex).toBe(1);
    expect(queue[2].memberIndex).toBe(2);
    expect(queue[3].memberIndex).toBe(3);

    // Round 2: 3, 2, 1, 0 (reversed)
    expect(queue[4].memberIndex).toBe(3);
    expect(queue[5].memberIndex).toBe(2);
    expect(queue[6].memberIndex).toBe(1);
    expect(queue[7].memberIndex).toBe(0);

    // Round 3: 0, 1, 2, 3 (back to normal)
    expect(queue[8].memberIndex).toBe(0);
    expect(queue[9].memberIndex).toBe(1);
    expect(queue[10].memberIndex).toBe(2);
    expect(queue[11].memberIndex).toBe(3);
  });

  it('assigns correct overall pick numbers', () => {
    const queue = generateSnakeOrder(4, 2);
    expect(queue.map((q) => q.overallPick)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('assigns correct round and pick-in-round', () => {
    const queue = generateSnakeOrder(4, 2);

    // Round 1
    for (let i = 0; i < 4; i++) {
      expect(queue[i].round).toBe(1);
      expect(queue[i].pickInRound).toBe(i + 1);
    }

    // Round 2
    for (let i = 4; i < 8; i++) {
      expect(queue[i].round).toBe(2);
      expect(queue[i].pickInRound).toBe(i - 3);
    }
  });

  it('gives first and last pick fair treatment in 8-team snake', () => {
    const queue = generateSnakeOrder(8, 4);

    // Member 0 picks: 1st, 16th, 17th, 32nd
    const member0Picks = queue.filter((q) => q.memberIndex === 0);
    expect(member0Picks.map((q) => q.overallPick)).toEqual([1, 16, 17, 32]);

    // Member 7 picks: 8th, 9th, 24th, 25th
    const member7Picks = queue.filter((q) => q.memberIndex === 7);
    expect(member7Picks.map((q) => q.overallPick)).toEqual([8, 9, 24, 25]);
  });

  it('rejects invalid league sizes', () => {
    expect(() => generateSnakeOrder(1)).toThrow();
    expect(() => generateSnakeOrder(17)).toThrow();
  });
});

describe('generateLinearOrder', () => {
  it('keeps same order every round', () => {
    const queue = generateLinearOrder(4, 2);

    expect(queue[0].memberIndex).toBe(0);
    expect(queue[1].memberIndex).toBe(1);
    expect(queue[2].memberIndex).toBe(2);
    expect(queue[3].memberIndex).toBe(3);
    expect(queue[4].memberIndex).toBe(0);
    expect(queue[5].memberIndex).toBe(1);
    expect(queue[6].memberIndex).toBe(2);
    expect(queue[7].memberIndex).toBe(3);
  });
});
