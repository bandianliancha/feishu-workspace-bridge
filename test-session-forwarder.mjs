import assert from "node:assert/strict";
import { createSessionForwarder } from "./index.mjs";

const calls = [];
const controller = {
  async prompt(request, signal) {
    signal.throwIfAborted();
    calls.push({ request, signal });
    return { accepted: true };
  }
};
const forward = createSessionForwarder({
  get(name) {
    assert.equal(name, "sessionController");
    return controller;
  }
});

const result = await forward("session-1", "来自飞书", "om_message-1");
assert.deepEqual(result, { accepted: true });
assert.equal(calls.length, 1);
assert.equal(calls[0].request.requestId, "feishu-om_message-1");
assert.equal(calls[0].request.sessionId, "session-1");
assert.equal(calls[0].request.mode, "queue");
assert.deepEqual(calls[0].request.content, [{ type: "text", text: "来自飞书" }]);
console.log("Feishu session forwarder passed");
