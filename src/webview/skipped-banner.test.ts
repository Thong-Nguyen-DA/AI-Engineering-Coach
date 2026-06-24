/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @vitest-environment jsdom
 *
 * Tests for the skipped-history banner builder (issue #106): summary pluralization, markup,
 * dismiss behavior, and the "View details" callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSkippedBanner, formatSkippedSummary } from './skipped-banner';

describe('formatSkippedSummary', () => {
  it('uses singular nouns for a single file and line', () => {
    expect(formatSkippedSummary(1, 1)).toBe(
      'Some history was skipped while parsing (1 file, 1 line). Results may be incomplete.',
    );
  });

  it('uses plural nouns for multiple files and lines', () => {
    expect(formatSkippedSummary(3, 42)).toBe(
      'Some history was skipped while parsing (3 files, 42 lines). Results may be incomplete.',
    );
  });

  it('omits the line clause when no lines were skipped', () => {
    expect(formatSkippedSummary(2, 0)).toBe(
      'Some history was skipped while parsing (2 files). Results may be incomplete.',
    );
  });
});

describe('buildSkippedBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('builds an accessible status banner with the summary text', () => {
    const banner = buildSkippedBanner(3, 42, { onViewDetails: () => { /* noop */ } });

    expect(banner.id).toBe('skipped-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.querySelector('.skipped-banner-text')?.textContent).toContain('3 files, 42 lines');
  });

  it('calls onViewDetails when the details button is clicked', () => {
    const onViewDetails = vi.fn();
    const banner = buildSkippedBanner(1, 0, { onViewDetails });

    banner.querySelector<HTMLButtonElement>('.skipped-banner-link')!.click();

    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('removes itself from the DOM when dismissed', () => {
    const banner = buildSkippedBanner(1, 0, { onViewDetails: () => { /* noop */ } });
    document.body.appendChild(banner);
    expect(document.getElementById('skipped-banner')).not.toBeNull();

    banner.querySelector<HTMLButtonElement>('.skipped-banner-dismiss')!.click();

    expect(document.getElementById('skipped-banner')).toBeNull();
  });
});
