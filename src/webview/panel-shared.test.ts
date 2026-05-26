/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { escapeHtmlAttr } from './panel-shared';

describe('escapeHtmlAttr', () => {
  it('escapes all HTML-special characters', () => {
    expect(escapeHtmlAttr('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtmlAttr('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes single quotes', () => {
    expect(escapeHtmlAttr("it's")).toBe('it&#39;s');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtmlAttr('VS Code')).toBe('VS Code');
    expect(escapeHtmlAttr('Claude')).toBe('Claude');
  });

  it('handles empty string', () => {
    expect(escapeHtmlAttr('')).toBe('');
  });
});
