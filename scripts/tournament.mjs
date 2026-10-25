import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../src/config.mjs';
import {privateJson} from '../src/recording.mjs';
import {readyGate, finishRound} from '../src/tournament.mjs';

const command = process.argv[2] || 'status';
const file = path.resolve(process.env.DQ_TOURNAMENT_STATE || '.local/tournament/state.json');
const config = loadConfig(process.env.DQ_BOT_CONFIG || 'bot.config.json');
try {
  let tournament = JSON.parse(fs.readFileSync(file));
  const status = JSON.parse(fs.readFileSync(path.join(config.stateDirectory, 'status.json')));
  if (command === 'ready') {
    const blocked = readyGate(tournament, status); if (blocked) throw new Error(blocked);
    tournament = {...tournament, activeRun: status.runDirectory, status: 'ready-queued'};
    privateJson(file, tournament);
    privateJson(path.join(config.stateDirectory, 'command.json'), {cmd: 'ready', ready: true});
  } else if (command === 'record') {
    if (!tournament.activeRun) throw new Error('No active round');
    const result = JSON.parse(fs.readFileSync(path.join(tournament.activeRun, 'result.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(tournament.activeRun, 'manifest.json')));
    tournament = finishRound(tournament, result, tournament.activeRun, manifest.controllerVersion);
    privateJson(file, tournament);
  } else if (command !== 'status') throw new Error('Use status, ready, or record');
  console.log(JSON.stringify({tournament, lobby: {connected: status.connected, state: status.state, side: status.side},
    readyGate: readyGate(tournament, status)}, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
