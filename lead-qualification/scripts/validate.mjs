// Offline checks for the lead qualification bundle. Run: node lead-qualification/scripts/validate.mjs
// - every n8n workflow parses and every connection points at a real node
// - every node name and id is unique
// - every Code node's JavaScript compiles
// - the Vapi assistant config parses and has the required fields
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL ${msg}`); };
const ok = (msg) => console.log(`ok   ${msg}`);

const workflowDir = join(root, 'n8n');
for (const file of readdirSync(workflowDir).filter((f) => f.endsWith('.json'))) {
  const wf = JSON.parse(readFileSync(join(workflowDir, file), 'utf8'));
  const names = new Set();
  const ids = new Set();
  for (const node of wf.nodes) {
    if (names.has(node.name)) fail(`${file}: duplicate node name "${node.name}"`);
    if (ids.has(node.id)) fail(`${file}: duplicate node id ${node.id}`);
    names.add(node.name);
    ids.add(node.id);

    if (node.type === 'n8n-nodes-base.code') {
      try {
        // Compile only: n8n's $input / $() globals are not available here.
        new Function(node.parameters.jsCode);
      } catch (err) {
        fail(`${file}: Code node "${node.name}" does not compile: ${err.message}`);
      }
    }
  }
  for (const [source, outputs] of Object.entries(wf.connections)) {
    if (!names.has(source)) fail(`${file}: connection from unknown node "${source}"`);
    for (const branch of outputs.main) {
      for (const link of branch) {
        if (!names.has(link.node)) fail(`${file}: "${source}" connects to unknown node "${link.node}"`);
      }
    }
  }
  // Every node except triggers should be reachable from a trigger (webhook / airtable trigger).
  const targets = new Set(Object.values(wf.connections).flatMap((o) => o.main.flat().map((l) => l.node)));
  for (const node of wf.nodes) {
    const isTrigger = /Trigger|webhook$/i.test(node.type) || node.type.endsWith('.webhook');
    if (!isTrigger && !targets.has(node.name)) fail(`${file}: node "${node.name}" is not connected to anything upstream`);
  }
  ok(`${file}: ${wf.nodes.length} nodes, ${Object.keys(wf.connections).length} connection sources`);
}

const assistant = JSON.parse(readFileSync(join(root, 'vapi', 'assistant.json'), 'utf8'));
for (const key of ['name', 'firstMessage', 'model', 'server', 'analysisPlan']) {
  if (!(key in assistant)) fail(`assistant.json: missing "${key}"`);
}
const tools = assistant.model?.tools ?? [];
if (!tools.some((t) => t.function?.name === 'book_appointment' && t.server?.url)) {
  fail('assistant.json: book_appointment tool with a server url is missing');
}
const outcomes = assistant.analysisPlan?.structuredDataSchema?.properties?.outcome?.enum ?? [];
for (const o of ['interested', 'not_interested', 'callback', 'no_answer']) {
  if (!outcomes.includes(o)) fail(`assistant.json: outcome enum missing "${o}"`);
}
ok('vapi/assistant.json: required fields, booking tool, outcome enum');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
