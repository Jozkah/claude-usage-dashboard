# Claude usage dashboard

Live usage limits for every Claude account you track: 5-hour and weekly limits, reset countdowns,
pace, history, and which account has the most room right now. Works on Windows, macOS and Linux.

Usage is tracked by Anthropic per account, so what you use on your phone or other computers
shows up here too.

## Run it

You need [Node.js 18+](https://nodejs.org).

```bash
npm install
npm run dev
```

Your browser opens at <http://localhost:5173>. No accounts logged in yet? Preview it with fake data:

```bash
npm run dev:mock
```

### Run it as a single process (no dev server)

```bash
npm install
npm run build
npm start          # http://localhost:4777
```

## Run it in Docker

```bash
docker compose up -d --build
```

Open <http://localhost:4777>.

Edit `docker-compose.yml` to point at your accounts. Each folder mounted under `/accounts`
becomes one account, named after the folder:

```yaml
volumes:
  - ~/.claude:/accounts/personal:ro
  - ~/.claude-work:/accounts/work:ro
```

On Windows use paths like `C:/Users/you/.claude:/accounts/personal:ro`.

Docker limits:
- **macOS:** Claude Code keeps the login in the Keychain, which a container can't read. Use
  `npm run dev` / `npm start` on a Mac instead.
- **Linux:** the container runs as user 1000. If your login file is only readable by another user,
  add `user: "${UID}:${GID}"` to the service.

## Accounts

The dashboard finds `~/.claude` (Personal) and `~/.claude-work` (Work, if it exists) by itself.
Use **Add account** in the sidebar for others: give it a name and the account's Claude config folder
(its `CLAUDE_CONFIG_DIR`). Log in there once with Claude Code first. The list is saved in
`~/.claude-usage-dashboard.json`, and usage history in `~/.claude-usage-history.json`
(or in `DATA_DIR` if you set it).

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4777` | API / production server port |
| `HOST` | `127.0.0.1` | Interface to listen on |
| `MOCK` | off | `1` shows fake sample data |
| `DATA_DIR` | home folder | Where the account list and history are saved |
| `ALLOWED_HOSTS` | | Extra host names allowed, comma separated (to open it from another device) |
| `ALLOW_ANY_HOST` | off | `1` accepts any host name. Only on a network you trust |
| `NO_OPEN` | off | `1` stops it opening the browser on start |

To open it from your phone on the same Wi-Fi: `HOST=0.0.0.0 ALLOWED_HOSTS=<your-pc-ip> npm start`.
That lets anyone on your network see your usage percentages (never your logins).

## How it works, and what to know

- The server reads each account's login file locally and asks Anthropic for the usage numbers.
  Tokens never reach the browser.
- It uses an **unofficial, undocumented endpoint** (the one Claude Code's `/usage` uses). It can
  change or stop working without notice. If the format changes, the card shows the raw response.
- It never refreshes or changes a login. If a card says the login expired, open Claude Code with
  that account once.
- History starts when you first run the dashboard and grows while it is running.
- The trend charts, rings and counters are animated. Animations switch off automatically if your
  system asks for reduced motion.
