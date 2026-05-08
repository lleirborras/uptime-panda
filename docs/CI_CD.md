# CI/CD Pipeline

This document describes the full automated pipeline: from a pull request to a versioned Docker image on GHCR.

---

## Overview

```
Developer opens PR
        │
        ▼
┌─────────────────────────────────┐
│  CI checks (must pass to merge) │
│  • check-linters                │
│  • auto-test (ubuntu-22.04, 20) │
└─────────────────────────────────┘
        │ PR merged
        ▼
┌─────────────────────────────────┐
│  version-bump workflow          │
│  • parse PR title               │
│  • npm version patch/minor/major│
│  • push commit + tag vX.Y.Z     │
│  • create GitHub Release        │
└─────────────────────────────────┘
        │ release published
        ▼
┌─────────────────────────────────┐
│  docker-publish workflow        │
│  • npm ci && npm run build      │
│  • buildx: amd64, arm64, arm/v7 │
│  • push to GHCR (2 variants)    │
└─────────────────────────────────┘
```

---

## Branch protection

`master` is protected. All changes **must** go through a pull request.

| Rule | Detail |
|---|---|
| Direct pushes blocked | Only the `GITHUB_TOKEN` bot can bypass (`enforce_admins: false`) |
| Required checks | `check-linters` and `auto-test (ubuntu-22.04, 20)` must pass |
| Force pushes | Disabled |
| Branch deletion | Disabled |

The bot bypass exists solely for the automated version-bump commit. No human should push directly to `master`.

---

## Workflows

### `validate.yml` — Lint and style check

**Trigger:** every push + every PR  
**Jobs:** `check-linters`

Runs:
```bash
npm run lint:prod   # ESLint (js + vue) + Stylelint
```

Also runs `autofix.yml` which applies Prettier auto-formatting and commits the diff back to the PR branch.

---

### `auto-test.yml` — Backend + E2E test matrix

**Trigger:** every push + every PR  
**Matrix:** `ubuntu-22.04`, `ubuntu-22.04-arm`, `macos-latest`, `windows-latest` × Node 20, 24 (+ Node 25 on Ubuntu)

Runs:
```bash
npm run test-backend-22   # node:test built-in runner
npm run test-e2e          # Playwright
```

Required check for merge: `auto-test (ubuntu-22.04, 20)`.

---

### `pr-title.yml` — Conventional commit title validation

**Trigger:** PR opened / edited / reopened / synchronised  
**Action:** [`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request)

Enforces the format:
```
<type>(<optional scope>): <description>
```

Valid types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`, `chore`, `build`, `ci`.  
Breaking change: append `!` before the colon (`feat!: …`).

---

### `version-bump.yml` — Automatic semantic versioning

**Trigger:** PR merged into `master` (skips PRs titled `chore: bump version …`)  
**Workflow:** [`.github/workflows/version-bump.yml`](../.github/workflows/version-bump.yml)

#### Semver mapping

| PR title pattern | Bump | Example |
|---|---|---|
| `<type>!:` or `<type>(<scope>)!:` | **major** | `feat!: drop Node 18 support` |
| `feat:` or `feat(<scope>):` | **minor** | `feat(db): add PostgreSQL support` |
| anything else | **patch** | `fix: correct heartbeat interval` |

#### What it does

1. Checks out `master` with `GITHUB_TOKEN` (admin bypass)
2. Parses the merged PR title with a regex
3. Runs `npm version <patch|minor|major>` — updates `package.json` + `package-lock.json`, creates a commit and a local tag
4. Pushes the commit and the `vX.Y.Z` tag to `master`
5. Creates a GitHub Release at that tag with `gh release create --generate-notes`

The release notes are auto-generated from the PR titles merged since the previous release.

---

### `docker-publish.yml` — Multi-platform Docker images

**Trigger:** GitHub Release published (i.e., fires after `version-bump.yml` creates one)  
**Workflow:** [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml)

#### Build steps

1. Checks out the tagged commit
2. `npm ci && npm run build` — builds the Vite frontend into `dist/`  
   *(the Dockerfile copies `dist/` in via `COPY . .`)*
3. Sets up QEMU + Docker Buildx for cross-platform compilation
4. Logs into GHCR via `GITHUB_TOKEN`
5. Builds and pushes two image variants for three platforms:

| Dockerfile target | Platforms | Description |
|---|---|---|
| `release` | `linux/amd64`, `linux/arm64`, `linux/arm/v7` | Runs as root |
| `rootless` | `linux/amd64`, `linux/arm64`, `linux/arm/v7` | Runs as `node` user |

#### Image tags

Every release produces 6 tags on `ghcr.io/lleirborras/uptime-panda`:

| Tag | Updates on |
|---|---|
| `latest` | every release |
| `latest-rootless` | every release |
| `X.Y` (e.g. `2.3`) | every patch in that minor |
| `X.Y-rootless` | every patch in that minor |
| `X.Y.Z` (e.g. `2.3.3`) | pinned to this exact release |
| `X.Y.Z-rootless` | pinned to this exact release |

#### Using the images

```bash
# Standard (recommended for most users)
docker run -d -p 3001:3001 -v uptime-panda:/app/data \
  --name uptime-panda ghcr.io/lleirborras/uptime-panda:latest

# Rootless (better security posture)
docker run -d -p 3001:3001 -v uptime-panda:/app/data \
  --name uptime-panda ghcr.io/lleirborras/uptime-panda:latest-rootless

# Pin to a specific release
docker run -d -p 3001:3001 -v uptime-panda:/app/data \
  --name uptime-panda ghcr.io/lleirborras/uptime-panda:2.3.3
```

---

### Other workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `codeql-analysis.yml` | push / PR | GitHub CodeQL security scan |
| `armv7-simple-test` (in `auto-test.yml`) | push / PR | Smoke-test on ARMv7 |
| `build-docker-base.yml` | manual | Rebuild upstream base images under `lleirborras/` namespace |
| `npm-update.yml` | schedule | Dependabot-style npm update PRs |
| `stale-bot.yml` | schedule | Close stale issues/PRs |

---

## Dependency management

Dependabot is configured to open PRs for both npm and GitHub Actions updates. All dependency PRs go through the same CI + merge → version bump → Docker publish pipeline as any other PR.

Security-relevant bumps are batched by severity (see `CONTRIBUTING.md`).

---

## Local equivalents

| CI step | Local command |
|---|---|
| Lint | `npm run lint` |
| Format | `npm run fmt` |
| Backend tests | `npm run test-backend-22` |
| E2E tests | `npm run test-e2e` |
| Build frontend | `npm run build` |
| Build Docker image | `npm run build-docker-nightly-local` |
