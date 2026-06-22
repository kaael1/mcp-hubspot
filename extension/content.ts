import type {
  ActivityType,
  AssociationSnapshot,
  FieldPatch,
  FieldSnapshot,
  Operation,
  PageSnapshot,
  RecordType,
  SearchResult,
  TableSnapshot,
} from '../shared/schemas.js';
import { hubspotObjectIds, hubspotObjectLabels } from '../shared/constants.js';
import type { ContentCommand, ContentResponse } from './types.js';

const text = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();

const visibleText = (element: Element | null | undefined) => text(element?.textContent || '');

const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
};

const objectIdToRecordType = Object.fromEntries(
  Object.entries(hubspotObjectIds).map(([recordType, objectId]) => [objectId, recordType]),
) as Record<string, Exclude<RecordType, 'custom'>>;

const getObjectId = (type: RecordType, objectId?: string) => (type === 'custom' ? objectId : hubspotObjectIds[type]);

const detectObjectId = (url = window.location.href) => {
  const route = url.match(/\/(?:record|objects)\/([^/?#]+)(?:[/?#]|$)/i);
  if (!route?.[1] || /^views$/i.test(route[1])) return undefined;
  return decodeURIComponent(route[1]);
};

const detectRecordType = (url = window.location.href): RecordType | undefined => {
  const objectId = detectObjectId(url);
  if (objectId) return objectIdToRecordType[objectId] || 'custom';
  if (/\/companies(?:\/|$)/i.test(url)) return 'company';
  if (/\/contacts(?:\/|$)/i.test(url)) return 'contact';
  if (/\/deals(?:\/|$)/i.test(url)) return 'deal';
  if (/\/tickets(?:\/|$)/i.test(url)) return 'ticket';
  return undefined;
};

const detectRecordId = (url = window.location.href) => {
  const objectMatch = url.match(/\/(?:record|objects)\/([^/?#]+)\/(?!views(?:\/|$))([^/?#]+)/i);
  if (objectMatch?.[2]) return decodeURIComponent(objectMatch[2]);
  const legacyMatch = url.match(/\/(?:contact|company|deal|ticket)\/(\d+)/i);
  return legacyMatch?.[1] ? decodeURIComponent(legacyMatch[1]) : undefined;
};

const getDisplayName = () =>
  text(
    document.querySelector('h1')?.textContent ||
      document.querySelector('[data-test-id*="record"] h1')?.textContent ||
      document.querySelector('[data-selenium-test*="record"] h1')?.textContent ||
      document.title,
  );

const collectLabelFields = () => {
  const fields: FieldSnapshot[] = [];
  const labels = [...document.querySelectorAll('label')].filter(isVisible);

  for (const label of labels.slice(0, 80)) {
    const labelText = visibleText(label);
    if (!labelText || labelText.length > 80) continue;

    const forId = label.getAttribute('for');
    const input = forId ? document.getElementById(forId) : label.parentElement?.querySelector('input, textarea, [role="textbox"], select');
    const value =
      input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement
        ? input.value
        : visibleText(input);

    fields.push({
      label: labelText,
      name: forId || labelText.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      value,
    });
  }

  return fields;
};

const collectPropertyLikeFields = () => {
  const fields: FieldSnapshot[] = [];
  const candidates = [
    ...document.querySelectorAll('[data-test-id*="property"], [data-selenium-test*="property"], [class*="property"]'),
  ].filter(isVisible);

  for (const candidate of candidates.slice(0, 120)) {
    const parts = [...candidate.querySelectorAll('span, div, button')].map(visibleText).filter(Boolean);
    if (parts.length < 2) continue;

    const [label, ...rest] = parts;
    const value = rest.find((part) => part !== label && part.length < 300);
    if (!label || !value || label.length > 80) continue;

    fields.push({
      label,
      name: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      value,
    });
  }

  return fields;
};

const dedupeFields = (fields: FieldSnapshot[]) => {
  const byKey = new Map<string, FieldSnapshot>();

  for (const field of fields) {
    const key = `${field.name || field.label}:${field.value}`;
    if (!byKey.has(key)) byKey.set(key, field);
  }

  return [...byKey.values()].slice(0, 120);
};

const collectTables = (): TableSnapshot[] => {
  const tables: TableSnapshot[] = [];

  for (const table of [...document.querySelectorAll('table')].filter(isVisible).slice(0, 4)) {
    const columns = [...table.querySelectorAll('thead th, [role="columnheader"]')]
      .map(visibleText)
      .filter(Boolean)
      .slice(0, 20);

    if (columns.length === 0) continue;

    const rows = [...table.querySelectorAll('tbody tr, [role="row"]')]
      .filter((row) => isVisible(row) && row.querySelectorAll('td, [role="cell"]').length > 0)
      .slice(0, 50)
      .map((row) => {
        const cells = [...row.querySelectorAll('td, [role="cell"]')].map(visibleText);
        return Object.fromEntries(columns.map((column, index) => [column, cells[index] || '']));
      });

    if (rows.length > 0) {
      tables.push({
        columns,
        rows,
        title: visibleText(table.closest('section, article, [data-test-id], [data-testid]')?.querySelector('h1, h2, h3')) || undefined,
      });
    }
  }

  return tables;
};

const collectAssociations = (): AssociationSnapshot[] => {
  const associations: AssociationSnapshot[] = [];
  const seen = new Set<string>();

  for (const anchor of [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(isVisible).slice(0, 250)) {
    const href = anchor.href;
    const type = detectRecordType(href);
    if (!type || !/\/(?:record|objects)\/[^/]+\/(?!views(?:\/|$))[^/?#]+/i.test(href)) continue;

    const displayName = visibleText(anchor);
    if (!displayName || seen.has(href)) continue;
    seen.add(href);
    associations.push({
      displayName,
      objectId: detectObjectId(href),
      recordId: detectRecordId(href),
      type,
      url: href,
    });
  }

  return associations.slice(0, 80);
};

const detectActivityType = (value: string): ActivityType | undefined => {
  if (/(^|\b)(note|nota|anotação|anotacao)(\b|$)/i.test(value)) return 'note';
  if (/(^|\b)(task|tarefa)(\b|$)/i.test(value)) return 'task';
  if (/(^|\b)(call|chamada|ligação|ligacao)(\b|$)/i.test(value)) return 'call';
  if (/(^|\b)(meeting|reunião|reuniao)(\b|$)/i.test(value)) return 'meeting';
  if (/(^|\b)(email|e-mail)(\b|$)/i.test(value)) return 'email';
  return undefined;
};

const collectTimeline = () => {
  const containers = [
    ...document.querySelectorAll<HTMLElement>(
      [
        '[data-test-id*="timeline"]',
        '[data-testid*="timeline"]',
        '[data-selenium-test*="timeline"]',
        '[aria-label*="Activity"]',
        '[aria-label*="Atividade"]',
        '[class*="timeline"]',
        '[class*="Timeline"]',
      ].join(', '),
    ),
  ].filter(isVisible);

  const candidates = (
    containers.length > 0
      ? containers.flatMap((container) => [
          ...container.querySelectorAll<HTMLElement>(
            'article, li, section, [role="listitem"], [data-test-id*="activity"], [data-testid*="activity"]',
          ),
        ])
      : [
          ...document.querySelectorAll<HTMLElement>(
            'article, li, section, [role="listitem"], [data-test-id*="activity"], [data-testid*="activity"]',
          ),
        ]
  ).filter(isVisible);

  const seen = new Set<string>();
  return candidates
    .map((candidate) => {
      const fullText = visibleText(candidate);
      if (!fullText || fullText.length < 8 || fullText.length > 2000) return null;
      const title =
        visibleText(candidate.querySelector('h1, h2, h3, h4, strong, [data-test-id*="title"], [data-testid*="title"]')) ||
        fullText.slice(0, 120);
      const key = `${title}:${fullText.slice(0, 200)}`;
      if (seen.has(key)) return null;
      seen.add(key);

      const link = candidate.querySelector<HTMLAnchorElement>('a[href]');
      const timeText =
        candidate.querySelector<HTMLTimeElement>('time')?.dateTime ||
        visibleText(candidate.querySelector('time, [datetime], [data-test-id*="date"], [data-testid*="date"]'));

      return {
        actor: visibleText(candidate.querySelector('[data-test-id*="user"], [data-testid*="user"], [class*="user"], [class*="User"]')) || undefined,
        at: timeText || undefined,
        body: fullText === title ? undefined : fullText.slice(0, 1000),
        title,
        type: detectActivityType(fullText),
        url: link?.href,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 40);
};

const captureSnapshot = (): PageSnapshot => ({
  associations: collectAssociations(),
  capturedAt: new Date().toISOString(),
  displayName: getDisplayName() || undefined,
  fields: dedupeFields([...collectLabelFields(), ...collectPropertyLikeFields()]),
  recordId: detectRecordId(),
  recordType: detectRecordType(),
  tables: collectTables(),
  timeline: collectTimeline(),
  title: document.title,
  url: window.location.href,
});

const collectResults = ({
  limit = 25,
  objectId,
  objectLabel,
  query,
  type,
}: {
  limit?: number;
  objectId?: string;
  objectLabel?: string;
  query: string;
  type: RecordType;
}) => {
  const normalizedQuery = query.toLowerCase();
  const resolvedObjectId = getObjectId(type, objectId);
  const labels =
    type === 'custom'
      ? [objectLabel, objectId].filter(Boolean).map(String)
      : [...hubspotObjectLabels[type].singular, ...hubspotObjectLabels[type].plural];
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(isVisible);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    const href = anchor.href;
    const label = visibleText(anchor);
    const haystack = `${label} ${href}`.toLowerCase();
    const isTargetObject =
      (resolvedObjectId && href.includes(resolvedObjectId)) ||
      labels.some((part) => part && href.toLowerCase().includes(part.toLowerCase())) ||
      (type === 'custom' && /\/(?:record|objects)\/[^/]+\/(?!views(?:\/|$))[^/?#]+/i.test(href));
    if (!isTargetObject) continue;
    if (normalizedQuery && !haystack.includes(normalizedQuery)) continue;
    if (!label || seen.has(href)) continue;

    seen.add(href);
    results.push({
      description: visibleText(anchor.closest('tr, [role="row"], li, div')),
      displayName: label,
      id: detectRecordId(href),
      objectId: detectObjectId(href) || resolvedObjectId,
      type,
      url: href,
    });

    if (results.length >= limit) break;
  }

  return results;
};

const findButton = (patterns: RegExp[]) =>
  [...document.querySelectorAll<HTMLButtonElement>('button, [role="button"], input[type="button"], input[type="submit"]')]
    .filter(isVisible)
    .find((button) => patterns.some((pattern) => pattern.test(visibleText(button) || button.getAttribute('value') || '')));

const findMenuButton = (patterns: RegExp[]) => {
  const candidates = [...document.querySelectorAll<HTMLButtonElement>('button, [role="button"]')]
    .filter(isVisible)
    .filter((button) => patterns.some((pattern) => pattern.test(visibleText(button))));

  return (
    candidates.find((button) => button.closest('ul, ol, [role="menu"], [role="list"], [data-test-id*="dropdown"]')) ||
    candidates[candidates.length - 1] ||
    null
  );
};

const findInputForField = (field: FieldPatch) => {
  const aliases: Record<string, string[]> = {
    amount: ['amount', 'valor'],
    closedate: ['close date', 'data de fechamento', 'data de fecho'],
    company: ['company', 'empresa'],
    content: ['content', 'body', 'conteúdo', 'conteudo', 'descrição', 'descricao'],
    domain: ['domain', 'domínio', 'dominio', 'company domain name', 'domínio da empresa', 'dominio da empresa'],
    dealname: ['deal name', 'nome do negócio', 'nome do negocio', 'negócio', 'negocio'],
    dealstage: ['deal stage', 'stage', 'etapa', 'fase'],
    description: ['description', 'descrição', 'descricao'],
    duedate: ['due date', 'data de vencimento', 'vencimento'],
    email: ['email', 'e-mail'],
    firstname: ['first name', 'firstname', 'nome'],
    hs_pipeline: ['pipeline', 'funil'],
    hs_pipeline_stage: ['pipeline stage', 'status', 'etapa', 'fase'],
    hubspot_owner_id: ['owner', 'proprietário', 'proprietario', 'responsável', 'responsavel'],
    jobtitle: ['job title', 'cargo'],
    lastname: ['last name', 'lastname', 'sobrenome'],
    lifecyclestage: ['lifecycle stage', 'estágio do ciclo de vida', 'estagio do ciclo de vida'],
    name: ['name', 'nome', 'company name', 'nome da empresa'],
    phone: ['phone', 'telefone'],
    pipeline: ['pipeline', 'funil'],
    source_type: ['source', 'fonte'],
    subject: ['subject', 'assunto', 'titulo', 'título'],
    ticketname: ['ticket name', 'nome do ticket', 'assunto'],
    ticketstage: ['ticket status', 'status do ticket', 'status'],
    website: ['website', 'site'],
  };
  const wanted = [field.name, field.label, ...(aliases[field.name.toLowerCase()] || [])]
    .filter(Boolean)
    .map((part) => String(part).toLowerCase());
  const controls = [
    ...document.querySelectorAll<HTMLElement>(
      [
        'input',
        'textarea',
        'select',
        '[role="textbox"]',
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '[contenteditable="true"]',
        '[data-test-id*="property"] button',
        '[data-testid*="property"] button',
      ].join(', '),
    ),
  ].filter(isVisible);

  for (const control of controls) {
    const id = control.id;
    const name = control.getAttribute('name') || '';
    const placeholder = control.getAttribute('placeholder') || '';
    const aria = control.getAttribute('aria-label') || '';
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const nearbyText = visibleText(control.closest('[class*="Form"], [class*="field"], [data-test-id], [data-testid], div'));
    const haystack = `${id} ${name} ${placeholder} ${aria} ${visibleText(label)} ${nearbyText}`.toLowerCase();
    if (wanted.some((part) => part && haystack.includes(part))) return control;
  }

  return null;
};

const dispatchFieldEvents = (control: HTMLElement) => {
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
};

const setNativeValue = (control: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  control.focus();
  if (valueSetter) valueSetter.call(control, value);
  else control.value = value;
  dispatchFieldEvents(control);
};

const clickMatchingOption = async (value: string) => {
  await wait(500);
  const normalizedValue = value.toLowerCase();
  const options = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="option"], [role="menuitem"], [data-test-id*="option"], [data-testid*="option"], li, button',
    ),
  ].filter(isVisible);
  const exact = options.find((option) => visibleText(option).toLowerCase() === normalizedValue);
  const partial = options.find((option) => visibleText(option).toLowerCase().includes(normalizedValue));
  const target = exact || partial;
  if (!target) return false;
  target.click();
  await wait(300);
  return true;
};

const setControlValue = async (control: HTMLElement, value: string) => {
  if (control instanceof HTMLSelectElement) {
    const matchedOption = [...control.options].find(
      (option) => option.value.toLowerCase() === value.toLowerCase() || visibleText(option).toLowerCase() === value.toLowerCase(),
    );
    if (matchedOption) control.value = matchedOption.value;
    else control.value = value;
    dispatchFieldEvents(control);
    return true;
  }

  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    setNativeValue(control, value);
    if (control.getAttribute('role') === 'combobox') {
      await clickMatchingOption(value);
    }
    return true;
  }

  if (control.getAttribute('contenteditable') === 'true' || control.getAttribute('role') === 'textbox') {
    control.focus();
    control.textContent = value;
    dispatchFieldEvents(control);
    return true;
  }

  if (control.getAttribute('role') === 'combobox' || control.getAttribute('aria-haspopup') === 'listbox' || control.tagName === 'BUTTON') {
    control.click();
    await wait(400);
    const activeInput =
      document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
    if (activeInput) setNativeValue(activeInput, value);
    const clicked = await clickMatchingOption(value);
    if (clicked) return true;
  }

  return false;
};

const fillFields = async (fields: FieldPatch[]) => {
  const missing: string[] = [];

  for (const field of fields) {
    const control = findInputForField(field);
    if (!control) {
      missing.push(field.label || field.name);
      continue;
    }
    const applied = await setControlValue(control, field.value);
    if (!applied) missing.push(field.label || field.name);
  }

  return missing;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clickSave = async () => {
  const saveButton = findButton([/^save$/i, /create/i, /salvar/i, /criar/i, /done/i, /log/i, /registrar/i, /concluir/i]);
  if (!saveButton) return false;
  saveButton.click();
  await wait(1200);
  return true;
};

const isCreateEmbedSnapshot = (snapshot: PageSnapshot) => /\/object-builder\/[^/]+\/[^/]+\/embed/i.test(snapshot.url);

const isRecordSnapshot = (snapshot: PageSnapshot) =>
  Boolean(snapshot.recordId && snapshot.recordType && /\/(?:record|objects)\/[^/]+\/(?!views(?:\/|$))[^/?#]+/i.test(snapshot.url));

const executeUpdate = async (
  operation: Operation,
  options: { requireRecordAfterSave?: boolean; save: boolean } = { save: true },
): Promise<
  | { error: string; ok: false }
  | { error: string; ok: true; status: 'paused' }
  | { ok: true; result: PageSnapshot; status: 'succeeded' }
> => {
  const missing = await fillFields(operation.fields || []);
  if (missing.length > 0) {
    return {
      error: `Could not find editable fields: ${missing.join(', ')}`,
      ok: false as const,
    };
  }

  if (!options.save) {
    return {
      ok: true as const,
      result: captureSnapshot(),
      status: 'succeeded' as const,
    };
  }

  const saved = await clickSave();
  if (!saved) {
    return {
      error: 'Fields were filled, but no visible save/create button was found. User action is required.',
      ok: true as const,
      status: 'paused' as const,
    };
  }

  const snapshot = captureSnapshot();
  if (options.requireRecordAfterSave && !isRecordSnapshot(snapshot)) {
    return {
      error: isCreateEmbedSnapshot(snapshot)
        ? 'HubSpot kept the create form open after save. No final record URL was observed, so creation is not confirmed.'
        : 'No final HubSpot record URL was observed after save, so creation is not confirmed.',
      ok: true as const,
      status: 'paused' as const,
    };
  }

  return {
    ok: true as const,
    result: snapshot,
    status: 'succeeded' as const,
  };
};

const createButtonPatterns = (operation: Operation) => {
  if (operation.objectLabel) return [new RegExp(`create\\s+${operation.objectLabel}`, 'i'), new RegExp(`criar\\s+${operation.objectLabel}`, 'i')];
  if (operation.type === 'custom') return [/create/i, /criar/i, /adicionar/i];

  const labels = hubspotObjectLabels[operation.type];
  const terms = [...labels.singular, ...labels.plural].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [
    new RegExp(`adicionar\\s+(${terms.join('|')})`, 'i'),
    new RegExp(`create\\s+(${terms.join('|')})`, 'i'),
    new RegExp(`criar\\s+(${terms.join('|')})`, 'i'),
  ];
};

const executeCreate = async (operation: Operation) => {
  let createButton =
    document.querySelector<HTMLElement>('[data-test-id="create-object-dropdown-create-object"], [data-testid="create-object-dropdown-create-object"]') ||
    findMenuButton([/^criar novo$/i, /^create new$/i]);

  if (!createButton) {
    const addButton =
      document.querySelector<HTMLElement>('[data-test-id="create-object-dropdown"], [data-testid="create-object-dropdown"]') ||
      findButton(createButtonPatterns(operation));

    if (addButton) {
      addButton.click();
      await wait(1200);
    }

    createButton =
      document.querySelector<HTMLElement>('[data-test-id="create-object-dropdown-create-object"], [data-testid="create-object-dropdown-create-object"]') ||
      findMenuButton([/^criar novo$/i, /^create new$/i]);
  }

  if (createButton) {
    createButton.click();
    await wait(1600);
  }

  return executeUpdate(operation, { requireRecordAfterSave: true, save: true });
};

const activityPatterns: Record<ActivityType, RegExp[]> = {
  call: [/call/i, /chamada/i, /ligação/i, /ligacao/i],
  email: [/email/i, /e-mail/i],
  meeting: [/meeting/i, /reunião/i, /reuniao/i],
  note: [/note/i, /nota/i, /anotação/i, /anotacao/i],
  task: [/task/i, /tarefa/i],
};

const executeActivityCreate = async (operation: Operation) => {
  const activity = operation.activity;
  if (!activity) return { error: 'Activity payload is missing.', ok: false as const };

  const activityButton = findButton(activityPatterns[activity.type]);
  if (activityButton) {
    activityButton.click();
    await wait(1200);
  }

  const fields: FieldPatch[] = [
    ...(activity.title ? [{ label: 'Title', name: 'subject', value: activity.title }] : []),
    ...(activity.body ? [{ label: 'Body', name: 'body', value: activity.body }] : []),
    ...(activity.dueDate ? [{ label: 'Due date', name: 'duedate', value: activity.dueDate }] : []),
    ...(activity.fields || []),
  ];

  const missing = await fillFields(fields);
  if (missing.length > 0) {
    return {
      error: `Could not find editable activity fields: ${missing.join(', ')}`,
      ok: false as const,
    };
  }

  const saved = await clickSave();
  if (!saved) {
    return {
      error: 'Activity fields were filled, but no visible save/log button was found. User action is required.',
      ok: true as const,
      status: 'paused' as const,
    };
  }

  return {
    ok: true as const,
    result: captureSnapshot(),
    status: 'succeeded' as const,
  };
};

const executeAssociationCreate = async (operation: Operation) => {
  const association = operation.association;
  if (!association) return { error: 'Association payload is missing.', ok: false as const };

  const targetName = association.to.displayName || association.to.id || association.to.url;
  if (!targetName) return { error: 'Association target needs displayName, id, or url.', ok: false as const };

  const associationButton = findButton([
    /associate/i,
    /association/i,
    /associar/i,
    /associação/i,
    /associacao/i,
    /adicionar/i,
    /add/i,
  ]);
  if (associationButton) {
    associationButton.click();
    await wait(1200);
  }

  const missing = await fillFields([
    {
      label: association.label || association.to.objectLabel || association.to.type,
      name: association.to.objectLabel || association.to.type,
      value: targetName,
    },
  ]);

  if (missing.length > 0) {
    return {
      error: `Could not find an association picker for ${targetName}.`,
      ok: false as const,
    };
  }

  const saved = await clickSave();
  if (!saved) {
    return {
      error: 'Association target was entered, but no visible save button was found. User action is required.',
      ok: true as const,
      status: 'paused' as const,
    };
  }

  return {
    ok: true as const,
    result: captureSnapshot(),
    status: 'succeeded' as const,
  };
};

const executeOperation = async (operation: Operation): Promise<ContentResponse> => {
  if (operation.kind === 'create') {
    const result = await executeCreate(operation);
    return result.ok ? result : { error: result.error, ok: false };
  }

  if (operation.kind === 'update') {
    const result = await executeUpdate(operation);
    return result.ok ? result : { error: result.error, ok: false };
  }

  if (operation.kind === 'fill-only') {
    const result = await executeUpdate(operation, { save: false });
    return result.ok ? result : { error: result.error, ok: false };
  }

  if (operation.kind === 'create-activity') {
    const result = await executeActivityCreate(operation);
    return result.ok ? result : { error: result.error, ok: false };
  }

  if (operation.kind === 'associate-record') {
    const result = await executeAssociationCreate(operation);
    return result.ok ? result : { error: result.error, ok: false };
  }

  return {
    itemResults: (operation.items || []).map(() => ({
      error: 'Batch items must be navigated by the extension background worker.',
      status: 'skipped',
    })),
    ok: true,
    status: 'paused',
  };
};

chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
  const run = async (): Promise<ContentResponse> => {
    if (message.type === 'capture_snapshot') return { ok: true, snapshot: captureSnapshot() };
    if (message.type === 'collect_results') return { ok: true, results: collectResults(message.input) };
    if (message.type === 'execute_operation') return executeOperation(message.operation);
    return { error: 'Unknown content command.', ok: false };
  };

  run()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error), ok: false }));

  return true;
});
