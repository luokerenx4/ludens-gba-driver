# @ludens-community/driver-mgba

Community GBA driver for the Baseware device service. Speaks the
socket-bridge protocol (`docs/reference/driver-bridge-protocol.md` in the host repo)
to a scripted mGBA 0.10.5 instance.

## Install in Ludens

With Ludens's `baseware` and `rsa` CLIs on `PATH`, use a reviewed commit as
`<revision>` below. Discovery installs and checks the driver package; it does
not install or start mGBA. Run `rsa init` in a new workspace directory outside
the source checkout:

```sh
baseware driver discover --package 'github:luokerenx4/ludens-gba-driver#<revision>'
mkdir -p /absolute/path/to/workspace
cd /absolute/path/to/workspace
rsa init --driver mgba \
  --driver-package 'github:luokerenx4/ludens-gba-driver#<revision>'
rsa up --dry-run
```

Prepare mGBA, the ROM and `bridge.lua` manually as described below before
running `rsa up`. Do not pass `--game`: this driver connects to the prepared
instance. For a custom bridge port, set the same `port` in `rsa.json`.
For local development, use
`--driver-package file:/absolute/path/to/ludens-gba-driver`.

## Backend

mGBA itself is [upstream software](https://mgba.io), not shipped here.
The bridge supports mGBA `0.10.5`. Baseware's recorded real-device validation
also covers capture, input, disconnect release and reconnection with official
development build `0.11-9161-1509d8602`
([fixed macOS download](https://s3.amazonaws.com/mgba/build/mGBA-build-2026-10-25-macos-9161-1509d86028c7df2d844b590723a80b2978f49e7c.dmg)).
Before upgrading, quit the emulator and back up the application, configuration
and `.sav` files.

1. Open mGBA and load a ROM manually. mGBA workspaces do not use a `game` field
   in `rsa.json`.
2. Open **Tools → Scripting**, then load this package's `bridge.lua` through
   **File → Load script**, or run this in the scripting console:

   ```lua
   dofile("/absolute/path/to/ludens-gba-driver/bridge.lua")
   ```

3. Wait for `RSA bridge listening on 127.0.0.1:47653 (manual)`. The Scripting
   window may then be closed, but keep the emulator running: pausing it also
   pauses frame callbacks, screen capture and ownership handoff.

Running `dofile` again closes the old bridge and reloads the script. To use a
different port, set the Lua global **before** loading the bridge:

```lua
RSA_BRIDGE_PORT = 47753
dofile("/absolute/path/to/ludens-gba-driver/bridge.lua")
```

Set the workspace's `rsa.json` `port` to the same value. Each bridge port accepts
one Baseware connection at a time; separate emulator instances need distinct
ports.

### GBA save types

Some Chinese Emerald ROM hacks require **SRAM 64 KiB**. If detected as Flash 1Mb,
in-game saving can fail. The `0.11-9161` build above includes the
[user override priority fix](https://github.com/mgba-emu/mgba/commit/5337ae7ae14daaf0aecd4d2c40429fc31440b245).
For affected ROMs, add `savetype=SRAM512` to their
`[override.<four-character game code>]` section in `~/.config/mgba/config.ini`.
A ROM with an empty game code uses `[override.]`, which affects every ROM with
an empty code; do not apply that override indiscriminately.

Verify by saving in-game, quitting the emulator completely, then reopening the
game and loading the save. Some hacks' two save slots overlap within the 64 KiB
address space and can still report a damaged save after a successful cold load.
Keep a separate `.sav` backup.

## Kit sources

`src/bridge.ts`, `pad.ts`, `timeline.ts`, `schema.ts`, `capture.ts`,
`contracts.ts` and `tool-contract.ts` are adapted from the Baseware
reference implementation. Behavior follows the bridge protocol spec;
this package carries no host dependency.

## Development

From this package directory, install dependencies and run the checks:

```sh
bun install
bun run test
bun run typecheck
```

The default tests run independently of the host repository. They cover GBA
frame encoding and capability schemas, capture-file cleanup, TCP framing and
disconnects, and pad/timeline lifecycle behavior using local fixtures on
automatically assigned ports. They do not connect to mGBA or a model.
Type checking includes both source and test files.

### Live bridge reconnection test

`tests/bridge.live.test.ts` is skipped unless `RSA_BRIDGE_TEST=1` is set. It sends
real controller input, disconnects during a held input, then checks release,
reconnection and capture. Use a dedicated mGBA instance with a disposable game
state or a backed-up save. Load a ROM and this package's bridge on an unused
port as shown above, keep the emulator running, and ensure no Host or Baseware
client is connected to that instance.

Run only the live test, passing the same port explicitly:

```sh
RSA_BRIDGE_TEST=1 RSA_BRIDGE_PORT=47753 bun test tests/bridge.live.test.ts
```

The test refuses to run without a valid explicit port. The shell variable
selects the test's connection; it does not configure mGBA's Lua global.
