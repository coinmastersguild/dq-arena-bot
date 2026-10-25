import fs from 'node:fs';

export function lockOwner(file) {
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Invalid process lock; operator inspection needed');
  try { process.kill(pid, 0); return pid; }
  catch (error) { if (error.code === 'ESRCH') return null; throw error; }
}

export function clearStaleLock(file) {
  if (lockOwner(file)) throw new Error('An existing process owns the lock');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function acquireProcessLock(file) {
  clearStaleLock(file);
  const fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid));
  return () => { fs.closeSync(fd); fs.unlinkSync(file); };
}
