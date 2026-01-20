# Wallet locking & balance safety

## Rules
- Run all balance mutations inside a single database transaction.
- Lock the wallet row before any update. Use `WalletRepository.lockForUpdate` or `WalletService.getWalletForUpdate`.
- If a transaction needs to lock multiple wallets, lock them in a deterministic order: sort by `channelId`, then `userId`.
- Do not interleave wallet locks with other `SELECT ... FOR UPDATE` calls in a different order. Keep lock order consistent within the transaction.
- Use `WalletService.incrementBalance` / `decrementBalance` to ensure the lock is taken.

## Observability
- `wallet_race_conflicts_total` increments when a wallet lock/serialization conflict is detected.
