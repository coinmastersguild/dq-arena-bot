#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {loadConfig} from '../src/config.mjs';
import {ArenaClient} from '../src/client.mjs';
import {privateJson} from '../src/recording.mjs';

process.umask(0o077);
const {values, positionals} = parseArgs({allowPositionals: true, options: {
  config: {type: 'string'}, ready: {type: 'boolean'}, help: {type: 'boolean'},
}});
if (values.help) {
  console.log('Usage: node bin/arena.mjs [start|status|ready|unready|pause|resume|stop] [--config bot.config.json] [--ready]\nDefault start joins without readying. Autonomy explicitly enables automatic readiness.');
} else {
  let client;
  try {
    const config = loadConfig(values.config);
    const command = positionals[0] || 'start';
    if (command === 'status') console.log(fs.readFileSync(path.join(config.stateDirectory, 'status.json'), 'utf8'));
    else if (['ready', 'unready', 'pause', 'resume', 'stop'].includes(command)) {
      if (!fs.existsSync(path.join(config.stateDirectory, 'runner.lock'))) throw new Error('No runner lock; start a client first');
      if (command === 'stop' && fs.existsSync(path.join(config.stateDirectory, 'service.lock'))) {
        fs.writeFileSync(path.join(config.stateDirectory, 'service.halt'), 'Operator stopped service.\n', {mode: 0o600});
      }
      privateJson(path.join(config.stateDirectory, 'command.json'), ['stop', 'pause', 'resume'].includes(command) ? {cmd: command} : {cmd: 'ready', ready: command === 'ready'});
      console.log('Command queued; check status for the server acknowledgement.');
    } else if (command === 'start') {
      client = new ArenaClient(config, {ready: !!values.ready});
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void client.stop(signal));
      await client.start();
    } else throw new Error('Unknown command; use --help');
  } catch (error) {
    console.error(error.message);
    if (client?.lock !== undefined) await client.stop('startup-failed');
    process.exitCode = 1;
  }
}
