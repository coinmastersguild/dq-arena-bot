#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import {ArenaClient} from '../src/client.mjs';
import {loadConfig} from '../src/config.mjs';
import {privateJson} from '../src/recording.mjs';
import {acquireProcessLock, clearStaleLock} from '../src/process-lock.mjs';

process.umask(0o077);
const {values} = parseArgs({options: {config: {type: 'string'}}});
const config = loadConfig(values.config);
if (!config.autonomy.enabled) throw new Error('Enable autonomy in the operator config before starting the service');
fs.mkdirSync(config.stateDirectory, {recursive: true, mode: 0o700});
const unlock = acquireProcessLock(path.join(config.stateDirectory, 'service.lock'));
const haltFile = path.join(config.stateDirectory, 'service.halt');
const stateFile = path.join(config.stateDirectory, 'service.json');
let stopping = false, client, failures = 0;
const signal = () => { stopping = true; void client?.stop('service-signal'); };
process.once('SIGINT', signal); process.once('SIGTERM', signal);
try {
  while (!stopping) {
    if (fs.existsSync(haltFile)) { await delay(1000); continue; }
    try {
      clearStaleLock(path.join(config.stateDirectory, 'runner.lock'));
      privateJson(stateFile, {pid: process.pid, state: 'running', updatedAt: Date.now()});
      client = new ArenaClient(loadConfig(values.config));
      // Detailed diagnostics already live in bounded per-round recordings.
      client.diagnostic = data => {
        client.recorder?.write('diagnostic', data);
        if (['result', 'joined', 'inference-skipped', 'policy-activated', 'reconnect-error'].includes(data.type)) {
          privateJson(path.join(config.stateDirectory, 'last-event.json'), {at: Date.now(), ...data});
        }
      };
      const began = Date.now();
      await client.start();
      const reason = await client.finished;
      if (reason === 'operator') {
        fs.writeFileSync(haltFile, 'Operator stopped service. Remove this file to resume.\n', {mode: 0o600});
        privateJson(stateFile, {pid: process.pid, state: 'halted', updatedAt: Date.now()});
      }
      if (Date.now() - began > 60000) failures = 0;
    } catch {
      if (client?.lock !== undefined) await client.stop('startup-failed');
      privateJson(stateFile, {pid: process.pid, state: 'retrying', updatedAt: Date.now()});
    }
    if (stopping || fs.existsSync(haltFile)) continue;
    const until = Date.now() + Math.min(300000, 5000 * 2 ** Math.min(failures++, 6));
    while (!stopping && Date.now() < until && !fs.existsSync(haltFile)) await delay(1000);
  }
} finally {
  unlock();
  privateJson(stateFile, {pid: process.pid, state: 'stopped', updatedAt: Date.now()});
}
