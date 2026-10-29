import { createServer, type AddressInfo, type Socket } from "node:net";

export interface BridgeRequest {
  id: string;
  operation: string;
  args: string[];
  socket: Socket;
  reply(status: "OK" | "ERROR", ...fields: (string | number)[]): void;
}

/** An isolated protocol peer; never connects to an installed emulator. */
export async function createBridgeFixture(handle: (request: BridgeRequest) => void) {
  const requests: BridgeRequest[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const [id, operation, ...args] = buffer.slice(0, end).split("\t");
        buffer = buffer.slice(end + 1);
        const request: BridgeRequest = { id, operation, args, socket,
          reply(status, ...fields) { socket.write([id, status, ...fields].join("\t") + "\n"); } };
        requests.push(request);
        handle(request);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
