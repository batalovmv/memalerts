import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

// Simple Twitch OAuth implementation (you can replace with passport-twitch-new)
export const authController = {
  initiateTwitchAuth: (req: AuthRequest, res: Response) => {
    // For MVP, we'll generate state but skip verification
    // In production, use proper session storage or signed cookies
    const clientId = process.env.TWITCH_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.TWITCH_CALLBACK_URL || '');
    const scopes = encodeURIComponent('user:read:email channel:read:redemptions');

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`;

    res.redirect(authUrl);
  },

  handleTwitchCallback: async (req: AuthRequest, res: Response) => {
    const { code } = req.query;

    if (!code) {
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      return res.redirect(`${redirectUrl}/?error=auth_failed`);
    }

    try {
      // Exchange code for token
      const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.TWITCH_CLIENT_ID!,
          client_secret: process.env.TWITCH_CLIENT_SECRET!,
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: process.env.TWITCH_CALLBACK_URL!,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenData.access_token) {
        console.error('No access token received from Twitch:', tokenData);
        const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
        return res.redirect(`${redirectUrl}/?error=auth_failed`);
      }

      // Get user info from Twitch
      const userResponse = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
        },
      });

      const userData = await userResponse.json();
      const twitchUser = userData.data[0];

      if (!twitchUser) {
        console.error('No user data received from Twitch:', userData);
        const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
        return res.redirect(`${redirectUrl}/?error=auth_failed`);
      }

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { twitchUserId: twitchUser.id },
        include: { wallet: true, channel: true },
      });

      if (!user) {
        // Check if channel exists for this Twitch user
        let channel = await prisma.channel.findUnique({
          where: { twitchChannelId: twitchUser.id },
        });

        let channelId = null;
        let role = 'viewer';

        if (!channel) {
          // Create new channel for this streamer
          channel = await prisma.channel.create({
            data: {
              twitchChannelId: twitchUser.id,
              slug: twitchUser.login.toLowerCase(),
              name: twitchUser.display_name,
            },
          });
          role = 'streamer'; // First user who creates channel is streamer
        } else {
          // Channel exists - check if this user is the owner
          // If channel's twitchChannelId matches user's twitchUserId, they are the streamer
          role = 'streamer'; // User owns this channel
        }
        
        channelId = channel.id;

        user = await prisma.user.create({
          data: {
            twitchUserId: twitchUser.id,
            displayName: twitchUser.display_name,
            role,
            channelId,
            wallet: {
              create: {
                balance: 0,
              },
            },
          },
          include: {
            wallet: true,
            channel: true,
          },
        });
      } else if (!user.wallet) {
        // Create wallet if missing
        await prisma.wallet.create({
          data: {
            userId: user.id,
            balance: 0,
          },
        });
        user = await prisma.user.findUnique({
          where: { id: user.id },
          include: { wallet: true, channel: true },
        });
      }

      // Generate JWT
      const token = jwt.sign(
        {
          userId: user!.id,
          role: user!.role,
          channelId: user!.channelId,
        },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
      );

      // Set httpOnly cookie
      // Use secure in production (HTTPS) and lax sameSite for OAuth redirects
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions: any = {
        httpOnly: true,
        secure: isProduction, // Only send over HTTPS in production
        sameSite: 'lax', // Changed from 'strict' to allow OAuth redirects
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/', // Ensure cookie is available for all paths
      };

      // Set domain if in production with a domain
      if (isProduction && process.env.DOMAIN) {
        cookieOptions.domain = process.env.DOMAIN;
      }

      res.cookie('token', token, cookieOptions);

      // Redirect to dashboard or home if WEB_URL is not set
      const redirectUrl = process.env.WEB_URL || (isProduction ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      console.log('Redirecting to:', redirectUrl);
      res.redirect(`${redirectUrl}/dashboard`);
    } catch (error) {
      console.error('Auth error:', error);
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      res.redirect(`${redirectUrl}/?error=auth_failed`);
    }
  },

  logout: (req: AuthRequest, res: Response) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  },
};

