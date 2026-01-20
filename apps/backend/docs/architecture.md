# Repository Pattern

Controllers should use repositories instead of calling Prisma directly. Repositories provide a thin data access layer that can be mocked in tests while keeping Prisma contained.

## Structure

- `src/repositories/types.ts`: repository interfaces and context types.
- `src/repositories/*.ts`: Prisma-backed implementations per domain.
- `src/repositories/index.ts`: default `repositories` context and `transaction` wrapper.

## Usage

- Inject repositories into services via `createServiceContext` (see `src/services/index.ts`).
- Controllers should stay thin and call `services.*`.
- Use `repositories.transaction` inside services when a Prisma transaction is required.

Example:

```ts
export const handlerWithRepos = async (repos, req, res) => {
  const { channels } = repos;
  const channel = await channels.findUnique({ where: { id: req.channelId } });
  // ...
};

export const service = (repos) => ({
  handler: (req, res) => handlerWithRepos(repos, req, res),
});

export const handler = async (req, res) => services.example.handler(req, res);
```

## Tests

Use `tests/mocks/repositories.ts` to create mock repository contexts for controller/unit tests.
