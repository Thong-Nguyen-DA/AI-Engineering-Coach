/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Pure session aggregate reducers used for loading-progress totals. No vscode/fs dependency. */

import type { Session } from './types';

/** Running totals surfaced on the loading screen as sessions are discovered. */
export interface SessionTotals {
  /** Total AI-generated lines of code across all requests. */
  linesOfCode: number;
  /** Total tool calls across all requests. */
  toolCalls: number;
  /** Total images analyzed by the AI (from variableKinds.image). */
  imagesAnalyzed: number;
  /** Count of unique files edited by the AI. */
  filesEdited: number;
  /** Total requests (turns). */
  requests: number;
}

/** Compute the loading-progress totals for a set of sessions in a single pass per metric. */
export function computeSessionTotals(sessions: readonly Session[]): SessionTotals {
  let linesOfCode = 0;
  let toolCalls = 0;
  let imagesAnalyzed = 0;
  let requests = 0;
  const editedFiles = new Set<string>();
  for (const s of sessions) {
    requests += s.requests.length;
    for (const r of s.requests) {
      for (const b of r.aiCode) linesOfCode += b.loc;
      toolCalls += r.toolsUsed.length;
      imagesAnalyzed += r.variableKinds['image'] || 0;
      for (const f of r.editedFiles) editedFiles.add(f);
    }
  }
  return { linesOfCode, toolCalls, imagesAnalyzed, filesEdited: editedFiles.size, requests };
}

/** Incremental accumulator that folds sessions in one at a time, preserving a unique-files set
 * across calls. Used by the cold-parse loop to surface running totals without re-summing every
 * session on each progress tick. `snapshot()` always equals {@link computeSessionTotals} over the
 * same sessions. */
export interface RunningTotals {
  /** Fold one more session's metrics into the running totals. */
  add(session: Session): void;
  /** Current snapshot of the accumulated totals. */
  snapshot(): SessionTotals;
}

export function createRunningTotals(): RunningTotals {
  let linesOfCode = 0;
  let toolCalls = 0;
  let imagesAnalyzed = 0;
  let requests = 0;
  const editedFiles = new Set<string>();
  return {
    add(session: Session): void {
      requests += session.requests.length;
      for (const r of session.requests) {
        for (const b of r.aiCode) linesOfCode += b.loc;
        toolCalls += r.toolsUsed.length;
        imagesAnalyzed += r.variableKinds['image'] || 0;
        for (const f of r.editedFiles) editedFiles.add(f);
      }
    },
    snapshot(): SessionTotals {
      return { linesOfCode, toolCalls, imagesAnalyzed, filesEdited: editedFiles.size, requests };
    },
  };
}
