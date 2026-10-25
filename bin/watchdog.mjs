#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import {loadConfig} from '../src/config.mjs';
import {privateJson} from '../src/recording.mjs';
import {acquireProcessLock, lockOwner} from '../src/process-lock.mjs';

process.umask(0o077);
const {values} = parseArgs({options: {config: {type: 'string'}, worker: {type: 'boolean'}}});
if (!values.config) throw new Error('--config is required');
const configFile = path.resolve(values.config), config = loadConfig(configFile);
if (!config.autonomy.enabled) throw new Error('Enable autonomy before starting the watchdog');
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(config.stateDirectory, 'watchdog.lock');
fs.mkdirSync(config.stateDirectory, {recursive: true, mode: 0o700});
if (!values.worker) {
  const pid = lockOwner(file);
  if (pid) console.log(JSON.stringify({watchdogPid: pid, alreadyRunning: true}));
  else {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', '--config', configFile],
      {cwd: root, detached: true, stdio: 'ignore'});
    child.on('error', () => { console.error('Could not start watchdog'); process.exitCode = 1; });
    child.unref();
    // A detached process is not "running" until it has acquired its own lock.
    for (let n = 0; n < 30 && !lockOwner(file); n++) await delay(100);
    if (!lockOwner(file)) throw new Error('Watchdog did not initialize');
    console.log(JSON.stringify({watchdogPid: lockOwner(file), detached: true}));
  }
} else {
  const unlock = acquireProcessLock(file);
  let stopping = false, lastSpawn = 0;
  const stop = () => {
    stopping = true;
    const pid = lockOwner(path.join(config.stateDirectory, 'service.lock'));
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* It already exited. */ } }
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    while (!stopping) {
      const pid = lockOwner(path.join(config.stateDirectory, 'service.lock'));
      const halted = fs.existsSync(path.join(config.stateDirectory, 'service.halt'));
      if (!pid && !halted && Date.now() - lastSpawn >= 30000) {
        lastSpawn = Date.now();
        // Bound startup diagnostics. Routine combat diagnostics stay in per-round records.
        const log = path.join(config.stateDirectory, 'service-error.log');
        if (fs.existsSync(log) && fs.statSync(log).size > 256 * 1024) fs.renameSync(log, log + '.previous');
        const fd = fs.openSync(log, 'a', 0o600);
        const child = spawn(process.execPath, [path.join(root, 'bin/service.mjs'), '--config', configFile],
          {cwd: root, stdio: ['ignore', 'ignore', fd]});
        child.on('error', () => {}); fs.closeSync(fd);
      }
      privateJson(path.join(config.stateDirectory, 'watchdog.json'),
        {pid: process.pid, servicePid: pid, state: halted ? 'halted' : 'watching', updatedAt: Date.now()});
      await delay(1000);
    }
  } finally { unlock(); }
}
