import { describe, expect, it } from 'vitest';

import { redact, redactString } from '../shared/redaction.js';

describe('redaction', () => {
  it('removes bearer-like strings', () => {
    expect(redactString('Bearer abc.def.ghi')).not.toContain('Bearer abc');
  });

  it('redacts sensitive object keys recursively', () => {
    expect(
      redact({
        nested: {
          sessionToken: 'secret',
        },
        visible: 'ok',
      }),
    ).toEqual({
      nested: {
        sessionToken: '[REDACTED]',
      },
      visible: 'ok',
    });
  });
});
