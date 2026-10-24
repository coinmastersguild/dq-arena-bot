import fs from 'node:fs';
import WebSocket from 'ws';
import {CombatController} from './combat-controller.mjs';

process.umask(0o077);
const origin = 'https://degenquest.ai';
const spec = 'frost_mage';
const char = 'high-elf-male';
const cookie = fs.readFileSync('.secrets/cookies.txt', 'utf8').split('\n')
  .filter(line => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
  .map(line => line.split('\t')).filter(row => row.length >= 7)
  .map(row => `${row[5]}=${row[6]}`).join('; ');
let release, admission, socket, stopped = false;
let heartbeat, renewal;
let controlTimer;
let lastLobby = '';
let teamRequested = false;
const runId = new Date().toISOString().replaceAll(':', '-');
fs.mkdirSync('runs', {recursive: true});
const evidence = fs.createWriteStream(`runs/${runId}.jsonl`, {mode: 0o600});
function trace(kind, data) { evidence.write(JSON.stringify({at: Date.now(), kind, data}) + '\n'); }
const combat = new CombatController(message => send(message));
const status = {name: 'FrostByteAgent', spec, char};
function record(update) {
  Object.assign(status, update, {updatedAt: new Date().toISOString()});
  fs.writeFileSync('.secrets/arena-status.tmp', JSON.stringify(status, null, 2));
  fs.renameSync('.secrets/arena-status.tmp', '.secrets/arena-status.json');
  console.log(JSON.stringify(update));
}
async function api(path, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Origin: origin, Cookie: cookie, 'Content-Type': 'application/json',
      ...(release ? {'X-DQ-Arena-Release': release} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    signal: AbortSignal.timeout(30000),
  }).catch(error => { throw new Error(`${path}: ${error.cause?.code || error.message}`); });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return data;
}
function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    if (message.t === 'cmd' || message.t === 'input') trace('intent', message);
  }
}
async function stop(reason) {
  if (stopped) return;
  stopped = true;
  clearInterval(heartbeat); clearInterval(renewal);
  clearInterval(controlTimer);
  socket?.close();
  if (admission) {
    try { await api('/api/arena/connection/release', admission); }
    catch (error) { record({releaseError: error.message}); }
  }
  record({connected: false, stopped: reason});
  process.exit(0);
}
process.on('SIGTERM', () => stop('terminated'));
process.on('SIGINT', () => stop('interrupted'));
try {
  const launch = await api('/api/launch');
  if (launch.status !== 'admitted') throw new Error(`Launch status: ${launch.status}`);
  release = launch.arenaRelease;
  const rules = await api('/api/arena/rules');
  combat.setRules(rules);
  trace('run', {release, build: rules.build, spec, char});
  status.name = launch.identity.name;
  const manifest = await fetch(`${origin}/arena-assets/${release}/chars/manifest.json`).then(r => r.json());
  if (!manifest[char]) throw new Error('Character unavailable');
  const entered = await api('/api/arena/battle/enter', {spec, char});
  if (!entered.room || !entered.ticket) throw new Error('Missing room or ticket');
  admission = {room: entered.room, ticket: entered.ticket, spec};
  fs.writeFileSync('.secrets/arena-admission.json', JSON.stringify({...admission, release}));
  const url = new URL('/arena/ws', origin.replace('https:', 'wss:'));
  url.search = new URLSearchParams({room: entered.room, spec, release}).toString();
  socket = new WebSocket(url, {headers: {Origin: origin, Cookie: cookie}});
  socket.on('open', () => {
    send({t: 'join', name: status.name, spec, char, ticket: entered.ticket});
    heartbeat = setInterval(() => send({t: 'ping', c: Date.now()}), 2000);
    renewal = setInterval(() => api('/api/arena/connection/renew', admission)
      .catch(error => record({renewalError: error.message})), 30000);
    controlTimer = setInterval(() => {
      const path = '.secrets/arena-command.json';
      if (!fs.existsSync(path)) return;
      try {
        const command = JSON.parse(fs.readFileSync(path));
        fs.unlinkSync(path);
        if (['ready', 'team', 'slot', 'target', 'cast', 'coach'].includes(command.cmd)) send({t: 'cmd', ...command});
      } catch { record({controlError: 'Invalid local command'}); }
    }, 200);
  });
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (['welcome', 'lobby', 'snap', 'self', 'evs', 'battle', 'chars'].includes(message.t)) {
      const {ticket, token, ...safe} = message;
      trace('received', safe);
    }
    combat.observe(message);
    if (message.t === 'welcome') {
      record({connected: true, room: entered.room, release, state: message.state,
        pid: message.pid, side: message.side, spectator: message.spectator});
      if (message.spectator) stop('Spectator admission grants no player control');
    }
    if (message.t === 'lobby') {
      const encoded = JSON.stringify(message);
      if (encoded !== lastLobby) { record({state: message.state || 'lobby', lobby: message}); lastLobby = encoded; }
      const opponentSide = Object.entries(message.sides || {}).find(([, slots]) => slots.some(s => s.human && !s.you && s.name.toLowerCase() === 'highlander'))?.[0];
      const desired = opponentSide === 'freehold' ? 'coinfall' : 'freehold';
      const ourSide = Object.entries(message.sides || {}).find(([, slots]) => slots.some(s => s.you))?.[0];
      if (!teamRequested && ourSide && ourSide !== desired) {
        teamRequested = true;
        send({t: 'cmd', cmd: 'team', side: desired});
      }
      if (ourSide) { status.side = ourSide; combat.side = ourSide; }
    }
    if (message.t === 'battle') record({battle: message});
    if (message.t === 'error') record({serverError: message.error ?? message.message ?? 'unknown'});
  });
  socket.on('close', (code) => { if (!stopped) stop(`Socket closed: ${code}`); });
  socket.on('error', error => record({connectionError: error.code || error.message}));
  setTimeout(() => stop('30-minute session limit'), 30 * 60 * 1000);
} catch (error) {
  record({error: error.cause?.code || error.message});
  await stop('Connection failed');
}
