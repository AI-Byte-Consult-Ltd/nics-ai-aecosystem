import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(import.meta.dirname, "../n8n/NICS_Professional_Market_Intelligence_Agent.json");
const raw = readFileSync(file, "utf8");
const workflow = JSON.parse(raw);

assert.equal(workflow.name, "NICS Professional Market Intelligence Agent V1");
assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length >= 25);
assert.ok(workflow.connections && typeof workflow.connections === "object");
assert.equal(workflow.settings.timezone, "Europe/Sofia");

const names = new Set(workflow.nodes.map((node) => node.name));
const required = [
  "TradingView Webhook", "Personal Market Query", "Runtime Config", "Fetch Batched OHLC",
  "Deterministic Technical Engine", "Fetch Economic Calendar", "Event Risk Filter",
  "Signal Lifecycle and Performance", "Fetch Trading Economics News", "Fetch GDELT News",
  "Qwen Market Explanation", "Validate and Format Report", "Send Telegram Digest", "Send WhatsApp Digest"
];
for (const name of required) assert.ok(names.has(name), "Missing node: " + name);

for (const [source, outputs] of Object.entries(workflow.connections)) {
  assert.ok(names.has(source), "Connection source does not exist: " + source);
  for (const branch of outputs.main ?? []) {
    for (const target of branch) assert.ok(names.has(target.node), "Connection target does not exist: " + target.node);
  }
}
for (const current of workflow.nodes.filter((item) => item.type === "n8n-nodes-base.code")) {
  assert.ok(current.parameters.jsCode?.length > 20, "Empty Code node: " + current.name);
  try {
    new Function(current.parameters.jsCode);
  } catch (error) {
    throw new Error("Invalid JavaScript in Code node " + current.name + ": " + error.message);
  }
}
assert.ok(!/sk-[A-Za-z0-9_-]{12,}/.test(raw), "A secret-looking API key was committed");
assert.ok(!/bot[0-9]{6,}:[A-Za-z0-9_-]{20,}/.test(raw), "A Telegram token was committed");

console.log("workflow validation: ok (" + workflow.nodes.length + " nodes)");
