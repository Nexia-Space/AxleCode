# Axle desktop daemon

The daemon is the long-lived Axle server process that owns the local database,
threads, files, terminals, provider connections, and WebSocket session state.
It is separate from the Electron window, so a mobile client can remain
connected when the desktop window is closed.

## Development

From `axle-desktop/source`:

```sh
node apps/server/src/bin.ts daemon run --host 127.0.0.1 --port 3773
node apps/server/src/bin.ts daemon status
```

The daemon uses the normal Axle data directory and writes its discovery record
to `userdata/server-runtime.json`. The record is marked with `role: "daemon"`
so desktop clients can distinguish it from a short-lived app-owned backend.

## Install as a user service

After the packaged `axle` CLI is available:

```sh
axle daemon install
axle daemon status
axle daemon uninstall
```

Installation creates a per-user service:

- macOS: `~/Library/LaunchAgents/com.axle.desktop-daemon.plist`
- Linux: `~/.config/systemd/user/axle-daemon.service`
- Windows: the `Axle Desktop Daemon` scheduled task

The service is intentionally user-scoped. It does not require administrator
privileges and uses the same Axle data directory as the desktop application.

## Pairing

The existing pairing-token and scoped-session APIs are the daemon's mobile
connection protocol. The desktop UI should create a short-lived token through
`POST /api/auth/pairing-token`, render the returned pairing URL as a QR code,
and the mobile app should exchange it for a scoped session before opening its
WebSocket. No database or thread state is duplicated in the mobile app.

The desktop-to-daemon attach path is intentionally a separate integration
step: until it is enabled in the desktop shell, the desktop app continues to
use its existing child backend and the daemon should be run on its own port or
with a separate data directory during development.
