/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * OOM regression repro (issue #106).
 *
 * Generates a large synthetic session tree in an OS temp dir, then forks the REAL built parse
 * worker (dist/parse-worker.js) exactly like the extension does — isolated process, capped heap
 * — and asserts it streams a `done` message instead of crashing (SIGABRT / non-zero exit).
 *
 * SAFETY:
 *   - Synthetic data is written only to os.tmpdir(); deleted on exit.
 *   - The forked worker's HOME/USERPROFILE are redirected to a temp dir so its disk-cache write
 *     never touches the user's real ~/.copilot-analytics-cache.
 *
 * This is intentionally NOT part of `npm test` (it allocates GBs). Run it manually:
 *   npm run build
 *   npm run test:oom-synth                 # default ~1.5 GB tree
 *   OOM_TARGET_GB=3 OOM_HEAP_MB=4096 npm run test:oom-synth
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fork } from 'child_process';
import { cleanup, generateSyntheticLogs, planForTargetGb } from './generate-synthetic-logs';

function mb(bytes: number): string { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

async function main(): Promise<void> {
  const targetGb = Number(process.env.OOM_TARGET_GB ?? '1.5');
  const heapMb = Number(process.env.OOM_HEAP_MB ?? '4096');
  // Optional: shape large individual session files (mimics histories with a few huge sessions,
  // which stress the prefetch buffer / per-workspace transient — issue #106).
  const bytesPerRequest = process.env.OOM_BYTES_PER_REQUEST ? Number(process.env.OOM_BYTES_PER_REQUEST) : undefined;

  const workerPath = path.join(process.cwd(), 'dist', 'parse-worker.js');
  if (!fs.existsSync(workerPath)) {
    throw new Error(`Worker not built: ${workerPath}. Run "npm run build" first.`);
  }

  // Redirect the forked worker's home so its cache write lands in temp, not the real home dir.
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-oom-home-'));

  console.log(`Generating ~${targetGb} GB synthetic tree...`);
  const t0 = Date.now();
  const gen = generateSyntheticLogs(planForTargetGb(targetGb, bytesPerRequest));
  console.log(`  ${gen.totalSessions} sessions, ${mb(gen.approxBytesOnDisk)} on disk in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  root: ${gen.root}`);
  console.log(`Forking worker with --max-old-space-size=${heapMb}...`);

  const cleanupAll = (): void => { cleanup(gen.root); cleanup(fakeHome); };

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = fork(workerPath, [], {
        execArgv: [`--max-old-space-size=${heapMb}`],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
      });

      let chunks = 0;
      let sessions = 0;
      let gotDone = false;
      const started = Date.now();

      child.on('message', (msg: { type?: string; payload?: { sessions?: unknown[] } }) => {
        if (msg.type === 'chunk') {
          chunks++;
          sessions += msg.payload?.sessions?.length ?? 0;
        } else if (msg.type === 'done') {
          gotDone = true;
          console.log(`\n✅ worker emitted "done" after ${((Date.now() - started) / 1000).toFixed(1)}s: ${chunks} chunks, ${sessions} sessions`);
          child.kill();
          resolve(0);
        } else if (msg.type === 'error') {
          reject(new Error(`worker error message: ${JSON.stringify(msg)}`));
        }
      });

      child.on('exit', (code, signal) => {
        if (gotDone) return;
        reject(new Error(`worker exited before "done": code=${code} signal=${signal || ''}`));
      });
      child.on('error', reject);

      child.send({ logsDirs: [gen.root] });
    });

    console.log(`\nPASS — repro completed without OOM (exit ${exitCode}).`);
  } catch (err) {
    console.error(`\nFAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    cleanupAll();
    console.log('Cleaned up temp data.');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
});
