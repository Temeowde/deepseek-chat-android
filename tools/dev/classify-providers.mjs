import fs from 'node:fs';
import path from 'node:path';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';

const dir = 'C:/Users/zzzy/.dsh/profiles/node_modules/@earendil-works/pi-ai/dist/providers';
const providers = builtinProviders();
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js') && !/\.models\.js$|^all\.js$|^faux\.js$|^radius-config\.js$|^opencode-headers\.js$|^cloudflare-auth\.js$|^cloudflare-stream\.js$/.test(name));
const source = new Map();
for (const name of files) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  for (const match of text.matchAll(/id:\s*"([^"]+)"/g)) {
    if (!source.has(match[1])) source.set(match[1], text);
  }
}
const rows = providers.map((provider) => {
  const text = source.get(provider.id) ?? '';
  const apis = [];
  if (text.includes('openAICompletionsApi')) apis.push('openai-completions');
  if (text.includes('anthropicMessagesApi')) apis.push('anthropic');
  if (text.includes('openAIResponsesApi')) apis.push('openai-responses');
  if (text.includes('googleGenerativeAIApi')) apis.push('google');
  if (text.includes('mistralConversationsApi')) apis.push('mistral');
  if (text.includes('piMessagesApi')) apis.push('pi');
  if (text.includes('bedrock')) apis.push('bedrock');
  return { id: provider.id, name: provider.name, baseUrl: provider.baseUrl ?? '', apis: apis.join(','), auth: Object.keys(provider.auth ?? {}).join(',') };
});
for (const row of rows) console.log([row.id, row.name, row.apis || '(special)', row.baseUrl || '(dynamic)', row.auth || '(none)'].join('\t'));
console.log('TOTAL', rows.length);
const compatible = rows.filter((row) => row.apis.includes('openai-completions') && row.baseUrl);
console.log('OPENAI_COMPATIBLE_WITH_BASEURL', compatible.length);
console.log(compatible.map((row) => row.id).join(','));
