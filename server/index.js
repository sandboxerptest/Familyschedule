#!/usr/bin/env node
/**
 * Entry point. Reads configuration from the environment, opens the store and
 * starts listening — then prints the two URLs a household actually needs:
 * one for the TV, one for the phone in their pocket.
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { Store } from './store.js';
import { seedState } from './seed.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const port = Number(process.env.PORT || 4321);
const host = process.env.HOST || '0.0.0.0';
const dataFile = process.env.HEARTH_DATA
  ? path.resolve(process.env.HEARTH_DATA)
  : path.join(ROOT, 'data', 'calendar.json');

const store = new Store(dataFile);
await store.load({ seed: process.env.HEARTH_SEED === 'off' ? undefined : seedState });

const server = createApp(store);

server.listen(port, host, () => {
  const lines = [
    '',
    `  Hearth is running — data at ${dataFile}`,
    '',
    `  TV display   http://localhost:${port}/`,
    `  Phone editor http://localhost:${port}/edit`,
  ];
  for (const address of lanAddresses()) {
    lines.push(`  On your network  http://${address}:${port}/  ·  /edit`);
  }
  lines.push('');
  console.log(lines.join('\n'));
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

const shutdown = async (signal) => {
  console.log(`\n[hearth] ${signal} received, closing…`);
  server.close();
  await store.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
