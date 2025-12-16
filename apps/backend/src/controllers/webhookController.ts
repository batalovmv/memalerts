import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { twitchRedemptionEventSchema } from '../shared/index.js';

export const webhookController = {
  handleEventSub: async (req: Request, res: Response) => {
    // Handle challenge verification
    if (req.body.subscription && req.body.subscription.status === 'webhook_callback_verification_pending') {
      const challenge = req.body.challenge;
      return res.status(200).send(challenge);
    }

    // Verify HMAC signature
    const messageId = req.headers['twitch-eventsub-message-id'] as string;
    const messageTimestamp = req.headers['twitch-eventsub-message-timestamp'] as string;
    const messageSignature = req.headers['twitch-eventsub-message-signature'] as string;

    if (!messageId || !messageTimestamp || !messageSignature) {
      return res.status(403).json({ error: 'Missing signature headers' });
    }

    const hmacMessage = messageId + messageTimestamp + JSON.stringify(req.body);
    const hmac = crypto
      .createHmac('sha256', process.env.TWITCH_EVENTSUB_SECRET!)
      .update(hmacMessage)
      .digest('hex');
    const expectedSignature = 'sha256=' + hmac;

    if (messageSignature !== expectedSignature) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Check timestamp (should be within 10 minutes)
    const timestamp = parseInt(messageTimestamp, 10);
    const now = Date.now();
    if (Math.abs(now - timestamp) > 10 * 60 * 1000) {
      return res.status(403).json({ error: 'Request too old' });
    }

    // Handle redemption event
    if (req.body.subscription?.type === 'channel.channel_points_custom_reward_redemption.add') {
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

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:65',message:'Checking reward match',data:{eventRewardId:event.reward.id,channelRewardId:channel.rewardIdForCoins,matches:channel.rewardIdForCoins === event.reward.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
        // #endregion
        
        // Check if this reward is configured for coins
        if (channel.rewardIdForCoins && channel.rewardIdForCoins === event.reward.id) {
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

          // Calculate coins - use rewardCoins if set, otherwise use coinPerPointRatio
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:99',message:'Processing reward redemption',data:{rewardId:event.reward.id,channelRewardId:channel.rewardIdForCoins,rewardCost:event.reward.cost,rewardCoins:channel.rewardCoins,coinPerPointRatio:channel.coinPerPointRatio},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
          
          let coinsGranted: number;
          if (channel.rewardCoins !== null && channel.rewardCoins !== undefined) {
            // Use fixed rewardCoins value
            coinsGranted = channel.rewardCoins;
          } else {
            // Fallback to coinPerPointRatio calculation
            coinsGranted = Math.floor(event.reward.cost * channel.coinPerPointRatio);
          }
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:109',message:'Coins calculated',data:{coinsGranted,userId:user.id,channelId:channel.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion

          // Atomic transaction: create redemption + update wallet
          await prisma.$transaction(async (tx) => {
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

            await tx.wallet.update({
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
          });
        }

        return res.status(200).json({ message: 'Redemption processed' });
      } catch (error) {
        console.error('Error processing redemption:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    res.status(200).json({ message: 'Event received' });
  },
};


