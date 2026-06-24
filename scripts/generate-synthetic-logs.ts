/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Synthetic VS Code session-log generator (issue #106 testing).
 *
 * Writes fake chatSessions JSON into a throwaway directory that mirrors the on-disk layout the
 * parser expects:  <root>/<workspaceId>/chatSessions/<sessionId>.json
 *
 * SAFETY: never writes into the user's workspace or real log dirs. Defaults to an OS temp dir
 * (os.tmpdir()), and the directory is the caller's to delete (use cleanup()).
 *
 * Usable two ways:
 *   1. Imported:  generateSyntheticLogs({ workspaces, sessionsPerWorkspace, ... })
 *   2. CLI:       npx tsx scripts/generate-synthetic-logs.ts --target-gb 2 --keep
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface GenOptions {
  /** Destination root. Defaults to a fresh OS temp dir. Never point this at real data. */
  root?: string;
  workspaces: number;
  sessionsPerWorkspace: number;
  requestsPerSession: number;
  /** Approximate combined bytes of message + response text per request. */
  bytesPerRequest: number;
}

export interface GenResult {
  root: string;
  totalSessions: number;
  totalRequests: number;
  approxBytesOnDisk: number;
}

const DEFAULTS: Omit<GenOptions, 'root'> = {
  workspaces: 50,
  sessionsPerWorkspace: 20,
  requestsPerSession: 8,
  bytesPerRequest: 4096,
};

function makeText(bytes: number, seed: string): string {
  if (bytes <= 0) return '';
  // Cheap, deterministic-ish filler. Repeating a seeded token keeps generation fast.
  const token = `${seed} the quick brown fox edits ${seed}.ts and runs npm test. `;
  return token.repeat(Math.ceil(bytes / token.length)).slice(0, bytes);
}

/** Create a single synthetic chatSession file's JSON content. */
function makeSessionJson(wsId: string, sessionIdx: number, opts: GenOptions): string {
  const baseTs = 1_700_000_000_000 + sessionIdx * 60_000;
  const half = Math.max(1, Math.floor(opts.bytesPerRequest / 2));
  const requests = Array.from({ length: opts.requestsPerSession }, (_, j) => ({
    requestId: `${wsId}-s${sessionIdx}-r${j}`,
    timestamp: baseTs + j * 1000,
    message: { text: makeText(half, `m${j}`) },
    response: [{ value: makeText(half, `a${j}`) }],
    modelId: j % 2 === 0 ? 'gpt-4o' : 'claude-3.7',
    result: { timings: { firstProgress: 200, totalElapsed: 1500 }, metadata: {} },
  }));
  return JSON.stringify({
    creationDate: baseTs,
    lastMessageDate: baseTs + opts.requestsPerSession * 1000,
    sessionId: `${wsId}-s${sessionIdx}`,
    requests,
  });
}

export function generateSyntheticLogs(partial: Partial<GenOptions>): GenResult {
  const opts: GenOptions = { ...DEFAULTS, ...partial };
  const root = opts.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'aic-synth-'));

  let totalSessions = 0;
  let totalRequests = 0;
  let approxBytesOnDisk = 0;

  for (let w = 0; w < opts.workspaces; w++) {
    const wsId = `synthws-${String(w).padStart(5, '0')}`;
    const chatDir = path.join(root, wsId, 'chatSessions');
    fs.mkdirSync(chatDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, wsId, 'workspace.json'),
      JSON.stringify({ folder: `file:///synthetic/${wsId}` }),
    );
    for (let s = 0; s < opts.sessionsPerWorkspace; s++) {
      const json = makeSessionJson(wsId, s, opts);
      fs.writeFileSync(path.join(chatDir, `${wsId}-s${s}.json`), json);
      approxBytesOnDisk += json.length;
      totalRequests += opts.requestsPerSession;
      totalSessions++;
    }
  }

  return { root, totalSessions, totalRequests, approxBytesOnDisk };
}

/** Remove a generated tree. Safe no-op if it doesn't exist. */
export function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

/** Derive workspace/session counts that roughly hit a target on-disk size in GB. */
export function planForTargetGb(targetGb: number, bytesPerRequest = DEFAULTS.bytesPerRequest): Partial<GenOptions> {
  const targetBytes = targetGb * 1024 * 1024 * 1024;
  const requestsPerSession = DEFAULTS.requestsPerSession;
  const sessionsPerWorkspace = DEFAULTS.sessionsPerWorkspace;
  const bytesPerSession = requestsPerSession * bytesPerRequest;
  const bytesPerWorkspace = sessionsPerWorkspace * bytesPerSession;
  const workspaces = Math.max(1, Math.ceil(targetBytes / bytesPerWorkspace));
  return { workspaces, sessionsPerWorkspace, requestsPerSession, bytesPerRequest };
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// CLI entry — only runs when executed directly, not when imported.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', '').replace(/^\/([A-Za-z]:)/, '$1'));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const getNum = (flag: string, def: number): number => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
  };
  const keep = args.includes('--keep');
  const targetGb = args.includes('--target-gb') ? getNum('--target-gb', 1) : undefined;

  const plan: Partial<GenOptions> = targetGb != null
    ? planForTargetGb(targetGb)
    : {
        workspaces: getNum('--workspaces', DEFAULTS.workspaces),
        sessionsPerWorkspace: getNum('--sessions', DEFAULTS.sessionsPerWorkspace),
        requestsPerSession: getNum('--requests', DEFAULTS.requestsPerSession),
        bytesPerRequest: getNum('--bytes', DEFAULTS.bytesPerRequest),
      };

  console.log('Generating synthetic logs with plan:', plan);
  const t0 = Date.now();
  const res = generateSyntheticLogs(plan);
  console.log(`\nGenerated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  root:     ${res.root}`);
  console.log(`  sessions: ${res.totalSessions}`);
  console.log(`  requests: ${res.totalRequests}`);
  console.log(`  on disk:  ${mb(res.approxBytesOnDisk)}`);
  if (keep) {
    console.log('\n--keep set: tree retained. Delete it yourself when done:');
    console.log(`  rm -rf "${res.root}"`);
  } else {
    cleanup(res.root);
    console.log('\nCleaned up (pass --keep to retain the tree).');
  }
}
