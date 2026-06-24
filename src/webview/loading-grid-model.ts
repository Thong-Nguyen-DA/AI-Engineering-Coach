/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Pure visual-model helpers for the loading-screen workspace grid. No DOM / vscode access;
 * extracted from app.ts so the percentile/intensity/tile math is unit-testable. */


export interface WorkspacePlanMeta {
  key: string;
  order: number;
  date: string | null;
  month: string;
  workspace: string;
  workspaceKey: string;
  size: number;
}

/** Compact a running stat count for the loading ticker: 1.2M / 47K / 938. */
export function formatStatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export interface GridDimensions {
  rows: number;
  cols: number;
  size: number;
}

/** Compute the background tile grid layout for `n` cells inside a `width`×`height` viewport.
 * Rows/cols are chosen proportional to the viewport aspect ratio; cell size fills ~60% of the
 * available stride and is clamped to 2–16px. Returns `null` when there is nothing to lay out or
 * the viewport is too small to be meaningful (mirrors the previous inline early-return guard). */
export function computeGridDimensions(n: number, width: number, height: number): GridDimensions | null {
  if (n === 0 || width < 20 || height < 20) return null;
  const aspect = width / height;
  const rows = Math.max(1, Math.ceil(Math.sqrt(n / aspect)));
  const cols = Math.max(1, Math.ceil(n / rows));
  const stride = Math.min(width / cols, height / rows);
  const size = Math.max(2, Math.min(16, Math.floor(stride * 0.6)));
  return { rows, cols, size };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function sessionIntensityLevel(size: number, breakpoints: { q25: number; q50: number; q75: number }): 1 | 2 | 3 | 4 {
  if (size >= breakpoints.q75 && breakpoints.q75 > 0) return 4;
  if (size >= breakpoints.q50 && breakpoints.q50 > 0) return 3;
  if (size >= breakpoints.q25 && breakpoints.q25 > 0) return 2;
  return 1;
}

export function sessionTileVars(level: 1 | 2 | 3 | 4): { pendingBg: string; pendingBorder: string; doneBg: string; doneBorder: string; doneGlow: string } {
  const strengths = {
    1: { pending: 6, border: 14, done: 35, glow: 18 },
    2: { pending: 9, border: 18, done: 48, glow: 24 },
    3: { pending: 12, border: 24, done: 62, glow: 30 },
    4: { pending: 16, border: 30, done: 78, glow: 38 },
  }[level];

  return {
    pendingBg: `color-mix(in srgb, var(--accent-blue) ${strengths.pending}%, var(--vscode-editor-background, #1e1e1e))`,
    pendingBorder: `color-mix(in srgb, var(--accent-blue) ${strengths.border}%, var(--border))`,
    doneBg: `color-mix(in srgb, var(--vscode-progressBar-background, var(--accent-blue)) ${strengths.done}%, var(--vscode-editor-background, #1e1e1e))`,
    doneBorder: `color-mix(in srgb, var(--vscode-progressBar-background, var(--accent-blue)) ${Math.min(90, strengths.done + 8)}%, var(--border))`,
    doneGlow: `color-mix(in srgb, var(--vscode-progressBar-background, var(--accent-blue)) ${strengths.glow}%, transparent)`,
  };
}

export function parseWorkspacePlanKey(key: string, fallbackOrder: number): WorkspacePlanMeta {
  try {
    const parsed = JSON.parse(key) as { order?: number; date?: string | null; wsId?: string; workspaceKey?: string; size?: number };
    const order = typeof parsed.order === 'number' ? parsed.order : fallbackOrder;
    const date = typeof parsed.date === 'string' ? parsed.date : null;
    return {
      key,
      order,
      date,
      month: date ? date.slice(0, 7) : `chunk-${Math.floor(fallbackOrder / 28)}`,
      workspace: typeof parsed.wsId === 'string' && parsed.wsId.length > 0 ? parsed.wsId : `Workspace ${fallbackOrder + 1}`,
      workspaceKey: typeof parsed.workspaceKey === 'string' && parsed.workspaceKey.length > 0 ? parsed.workspaceKey : `workspace-${fallbackOrder}`,
      size: typeof parsed.size === 'number' ? parsed.size : 0,
    };
  } catch {
    return {
      key,
      order: fallbackOrder,
      date: null,
      month: `chunk-${Math.floor(fallbackOrder / 28)}`,
      workspace: `Workspace ${fallbackOrder + 1}`,
      workspaceKey: `workspace-${fallbackOrder}`,
      size: 0,
    };
  }
}
