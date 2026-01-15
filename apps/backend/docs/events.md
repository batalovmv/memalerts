# Event Emission After Transactions

## Goal
- Emit Socket.IO and relay side effects only after the database transaction commits.
- Avoid orphan events when a transaction rolls back.

## Pattern
1) Create a `TransactionEventBuffer` before the transaction.
2) Inside the transaction, add buffered tasks for any side effects.
3) After the transaction succeeds, call `commit()`.
4) In `finally`, call `flush()` to emit only on commit.

## Example
```ts
const io = req.app.get('io') as Server;
const eventBuffer = new TransactionEventBuffer();

const result = await (async () => {
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // DB writes...
      eventBuffer.add(() => {
        emitWalletUpdated(io, walletEvent);
        void relayWalletUpdatedToPeer(walletEvent);
      });
      return { ok: true };
    });
    eventBuffer.commit();
    return txResult;
  } finally {
    await eventBuffer.flush();
  }
})();
```

## Notes
- Buffer only side effects (Socket.IO emits, relays, external API calls).
- Keep tasks best-effort; `TransactionEventBuffer` swallows errors on flush.
- Always call `flush()` in a `finally` block; if the transaction fails, skip `commit()` and `flush()` will no-op.
