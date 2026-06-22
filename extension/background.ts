import { bridgeOrigin, hubspotObjectIds } from '../shared/constants.js';
import type { BrowserTask, Operation, RecordType } from '../shared/schemas.js';
import type { ContentCommand, ContentResponse, ExtensionStatus, RuntimeMessage, TaskEnvelope } from './types.js';

const STORAGE_KEY = 'hubspot-mcp-pairing-key';
const POLL_ALARM = 'hubspot-mcp-poll';
const executingOperations = new Set<string>();

const getStorage = <T = Record<string, unknown>>(keys: string[]) =>
  new Promise<T>((resolve) => chrome.storage.local.get(keys, (value) => resolve(value as T)));

const setStorage = (value: Record<string, unknown>) =>
  new Promise<void>((resolve) => chrome.storage.local.set(value, () => resolve()));

const getPairingKey = async () => {
  const storage = await getStorage<{ [STORAGE_KEY]?: string }>([STORAGE_KEY]);
  return storage[STORAGE_KEY] || '';
};

const bridgeFetch = async <T>(path: string, init: RequestInit = {}) => {
  const key = await getPairingKey();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (key) headers.set('x-hubspot-mcp-key', key);

  const response = await fetch(`${bridgeOrigin}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = (text ? JSON.parse(text) : {}) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Bridge request failed with ${response.status}`);
  return payload as T;
};

const isHubSpotUrl = (url: string | undefined) => Boolean(url && /^https?:\/\/[^/]*hubspot\.com\//i.test(url));

const queryTabs = (queryInfo: chrome.tabs.QueryInfo) =>
  new Promise<chrome.tabs.Tab[]>((resolve) => chrome.tabs.query(queryInfo, resolve));

const updateTab = (tabId: number, updateProperties: chrome.tabs.UpdateProperties) =>
  new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tab) {
        reject(new Error('Chrome did not return an updated tab.'));
        return;
      }
      resolve(tab);
    });
  });

const waitForTabComplete = (tabId: number, timeoutMs = 15_000) =>
  new Promise<void>((resolve) => {
    const timeout = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      globalThis.clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getHubSpotTab = async () => {
  const [active] = await queryTabs({ active: true, currentWindow: true });
  if (active?.id && isHubSpotUrl(active.url)) return active;

  const tabs = await queryTabs({});
  return tabs.find((tab) => tab.id && isHubSpotUrl(tab.url)) || null;
};

const ensureContentScript = async (tabId: number) => {
  try {
    await chrome.scripting.executeScript({ files: ['content.js'], target: { allFrames: true, tabId } });
  } catch {
    // The manifest-injected content script may already be present, or the tab may still be loading.
  }
};

const sendContentToFrame = async <T extends ContentResponse>(tabId: number, frameId: number, message: ContentCommand) =>
  new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('No response from HubSpot content script.'));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });

const getFrameIds = async (tabId: number) =>
  new Promise<number[]>((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError || !frames?.length) {
        resolve([0]);
        return;
      }

      resolve([...new Set([0, ...frames.map((frame) => frame.frameId)])]);
    });
  });

