/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Live parse-worker telemetry strip rendered at the top of the loading screen (issue #106).
 *
 * Kept in its own module (rather than inline in app.ts) so the DOM rendering can be unit-tested
 * under jsdom without importing the whole app shell (Chart.js, pages, message listener wiring).
 */

import type { WorkerTelemetry } from './shared';

const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Format a megabyte count as a compact human string (e.g. `512 MB`, `1.5 GB`). */
export function fmtMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Map a 0–100 pressure percentage to a gauge color: blue → amber (≥65) → red (≥85). */
export function pressureColor(pct: number): string {
  if (pct >= 85) return 'var(--accent-red, #f14c4c)';
  if (pct >= 65) return 'var(--accent-amber, #d7a000)';
  return 'var(--accent-blue)';
}

function ringMarkup(idBase: string): string {
  return (
    `<div class="tg-ringwrap">` +
    `<svg class="tg-ring" viewBox="0 0 64 64" aria-hidden="true">` +
    `<circle class="tg-track" cx="32" cy="32" r="${RING_RADIUS}"></circle>` +
    `<circle class="tg-arc" id="${idBase}-arc" cx="32" cy="32" r="${RING_RADIUS}" transform="rotate(-90 32 32)" stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>` +
    `</svg>` +
    `<div class="tg-ringpct" id="${idBase}-pct">0%</div>` +
    `</div>`
  );
}

function setRing(idBase: string, pct: number, color: string): void {
  const clamped = Math.max(0, Math.min(100, pct));
  const arc = document.getElementById(idBase + '-arc');
  if (arc) {
    arc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped / 100));
    arc.style.stroke = color;
  }
  const pctEl = document.getElementById(idBase + '-pct');
  if (pctEl) pctEl.textContent = `${Math.round(clamped)}%`;
}

/** Build the static telemetry strip markup once into `host`. Content is fully static (no user
 *  data), so the innerHTML assignment is safe. */
function buildTelemetryStrip(host: HTMLElement): void {
  // eslint-disable-next-line no-unsanitized/property
  host.innerHTML =
    `<div class="tg-gauge">` +
      ringMarkup('tg-mem') +
      `<div class="tg-meta">` +
        `<div class="tg-label">Heap memory</div>` +
        `<div class="tg-value"><span id="tg-mem-used">—</span></div>` +
        `<div class="tg-sub">of <span id="tg-mem-limit">—</span> cap</div>` +
      `</div>` +
    `</div>` +
    `<div class="tg-gauge">` +
      ringMarkup('tg-cpu') +
      `<div class="tg-meta">` +
        `<div class="tg-label">Worker CPU</div>` +
        `<div class="tg-value" id="tg-cpu-load">idle</div>` +
        `<div class="tg-sub">single parse process</div>` +
      `</div>` +
    `</div>` +
    `<div class="tg-tiles">` +
      `<div class="tg-tile"><span class="tg-tile-label">Process RSS</span><span class="tg-tile-value" id="tg-rss">—</span></div>` +
      `<div class="tg-tile"><span class="tg-tile-label">Session buffers</span><span class="tg-tile-value" id="tg-buf">—</span></div>` +
      `<div class="tg-tile" id="tg-skipped-tile"><span class="tg-tile-label">Skipped</span><span class="tg-tile-value" id="tg-skipped">0</span></div>` +
    `</div>`;
}

/**
 * Render/refresh the loading-screen telemetry strip from a worker telemetry snapshot.
 * No-op if the `#loading-telemetry` host element is absent (e.g. loading UI not mounted).
 */
export function updateTelemetry(t: WorkerTelemetry): void {
  const host = document.getElementById('loading-telemetry');
  if (!host) return;
  if (!host.dataset.init) {
    host.dataset.init = '1';
    buildTelemetryStrip(host);
  }

  const memPct = t.heapLimitMB > 0 ? (t.heapUsedMB / t.heapLimitMB) * 100 : 0;
  setRing('tg-mem', memPct, pressureColor(memPct));
  setRing('tg-cpu', t.cpuPct, pressureColor(t.cpuPct));

  const set = (id: string, text: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('tg-mem-used', fmtMem(t.heapUsedMB));
  set('tg-mem-limit', fmtMem(t.heapLimitMB));
  set('tg-cpu-load', t.cpuPct >= 70 ? 'busy' : t.cpuPct >= 25 ? 'active' : 'idle');
  set('tg-rss', fmtMem(t.rssMB));
  set('tg-buf', fmtMem(t.fileBufMB));

  // Surface parse warnings: count of files that failed to parse, with skipped malformed lines as
  // secondary detail. The tile is highlighted only when something actually failed; details for
  // each failed file are written to the "AI Engineer Coach" output channel.
  const skippedFiles = t.skippedFiles ?? 0;
  const skippedLines = t.skippedLines ?? 0;
  set('tg-skipped', skippedLines > 0
    ? `${skippedFiles} file${skippedFiles === 1 ? '' : 's'} · ${skippedLines} line${skippedLines === 1 ? '' : 's'}`
    : `${skippedFiles} file${skippedFiles === 1 ? '' : 's'}`);
  const skippedTile = document.getElementById('tg-skipped-tile');
  if (skippedTile) skippedTile.classList.toggle('tg-tile-warn', skippedFiles > 0);

  host.classList.toggle('tg-pressure', memPct >= 85);
}
