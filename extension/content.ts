import type {
  AssociationSnapshot,
  FieldPatch,
  FieldSnapshot,
  Operation,
  PageSnapshot,
  RecordType,
  SearchResult,
  TableSnapshot,
} from '../shared/schemas.js';
import { hubspotObjectIds } from '../shared/constants.js';
import type { ContentCommand, ContentResponse } from './types.js';

const text = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();

const visibleText = (element: Element | null | undefined) => text(element?.textContent || '');

const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
};

const detectRecordType = (url = window.location.href): RecordType | undefined => {
  if (url.includes('/objects/0-2/') || url.includes('/record/0-2/') || url.includes('/0-2/')) return 'company';
  if (url.includes('/objects/0-1/') || url.includes('/record/0-1/') || url.includes('/0-1/')) return 'contact';
  if (url.includes('/companies')) return 'company';
  if (url.includes('/contacts')) return 'contact';
  return undefined;
};

const detectRecordId = (url = window.location.href) => {
  const objectMatch = url.match(/\/(?:record|objects)\/(?:0-1|0-2)\/(?!views(?:\/|$))([^/?#]+)/i);
  if (objectMatch?.[1]) return decodeURIComponent(objectMatch[1]);
  const legacyMatch = url.match(/\/(?:contact|company)\/(\d+)/i);
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
    if (!type || !/\/record\/0-[12]\//.test(href)) continue;

    const displayName = visibleText(anchor);
    if (!displayName || seen.has(href)) continue;
    seen.add(href);
    associations.push({
      displayName,
      recordId: detectRecordId(href),
      type,
      url: href,
    });
  }

  return associations.slice(0, 80);
};

const captureSnapshot = (): PageSnapshot => ({
  associations: collectAssociations(),
  capturedAt: new Date().toISOString(),
  displayName: getDisplayName() || undefined,
  fields: dedupeFields([...collectLabelFields(), ...collectPropertyLikeFields()]),
  recordId: detectRecordId(),
  recordType: detectRecordType(),
  tables: collectTables(),
  title: document.title,
  url: window.location.href,
});

const collectResults = ({ limit = 25, query, type }: { limit?: number; query: string; type: RecordType }) => {
  const normalizedQuery = query.toLowerCase();
  const objectId = hubspotObjectIds[type];
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(isVisible);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    const href = anchor.href;
    const label = visibleText(anchor);
    const haystack = `${label} ${href}`.toLowerCase();
    if (!href.includes(objectId) && !href.toLowerCase().includes(type === 'contact' ? 'contact' : 'compan')) continue;
    if (normalizedQuery && !haystack.includes(normalizedQuery)) continue;
    if (!label || seen.has(href)) continue;

    seen.add(href);
    results.push({
      description: visibleText(anchor.closest('tr, [role="row"], li, div')),
      displayName: label,
      id: detectRecordId(href),
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
    company: ['company', 'empresa'],
    domain: ['domain', 'domínio', 'dominio', 'company domain name', 'domínio da empresa', 'dominio da empresa'],
    email: ['email', 'e-mail'],
    firstname: ['first name', 'firstname', 'nome'],
    lastname: ['last name', 'lastname', 'sobrenome'],
    name: ['name', 'nome', 'company name', 'nome da empresa'],
    phone: ['phone', 'telefone'],
    website: ['website', 'site'],
  };
  const wanted = [field.name, field.label, ...(aliases[field.name.toLowerCase()] || [])]
    .filter(Boolean)
    .map((part) => String(part).toLowerCase());
  const controls = [
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select, [role="textbox"], [contenteditable="true"]',
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

const setNativeValue = (control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  control.focus();
  if ('value' in control) control.value = value;
  if (control.getAttribute('contenteditable') === 'true') control.textContent = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
};

const fillFields = (fields: FieldPatch[]) => {
  const missing: string[] = [];

  for (const field of fields) {
    const control = findInputForField(field);
    if (!control) {
      missing.push(field.label || field.name);
      continue;
    }
    setNativeValue(control, field.value);
  }

  return missing;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clickSave = async () => {
  const saveButton = findButton([/^save$/i, /create/i, /salvar/i, /criar/i]);
  if (!saveButton) return false;
  saveButton.click();
  await wait(1200);
  return true;
};

const executeUpdate = async (
  operation: Operation,
  options: { save: boolean } = { save: true },
): Promise<
  | { error: string; ok: false }
  | { error: string; ok: true; status: 'paused' }
  | { ok: true; result: PageSnapshot; status: 'succeeded' }
> => {
  const missing = fillFields(operation.fields || []);
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

  return {
    ok: true as const,
    result: captureSnapshot(),
    status: 'succeeded' as const,
  };
};

const executeCreate = async (operation: Operation) => {
  let createButton =
    document.querySelector<HTMLElement>('[data-test-id="create-object-dropdown-create-object"], [data-testid="create-object-dropdown-create-object"]') ||
    findMenuButton([/^criar novo$/i, /^create new$/i]);

  if (!createButton) {
    const addButton =
      document.querySelector<HTMLElement>('[data-test-id="create-object-dropdown"], [data-testid="create-object-dropdown"]') ||
      findButton([
        operation.type === 'company'
          ? /adicionar empresas?|create company|criar empresa/i
          : /adicionar contatos?|create contact|criar contato/i,
      ]);

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

  return executeUpdate(operation);
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
