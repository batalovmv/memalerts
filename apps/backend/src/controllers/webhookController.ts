import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { twitchRedemptionEventSchema } from '../shared/index.js';
import { Server } from 'socket.io';

export const webhookController = {
  handleEventSub: async (req: Request, res: Response) => {
    try {
      console.log('Webhook request received:', {
        method: req.method,
        path: req.path,
        hasBody: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        subscriptionType: req.body?.subscription?.type,
        subscriptionStatus: req.body?.subscription?.status,
        hasHeaders: !!req.headers['twitch-eventsub-message-id'],
        headers: {
          messageId: req.headers['twitch-eventsub-message-id'],
          timestamp: req.headers['twitch-eventsub-message-timestamp'],
          signature: req.headers['twitch-eventsub-message-signature'] ? 'present' : 'missing',
        },
      });
      
      // Handle challenge verification
      if (req.body.subscription && req.body.subscription.status === 'webhook_callback_verification_pending') {
        const challenge = req.body.challenge;
        console.log('Challenge verification:', challenge);
        return res.status(200).send(challenge);
      }

      // Verify HMAC signature
      const messageId = req.headers['twitch-eventsub-message-id'] as string;
      const messageTimestamp = req.headers['twitch-eventsub-message-timestamp'] as string;
      const messageSignature = req.headers['twitch-eventsub-message-signature'] as string;

      if (!messageId || !messageTimestamp || !messageSignature) {
        console.log('Missing signature headers:', { messageId: !!messageId, timestamp: !!messageTimestamp, signature: !!messageSignature });
        // For challenge verification, we might not have signature headers yet
        // Return 200 instead of 403 to allow challenge to pass
        return res.status(200).json({ message: 'Missing signature headers - may be challenge verification' });
      }

      console.log('Validating HMAC signature...');
      const hmacMessage = messageId + messageTimestamp + JSON.stringify(req.body);
      const hmac = crypto
        .createHmac('sha256', process.env.TWITCH_EVENTSUB_SECRET!)
        .update(hmacMessage)
        .digest('hex');
      const expectedSignature = 'sha256=' + hmac;

      console.log('HMAC validation:', {
        messageSignaturePrefix: messageSignature.substring(0, 20),
        expectedSignaturePrefix: expectedSignature.substring(0, 20),
        match: messageSignature === expectedSignature,
      });

      if (messageSignature !== expectedSignature) {
        console.error('Invalid signature!', {
          received: messageSignature.substring(0, 30),
          expected: expectedSignature.substring(0, 30),
        });
        return res.status(403).json({ error: 'Invalid signature' });
      }

      console.log('HMAC signature valid, checking timestamp...');
      // Check timestamp (should be within 10 minutes)
      // Twitch sends timestamp as ISO string, convert to milliseconds
      const timestamp = new Date(messageTimestamp).getTime();
      const now = Date.now();
      const timeDiff = Math.abs(now - timestamp);
      console.log('Timestamp check:', {
        timestamp,
        now,
        timeDiff,
        timeDiffMinutes: timeDiff / 1000 / 60,
        isValid: timeDiff <= 10 * 60 * 1000,
      });
      
      if (timeDiff > 10 * 60 * 1000) {
        console.error('Request too old!', { timeDiff, timeDiffMinutes: timeDiff / 1000 / 60 });
        return res.status(403).json({ error: 'Request too old' });
      }

      console.log('Timestamp valid, processing event...');

      // Handle redemption event
      console.log('Checking event type:', {
        subscriptionType: req.body?.subscription?.type,
        isRedemptionEvent: req.body?.subscription?.type === 'channel.channel_points_custom_reward_redemption.add',
      });
      
      if (req.body.subscription?.type === 'channel.channel_points_custom_reward_redemption.add') {
        console.log('Redemption event detected, processing...');
      try {
        const event = twitchRedemptionEventSchema.parse(req.body.event);

        // Check for duplicate redemption
        const existing = await prisma.redemption.findUnique({
          where: { twitchRedemptionId: event.id },
        });

        if (existing) {
          return res.status(200).json({ message: 'Duplicate redemption ignored' });
        }

        // Find channel by broadcaster_user_id
        const channel = await prisma.channel.findUnique({
          where: { twitchChannelId: event.broadcaster_user_id },
          include: { users: true },
        });

        if (!channel) {
          return res.status(200).json({ message: 'Channel not found, ignoring' });
        }

          // Check if this reward is configured for coins
          // Also check if reward is enabled
          if (channel.rewardIdForCoins && channel.rewardIdForCoins === event.reward.id && channel.rewardEnabled) {
          // Find or create user
          let user = await prisma.user.findUnique({
            where: { twitchUserId: event.user_id },
            include: { wallets: true },
          });

          if (!user) {
            user = await prisma.user.create({
              data: {
                twitchUserId: event.user_id,
                displayName: event.user_name,
                role: 'viewer',
                channelId: channel.id,
              },
              include: {
                wallets: true,
              },
            });
          }

          // Find or create wallet for this channel
          let wallet = user.wallets?.find(w => w.channelId === channel.id);
          if (!wallet) {
            wallet = await prisma.wallet.create({
              data: {
                userId: user.id,
                channelId: channel.id,
                balance: 0,
              },
            });
          }

          // Calculate coins - use rewardCoins (fixed value per redemption)
          // Use rewardCoins if set, otherwise default to 1
          const coinsGranted = channel.rewardCoins !== null && channel.rewardCoins !== undefined 
            ? channel.rewardCoins 
            : 1;

          // Atomic transaction: create redemption + update wallet
          const updatedWallet = await prisma.$transaction(async (tx) => {
            await tx.redemption.create({
              data: {
                channelId: channel.id,
                userId: user!.id,
                twitchRedemptionId: event.id,
                pointsSpent: event.reward.cost,
                coinsGranted,
                status: 'completed',
              },
            });

            const wallet = await tx.wallet.update({
              where: { 
                userId_channelId: {
                  userId: user!.id,
                  channelId: channel.id,
                }
              },
              data: {
                balance: {
                  increment: coinsGranted,
                },
              },
            });
            
            return wallet;
          });
          
          // Emit wallet update event via Socket.IO
          try {
            const io: Server = req.app.get('io');
            const walletUpdateData = {
              userId: user.id,
              channelId: channel.id,
              walletId: updatedWallet.id,
              balance: updatedWallet.balance,
            };
            console.log('[webhookController] Emitting wallet:updated event:', walletUpdateData);
            // Emit to user-specific room and channel room
            io.to(`user:${user.id}`).emit('wallet:updated', walletUpdateData);
            io.to(`channel:${channel.slug}`).emit('wallet:updated', walletUpdateData);
            // Log how many clients are in each room (for debugging)
            const userRoom = io.sockets.adapter.rooms.get(`user:${user.id}`);
            const channelRoom = io.sockets.adapter.rooms.get(`channel:${channel.slug}`);
            console.log('[webhookController] Socket.IO rooms:', {
              userRoomSize: userRoom?.size || 0,
              channelRoomSize: channelRoom?.size || 0,
            });
          } catch (error) {
            console.error('Error emitting wallet update:', error);
            // Don't fail the request if Socket.IO emit fails
          }
        }

        return res.status(200).json({ message: 'Redemption processed' });
      } catch (error: any) {
        console.error('Error processing redemption:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

      console.log('Event received but not processed:', { subscriptionType: req.body?.subscription?.type });
      res.status(200).json({ message: 'Event received' });
    } catch (error: any) {
      console.error('Error in handleEventSub:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  },
};


