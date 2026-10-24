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
  return config;
}
