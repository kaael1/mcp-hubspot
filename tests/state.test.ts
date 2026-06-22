import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

describe('runtime state', () => {
  beforeEach(() => {
    process.env.HUBSPOT_BROWSER_DATA_DIR = mkdtempSync(join(tmpdir(), 'hubspot-browser-mcp-'));
  });

  it('creates pending operations that require approval', async () => {
    const state = await import('../server/state.js');
    await state.loadRuntimeState();

    const operation = await state.createOperation({
      fields: [{ label: 'Lifecycle stage', name: 'lifecyclestage', value: 'Lead' }],
      kind: 'update',
      target: { displayName: 'Test Contact', type: 'contact' },
      type: 'contact',
    });

    expect(operation.status).toBe('pending');
    expect(state.getContext().pendingOperations).toHaveLength(1);

    const approved = await state.approveOperation(operation.id);
    expect(approved.status).toBe('approved');
  });
});
