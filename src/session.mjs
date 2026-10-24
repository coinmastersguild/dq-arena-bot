import fs from 'node:fs';

export function cookieHeader(text, origin, now = Date.now()) {
  const url = new URL(origin);
  return text.split('\n').filter(line => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
    .map(line => line.replace(/^#HttpOnly_/, '').trimEnd().split('\t'))
    .filter(row => {
      if (row.length !== 7) return false;
      const [domain, subdomains, path, secure, expires] = row;
      const host = domain.replace(/^\./, '');
      return (url.hostname === host || (subdomains === 'TRUE' && url.hostname.endsWith('.' + host))) &&
        path === '/' && (secure !== 'TRUE' || url.protocol === 'https:') &&
        (expires === '0' || Number(expires) * 1000 > now);
    }).map(row => `${row[5]}=${row[6]}`).join('; ');
}

export class ArenaSession {
  constructor({origin, cookieFile, fetchImpl = fetch}) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('origin must be an HTTPS origin without credentials or path');
    }
    this.origin = url.origin; this.cookieFile = cookieFile; this.fetch = fetchImpl;
  }
  headers() {
    const cookie = cookieHeader(fs.readFileSync(this.cookieFile, 'utf8'), this.origin);
    if (!cookie) throw new Error('No unexpired session cookie for configured origin; sign in first');
    return {Origin: this.origin, Cookie: cookie, 'Content-Type': 'application/json',
      ...(this.release ? {'X-DQ-Arena-Release': this.release} : {})};
  }
  async request(path, body) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected same-origin API path');
    const headers = this.headers();
    let response;
    try {
      response = await this.fetch(this.origin + path, {method: body === undefined ? 'GET' : 'POST',
        headers, redirect: 'error', signal: AbortSignal.timeout(30000),
        ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    } catch (error) { throw new Error(`${path.split('?')[0]}: ${error.cause?.code || 'request failed'}`); }
    if (!response.ok) {
      const error = new Error(`${path.split('?')[0]}: HTTP ${response.status}`); error.status = response.status; throw error;
    }
    return response.json();
  }
}
