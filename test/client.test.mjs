import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaClient} from '../src/client.mjs';

function client() {
  const c = new ArenaClient({origin: 'https://example.com', cookieFile: '/unused', spec: 'frost_mage', side: 'freehold'});
  const sent = [];
  c.send = m => sent.push(m); c.status = () => {}; c.diagnostic = () => {}; c.recorder = {write() {}};
  return {c, sent};
}
const lobby = side => ({t: 'lobby', state: 'lobby', sides: {[side]: [{you: true, name: 'Example'}]}, leaders: {}});
test('default connection never readies and side selection precedes explicit readiness', () => {
  const {c, sent} = client(); c.message(lobby('coinfall'));
  assert.ok(sent.some(m => m.cmd === 'team' && m.side === 'freehold'));
  assert.ok(!sent.some(m => m.ready === true));
  c.readyRequested = true; c.message(lobby('freehold'));
  assert.equal(sent.filter(m => m.ready === true).length, 1);
  c.message(lobby('freehold')); assert.equal(sent.filter(m => m.ready === true).length, 1);
});
test('disconnect clears queued readiness and combat state before recovery', async () => {
  const {c} = client(); c.readyRequested = true; c.controller.targetId = 123; c.stopping = true;
  await c.disconnected(1006);
  assert.equal(c.readyRequested, false); assert.equal(c.controller.targetId, null);
});
