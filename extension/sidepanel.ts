import type { ExtensionStatus } from './types.js';

const statusEl = document.getElementById('status') as HTMLElement;
const operationsEl = document.getElementById('operations') as HTMLElement;
const refreshButton = document.getElementById('refresh') as HTMLButtonElement;
const autopilotInput = document.getElementById('autopilot') as HTMLInputElement;

const sendMessage = <T>(message: unknown) =>
  new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T & { error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });

const fieldList = (fields: Array<{ label?: string; name: string; value: string }> = []) =>
  fields
    .map(
      (field) =>
        `<li><strong>${escapeHtml(field.label || field.name)}</strong><span>${escapeHtml(field.value)}</span></li>`,
    )
    .join('');

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);

const render = (status: ExtensionStatus) => {
  statusEl.textContent = status.paired
    ? `Paired. ${status.pendingOperations.length} pending/running operation(s).`
    : status.bridgeOk
      ? 'Bridge found, but this extension is not paired yet.'
      : `Bridge offline: ${status.error || 'not reachable'}`;
  autopilotInput.checked = status.autopilotEnabled;

  operationsEl.innerHTML =
    status.pendingOperations.length === 0
      ? '<p class="empty">No pending operations.</p>'
      : status.pendingOperations
          .map(
            (operation) => `
              <article class="operation">
                <h2>${escapeHtml(operation.summary)}</h2>
                <p>${escapeHtml(operation.kind)} · ${escapeHtml(operation.type)} · ${escapeHtml(operation.status)}</p>
                <ul>${fieldList(operation.fields)}</ul>
                ${
                  operation.kind === 'batch-update'
                    ? `<p>${operation.items?.length || 0} item(s) in this batch.</p>`
                    : ''
                }
                ${
                  operation.status === 'pending' || operation.status === 'paused'
                    ? `<div class="actions">
                        <button data-approve="${operation.id}">Approve</button>
                        <button data-reject="${operation.id}" class="secondary">Reject</button>
                      </div>`
                    : ''
                }
              </article>
            `,
          )
          .join('');

  operationsEl.querySelectorAll<HTMLButtonElement>('button[data-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await sendMessage({ operationId: button.dataset.approve, type: 'approve-operation' });
      await refresh();
    });
  });

  operationsEl.querySelectorAll<HTMLButtonElement>('button[data-reject]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await sendMessage({ operationId: button.dataset.reject, type: 'reject-operation' });
      await refresh();
    });
  });
};

const refresh = async () => {
  try {
    render(await sendMessage<ExtensionStatus>({ type: 'get-status' }));
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
};

refreshButton.addEventListener('click', () => {
  void refresh();
});

autopilotInput.addEventListener('change', async () => {
  autopilotInput.disabled = true;
  try {
    await sendMessage({ enabled: autopilotInput.checked, type: 'set-autopilot' });
    await refresh();
  } finally {
    autopilotInput.disabled = false;
  }
});

void refresh();
window.setInterval(() => void refresh(), 2500);
