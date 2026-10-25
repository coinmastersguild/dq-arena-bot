import fs from 'node:fs';
import path from 'node:path';

export function loadConfig(file) {
  const provided = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const root = file ? path.dirname(path.resolve(file)) : process.cwd();
  const config = {origin: 'https://degenquest.ai', spec: 'frost_mage', character: 'high-elf-male',
    side: null, cookieFile: '.secrets/cookies.txt', stateDirectory: '.secrets/bot',
    runsDirectory: 'runs', maxSessionMinutes: 30, maxReconnects: 3, ...provided};
  if (![null, 'coinfall', 'freehold'].includes(config.side)) throw new Error('Invalid side');
  if (config.spec !== 'frost_mage') throw new Error('Only frost_mage strategy is implemented');
  if (!Number.isFinite(config.maxSessionMinutes) || config.maxSessionMinutes < 1 || config.maxSessionMinutes > 120) throw new Error('Session duration must be 1–120 minutes');
  if (typeof config.character !== 'string' || !/^[a-z0-9_-]+$/.test(config.character)) throw new Error('Invalid character ID');
  if (!Number.isInteger(config.maxReconnects) || config.maxReconnects < 0 || config.maxReconnects > 5) throw new Error('Reconnects must be 0–5');
  for (const key of ['cookieFile', 'stateDirectory', 'runsDirectory']) config[key] = path.resolve(root, config[key]);
  if (provided.autonomy !== undefined && (!provided.autonomy || typeof provided.autonomy !== 'object')) throw new Error('Invalid autonomy config');
  config.autonomy = {enabled: false, reviewSeconds: 300, retainRuns: 100, ...provided.autonomy,
    inference: {enabled: false, model: 'glm-5.3-flash-local', maxOutputTokens: 2048,
      requestsPerDay: 12, tokensPerDay: 120000, ...provided.autonomy?.inference}};
  const a = config.autonomy, i = a.inference;
  if (typeof a.enabled !== 'boolean' || typeof i.enabled !== 'boolean') throw new Error('Invalid enable flag');
  for (const [value, min, max] of [[a.reviewSeconds, 300, 3600], [a.retainRuns, 5, 1000],
    [i.maxOutputTokens, 256, 4096], [i.requestsPerDay, 1, 288], [i.tokensPerDay, 4096, 10000000]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid autonomy limit');
  }
  if (typeof i.model !== 'string' || !/^glm[\w.-]+$/.test(i.model)) throw new Error('Use a concrete GLM model');
  if (i.authTokenFile) i.authTokenFile = path.resolve(root, i.authTokenFile);
  return config;
}
