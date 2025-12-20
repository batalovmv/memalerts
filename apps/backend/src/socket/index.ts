import { Server } from 'socket.io';

export function setupSocketIO(io: Server) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join:channel', (channelSlug: string) => {
      const raw = String(channelSlug || '').trim();
      if (!raw) return;
      const normalized = raw.toLowerCase();
      // Backward-compatible: join both the raw and normalized rooms.
      // Server emits are generally normalized, but some older code may emit raw.
      socket.join(`channel:${raw}`);
      socket.join(`channel:${normalized}`);
      console.log(`Client ${socket.id} joined channel:${normalized} (raw: ${raw})`);
    });

    socket.on('join:user', (userId: string) => {
      socket.join(`user:${userId}`);
      console.log(`Client ${socket.id} joined user:${userId}`);
    });

    socket.on('activation:ackDone', async (data: { activationId: string }) => {
      // Update activation status
      const { prisma } = await import('../lib/prisma.js');
      try {
        await prisma.memeActivation.update({
          where: { id: data.activationId },
          data: { status: 'done' },
        });
      } catch (error) {
        console.error('Error updating activation:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}


