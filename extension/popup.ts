import type { ExtensionStatus } from './types.js';

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const messageEl = document.getElementById('message') as HTMLParagraphElement;
const keyInput = document.getElementById('pairing-key') as HTMLInputElement;
const pairButton = document.getElementById('pair') as HTMLButtonElement;
const panelButton = document.getElementById('open-panel') as HTMLButtonElement;
const pairSection = document.getElementById('pair-section') as HTMLElement;

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

const refresh = async () => {
  const status = await sendMessage<ExtensionStatus>({ type: 'get-status' });
  statusEl.textContent = status.paired
    ? `Paired. Pending operations: ${status.pendingOperations.length}`
    : status.bridgeOk
      ? 'Bridge found. Paste the pairing key from `doctor`.'
      : `Bridge offline: ${status.error || 'not reachable'}`;

  pairSection.hidden = status.paired;
  messageEl.textContent = status.paired ? 'Already paired with this local bridge.' : messageEl.textContent;
};

pairButton.addEventListener('click', async () => {
  messageEl.textContent = '';
  try {
    await sendMessage({ key: keyInput.value.trim(), type: 'pair' });
    messageEl.textContent = 'Paired with local bridge.';
    await refresh();
  } catch (error) {
    messageEl.textContent = error instanceof Error ? error.message : String(error);
  }
});

panelButton.addEventListener('click', () => {
  void sendMessage({ type: 'open-side-panel' });
});

void refresh();
