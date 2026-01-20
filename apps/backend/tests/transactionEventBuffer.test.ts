import { prisma } from '../src/lib/prisma.js';
import { TransactionEventBuffer } from '../src/utils/transactionEventBuffer.js';
import { createChannel } from './factories/index.js';

describe('TransactionEventBuffer', () => {
  it('does not emit buffered tasks when commit is not called', async () => {
    const buffer = new TransactionEventBuffer();
    let called = 0;

    buffer.add(() => {
      called += 1;
    });

    await buffer.flush();

    expect(called).toBe(0);
  });

  it('emits buffered tasks after commit', async () => {
    const buffer = new TransactionEventBuffer();
    let called = 0;

    buffer.add(() => {
      called += 1;
    });

    buffer.commit();
    await buffer.flush();

    expect(called).toBe(1);
  });

  it('skips buffered tasks when the transaction rolls back', async () => {
    const buffer = new TransactionEventBuffer();
    const slug = `rollback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let called = 0;
    let threw = false;

    try {
      await prisma.$transaction(async (tx) => {
        await createChannel({ slug, name: 'Rollback Test' }, { prisma: tx });
        buffer.add(() => {
          called += 1;
        });
        throw new Error('force rollback');
      });
      buffer.commit();
    } catch {
      threw = true;
    } finally {
      await buffer.flush();
    }

    const persisted = await prisma.channel.findUnique({ where: { slug } });

    expect(threw).toBe(true);
    expect(persisted).toBeNull();
    expect(called).toBe(0);
  });
});
