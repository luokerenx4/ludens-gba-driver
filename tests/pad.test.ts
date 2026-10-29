import { expect, test } from "bun:test";
import type { ControllerContext, ToolArguments } from "../src/contracts.ts";
import { createGbaProvider } from "../src/provider.ts";
import { createBridgeFixture, type BridgeRequest } from "./bridge-fixture.ts";
import { call } from "./driver-fixture.ts";

async function until(check: () => boolean) {
  const deadline = performance.now() + 2_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Bridge fixture condition timed out");
    await Bun.sleep(1);
  }
}

async function padFixture(options: { delayRelease?: boolean } = {}) {
  let active: BridgeRequest | undefined;
  const complete = (outcome: "completed" | "interrupted") => {
    const action = active;
    active = undefined;
    action?.reply("OK", outcome, 10, 40);
  };
  const fixture = await createBridgeFixture(request => {
    if (request.operation === "HELLO") request.reply("OK", 60, 1);
    else if (request.operation === "OWN") request.reply("OK");
    else if (request.operation === "APPLY") active = request;
    else if (request.operation === "STOP" || request.operation === "DISOWN") {
      request.reply("OK");
      if (!options.delayRelease) complete("interrupted");
    } else request.reply("ERROR", `Unexpected ${request.operation}`);
  });
  const provider = await createGbaProvider({ port: fixture.port,
    clock: { id: "pad-test", now: () => performance.now() } });
  const tool = (name: string) => provider.capabilities.controllers.find(controller => controller.tool.name === `pad.${name}`)!;
  return {
    ...fixture, provider, tool, complete,
    whenApplied: () => until(() => !!active),
    execute: (name: string, args: ToolArguments, context: ControllerContext) => call(tool(name), args, context),
    async close() { provider.close(); await fixture.close(); },
  };
}

const inputs = [{ atMs: 0, durationMs: 500, state: { LEFT: 1 } }, { atMs: 0, durationMs: 300, state: { B: 1 } }];
const context = (epoch = "test-epoch"): ControllerContext => ({ epoch, signal: new AbortController().signal });

// The provider-level lifecycle cases also apply to the original native pad test:
// caller/wait cancellation leaves the action running; ownership release stops it.
test("submitted GBA actions survive caller and waiter cancellation and record one terminal event", async () => {
  const fixture = await padFixture();
  try {
    const caller = new AbortController();
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const request = { ...context(), signal: caller.signal,
      record: (type: "action_start" | "action_end", data: Record<string, unknown>) => events.push({ type, data }) };
    await fixture.tool("play").acquire!(request.epoch!);
    const started = await fixture.execute("play", { inputs }, request);
    await fixture.whenApplied();
    const apply = fixture.requests.find(request => request.operation === "APPLY")!;
    expect(apply.args).toEqual([request.epoch!, "34:18,32:12"]);
    expect(started.result.structuredContent).toMatchObject({ status: "running" });
    caller.abort();

    const waiter = new AbortController();
    const waiting = fixture.execute("wait", { actionId: started.actionId }, { ...context(), signal: waiter.signal });
    const cancelled = waiting.then(() => undefined, error => error);
    waiter.abort();
    expect(await cancelled).toBeInstanceOf(Error);
    expect((await fixture.execute("status", { actionId: started.actionId }, context())).result.structuredContent)
      .toMatchObject({ status: "running" });
    expect(fixture.requests.some(request => request.operation === "STOP")).toBe(false);

    fixture.complete("completed");
    const finished = await fixture.execute("wait", { actionId: started.actionId }, context());
    expect(finished).toMatchObject({ status: "completed", exitCode: 0 });
    expect(finished.result.structuredContent).toMatchObject({ status: "completed", startFrame: 10, endFrame: 40, frames: 30 });
    expect(events.map(event => event.type)).toEqual(["action_start", "action_end"]);
    expect(events[1].data).toMatchObject({ actionId: started.actionId, status: "completed" });
  } finally { await fixture.close(); }
});

test("GBA waiting play rejects overlapping actions and explicit cancellation completes the original waiter", async () => {
  const fixture = await padFixture();
  try {
    await fixture.tool("play").acquire!(context().epoch!);
    const waiting = fixture.execute("play", { inputs, wait: true }, context());
    await fixture.whenApplied();
    await expect(fixture.execute("play", { inputs }, context())).rejects.toThrow("BUSY");
    const actionId = fixture.requests.find(request => request.operation === "APPLY")!.id;
    const cancelled = await fixture.execute("cancel", { actionId }, context());
    expect(cancelled).toMatchObject({ status: "interrupted", exitCode: 130 });
    expect(await waiting).toMatchObject({ actionId, status: "interrupted", exitCode: 130 });
    expect(fixture.requests.filter(request => request.operation === "STOP")).toHaveLength(1);
  } finally { await fixture.close(); }
});

test("revoking the control signal stops an asynchronous GBA action", async () => {
  const fixture = await padFixture();
  try {
    const control = new AbortController();
    await fixture.tool("play").acquire!(context().epoch!);
    const started = await fixture.execute("play", { inputs }, { ...context(), controlSignal: control.signal });
    await fixture.whenApplied();
    control.abort();
    const finished = await fixture.execute("wait", { actionId: started.actionId }, context());
    expect(finished).toMatchObject({ status: "interrupted", exitCode: 130 });
    expect(fixture.requests.find(request => request.operation === "STOP")?.args).toEqual([context().epoch!, started.actionId!]);
  } finally { await fixture.close(); }
});

test("ownership release waits for the terminal action reply and clears previous-epoch lookups", async () => {
  const fixture = await padFixture({ delayRelease: true });
  try {
    await fixture.tool("play").acquire!(context().epoch!);
    const started = await fixture.execute("play", { inputs }, context());
    await fixture.whenApplied();
    let released = false;
    const releasing = fixture.tool("play").release!(context().epoch!).then(() => { released = true; });
    await until(() => fixture.requests.some(request => request.operation === "DISOWN"));
    await expect(fixture.execute("status", { actionId: started.actionId }, context())).rejects.toThrow("STALE_EPOCH");
    await expect(fixture.tool("play").acquire!("next-epoch")).rejects.toThrow("BUSY");
    expect(released).toBe(false);
    fixture.complete("interrupted");
    await releasing;
    await fixture.tool("play").acquire!("next-epoch");
    await expect(fixture.execute("status", { actionId: started.actionId }, context("next-epoch")))
      .rejects.toThrow("Unknown action in this control epoch");
    await expect(fixture.execute("play", { inputs }, context())).rejects.toThrow("STALE_EPOCH");
  } finally { await fixture.close(); }
});
