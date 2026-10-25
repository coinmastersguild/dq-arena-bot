#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadConfig} from '../src/config.mjs';

const {values} = parseArgs({options: {config: {type: 'string'}}});
if (!values.config) throw new Error('--config is required');
const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = path.resolve(values.config), config = loadConfig(configFile);
const xml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const args = [process.execPath, path.join(root, 'bin/service.mjs'), '--config', configFile];
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.coinmastersguild.dq-arena-bot</string>
<key>ProgramArguments</key><array>${args.map(s => `<string>${xml(s)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>${xml(path.join(config.stateDirectory, 'service-error.log'))}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(process.execPath))}:/usr/bin:/bin</string></dict>
</dict></plist>
`;
const file = path.join(root, '.local', 'dq-arena-bot.plist');
fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
fs.writeFileSync(file, plist, {mode: 0o600});
console.log(file);
