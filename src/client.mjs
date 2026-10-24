import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import WebSocket from 'ws';
import {CombatController, CONTROLLER_VERSION} from './controller.mjs';
import {ArenaSession} from './session.mjs';
import {Recorder, privateJson, redact} from './recording.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class ArenaClient {
  constructor(config, {ready = false} = {}) {
    this.config = config; this.readyRequested = ready; this.stopping = false; this.reconnects = 0;
    this.session = new ArenaSession(config);
    this.state = {connected: false, state: 'connecting', controllerVersion: CONTROLLER_VERSION};
    this.controller = new CombatController({spec: config.spec, send: m => this.send(m), onDiagnostic: d => this.diagnostic(d)});
    this.timers = new Set(); this.reportPending = false;
  }
  diagnostic(data) { this.recorder?.write('diagnostic', data); console.log(JSON.stringify(data)); }
  status(update) {
    Object.assign(this.state, update, {updatedAt: new Date().toISOString()});
    privateJson(path.join(this.config.stateDirectory, 'status.json'), redact(this.state));
  }
  interval(fn, ms) { const timer = setInterval(fn, ms); this.timers.add(timer); return timer; }
  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
    if (['cmd', 'input'].includes(message.t)) this.recorder?.write('intent', message);
  }
  async start() {
    fs.mkdirSync(this.config.stateDirectory, {recursive: true, mode: 0o700});
    this.lockPath = path.join(this.config.stateDirectory, 'runner.lock');
    try { this.lock = fs.openSync(this.lockPath, 'wx', 0o600); }
    catch { throw new Error('Runner lock exists. Check the process before removing a stale lock.'); }
    fs.writeFileSync(this.lock, String(process.pid));
    this.startedAt = Date.now();
    let commit = 'uncommitted', dirty = true;
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
      dirty = !!execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim();
    } catch { /* An exported source archive need not contain .git. */ }
    this.recorder = new Recorder(this.config.runsDirectory, {controllerVersion: CONTROLLER_VERSION, commit, dirty,
      origin: this.config.origin, spec: this.config.spec, character: this.config.character, side: this.config.side});
    this.deadline = setTimeout(() => this.stop('session-limit'), this.config.maxSessionMinutes * 60000);
    this.interval(() => this.localCommand(), 200);
    await this.connect();
  }
  async connect() {
    const launch = await this.session.request('/api/launch');
    if (this.stopping) return;
    if (launch.status !== 'admitted') throw new Error(`Launch requires ${launch.status}; this bot never purchases access`);
    this.session.release = launch.arenaRelease;
    const rules = await this.session.request('/api/arena/rules'); this.controller.setRules(rules);
    if (this.stopping) return;
    this.recorder.write('release', {arenaRelease: launch.arenaRelease, nativeBuild: rules.build});
    this.name = launch.identity.name;
    const entered = await this.session.request('/api/arena/battle/enter', {spec: this.config.spec, char: this.config.character});
    if (!entered.room || !entered.ticket) throw new Error('Incomplete admission response');
    this.admission = {room: entered.room, ticket: entered.ticket, spec: this.config.spec};
    if (this.stopping) {
      await this.session.request('/api/arena/connection/release', this.admission);
      return;
    }
    privateJson(path.join(this.config.stateDirectory, 'admission.json'), {...this.admission, release: this.session.release});
    this.controller.reset(); this.teamRequested = false; this.lobbyInitialized = false; this.lastLobby = '';
    const url = new URL('/arena/ws', this.config.origin.replace('https:', 'wss:'));
    url.search = new URLSearchParams({room: entered.room, spec: this.config.spec, release: launch.arenaRelease});
    const socket = new WebSocket(url, {headers: this.session.headers(), handshakeTimeout: 20000}); this.socket = socket;
    socket.on('open', () => {
      this.send({t: 'join', name: this.name, spec: this.config.spec, char: this.config.character, ticket: entered.ticket});
      this.heartbeat = this.interval(() => this.send({t: 'ping', c: Date.now()}), 2000);
      this.renewal = this.interval(() => this.renew(), 30000);
    });
    socket.on('message', raw => {
      try { this.message(JSON.parse(raw.toString())); }
      catch (error) {
        this.diagnostic({type: 'message-error', message: error.message});
        void this.stop('controller-error');
      }
    });
    socket.on('error', error => this.diagnostic({type: 'socket-error', code: error.code || 'transport'}));
    socket.on('close', code => this.disconnected(code));
  }
  async renew() {
    if (this.renewing || this.stopping) return;
    this.renewing = true;
    try { await this.session.request('/api/arena/connection/renew', this.admission); }
    catch (error) { this.diagnostic({type: 'renewal-error', message: error.message}); this.socket?.close(); }
    finally { this.renewing = false; }
  }
  message(m) {
    if (['welcome', 'lobby', 'snap', 'self', 'evs', 'battle', 'chars', 'error'].includes(m.t)) this.recorder.write('received', m);
    this.controller.observe(m);
    if (m.t === 'welcome') {
      this.status({connected: true, name: this.name, room: this.admission.room, release: this.session.release,
        state: m.state, side: m.side, spectator: !!m.spectator, pid: m.pid});
      this.diagnostic({type: 'joined', name: this.name, side: m.side, state: m.state});
      if (m.spectator) { this.readyRequested = false; this.diagnostic({type: 'spectator-no-control'}); }
    }
    if (m.t === 'lobby') {
      const mine = Object.entries(m.sides || {}).find(([, slots]) => slots.some(s => s.you));
      this.status({state: m.state, side: mine?.[0] ?? null, lobby: m});
      if (m.state !== 'lobby' || !mine) return;
      if (!this.lobbyInitialized) {
        this.send({t: 'cmd', cmd: 'ready', ready: false}); this.lobbyInitialized = true;
      }
      if (this.config.side && mine[0] !== this.config.side) {
        if (!this.teamRequested) { this.send({t: 'cmd', cmd: 'team', side: this.config.side}); this.teamRequested = true; }
        return;
      }
      if (this.readyRequested) { this.send({t: 'cmd', cmd: 'ready', ready: true}); this.readyRequested = false; }
    }
    if (m.t === 'battle') {
      this.status({state: m.state, battle: m});
      if (m.state === 'results' && !this.reportPending) {
        this.reportPending = true; this.recorder.result(m);
        this.diagnostic({type: 'result', winner: m.winner});
        void this.collectReport().catch(error => this.diagnostic({type: 'report-error', message: error.message}));
      }
      if (m.state === 'countdown') this.reportPending = false;
    }
    if (m.t === 'error') this.diagnostic({type: 'server-error', message: m.error ?? m.message ?? 'unspecified'});
  }
  async collectReport() {
    for (let attempt = 0; attempt < 4 && !this.stopping; attempt++) {
      await delay(2000 * (attempt + 1));
      if (this.stopping) return;
      const history = await this.session.request('/api/arena/battle/history?limit=5');
      const match = history.matches?.find(m => m.completed_at >= this.startedAt && m.self?.name === this.name && m.reportAvailable);
      if (!match) continue;
      try {
        const report = await this.session.request('/api/arena/battle/report?match=' + encodeURIComponent(match.match_id));
        privateJson(path.join(this.recorder.directory, `report-${match.match_id}.json`), redact(report));
        this.diagnostic({type: 'report-saved', matchId: match.match_id}); return;
      } catch (error) { if (error.status !== 404) throw error; }
    }
    this.diagnostic({type: 'report-pending', message: 'Saved socket results; persisted report not yet available'});
  }
  localCommand() {
    const file = path.join(this.config.stateDirectory, 'command.json');
    if (!fs.existsSync(file)) return;
    try {
      const command = JSON.parse(fs.readFileSync(file)); fs.unlinkSync(file);
      if (command.cmd === 'stop') { void this.stop('operator'); return; }
      if (command.cmd === 'ready' && typeof command.ready === 'boolean' && this.state.state === 'lobby') this.send({t: 'cmd', cmd: 'ready', ready: command.ready});
      else if (command.cmd === 'team' && ['coinfall', 'freehold'].includes(command.side) && this.state.state === 'lobby') this.send({t: 'cmd', cmd: 'team', side: command.side});
      else this.diagnostic({type: 'command-rejected', message: 'Command is invalid in the current state'});
    } catch { this.diagnostic({type: 'command-rejected', message: 'Malformed command file'}); }
  }
  async disconnected(code) {
    for (const timer of [this.heartbeat, this.renewal]) { clearInterval(timer); this.timers.delete(timer); }
    this.controller.reset(); this.readyRequested = false;
    if (this.stopping) return;
    this.status({connected: false, state: 'reconnecting'});
    this.diagnostic({type: 'disconnected', code});
    while (!this.stopping && this.reconnects < this.config.maxReconnects) {
      await delay(1000 * 2 ** this.reconnects++);
      if (this.stopping) return;
      try { await this.connect(); return; }
      catch (error) { this.diagnostic({type: 'reconnect-error', message: error.message}); }
    }
    if (!this.stopping) await this.stop('reconnect-limit');
  }
  async stop(reason) {
    if (this.stopping) return;
    this.stopping = true;
    this.controller.stopMovement();
    clearTimeout(this.deadline);
    for (const timer of this.timers) clearInterval(timer);
    this.socket?.close();
    const terminate = setTimeout(() => this.socket?.terminate(), 2000); terminate.unref();
    if (this.admission) {
      try { await this.session.request('/api/arena/connection/release', this.admission); }
      catch (error) { this.diagnostic({type: 'release-error', message: error.message}); }
    }
    this.status({connected: false, state: 'stopped', reason});
    this.recorder?.close();
    if (this.lock !== undefined) { fs.closeSync(this.lock); fs.unlinkSync(this.lockPath); this.lock = undefined; }
  }
}
