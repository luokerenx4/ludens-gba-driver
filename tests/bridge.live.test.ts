import { expect, test } from "bun:test";
import { createGbaProvider } from "../src/provider.ts";

test.skipIf(process.env.RSA_BRIDGE_TEST !== "1")("bridge survives repeated disconnects, including a connection lost during input", async () => {
  const port = Number(process.env.RSA_BRIDGE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Set RSA_BRIDGE_PORT to the dedicated test instance's bridge port");
  }
  for (let i = 0; i < 5; i++) {
    const provider = await createGbaProvider({ port, clock: { id: "test", now: () => performance.now() } });
    try {
      const tool = (name: string) => provider.capabilities.controllers.find(c => c.tool.name === name)!;
      const controller = tool("pad.play");
      const epoch = crypto.randomUUID();
      await controller.acquire!(epoch);
      if (i === 0) {
        const context = { epoch, signal: new AbortController().signal };
        const action = JSON.parse((await controller.execute({ inputs: [{ atMs: 0, durationMs: 30000, state: { LEFT: 1 } }] }, context)).stdout);
        const outcome = tool("pad.wait").execute({ actionId: action.actionId }, context);
        await Bun.sleep(50);
        provider.close();
        const result = await outcome;
        expect(result.status).toBe("failed");
        expect(result.stderr).toContain("disconnected");
      } else {
        const result = await tool("pad.state").execute({}, { epoch, signal: new AbortController().signal });
        expect(Object.values(JSON.parse(result.stdout).state).every(value => value === 0)).toBe(true);
        const captured = await tool("screen.capture").execute({}, { signal: new AbortController().signal });
        const block = captured.result.content[captured.observations![0].contentIndex!];
        expect(block.type).toBe("image");
        if (block.type === "image") expect(Buffer.from(block.data, "base64").length).toBeGreaterThan(100);
        await controller.release!(epoch);
      }
    } finally {
      provider.close();
    }
    await Bun.sleep(80); // Let mGBA's frame callback observe peer closure.
  }
}, 10000);
