# ADR 0001: Prisma Over TypeORM

Date: 2026-01-16
Status: Accepted

## Context

The backend needs a relational ORM with migrations, strong typing, and predictable query behavior. We evaluated common Node.js ORMs with a focus on developer experience, migration safety, and runtime reliability in long-lived services.

## Decision

Use Prisma as the primary ORM and schema/migration tool. Prisma provides type-safe queries, consistent migrations, and a clear schema-first workflow that aligns with our CI checks and data safety practices.

## Consequences

- We standardize on Prisma schema + migrations and require `prisma generate` during builds.
- Some dynamic or highly customized SQL requires `prisma.$queryRaw` or dedicated SQL migrations.
- We avoid runtime metadata reflection issues and reduce ORM-related production surprises.
