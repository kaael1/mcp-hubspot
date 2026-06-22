export const bridgeHost = '127.0.0.1';
export const bridgePort = Number(globalThis.process?.env?.HUBSPOT_BROWSER_BRIDGE_PORT || 17437);
export const bridgeOrigin = `http://${bridgeHost}:${bridgePort}`;
export const packageName = 'mcp-hubspot';
export const extensionName = 'HubSpot Browser MCP Bridge';
export const hubspotObjectIds = {
  company: '0-2',
  contact: '0-1',
} as const;
