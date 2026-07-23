import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const required = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
].filter(Boolean);

for (const path of required) await access(join('dist', path));
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['storage'])) throw new Error('Unexpected extension permissions.');
const expectedHosts = ['https://chatgpt.com/*', 'https://claude.ai/*'];
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) throw new Error('Unexpected host permissions.');

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path)); else output.push(path);
  }
  return output;
}

for (const path of await files('dist')) {
  if (!/\.(?:js|html|css|json)$/.test(path)) continue;
  const content = await readFile(path, 'utf8');
  if (/\bhttps?:\/\//i.test(content) && !path.endsWith('manifest.json')) {
    throw new Error(`Executable extension asset contains a remote URL: ${path}`);
  }
}
console.log(`Verified ${required.length} manifest resources, least-privilege permissions, and no remote executable URLs.`);
