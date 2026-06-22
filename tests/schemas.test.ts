import { describe, expect, it } from 'vitest';

import {
  operationSchema,
  pageSnapshotSchema,
  requestAssociatedContactsCreateInputSchema,
  requestBatchUpdateInputSchema,
  requestRecordFillInputSchema,
  requestRecordCreateInputSchema,
  searchRecordsInputSchema,
} from '../shared/schemas.js';

describe('shared schemas', () => {
  it('accepts a valid contact search', () => {
    expect(searchRecordsInputSchema.parse({ query: 'Acme', type: 'contact' })).toEqual({
      query: 'Acme',
      type: 'contact',
    });
  });

  it('limits batch updates to 25 items', () => {
    const items = Array.from({ length: 26 }, (_, index) => ({
      fields: [{ name: 'firstname', value: `Test ${index}` }],
      target: { type: 'contact' as const, url: `https://app.hubspot.com/contacts/1/record/0-1/${index}` },
    }));

    expect(() => requestBatchUpdateInputSchema.parse({ items, type: 'contact' })).toThrow();
  });

  it('requires fields for create operations', () => {
    expect(() => requestRecordCreateInputSchema.parse({ fields: [], type: 'company' })).toThrow();
  });

  it('accepts fill-only requests', () => {
    expect(
      requestRecordFillInputSchema.parse({
        fields: [{ name: 'phone', value: '+55 11 99999-0000' }],
        target: { type: 'contact' },
      }).fields[0]?.name,
    ).toBe('phone');
  });

  it('accepts associated contact creation batches', () => {
    expect(
      requestAssociatedContactsCreateInputSchema.parse({
        company: { displayName: 'Codex MCP Test', type: 'company' },
        contacts: [
          {
            fields: [
              { name: 'firstname', value: 'Codex' },
              { name: 'email', value: 'codex@example.com' },
            ],
          },
        ],
      }).contacts,
    ).toHaveLength(1);
  });

  it('captures tables and associations in snapshots', () => {
    expect(
      pageSnapshotSchema.parse({
        associations: [{ displayName: 'Jane Doe', type: 'contact', url: 'https://app.hubspot.com/contacts/1/record/0-1/2' }],
        capturedAt: '2026-06-22T00:00:00.000Z',
        fields: [],
        tables: [{ columns: ['Name'], rows: [{ Name: 'Acme' }] }],
        title: 'Companies',
        url: 'https://app.hubspot.com/contacts/1/objects/0-2/views/all/list',
      }).tables?.[0]?.rows[0]?.Name,
    ).toBe('Acme');
  });

  it('allows skipped item results for partially completed batches', () => {
    expect(
      operationSchema.parse({
        createdAt: '2026-06-22T00:00:00.000Z',
        id: 'op_1',
        itemResults: [{ status: 'skipped' }],
        kind: 'batch-update',
        risk: 'batch',
        status: 'paused',
        summary: 'Batch update 1 contact record(s).',
        type: 'contact',
        updatedAt: '2026-06-22T00:00:00.000Z',
      }).itemResults?.[0]?.status,
    ).toBe('skipped');
  });
});
