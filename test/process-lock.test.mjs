import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquireProcessLock, clearStaleLock, lockOwner} from '../src/process-lock.mjs';

test('locks reject live owners, recover dead workers and refuse malformed data', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-lock-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'runner.lock');
  const unlock = acquireProcessLock(file); assert.equal(lockOwner(file), process.pid);
  assert.throws(() => clearStaleLock(file), /existing process/); unlock();
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']); const pid = child.pid;
  await once(child, 'exit'); fs.writeFileSync(file, String(pid));
  clearStaleLock(file); assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'not-a-pid'); assert.throws(() => clearStaleLock(file), /Invalid process lock/);
});
