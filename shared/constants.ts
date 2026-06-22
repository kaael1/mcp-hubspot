export const bridgeHost = '127.0.0.1';
export const bridgePort = Number(globalThis.process?.env?.HUBSPOT_BROWSER_BRIDGE_PORT || 17437);
export const bridgeOrigin = `http://${bridgeHost}:${bridgePort}`;
export const packageName = 'mcp-hubspot';
export const packageVersion = '0.1.3';
export const extensionName = 'HubSpot Browser MCP Bridge';
export const hubspotObjectIds = {
  company: '0-2',
  contact: '0-1',
  deal: '0-3',
  ticket: '0-5',
} as const;

export const hubspotObjectLabels = {
  company: {
    plural: ['companies', 'empresas'],
    singular: ['company', 'empresa'],
  },
  contact: {
    plural: ['contacts', 'contatos'],
    singular: ['contact', 'contato'],
  },
  deal: {
    plural: ['deals', 'negocios', 'negócios'],
    singular: ['deal', 'negocio', 'negócio'],
  },
  ticket: {
    plural: ['tickets', 'chamados'],
    singular: ['ticket', 'chamado'],
  },
} as const;
