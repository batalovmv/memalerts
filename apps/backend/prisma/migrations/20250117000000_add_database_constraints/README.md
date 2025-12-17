# Database Constraints Migration

This migration adds CHECK constraints to enforce data validation at the database level.

## Purpose

These constraints provide an additional layer of security by ensuring data integrity even if:
- Application-level validation is bypassed
- Direct database access is used
- Bugs in application code allow invalid data

## Constraints Added

### Wallet
- `balance >= 0` - Prevents negative balances

### Promotion
- `discountPercent` between 0 and 100
- `endDate > startDate` - Ensures valid date range

### Channel
- `coinPerPointRatio > 0` - Prevents zero or negative ratios
- `rewardCost > 0` (if set) - Prevents zero or negative costs
- `rewardCoins >= 0` (if set) - Prevents negative coins
- Hex color format validation for `primaryColor`, `secondaryColor`, `accentColor`

### Meme
- `priceCoins >= 0` - Prevents negative prices
- `durationMs > 0` - Ensures positive duration
- `status` must be one of: 'pending', 'approved', 'rejected'
- `type` must be one of: 'image', 'gif', 'video', 'audio'

### MemeSubmission
- `status` must be one of: 'pending', 'approved', 'rejected'
- `type` must be one of: 'image', 'gif', 'video', 'audio'

### Redemption
- `pointsSpent > 0` - Ensures positive points
- `coinsGranted >= 0` - Prevents negative coins
- `status` must be one of: 'pending', 'completed', 'failed'

### MemeActivation
- `coinsSpent >= 0` - Prevents negative coins
- `status` must be one of: 'queued', 'playing', 'done', 'failed'

### User
- `role` must be one of: 'viewer', 'streamer', 'admin'

### BetaAccess
- `status` must be one of: 'pending', 'approved', 'rejected'

### FileHash
- `referenceCount > 0` - Ensures positive reference count
- `fileSize >= 0` - Prevents negative file sizes

## Notes

- All constraints use `CHECK` clauses which are enforced by PostgreSQL
- Constraints that allow NULL values use `IS NULL OR` pattern
- Hex color validation uses PostgreSQL regex pattern matching
- These constraints will be automatically applied during deployment via `prisma migrate deploy`

