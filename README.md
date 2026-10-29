# @ludens-community/driver-mgba

Community GBA driver for the Baseware device service. Speaks the
socket-bridge protocol (`docs/driver-bridge-protocol.md` in the host repo)
to a scripted mGBA 0.10.5 instance.

## Backend

mGBA itself is upstream software (https://mgba.io), not shipped here.
Install mGBA 0.10.5, open a ROM, then load `bridge.lua` via
Tools > Scripting > File > Load script. The bridge listens on
`RSA_BRIDGE_PORT` (default 47653).

## Kit sources

`src/bridge.ts`, `pad.ts`, `timeline.ts`, `schema.ts`, `capture.ts`,
`contracts.ts` and `tool-contract.ts` are adapted from the Baseware
reference implementation. Behavior follows the bridge protocol spec;
this package carries no host dependency.

## Development

From this package directory, install dependencies and check all source types:

```sh
bun install
bun run typecheck
```

The type check runs independently of the host repository and does not connect
to mGBA.
