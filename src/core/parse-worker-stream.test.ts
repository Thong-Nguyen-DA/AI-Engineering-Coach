/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the pure parse-worker streaming helpers (issue #106): the progress throttle
 * predicate and the chunk ack-window backpressure gate. */

import { describe, it, expect } from 'vitest';
import { shouldSendProgressImmediately, createAckWindow } from './parse-worker-stream';

describe('shouldSendProgressImmediately', () => {
  const base = { phase: 2, pct: 50 };

  it('sends immediately on a phase change', () => {
    expect(shouldSendProgressImmediately(base, /* lastPhase */ 1)).toBe(true);
  });

  it('throttles a routine intra-phase tick (same phase, mid progress)', () => {
    expect(shouldSendProgressImmediately(base, 2)).toBe(false);
  });

  it('sends immediately when a workspace grid plan is present', () => {
    expect(shouldSendProgressImmediately({ ...base, workspacePlan: ['a'] }, 2)).toBe(true);
  });

  it('sends immediately when a workspace completion is present', () => {
    expect(shouldSendProgressImmediately({ ...base, workspaceDone: 'a' }, 2)).toBe(true);
  });

  it('sends immediately at completion (pct >= 100)', () => {
    expect(shouldSendProgressImmediately({ phase: 2, pct: 100 }, 2)).toBe(true);
  });
});

describe('createAckWindow', () => {
  it('starts with highestAcked = -1 and the first window slots free', () => {
    const w = createAckWindow(4);
    expect(w.highestAcked).toBe(-1);
    // With nothing acked, seq 0..2 are within a window of 4 (seq - (-1) < 4); seq 3 is the 4th
    // unacked chunk and is blocked until the first ack arrives.
    expect(w.isFull(0)).toBe(false);
    expect(w.isFull(2)).toBe(false);
    expect(w.isFull(3)).toBe(true);
  });

  it('advances highestAcked and treats out-of-order acks monotonically', () => {
    const w = createAckWindow(4);
    w.onAck(2);
    expect(w.highestAcked).toBe(2);
    // A lower, late ack must not move highestAcked backwards.
    w.onAck(1);
    expect(w.highestAcked).toBe(2);
  });

  it('resolves waitForSlot immediately when the window is not full', async () => {
    const w = createAckWindow(4);
    await expect(w.waitForSlot(1)).resolves.toBeUndefined();
  });

  it('blocks waitForSlot until an ack frees the window', async () => {
    const w = createAckWindow(2);
    // seq 2 with highestAcked -1 => 2 - (-1) = 3 >= 2 => full, must wait.
    let resolved = false;
    const wait = w.waitForSlot(2).then(() => { resolved = true; });

    await Promise.resolve();
    expect(resolved).toBe(false);

    // Ack seq 0 => highestAcked 0 => 2 - 0 = 2 >= 2 => still full.
    w.onAck(0);
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Ack seq 1 => highestAcked 1 => 2 - 1 = 1 < 2 => slot frees.
    w.onAck(1);
    await wait;
    expect(resolved).toBe(true);
  });
});
