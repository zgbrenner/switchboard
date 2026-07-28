#!/usr/bin/env node
import { startHttpServer } from './http.mjs';
import { serveStdio } from './stdio.mjs';

function value(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number(value(name, String(fallback)));
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return parsed;
}

const transport = value('transport', 'stdio');
if (transport === 'stdio') {
  console.error('Switchboard MCP running on stdio.');
  await serveStdio();
} else if (transport === 'http') {
  const host = value('host', '127.0.0.1');
  const port = boundedInteger('port', 3764, 0, 65535);
  const path = value('path', '/mcp');
  const sessionTtlMs = boundedInteger('session-ttl-ms', 30 * 60 * 1000, 1, 24 * 60 * 60 * 1000);
  const maxSessions = boundedInteger('max-sessions', 256, 1, 10_000);
  const token = value('token', process.env.SWITCHBOARD_MCP_TOKEN ?? '');
  const server = startHttpServer({ host, port, path, sessionTtlMs, maxSessions, token });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.error(`Switchboard MCP listening at http://${host}:${actualPort}${path}${token ? ' with bearer authentication' : ''}.`);
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else {
  throw new Error('transport must be stdio or http.');
}
