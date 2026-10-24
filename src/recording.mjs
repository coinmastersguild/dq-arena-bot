import fs from 'node:fs';
import path from 'node:path';

const sensitive = /^(cookie|set-cookie|authorization|ticket|token|signature|private[_-]?key|mnemonic|seedPhrase|raw)$/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.test(key)).map(([key, item]) => [key, redact(item)]));
}
export function privateJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temp, file);
}
export class Recorder {
  constructor(directory, metadata, {maxBytes = 64 * 1024 * 1024} = {}) {
    this.directory = path.join(directory, new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
    fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
    this.fd = fs.openSync(path.join(this.directory, 'events.jsonl'), 'wx', 0o600);
    this.bytes = 0; this.maxBytes = maxBytes; this.truncated = false;
    privateJson(path.join(this.directory, 'manifest.json'), redact(metadata));
  }
  write(kind, data) {
    if (this.fd === null || this.truncated) return;
    const line = JSON.stringify({at: Date.now(), kind, data: redact(data)}) + '\n';
    if (this.bytes + Buffer.byteLength(line) > this.maxBytes) {
      this.truncated = true;
      privateJson(path.join(this.directory, 'recording-limit.json'), {truncated: true, bytes: this.bytes});
      return;
    }
    fs.writeSync(this.fd, line); this.bytes += Buffer.byteLength(line);
  }
  result(data) { privateJson(path.join(this.directory, 'result.json'), redact(data)); }
  close() { if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; } }
}
