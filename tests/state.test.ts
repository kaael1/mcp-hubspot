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

  it('creates pending deal, activity, and association operations', async () => {
    const state = await import('../server/state.js');
    await state.loadRuntimeState();

    const deal = await state.createOperation({
      fields: [{ label: 'Amount', name: 'amount', value: '1000' }],
      kind: 'create',
      type: 'deal',
    });
    const activity = await state.createOperation({
      activity: {
        body: 'Call the champion after procurement review.',
        target: { displayName: 'Renewal deal', type: 'deal' },
        type: 'note',
      },
      kind: 'create-activity',
      type: 'deal',
    });
    const association = await state.createOperation({
      association: {
        from: { displayName: 'Acme', type: 'company' },
        to: { displayName: 'Renewal deal', type: 'deal' },
      },
      kind: 'associate-record',
      type: 'company',
    });

    expect(deal.summary).toBe('Create deal record.');
    expect(activity.summary).toBe('Create note activity.');
    expect(association.summary).toBe('Associate Renewal deal.');
    expect(state.getContext().pendingOperations).toHaveLength(3);
  });
});
