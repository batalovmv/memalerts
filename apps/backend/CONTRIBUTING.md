# Contributing to MemAlerts Backend

Thanks for your interest in contributing! Please follow the guidelines below to keep changes safe and consistent.

## Setup

1) Install Node.js 20 and pnpm.
2) Install dependencies:
   ```bash
   pnpm install
   ```
3) Create `.env` based on `docs/ENVIRONMENT_VARIABLES.md` and local needs.

## Development

Run the API locally:
```bash
pnpm dev
```

## Quality checks

Before committing:
```bash
pnpm lint
pnpm typecheck
pnpm test
```

If you touch database schema:
```bash
pnpm prisma generate
pnpm migrations:check
```

## Commit style

We use Conventional Commits:
```
type(scope): short summary
```
Examples:
```
fix(api): handle empty webhook payload
feat(auth): add token rotation
```

## Pull requests

- Keep PRs focused and small where possible.
- Include tests for new behavior.
- Update docs when behavior changes.

## Security

If you find a security issue, report it privately. See `docs/security.md`.
