import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { twitchRedemptionEventSchema } from '../shared/index.js';
import { Server } from 'socket.io';

export const webhookController = {
  handleEventSub: async (req: Request, res: Response) => {
    try {
      // #region agent log
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
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:8',message:'Webhook request received',data:{hasBody:!!req.body,subscriptionType:req.body?.subscription?.type,subscriptionStatus:req.body?.subscription?.status,hasHeaders:!!req.headers['twitch-eventsub-message-id'],method:req.method,path:req.path},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
      // #endregion
      
      // Handle challenge verification
      if (req.body.subscription && req.body.subscription.status === 'webhook_callback_verification_pending') {
        const challenge = req.body.challenge;
        console.log('Challenge verification:', challenge);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:15',message:'Challenge verification',data:{challenge},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        return res.status(200).send(challenge);
      }

      // Verify HMAC signature
      const messageId = req.headers['twitch-eventsub-message-id'] as string;
      const messageTimestamp = req.headers['twitch-eventsub-message-timestamp'] as string;
      const messageSignature = req.headers['twitch-eventsub-message-signature'] as string;

      if (!messageId || !messageTimestamp || !messageSignature) {
        console.log('Missing signature headers:', { messageId: !!messageId, timestamp: !!messageTimestamp, signature: !!messageSignature });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:22',message:'Missing signature headers',data:{hasMessageId:!!messageId,hasTimestamp:!!messageTimestamp,hasSignature:!!messageSignature},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:32',message:'Invalid signature',data:{messageSignature:messageSignature.substring(0,20)+'...',expectedSignature:expectedSignature.substring(0,20)+'...'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:42',message:'Checking event type',data:{subscriptionType:req.body?.subscription?.type,isRedemptionEvent:req.body?.subscription?.type === 'channel.channel_points_custom_reward_redemption.add'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
      // #endregion
      
      if (req.body.subscription?.type === 'channel.channel_points_custom_reward_redemption.add') {
        console.log('Redemption event detected, processing...');
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:46',message:'Processing redemption event',data:{hasEvent:!!req.body.event,eventRewardId:req.body.event?.reward?.id,eventUserId:req.body.event?.user_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
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
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:65',message:'Checking reward match',data:{eventRewardId:event.reward.id,channelRewardId:channel.rewardIdForCoins,matches:channel.rewardIdForCoins === event.reward.id,rewardEnabled:channel.rewardEnabled},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
          // #endregion
          
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:99',message:'Processing reward redemption',data:{rewardId:event.reward.id,channelRewardId:channel.rewardIdForCoins,rewardCost:event.reward.cost,rewardCoins:channel.rewardCoins},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
          
          // Use rewardCoins if set, otherwise default to 1
          const coinsGranted = channel.rewardCoins !== null && channel.rewardCoins !== undefined 
            ? channel.rewardCoins 
            : 1;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:109',message:'Coins calculated',data:{coinsGranted,userId:user.id,channelId:channel.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion

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
            // Emit to user-specific room and channel room
            io.to(`user:${user.id}`).emit('wallet:updated', {
              userId: user.id,
              channelId: channel.id,
              balance: updatedWallet.balance,
            });
            io.to(`channel:${channel.slug}`).emit('wallet:updated', {
              userId: user.id,
              channelId: channel.id,
              balance: updatedWallet.balance,
            });
          } catch (error) {
            console.error('Error emitting wallet update:', error);
            // Don't fail the request if Socket.IO emit fails
          }
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:151',message:'Redemption processed successfully',data:{rewardId:event.reward.id,userId:user.id,coinsGranted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
          // #endregion
        }

        return res.status(200).json({ message: 'Redemption processed' });
      } catch (error: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:155',message:'Error processing redemption',data:{error:error.message,errorStack:error.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        console.error('Error processing redemption:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

      // #region agent log
      console.log('Event received but not processed:', { subscriptionType: req.body?.subscription?.type });
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:162',message:'Event received but not processed',data:{subscriptionType:req.body?.subscription?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
      // #endregion
      res.status(200).json({ message: 'Event received' });
    } catch (error: any) {
      console.error('Error in handleEventSub:', error);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webhookController.ts:170',message:'Top-level error in handleEventSub',data:{error:error.message,errorStack:error.stack?.substring(0,300)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
      // #endregion
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  },
};


