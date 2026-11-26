import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const libDir = 'C:/Users/zzzy/.dsh/profiles/desktop/node_modules/dsh-connect-workbuddy/lib';
const chunk = readdirSync(libDir).filter((f) => f.startsWith('host-heartbeat-') && f.endsWith('.js')).sort().at(-1);
const mod = await import(pathToFileURL(join(libDir, chunk)).href);
const Store = mod.F;
const Client = mod.nt;
const client = new Client(() => {});
const store = new Store({ region: 'cn', refresh: (c) => client.refreshToken(c) });
const credential = await store.resolve();
const response = await fetch('https://www.codebuddy.cn/v3/config', {
  headers: {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: 'application/json',
    'X-Domain': credential.domain,
    'User-Agent': 'WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0',
    'X-Product': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Version': '5.8.3',
  },
  signal: AbortSignal.timeout(20000),
});
const json = await response.json();
const data = json.data ?? {};
const hits = [];
const walk = (value, path) => {
  if (!value || hits.length > 100) return;
  if (typeof value === 'string') {
    if (/search|联网|网络搜索|web/i.test(value) && value.length < 200) hits.push({ path, value });
    return;
  }
  if (Array.isArray(value)) { value.slice(0, 50).forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/search|web|联网/i.test(key)) hits.push({ path: `${path}.${key}`, value: typeof item === 'object' ? JSON.stringify(item).slice(0, 200) : String(item).slice(0, 200) });
      walk(item, `${path}.${key}`);
    }
  }
};
walk(data, 'data');
console.log(JSON.stringify(hits.slice(0, 60), null, 2));
