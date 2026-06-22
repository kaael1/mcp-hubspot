import { describe, expect, it } from 'vitest';

import {
  operationSchema,
  pageSnapshotSchema,
  requestAssociationCreateInputSchema,
  requestAssociatedContactsCreateInputSchema,
  requestBatchUpdateInputSchema,
  requestRecordFillInputSchema,
  requestRecordCreateInputSchema,
  requestTimelineActivityCreateInputSchema,
  searchRecordsInputSchema,
} from '../shared/schemas.js';

describe('shared schemas', () => {
  it('accepts a valid contact search', () => {
    expect(searchRecordsInputSchema.parse({ query: 'Acme', type: 'contact' })).toEqual({
      query: 'Acme',
      type: 'contact',
    });
  });

  it('accepts deals, tickets, and custom object searches', () => {
    expect(searchRecordsInputSchema.parse({ query: 'Renewal', type: 'deal' }).type).toBe('deal');
    expect(searchRecordsInputSchema.parse({ query: 'Support', type: 'ticket' }).type).toBe('ticket');
    expect(searchRecordsInputSchema.parse({ objectId: '2-123456', objectLabel: 'Subscription', query: 'Gold', type: 'custom' }).objectId).toBe(
      '2-123456',
    );
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
        timeline: [{ body: 'Called Jane about renewal', title: 'Call', type: 'call' }],
        title: 'Companies',
        url: 'https://app.hubspot.com/contacts/1/objects/0-2/views/all/list',
      }).tables?.[0]?.rows[0]?.Name,
    ).toBe('Acme');
  });

  it('accepts timeline activity creation requests', () => {
    expect(
      requestTimelineActivityCreateInputSchema.parse({
        body: 'Follow up next week',
        target: { type: 'deal', url: 'https://app.hubspot.com/contacts/1/record/0-3/99' },
        title: 'Follow-up',
        type: 'task',
      }).target?.type,
    ).toBe('deal');
  });

  it('accepts association creation requests', () => {
    expect(
      requestAssociationCreateInputSchema.parse({
        from: { displayName: 'Acme', type: 'company' },
        to: { displayName: 'Renewal deal', type: 'deal' },
      }).to.type,
    ).toBe('deal');
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

  it('allows activity and association operations', () => {
    expect(
      operationSchema.parse({
        activity: { body: 'Decision maker confirmed', type: 'note' },
        createdAt: '2026-06-22T00:00:00.000Z',
        id: 'op_activity',
        kind: 'create-activity',
        risk: 'write',
        status: 'pending',
        summary: 'Create note activity.',
        type: 'company',
        updatedAt: '2026-06-22T00:00:00.000Z',
      }).kind,
    ).toBe('create-activity');

    expect(
      operationSchema.parse({
        association: { to: { displayName: 'Jane Doe', type: 'contact' } },
        createdAt: '2026-06-22T00:00:00.000Z',
        id: 'op_association',
        kind: 'associate-record',
        risk: 'write',
        status: 'pending',
        summary: 'Associate Jane Doe.',
        type: 'company',
        updatedAt: '2026-06-22T00:00:00.000Z',
      }).kind,
    ).toBe('associate-record');
  });
});
