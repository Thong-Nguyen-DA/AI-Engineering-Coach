/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Skipped-history banner (issue #106).
 *
 * When some session files fail to parse, the webview shows a compact, dismissible notice above
 * the page so the partial result is discoverable. Extracted from app.ts as a pure DOM builder so
 * the markup, pluralization, dismiss, and "View details" wiring are unit-testable in jsdom
 * without app.ts's load-time side effects.
 */

export interface SkippedBannerHandlers {
  /** Invoked when the user clicks "View details" (app wires this to reveal the output channel). */
  onViewDetails: () => void;
}

/** Human-readable summary of how much history was skipped, with correct singular/plural. */
export function formatSkippedSummary(skippedFiles: number, skippedLines: number): string {
  const fileLabel = `${skippedFiles} file${skippedFiles === 1 ? '' : 's'}`;
  const lineLabel = skippedLines > 0 ? `, ${skippedLines} line${skippedLines === 1 ? '' : 's'}` : '';
  return `Some history was skipped while parsing (${fileLabel}${lineLabel}). Results may be incomplete.`;
}

/**
 * Build the skipped-history banner element. The dismiss button removes the banner; "View details"
 * calls `handlers.onViewDetails`. The caller is responsible for inserting it into the document.
 */
export function buildSkippedBanner(
  skippedFiles: number,
  skippedLines: number,
  handlers: SkippedBannerHandlers,
): HTMLElement {
  const banner = document.createElement('div');
  banner.id = 'skipped-banner';
  banner.className = 'skipped-banner';
  banner.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'skipped-banner-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠';

  const text = document.createElement('span');
  text.className = 'skipped-banner-text';
  text.textContent = formatSkippedSummary(skippedFiles, skippedLines);

  const details = document.createElement('button');
  details.className = 'skipped-banner-link';
  details.type = 'button';
  details.textContent = 'View details';
  details.addEventListener('click', () => handlers.onViewDetails());

  const dismiss = document.createElement('button');
  dismiss.className = 'skipped-banner-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => banner.remove());

  banner.append(icon, text, details, dismiss);
  return banner;
}
