import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type http from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HUBSPOT_BROWSER_BRIDGE_PORT = '18437';
process.env.HUBSPOT_BROWSER_DATA_DIR = mkdtempSync(join(tmpdir(), 'hubspot-browser-mcp-bridge-'));

describe('bridge commands', () => {
  let baseUrl: string;
  let key: string;
  let server: http.Server;

  beforeAll(async () => {
    const state = await import('../server/state.js');
    const bridge = await import('../server/bridge.js');
    await state.loadRuntimeState();
    key = state.getPairingKey();
    server = bridge.createBridgeServer();
    await bridge.listen(server);
    baseUrl = 'http://127.0.0.1:18437';
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const command = async <T>(name: string, body: unknown = {}) => {
    const response = await fetch(`${baseUrl}/v1/commands/${name}`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-hubspot-mcp-key': key,
      },
      method: 'POST',
    });
    expect(response.ok).toBe(true);
    return (await response.json()) as { ok: true; result: T };
  };

  it('returns the coverage matrix', async () => {
    const response = await command<{ coverage: { outOfScope: string[] } }>('get_coverage_matrix');
    expect(response.result.coverage.outOfScope).toContain('delete records');
  });

  it('creates pending activity and association operations', async () => {
    const activity = await command<{ id: string; kind: string; status: string }>('request_timeline_activity_create', {
      body: 'Bridge integration note',
      target: { displayName: 'Acme', type: 'company' },
      type: 'note',
    });
    const association = await command<{ id: string; kind: string; status: string }>('request_association_create', {
      from: { displayName: 'Acme', type: 'company' },
      to: { displayName: 'Jane Doe', type: 'contact' },
    });

    expect(activity.result.kind).toBe('create-activity');
    expect(activity.result.status).toBe('pending');
    expect(association.result.kind).toBe('associate-record');
    expect(association.result.status).toBe('pending');
  });
});
