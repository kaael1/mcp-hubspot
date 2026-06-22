import { describe, expect, it } from 'vitest';

import { coverageMatrix } from '../shared/coverage.js';

describe('coverage matrix', () => {
  it('states supported, experimental, and out-of-scope areas', () => {
    expect(coverageMatrix.supported.some((item) => [...item.details].includes('deals'))).toBe(true);
    expect(coverageMatrix.supported.some((item) => [...item.details].includes('tickets'))).toBe(true);
    expect(coverageMatrix.experimental.some((item) => item.area === 'Timeline activities')).toBe(true);
    expect(coverageMatrix.outOfScope).toContain('delete records');
    expect(coverageMatrix.outOfScope).toContain('private app/OAuth/API-token management');
  });
});
