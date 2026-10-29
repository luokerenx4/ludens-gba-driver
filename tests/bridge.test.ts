import { expect, test } from "bun:test";
import { Bridge } from "../src/bridge.ts";
import { createBridgeFixture, type BridgeRequest } from "./bridge-fixture.ts";

test("bridge correlates out-of-order replies and buffers incomplete response lines", async () => {
  let first: BridgeRequest | undefined;
  const fixture = await createBridgeFixture(request => {
    if (request.operation === "FIRST") first = request;
    else {
      request.socket.write(`${request.id}\tOK\tsecond\n${first!.id}\tOK\tpart`);
      setTimeout(() => request.socket.write("ial\n"), 10);
    }
  });
  const bridge = await Bridge.open(fixture.port);
  try {
    const firstReply = bridge.request("FIRST");
    const secondReply = bridge.request("SECOND");
    expect(await secondReply).toEqual(["second"]);
    expect(await firstReply).toEqual(["partial"]);
  } finally {
    bridge.close();
    await fixture.close();
  }
});

test("bridge rejects protocol errors and delimiter injection without losing the connection", async () => {
  const fixture = await createBridgeFixture(request => {
    if (request.operation === "FAIL") request.reply("ERROR", "fixture failure");
    else request.reply("OK", "ready");
  });
  const bridge = await Bridge.open(fixture.port);
  try {
    await expect(bridge.request("FAIL")).rejects.toThrow("fixture failure");
    await expect(bridge.request("BAD\nOP")).rejects.toThrow("tabs or newlines");
    await expect(bridge.request("SAFE", ["bad\targument"])).rejects.toThrow("tabs or newlines");
    expect(await bridge.request("READY")).toEqual(["ready"]);
    expect(fixture.requests.map(request => request.operation)).toEqual(["FAIL", "READY"]);
  } finally {
    bridge.close();
    await fixture.close();
  }
});

test("peer disconnect rejects all pending requests and later calls report the same failure", async () => {
  const fixture = await createBridgeFixture(request => {
    if (request.operation === "DISCONNECT") request.socket.destroy();
  });
  const bridge = await Bridge.open(fixture.port);
  const failures: Error[] = [];
  bridge.onDisconnect = error => failures.push(error);
  try {
    const pending = Promise.allSettled([bridge.request("PENDING"), bridge.request("DISCONNECT")]);
    const results = await pending;
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(failures).toHaveLength(1);
    await expect(bridge.request("AFTER")).rejects.toBe(failures[0]);
  } finally {
    bridge.close();
    await fixture.close();
  }
});