const sendContent = async <T extends ContentResponse>(tabId: number, message: ContentCommand) => {
  await ensureContentScript(tabId);
  const frameIds = await getFrameIds(tabId);
  const seenFrames = new Set<number>();
  let lastError: Error | null = null;

  while (frameIds.length > 0) {
    const frameId = frameIds.shift();
    if (typeof frameId !== 'number' || seenFrames.has(frameId)) continue;
    seenFrames.add(frameId);

    try {
      return await sendContentToFrame<T>(tabId, frameId, message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (message.type === 'execute_operation') {
        await sleep(900);
        await ensureContentScript(tabId);
        for (const nextFrameId of await getFrameIds(tabId)) {
          if (!seenFrames.has(nextFrameId)) frameIds.push(nextFrameId);
        }
      }
    }
  }

  throw lastError || new Error('No HubSpot frame handled the command.');
};

const sendContentAllFrames = async <T extends ContentResponse>(tabId: number, message: ContentCommand) => {
  await ensureContentScript(tabId);
  const frameIds = await getFrameIds(tabId);
  const responses: T[] = [];

  for (const frameId of frameIds) {
    try {
      responses.push(await sendContentToFrame<T>(tabId, frameId, message));
    } catch {
      // Some iframes are transient or not HubSpot app frames.
    }
  }

  return responses;
};

const detectPortalId = (url: string | undefined) => {
  if (!url) return null;
  const direct = url.match(/hubspot\.com\/(?:contacts|companies|sales|reports|settings|home|global-home)\/(\d+)/i);
  if (direct?.[1]) return direct[1];
  const objectRoute = url.match(/hubspot\.com\/contacts\/(\d+)\/objects\//i);
  return objectRoute?.[1] || null;
};

const buildListUrl = (baseUrl: string | undefined, type: RecordType, query: string) => {
  const portalId = detectPortalId(baseUrl);
  if (!portalId) return null;
  const objectId = hubspotObjectIds[type];
  return `https://app.hubspot.com/contacts/${portalId}/objects/${objectId}/views/all/list?query=${encodeURIComponent(query)}`;
};

const buildObjectListUrl = (baseUrl: string | undefined, type: RecordType) => {
  const portalId = detectPortalId(baseUrl);
  if (!portalId) return null;
  return `https://app.hubspot.com/contacts/${portalId}/objects/${hubspotObjectIds[type]}/views/all/list`;
};

const navigateAndWait = async (tabId: number, url: string) => {
  await updateTab(tabId, { active: true, url });
  await waitForTabComplete(tabId);
  await sleep(2500);
};

const captureSnapshot = async (tabId: number) => {
  const responses = await sendContentAllFrames<Extract<ContentResponse, { snapshot: unknown }>>(tabId, { type: 'capture_snapshot' });
  if (responses.length === 0) throw new Error('No HubSpot frame returned a snapshot.');
  const [primary, ...rest] = responses.sort(
    (left, right) =>
      ((right.snapshot.fields?.length || 0) + (right.snapshot.tables?.length || 0) * 10 + (right.snapshot.associations?.length || 0) * 5) -
      ((left.snapshot.fields?.length || 0) + (left.snapshot.tables?.length || 0) * 10 + (left.snapshot.associations?.length || 0) * 5),
  );
  if (!primary) throw new Error('No HubSpot frame returned a usable snapshot.');
  const snapshot = {
    ...primary.snapshot,
    associations: [...(primary.snapshot.associations || []), ...rest.flatMap((item) => item.snapshot.associations || [])],
    fields: [...primary.snapshot.fields, ...rest.flatMap((item) => item.snapshot.fields || [])],
    tables: [...(primary.snapshot.tables || []), ...rest.flatMap((item) => item.snapshot.tables || [])],
  };

  await bridgeFetch('/snapshot', {
    body: JSON.stringify(snapshot),
    method: 'POST',
  });
  return snapshot;
};

const collectResults = async (tabId: number, input: { limit?: number; query: string; type: RecordType }) => {
  const response = await sendContent<Extract<ContentResponse, { results: unknown }>>(tabId, {
    input,
    type: 'collect_results',
  });
  return response.results;
};

const executeSearchTask = async (task: BrowserTask) => {
  const tab = await getHubSpotTab();
  if (!tab?.id) throw new Error('Open a logged-in HubSpot tab before searching.');
  const input = task.input as { limit?: number; query: string; type: RecordType };
  const listUrl = buildListUrl(tab.url, input.type, input.query);
  if (listUrl) await navigateAndWait(tab.id, listUrl);
  return { results: await collectResults(tab.id, input) };
};

const executeOpenRecordTask = async (task: BrowserTask) => {
  const tab = await getHubSpotTab();
  if (!tab?.id) throw new Error('Open a logged-in HubSpot tab before opening a record.');
  const input = task.input as { query?: string; record?: { url?: string; type: RecordType }; type?: RecordType; url?: string };
  const directUrl = input.url || input.record?.url;

  if (directUrl) {
    await navigateAndWait(tab.id, directUrl);
    return { snapshot: await captureSnapshot(tab.id) };
  }

  if (input.query && input.type) {
    const results = (await executeSearchTask({
      ...task,
      input: {
        limit: 1,
        query: input.query,
        type: input.type,
      },
    })) as { results: Array<{ url?: string }> };
    const firstUrl = results.results[0]?.url;
    if (!firstUrl) throw new Error(`No ${input.type} record found for "${input.query}".`);
    await navigateAndWait(tab.id, firstUrl);
    return { snapshot: await captureSnapshot(tab.id) };
  }

  throw new Error('Open record requires a URL, record URL, or query with type.');
};

const executeBrowserTask = async (task: BrowserTask) => {
  if (task.type === 'capture_snapshot') {
    const tab = await getHubSpotTab();
    if (!tab?.id) throw new Error('Open a logged-in HubSpot tab before capturing a snapshot.');
    return { snapshot: await captureSnapshot(tab.id) };
  }

  if (task.type === 'search_records') return executeSearchTask(task);
  if (task.type === 'open_record') return executeOpenRecordTask(task);
  throw new Error(`Unsupported task: ${task.type}`);
};

const pollOnce = async () => {
  let envelope: TaskEnvelope;
  try {
    envelope = await bridgeFetch<TaskEnvelope>('/tasks/next');
  } catch {
    return;
  }

  if (!envelope.task) return;

  try {
    const result = await executeBrowserTask(envelope.task);
    await bridgeFetch(`/tasks/${envelope.task.id}/result`, {
      body: JSON.stringify({ result, status: 'succeeded' }),
      method: 'POST',
    });
  } catch (error) {
    await bridgeFetch(`/tasks/${envelope.task.id}/result`, {
      body: JSON.stringify({ error: error instanceof Error ? error.message : String(error), status: 'failed' }),
      method: 'POST',
    }).catch(() => undefined);
  }
};

const runAutopilotOnce = async () => {
  let contextPayload: { context?: { pendingOperations?: Operation[]; settings?: { autopilot?: { enabled?: boolean } } } };
  try {
    contextPayload = await bridgeFetch('/context');
  } catch {
    return;
  }

  if (!contextPayload.context?.settings?.autopilot?.enabled) return;

  for (const operation of contextPayload.context.pendingOperations || []) {
    if (!['pending', 'approved'].includes(operation.status)) continue;
    if (executingOperations.has(operation.id)) continue;

    executingOperations.add(operation.id);
    void (async () => {
      try {
        const approved =
          operation.status === 'pending'
            ? (await bridgeFetch<{ operation: Operation }>(`/operations/${operation.id}/approve`, { method: 'POST' })).operation
            : operation;
        await executeApprovedOperation(approved);
      } finally {
        executingOperations.delete(operation.id);
      }
    })();
  }
};

const executeOneOperation = async (operation: Operation) => {
  const tab = await getHubSpotTab();
  if (!tab?.id) throw new Error('Open a logged-in HubSpot tab before approving an operation.');
  if (operation.kind === 'create') {
    const listUrl = buildObjectListUrl(tab.url, operation.type);
    if (listUrl) await navigateAndWait(tab.id, listUrl);
  }
  if (operation.target?.url) await navigateAndWait(tab.id, operation.target.url);
  const response = await sendContent<Extract<ContentResponse, { status: 'paused' | 'succeeded' }>>(tab.id, {
    operation,
    type: 'execute_operation',
  });
  return response;
};

const executeApprovedOperation = async (operation: Operation) => {
  await bridgeFetch(`/operations/${operation.id}/running`, { method: 'POST' });

  try {
    if (operation.kind === 'create-associated-contacts') {
      const itemResults = [];
      for (const contactCreate of operation.contactCreates || []) {
        const associationFields = operation.company?.displayName
          ? [
              {
                label: 'Empresa',
                name: 'company',
                value: operation.company.displayName,
              },
              {
                label: 'Nome da empresa',
                name: 'associatedcompany',
                value: operation.company.displayName,
              },
            ]
          : [];
        const itemOperation: Operation = {
          ...operation,
          fields: [...contactCreate.fields, ...associationFields],
          kind: 'create',
          type: 'contact',
        };

        try {
          const result = await executeOneOperation(itemOperation);
          itemResults.push({ status: result.status === 'succeeded' ? 'succeeded' : 'paused' });
        } catch (error) {
          itemResults.push({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed',
          });
        }
      }

      await bridgeFetch(`/operations/${operation.id}/result`, {
        body: JSON.stringify({
          itemResults,
          status: itemResults.every((item) => item.status === 'succeeded') ? 'succeeded' : 'paused',
        }),
        method: 'POST',
      });
      return;
    }

    if (operation.kind !== 'batch-update') {
      const result = await executeOneOperation(operation);
      await bridgeFetch(`/operations/${operation.id}/result`, {
        body: JSON.stringify({
          result: result.result,
          status: result.status,
        }),
        method: 'POST',
      });
      return;
    }

    const itemResults = [];
    for (const item of operation.items || []) {
      try {
        const itemOperation: Operation = {
          ...operation,
          fields: item.fields,
          kind: 'update',
          target: item.target,
        };
        const result = await executeOneOperation(itemOperation);
        itemResults.push({ record: item.target, status: result.status === 'succeeded' ? 'succeeded' : 'paused' });
      } catch (error) {
        itemResults.push({
          error: error instanceof Error ? error.message : String(error),
          record: item.target,
          status: 'failed',
        });
      }
    }

    await bridgeFetch(`/operations/${operation.id}/result`, {
      body: JSON.stringify({
        itemResults,
        status: itemResults.every((item) => item.status === 'succeeded') ? 'succeeded' : 'paused',
      }),
      method: 'POST',
    });
  } catch (error) {
    await bridgeFetch(`/operations/${operation.id}/result`, {
      body: JSON.stringify({ error: error instanceof Error ? error.message : String(error), status: 'failed' }),
      method: 'POST',
    });
  }
};

const pair = async (key: string) => {
  const response = await fetch(`${bridgeOrigin}/pair`, {
    body: JSON.stringify({ extensionId: chrome.runtime.id, key, version: chrome.runtime.getManifest().version }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Pairing failed with ${response.status}`);
  await setStorage({ [STORAGE_KEY]: key });
  await pollOnce();
  return body;
};

const getStatus = async (): Promise<ExtensionStatus> => {
  const key = await getPairingKey();
  try {
    const health = await fetch(`${bridgeOrigin}/health`);
    const body = (await health.json()) as {
      context?: {
        latestSnapshot?: unknown;
        pendingOperations?: Operation[];
        settings?: { autopilot?: { enabled?: boolean } };
      };
      paired?: boolean;
    };
    return {
      autopilotEnabled: Boolean(body.context?.settings?.autopilot?.enabled),
      bridgeOk: health.ok,
      hasKey: Boolean(key),
      lastSnapshot: (body.context?.latestSnapshot as ExtensionStatus['lastSnapshot']) || null,
      paired: Boolean(body.paired),
      pendingOperations: body.context?.pendingOperations || [],
    };
  } catch (error) {
    return {
      autopilotEnabled: false,
      bridgeOk: false,
      error: error instanceof Error ? error.message : String(error),
      hasKey: Boolean(key),
      paired: false,
      pendingOperations: [],
    };
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.05 });
  chrome.sidePanel?.setOptions({ enabled: true, path: 'sidepanel.html' });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.05 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  void pollOnce().then(() => runAutopilotOnce());
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  const run = async () => {
    if (message.type === 'pair') return pair(message.key);
    if (message.type === 'get-status') return getStatus();
    if (message.type === 'approve-operation') {
      const response = await bridgeFetch<{ operation: Operation }>(`/operations/${message.operationId}/approve`, { method: 'POST' });
      void executeApprovedOperation(response.operation);
      return { ok: true };
    }
    if (message.type === 'reject-operation') {
      return bridgeFetch(`/operations/${message.operationId}/reject`, { method: 'POST' });
    }
    if (message.type === 'set-autopilot') {
      return bridgeFetch('/settings/autopilot', {
        body: JSON.stringify({ enabled: message.enabled }),
        method: 'POST',
      });
    }
    if (message.type === 'open-side-panel') {
      await chrome.sidePanel.open({ windowId: sender.tab?.windowId || chrome.windows.WINDOW_ID_CURRENT });
      return { ok: true };
    }
    return { error: 'Unknown runtime message.' };
  };

  run()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});

void pollOnce().then(() => runAutopilotOnce());
