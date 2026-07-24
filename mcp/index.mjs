#!/usr/bin/env node
import { startHttpServer } from './http.mjs';
import { serveStdio } from './stdio.mjs';

function value(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const transport = value('transport', 'stdio');
if (transport === 'stdio') {
  console.error('Switchboard MCP running on stdio.');
  await serveStdio();
} else if (transport === 'http') {
  const host = value('host', '127.0.0.1');
  const port = Number(value('port', '3764'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be an integer between 0 and 65535.');
  const server = startHttpServer({ host, port });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  console.error(`Switchboard MCP listening at http://${host}:${typeof address === 'object' && address ? address.port : port}/mcp`);
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else {
  throw new Error('transport must be stdio or http.');
}
