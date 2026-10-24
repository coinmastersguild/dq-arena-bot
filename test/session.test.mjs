import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cookieHeader, ArenaSession} from '../src/session.mjs';
import {redact, Recorder} from '../src/recording.mjs';
import {loadConfig} from '../src/config.mjs';

test('cookie selection enforces domain, expiry, secure flag and root path', () => {
  const text = ['#HttpOnly_example.com\tFALSE\t/\tTRUE\t0\tsession\tfake',
    'evil.com\tFALSE\t/\tTRUE\t0\twrong\tno', 'example.com\tFALSE\t/\tTRUE\t1\texpired\tno',
    'example.com\tFALSE\t/admin\tTRUE\t0\tpath\tno'].join('\n');
  assert.equal(cookieHeader(text, 'https://example.com'), 'session=fake');
  assert.equal(cookieHeader(text, 'http://example.com'), '');
  assert.equal(cookieHeader(text, 'https://notexample.com'), '');
});
test('recorder removes structured credentials recursively and bounds storage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-record-test-'));
  try {
    assert.deepEqual(redact({ticket: 'secret', events: [{private_key: 'secret', id: 1}]}), {events: [{id: 1}]});
    const recorder = new Recorder(dir, {token: 'secret', controllerVersion: 'test'}, {maxBytes: 100});
    recorder.write('received', {ticket: 'secret', text: 'x'.repeat(200)});
    assert.equal(recorder.truncated, true); recorder.close();
    assert.ok(!fs.readFileSync(path.join(recorder.directory, 'manifest.json'), 'utf8').includes('secret'));
  } finally { fs.rmSync(dir, {recursive: true}); }
});
test('API uses session cookie, release header and rejects redirects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-session-test-'));
  try {
    const file = path.join(dir, 'cookies.txt');fs.writeFileSync(file, 'example.com\tFALSE\t/\tTRUE\t0\tsession\tfake');
    let request;
    const session = new ArenaSession({origin: 'https://example.com', cookieFile: file,
      fetchImpl: async (url, options) => { request = {url, options}; return {ok: true, json: async () => ({ok: true})}; }});
    session.release = 'build'; await session.request('/api/arena/seat');
    assert.equal(request.options.headers.Cookie, 'session=fake');
    assert.equal(request.options.headers['X-DQ-Arena-Release'], 'build'); assert.equal(request.options.redirect, 'error');
    await assert.rejects(session.request('//evil.com'), /same-origin/);
    assert.throws(() => new ArenaSession({origin: 'http://example.com'}), /HTTPS/);
  } finally { fs.rmSync(dir, {recursive: true}); }
});
test('configuration has no automatic readiness and bounds lifecycle settings', () => {
  assert.equal(loadConfig().side, null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-config-test-'));
  try {
    const file = path.join(dir, 'bad.json');fs.writeFileSync(file, JSON.stringify({maxReconnects: 50}));
    assert.throws(() => loadConfig(file), /Reconnects/);
  } finally { fs.rmSync(dir, {recursive: true}); }
});
