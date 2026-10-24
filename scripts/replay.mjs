import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {CombatController, CONTROLLER_VERSION} from '../src/controller.mjs';
const [input, catalog] = process.argv.slice(2);
if (!input || !catalog) {
  console.error('Usage: npm run replay -- <events.jsonl|run-directory> <native-rules.json>'); process.exitCode = 1;
} else {
  const counts = {}, diagnostics = []; let firstCoachTick = null, firstCastTick = null, events = 0;
  const controller = new CombatController({send: m => {
    const key = m.cmd || m.t; counts[key] = (counts[key] || 0) + 1;
    if (m.cmd === 'coach' && firstCoachTick === null) firstCoachTick = controller.tick;
    if (m.cmd === 'cast' && firstCastTick === null) firstCastTick = controller.tick;
  }, onDiagnostic: d => diagnostics.push(d)});
  controller.setRules(JSON.parse(fs.readFileSync(catalog, 'utf8')));
  const file = fs.statSync(input).isDirectory() ? path.join(input, 'events.jsonl') : input;
  for await (const line of readline.createInterface({input: fs.createReadStream(file), crlfDelay: Infinity})) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.kind === 'received') { controller.observe(record.data); events++; }
  }
  console.log(JSON.stringify({controllerVersion: CONTROLLER_VERSION, events, counts, firstCoachTick, firstCastTick, diagnostics,
    limitation: 'Open-loop replay: outputs do not alter recorded positions or outcomes. This does not predict a win.'}, null, 2));
}
