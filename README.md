# Tonight

> **Story-first movie tracking & recommendations.** Cross-platform (Android APK, iOS PWA, Web), built with a $0 infrastructure budget.

**Tonight** matches films by **story DNA** — plot structure, narrative themes, and setting — rather than crowd collaborative filtering ("users who liked X also liked Y"). Crowd signals (IMDb votes & ratings) are used strictly as a quality floor and an adjustable **Discovery Dial** (from crowd favourites to hidden gems).

---

## Architecture Overview

This repository is a **Bun** TypeScript monorepo:

```text
Tonight/
├─ apps/
│  └─ app/                 # @tonight/app — Expo + Expo Router (Android, iOS PWA, Web)
├─ packages/
│  └─ shared/              # @tonight/shared — Pure scoring math, constants, DTOs & Zod schemas
├─ pipeline/               # @tonight/pipeline — Wikidata/Wikipedia/IMDb ingestion, gte-small embeddings & eval
├─ supabase/               # Postgres + pgvector migrations, RLS policies, pgTAP tests & Deno Edge Functions
└─ .github/workflows/      # CI, nightly delta pipeline, encrypted DB backups & web deploy
```

### Data & Licensing Wall

- **Story / ML layer (`movies`, `movie_embeddings`, `people`, `moods`):** Populated exclusively from open/non-commercial sources — **Wikidata (CC0)**, **English Wikipedia plots (CC BY-SA)**, and **IMDb non-commercial datasets**.
- **Display layer (`tmdb_cache` via `tmdb-proxy` Edge Function):** Posters, backdrops, cast/crew display credits, and regional streaming providers (**JustWatch** via TMDB) are fetched on demand for display only and never enter embeddings, ML tables, or recommendation scoring.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) `>= 1.2`
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for local DB / Edge Functions in Phase 1+)

### Install & Verify

```bash
bun install
bun run typecheck
bun run lint
bun run test
```

### Workspace Commands

| Command                           | Description                                                 |
| --------------------------------- | ----------------------------------------------------------- |
| `bun run typecheck`               | Run TypeScript `tsc --noEmit` across all workspaces         |
| `bun run lint`                    | Run ESLint across all workspaces                            |
| `bun run test`                    | Run unit tests in `@tonight/shared` and `@tonight/pipeline` |
| `bun run format`                  | Format repository with Prettier                             |
| `bun --filter @tonight/app start` | Launch the Expo development server                          |

---

## Local Planning Docs

Detailed architecture specifications, database schema, recommendation math, design system tokens, and phase checklists live in [`local/README.md`](local/README.md) (local-only, gitignored).
