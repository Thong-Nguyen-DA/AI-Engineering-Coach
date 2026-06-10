/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { computeSessionTotals, createRunningTotals } from './session-totals';
import { createRequest, createSession } from './parser-shared';
import type { Session } from './types';

function session(reqs: ReturnType<typeof createRequest>[]): Session {
  return createSession({
    sessionId: 's', workspaceId: 'w', workspaceName: 'ws', harness: 'vscode', requests: reqs,
  });
}

describe('computeSessionTotals', () => {
  it('returns all-zero totals for no sessions', () => {
    expect(computeSessionTotals([])).toEqual({
      linesOfCode: 0, toolCalls: 0, imagesAnalyzed: 0, filesEdited: 0, requests: 0,
    });
  });

  it('aggregates loc, tool calls, images, edited files and requests across sessions', () => {
    const r1 = createRequest({
      messageText: '', responseText: '',
      aiCode: [{ language: 'ts', loc: 3 }, { language: 'ts', loc: 2 }],
      toolsUsed: ['read', 'edit'],
      variableKinds: { image: 2 },
      editedFiles: ['a.ts', 'b.ts'],
    });
    const r2 = createRequest({
      messageText: '', responseText: '',
      aiCode: [{ language: 'ts', loc: 4 }],
      toolsUsed: ['search'],
      variableKinds: { image: 1, file: 5 },
      editedFiles: ['b.ts'], // duplicate across requests must be de-duped
    });
    const totals = computeSessionTotals([session([r1, r2])]);
    expect(totals).toEqual({
      linesOfCode: 9, toolCalls: 3, imagesAnalyzed: 3, filesEdited: 2, requests: 2,
    });
  });

  it('de-duplicates edited files across separate sessions', () => {
    const a = session([createRequest({ messageText: '', responseText: '', editedFiles: ['x.ts'] })]);
    const b = session([createRequest({ messageText: '', responseText: '', editedFiles: ['x.ts', 'y.ts'] })]);
    expect(computeSessionTotals([a, b]).filesEdited).toBe(2);
  });
});

describe('createRunningTotals', () => {
  it('starts at all-zero totals', () => {
    expect(createRunningTotals().snapshot()).toEqual({
      linesOfCode: 0, toolCalls: 0, imagesAnalyzed: 0, filesEdited: 0, requests: 0,
    });
  });

  it('folding sessions one-by-one matches computeSessionTotals over the whole set', () => {
    const a = session([createRequest({
      messageText: '', responseText: '',
      aiCode: [{ language: 'ts', loc: 3 }, { language: 'ts', loc: 2 }],
      toolsUsed: ['read', 'edit'], variableKinds: { image: 2 }, editedFiles: ['a.ts', 'b.ts'],
    })]);
    const b = session([createRequest({
      messageText: '', responseText: '',
      aiCode: [{ language: 'ts', loc: 4 }],
      toolsUsed: ['search'], variableKinds: { image: 1 }, editedFiles: ['b.ts', 'c.ts'],
    })]);

    const running = createRunningTotals();
    running.add(a);
    running.add(b);

    expect(running.snapshot()).toEqual(computeSessionTotals([a, b]));
  });

  it('snapshot reflects only the sessions folded in so far', () => {
    const a = session([createRequest({ messageText: '', responseText: '', editedFiles: ['x.ts'] })]);
    const b = session([createRequest({ messageText: '', responseText: '', editedFiles: ['x.ts', 'y.ts'] })]);
    const running = createRunningTotals();
    running.add(a);
    expect(running.snapshot().filesEdited).toBe(1);
    running.add(b);
    expect(running.snapshot().filesEdited).toBe(2);
  });
});
