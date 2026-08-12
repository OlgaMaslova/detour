# Detour

Detour is a network of member circles who recommend places to each other. Anyone
can sign up and start a circle; an invitation is what puts somebody inside yours.
A place is public on Detour only because a verified member recommended it — there
is no guide catalogue, no awards, and no editorial lane.

Signed-out visitors can browse everything — Explore, cities, the map, the feed,
the place pages — scoped to the places the founding circle recommends.

## Tech stack

- **Backend** — [PocketBase](https://pocketbase.io) (database, auth, and custom
  routes/hooks in JavaScript), deployed on Fly.io as `takedetour-api`.
- **Frontend** — Vite + TypeScript static app, deployed as the Cloudflare
  Worker `detour-web`.
- **Live at** — https://takedetour.app, API at https://api.takedetour.app.

Both halves live in this repository and run in Olga's own Fly and Cloudflare
accounts.

## Running locally

```sh
npm run dev:api   # PocketBase on :8090
npm run dev       # Vite on :5173
```

Copy `.env.backend.local.example` to `.env.backend.local` for backend secrets.
Local logins are in `LOCAL_DEV.md`.

## Deploying

Work happens on `dev`. Merging `dev` into `main` is the release — CI builds and
deploys both halves automatically.

## More detail

- `AGENTS.md` — engineering rules; read it before touching a migration or hook.
- `docs/` — design conventions, policies, and the self-hosting migration runbook.
