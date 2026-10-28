// Community GBA driver: socket-bridge provider for mGBA 0.10.5.
// Kit files (bridge/pad/timeline/schema/capture/contracts/tool-contract) are
// adapted from the Baseware reference implementation; see README for sources.
// Load the bridge script in mGBA via Tools > Scripting > File > Load script: bridge.lua.
import type { Clock } from "./contracts.ts";
import { createGbaProvider } from "./provider.ts";
import type { DriverProvider } from "./registration.ts";

export type { DriverProvider };
export { createGbaProvider };

export interface GbaDriverOptions {
  port: number;
  clock: Clock;
}

const registration = {
  id: "mgba",
  transport: "bridge",
  defaultPort: 47653,
  fallbackVersion: "0.10.5",
  launchHint: "Open the ROM in mGBA and load bridge.lua (see this package) in Tools → Scripting.",
  load: async (options: { port?: number; clock: Clock }): Promise<DriverProvider> =>
    createGbaProvider({ port: options.port!, clock: options.clock }),
};

export default registration;
