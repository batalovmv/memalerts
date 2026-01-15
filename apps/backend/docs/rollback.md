# Rollback plan

## Code rollback
- Prefer feature flags first when possible.
- Revert the offending commit(s), then push.
- Move the `prod-*` tag to the previous good commit and push the tag.

Example:
```bash
git revert <bad_sha>
git push origin main
git tag prod-YYYYMMDD-HHMM <good_sha>
git push origin prod-YYYYMMDD-HHMM
```

## Migration rollback
- Only expand/contract migrations are allowed.
- Do not use down migrations in production.

## Feature flags
- Flags live in `src/config/env.ts` and `ENV.example`.
- Existing flags:
  - `AI_BULLMQ_ENABLED`
  - `CHAT_BOT_ENABLED` / `*_CHAT_BOT_ENABLED`
  - `DEBUG_LOGS`, `DEBUG_AUTH`
- Any new rollback flag must be added to both files above.
