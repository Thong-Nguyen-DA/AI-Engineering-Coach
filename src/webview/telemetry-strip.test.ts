/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @vitest-environment jsdom
 *
 * Unit tests for the loading-screen telemetry strip (issue #106). Verifies the pure formatting
 * helpers and the DOM rendering of {@link updateTelemetry} against a real jsdom document.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fmtMem, pressureColor, updateTelemetry } from './telemetry-strip';
import type { WorkerTelemetry } from './shared';

const SAMPLE: WorkerTelemetry = {
  rssMB: 512,
  heapUsedMB: 256,
  heapLimitMB: 4096,
  fileBufMB: 64,
  cpuPct: 42,
};

describe('telemetry-strip helpers', () => {
  it('fmtMem formats MB and GB', () => {
    expect(fmtMem(0)).toBe('0 MB');
    expect(fmtMem(512)).toBe('512 MB');
    expect(fmtMem(1024)).toBe('1.0 GB');
    expect(fmtMem(1536)).toBe('1.5 GB');
    expect(fmtMem(10240)).toBe('10 GB');
  });

  it('pressureColor escalates with utilization', () => {
    expect(pressureColor(10)).toContain('--accent-blue');
    expect(pressureColor(64)).toContain('--accent-blue');
    expect(pressureColor(65)).toContain('--accent-amber');
    expect(pressureColor(84)).toContain('--accent-amber');
    expect(pressureColor(85)).toContain('--accent-red');
    expect(pressureColor(100)).toContain('--accent-red');
  });
});

describe('updateTelemetry rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="loading-telemetry"></div>';
  });

  it('is a no-op when the host element is absent', () => {
    document.body.innerHTML = '';
    expect(() => updateTelemetry(SAMPLE)).not.toThrow();
  });

  it('builds the strip once and populates all values', () => {
    updateTelemetry(SAMPLE);
    const host = document.getElementById('loading-telemetry')!;

    expect(host.dataset.init).toBe('1');
    expect(document.getElementById('tg-mem-used')?.textContent).toBe('256 MB');
    expect(document.getElementById('tg-mem-limit')?.textContent).toBe('4.0 GB');
    expect(document.getElementById('tg-rss')?.textContent).toBe('512 MB');
    expect(document.getElementById('tg-buf')?.textContent).toBe('64 MB');
    // CPU label: 42% -> active
    expect(document.getElementById('tg-cpu-load')?.textContent).toBe('active');
  });

  it('does not rebuild markup on subsequent updates (updates in place)', () => {
    updateTelemetry(SAMPLE);
    const firstRing = document.getElementById('tg-mem-arc');
    updateTelemetry({ ...SAMPLE, heapUsedMB: 1024 });
    // Same element instance — strip was not torn down and recreated.
    expect(document.getElementById('tg-mem-arc')).toBe(firstRing);
    expect(document.getElementById('tg-mem-used')?.textContent).toBe('1.0 GB');
  });

  it('reflects the heap ring percentage and pressure class under load', () => {
    // 3686 / 4096 ≈ 90% -> red + pressure class
    updateTelemetry({ ...SAMPLE, heapUsedMB: 3686, cpuPct: 95 });
    const host = document.getElementById('loading-telemetry')!;
    expect(host.classList.contains('tg-pressure')).toBe(true);
    expect(document.getElementById('tg-mem-pct')?.textContent).toBe('90%');
    expect(document.getElementById('tg-cpu-load')?.textContent).toBe('busy');

    const arc = document.getElementById('tg-mem-arc') as unknown as SVGElement;
    expect(arc.style.stroke).toContain('--accent-red');
  });

  it('clears the pressure class when utilization drops', () => {
    updateTelemetry({ ...SAMPLE, heapUsedMB: 3900 }); // ~95% -> pressure
    expect(document.getElementById('loading-telemetry')!.classList.contains('tg-pressure')).toBe(true);
    updateTelemetry({ ...SAMPLE, heapUsedMB: 256 }); // ~6% -> no pressure
    expect(document.getElementById('loading-telemetry')!.classList.contains('tg-pressure')).toBe(false);
  });

  it('handles a zero heap limit without dividing by zero', () => {
    expect(() => updateTelemetry({ ...SAMPLE, heapLimitMB: 0 })).not.toThrow();
    expect(document.getElementById('tg-mem-pct')?.textContent).toBe('0%');
  });

  it('shows no skipped files by default (clean parse)', () => {
    updateTelemetry(SAMPLE);
    expect(document.getElementById('tg-skipped')?.textContent).toBe('0 files');
    expect(document.getElementById('tg-skipped-tile')?.classList.contains('tg-tile-warn')).toBe(false);
  });

  it('highlights skipped files and includes skipped lines when present', () => {
    updateTelemetry({ ...SAMPLE, skippedFiles: 2, skippedLines: 5 });
    expect(document.getElementById('tg-skipped')?.textContent).toBe('2 files · 5 lines');
    expect(document.getElementById('tg-skipped-tile')?.classList.contains('tg-tile-warn')).toBe(true);
  });

  it('uses singular wording for a single skipped file and clears the warn class when resolved', () => {
    updateTelemetry({ ...SAMPLE, skippedFiles: 1, skippedLines: 0 });
    expect(document.getElementById('tg-skipped')?.textContent).toBe('1 file');
    expect(document.getElementById('tg-skipped-tile')?.classList.contains('tg-tile-warn')).toBe(true);
    updateTelemetry({ ...SAMPLE, skippedFiles: 0, skippedLines: 0 });
    expect(document.getElementById('tg-skipped-tile')?.classList.contains('tg-tile-warn')).toBe(false);
  });
});
