#!/usr/bin/env node
import path from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createBridgeServer, getDoctorPayload, listen } from './bridge.js';
import { getPackageRoot } from './runtime-paths.js';
import { loadRuntimeState } from './state.js';
import { createMcpApp } from './tools.js';

const bridgeServer = createBridgeServer();

const handleCli = async () => {
  const command = process.argv[2];
  if (!command) return false;

  await loadRuntimeState();

  if (command === 'doctor') {
    console.log(JSON.stringify(getDoctorPayload(), null, 2));
    return true;
  }

  if (command === 'extension-path') {
    console.log(path.join(getPackageRoot(), 'dist', 'extension'));
    return true;
  }

  if (command === 'bridge') {
    await listen(bridgeServer);
    console.log(JSON.stringify(getDoctorPayload(), null, 2));
    await new Promise(() => undefined);
    return true;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log('0.1.0');
    return true;
  }

  console.error(`Unknown command "${command}". Use doctor, extension-path, or version.`);
  process.exitCode = 1;
  return true;
};

const main = async () => {
  if (await handleCli()) return;

  await loadRuntimeState();
  await listen(bridgeServer);

  const transport = new StdioServerTransport();
  await createMcpApp().connect(transport);
};

process.on('SIGINT', () => {
  bridgeServer.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  bridgeServer.close(() => process.exit(0));
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
