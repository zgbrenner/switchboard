#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSwitchboardProxyServer, validateProxyConfig } from '../dist/js/proxy/index.js';
import { routeRequest } from '../dist/js/router/route.js';

function parseArguments(argv) {
  const result = { configPath: 'switchboard.proxy.json', check: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--config') {
      const value = argv[++index];
      if (!value) throw new Error('--config requires a path.');
      result.configPath = value;
    } else if (argument === '--host') {
      const value = argv[++index];
      if (!value) throw new Error('--host requires a value.');
      result.host = value;
    } else if (argument === '--port') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value)) throw new Error('--port requires an integer.');
      result.port = value;
    } else if (argument === '--check') result.check = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function usage() {
  return `Usage: switchboard-proxy [--config path] [--host host] [--port port] [--check]

Starts the optional Switchboard OpenAI Responses and Anthropic Messages proxy.
Configuration defaults to ./switchboard.proxy.json.`;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const configPath = resolve(process.cwd(), args.configPath);
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  if (args.host !== undefined || args.port !== undefined) {
    raw.listen = {
      ...(raw.listen ?? {}),
      ...(args.host === undefined ? {} : { host: args.host }),
      ...(args.port === undefined ? {} : { port: args.port }),
    };
  }
  const config = validateProxyConfig(raw, process.env);
  if (args.check) {
    process.stdout.write(`Valid Switchboard proxy config: ${configPath}\n`);
    process.exit(0);
  }
  const proxy = createSwitchboardProxyServer(config, { route: routeRequest });
  const address = await proxy.listen();
  process.stderr.write(`switchboard-proxy listening on http://${address.host}:${address.port}\n`);
  const shutdown = async () => {
    await proxy.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
  process.exit(1);
}
