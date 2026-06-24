/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parse-worker resource telemetry sampler (issue #106).
 *
 * Extracted from parse-worker.ts so the CPU%/memory math is unit-testable with injected sources
 * (the worker entry itself wires up IPC and is awkward to load in a test). The sampler holds the
 * CPU-delta state between calls; create one per worker run.
 */

import * as v8 from 'v8';
import type { ParseTelemetry } from './parser';

const BYTES_PER_MB = 1024 * 1024;

/** Pluggable sources so tests can drive deterministic values. Defaults read the real runtime. */
export interface TelemetrySources {
  memoryUsage: () => NodeJS.MemoryUsage;
  cpuUsage: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  /** Monotonic time in nanoseconds (defaults to process.hrtime.bigint). */
  hrtimeNs: () => bigint;
  heapLimitBytes: () => number;
  /** Live parse-warning counts (failed files / skipped lines). */
  warningCounts: () => { skippedFiles: number; skippedLines: number };
}

const defaultSources: TelemetrySources = {
  memoryUsage: () => process.memoryUsage(),
  cpuUsage: (previous) => process.cpuUsage(previous),
  hrtimeNs: () => process.hrtime.bigint(),
  heapLimitBytes: () => v8.getHeapStatistics().heap_size_limit,
  warningCounts: () => ({ skippedFiles: 0, skippedLines: 0 }),
};

/**
 * Create a telemetry sampler. Each call to the returned function produces a fresh snapshot;
 * `cpuPct` is computed from the delta since the previous call (0 on the first call).
 */
export function createTelemetrySampler(sources: Partial<TelemetrySources> = {}): () => ParseTelemetry {
  const s: TelemetrySources = { ...defaultSources, ...sources };
  const mb = (n: number): number => Math.round(n / BYTES_PER_MB);

  // Constant read once — the heap ceiling does not change during a run.
  const heapLimitMB = mb(s.heapLimitBytes());

  let lastCpu = s.cpuUsage();
  let lastAt = s.hrtimeNs();

  return function sample(): ParseTelemetry {
    const m = s.memoryUsage();

    const cpuNow = s.cpuUsage();
    const at = s.hrtimeNs();
    const usedMicros = (cpuNow.user - lastCpu.user) + (cpuNow.system - lastCpu.system);
    const elapsedMicros = Number(at - lastAt) / 1000; // ns → µs
    lastCpu = cpuNow;
    lastAt = at;
    const cpuPct = elapsedMicros > 0
      ? Math.max(0, Math.min(100, (usedMicros / elapsedMicros) * 100))
      : 0;

    return {
      rssMB: mb(m.rss),
      heapUsedMB: mb(m.heapUsed),
      heapLimitMB,
      fileBufMB: mb(m.external + m.arrayBuffers),
      cpuPct: Math.round(cpuPct),
      ...s.warningCounts(),
    };
  };
}
