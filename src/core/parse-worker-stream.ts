/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Pure streaming helpers for the parse worker (issue #106).
 *
 * Extracted from parse-worker.ts so the two decisions that govern worker→parent IPC — when a
 * progress message must be sent immediately, and when chunk emission must pause for backpressure —
 * are unit-testable without spawning a worker. This module is a leaf: no Node/IPC imports.
 */

/** The subset of a progress payload that influences the throttle decision. */
export interface ThrottleableProgress {
  phase: number;
  pct: number;
  workspacePlan?: unknown;
  workspaceDone?: unknown;
}

/**
 * A progress message must bypass the time-based throttle and be sent immediately when it carries
 * structurally important state: a phase change, a one-shot workspace-grid plan/done event, or
 * completion (pct >= 100). Routine intra-phase ticks may be throttled instead.
 */
export function shouldSendProgressImmediately(progress: ThrottleableProgress, lastPhase: number): boolean {
  return (
    progress.phase !== lastPhase ||
    !!progress.workspacePlan ||
    !!progress.workspaceDone ||
    progress.pct >= 100
  );
}

/** Backpressure gate bounding how many emitted-but-unacked chunks may be in flight. */
export interface AckWindow {
  /** Record a parent acknowledgement for chunk `seq` and release any waiter. */
  onAck(seq: number): void;
  /** True while chunk `seq` must wait because the unacked window is full. */
  isFull(seq: number): boolean;
  /** Resolve once chunk `seq` is within the allowed window (immediately if already free). */
  waitForSlot(seq: number): Promise<void>;
  /** Highest contiguous-or-greater seq acked so far (-1 before any ack). */
  readonly highestAcked: number;
}

/**
 * Create an ack window of the given size. A chunk `seq` is blocked while `seq - highestAcked >=
 * windowSize`; each ack re-checks the condition and resumes a pending waiter. The worker keeps at
 * most `windowSize` chunks unacked so serialized payloads cannot pile up in the child's native
 * IPC write buffer — the native OOM that V8 heap limits could not prevent (issue #106).
 */
export function createAckWindow(windowSize: number): AckWindow {
  let highestAcked = -1;
  let waiter: (() => void) | null = null;

  return {
    onAck(seq: number): void {
      if (seq > highestAcked) highestAcked = seq;
      const resume = waiter;
      waiter = null;
      resume?.();
    },
    isFull(seq: number): boolean {
      return seq - highestAcked >= windowSize;
    },
    async waitForSlot(seq: number): Promise<void> {
      while (seq - highestAcked >= windowSize) {
        await new Promise<void>((resolve) => { waiter = resolve; });
      }
    },
    get highestAcked(): number {
      return highestAcked;
    },
  };
}
