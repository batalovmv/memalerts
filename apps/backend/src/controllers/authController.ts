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

    if (!clientId) {
      console.error('TWITCH_CLIENT_ID is not set');
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_client_id`);
    }

    if (!redirectUri) {
      console.error('TWITCH_CALLBACK_URL is not set');
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_callback_url`);
    }

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`;
    console.log('Initiating Twitch auth, redirecting to:', authUrl);
    res.redirect(authUrl);
  },

  handleTwitchCallback: async (req: AuthRequest, res: Response) => {
    const { code, error } = req.query;

    console.log('Twitch callback received:', { code: code ? 'present' : 'missing', error });

    if (error) {
      console.error('Twitch OAuth error:', error);
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${error}`);
    }

    if (!code) {
      console.error('No code in callback');
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_code`);
    }

    try {
      console.log('Exchanging code for token...');
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
      console.log('Token response status:', tokenResponse.status);
      console.log('Token response keys:', Object.keys(tokenData));

      if (!tokenData.access_token) {
        console.error('No access token received from Twitch:', tokenData);
        const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_token`);
      }

      console.log('Access token received, fetching user info...');

      // Get user info from Twitch
      const userResponse = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
        },
      });

      const userData = await userResponse.json();
      console.log('User response status:', userResponse.status);
      console.log('User data:', userData);

      const twitchUser = userData.data?.[0];

      if (!twitchUser) {
        console.error('No user data received from Twitch:', userData);
        const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user`);
      }

      console.log('Twitch user found:', twitchUser.login);

      // Find or create user with proper error handling
      let user = await prisma.user.findUnique({
        where: { twitchUserId: twitchUser.id },
        include: { wallets: true, channel: true },
      });

      if (!user) {
        console.log('User not found, creating new user...');
        try {
          // Use transaction to ensure atomicity
          user = await prisma.$transaction(async (tx) => {
            // Check if channel exists for this Twitch user
            let channel = await tx.channel.findUnique({
              where: { twitchChannelId: twitchUser.id },
            });

            let channelId = null;
            let role = 'viewer';

            if (!channel) {
              // Create new channel for this streamer
              // Use upsert to handle race conditions
              const slug = twitchUser.login.toLowerCase();
              channel = await tx.channel.upsert({
                where: { twitchChannelId: twitchUser.id },
                update: {},
                create: {
                  twitchChannelId: twitchUser.id,
                  slug: slug,
                  name: twitchUser.display_name,
                },
              });
              role = 'streamer'; // First user who creates channel is streamer
              console.log('Created new channel:', channel.slug);
            } else {
              // Channel exists - user owns this channel
              role = 'streamer';
              console.log('Found existing channel:', channel.slug);
            }
            
            channelId = channel.id;

            // Create user
            const newUser = await tx.user.create({
              data: {
                twitchUserId: twitchUser.id,
                displayName: twitchUser.display_name,
                role,
                channelId,
              },
              include: {
                wallets: true,
                channel: true,
              },
            });

            // Create wallet for this channel if channelId exists
            if (channelId) {
              await tx.wallet.create({
                data: {
                  userId: newUser.id,
                  channelId: channelId,
                  balance: 0,
                },
              });
            }

            // Fetch user with wallets after creation
            const userWithWallets = await tx.user.findUnique({
              where: { id: newUser.id },
              include: { wallets: true, channel: true },
            });
            console.log('Created new user:', newUser.id);
            return userWithWallets!;
          });
        } catch (error: any) {
          console.error('Error creating user:', error);
          // If user was created in a previous attempt, try to find it
          if (error.code === 'P2002') {
            console.log('User or channel already exists, trying to find user...');
            user = await prisma.user.findUnique({
              where: { twitchUserId: twitchUser.id },
              include: { wallets: true, channel: true },
            });
            if (!user) {
              throw new Error('Failed to create or find user');
            }
          } else {
            throw error;
          }
        }
      } else {
        console.log('User found:', user.id);
      }

      // Ensure wallet exists for user's channel (if user has a channel)
      if (user && user.channelId) {
        const existingWallet = user.wallets?.find(w => w.channelId === user.channelId);
        if (!existingWallet) {
          console.log('Wallet missing for channel, creating wallet...');
          try {
            await prisma.wallet.create({
              data: {
                userId: user.id,
                channelId: user.channelId,
                balance: 0,
              },
            });
            user = await prisma.user.findUnique({
              where: { id: user.id },
              include: { wallets: true, channel: true },
            });
            console.log('Wallet created for channel');
          } catch (error: any) {
            console.error('Error creating wallet:', error);
            if (user) {
              // Wallet might have been created by another request, try to fetch user again
              user = await prisma.user.findUnique({
                where: { id: user.id },
                include: { wallets: true, channel: true },
              });
            }
          }
        }
      }

      // Ensure user exists
      if (!user) {
        console.error('User is null after creation/fetch');
        const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_null`);
      }

      console.log('User created/found, generating JWT...');
      // Generate JWT
      const token = jwt.sign(
        {
          userId: user.id,
          role: user.role,
          channelId: user.channelId,
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

      // Don't set domain explicitly - let browser handle it
      // Setting domain explicitly can cause issues with cookie setting
      // Browser will automatically set it to the current domain

      console.log('Setting cookie with options:', {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        path: cookieOptions.path,
        maxAge: cookieOptions.maxAge,
        isProduction,
      });

      // Set cookie
      res.cookie('token', token, cookieOptions);
      
      // Verify cookie was set in response
      const setCookieHeader = res.getHeader('Set-Cookie');
      console.log('Set-Cookie header:', setCookieHeader);
      console.log('Response headers before redirect:', Object.keys(res.getHeaders()));
      
      if (!setCookieHeader) {
        console.error('WARNING: Set-Cookie header is not set!');
      }

      // Redirect to user's profile if streamer, otherwise to home
      const redirectUrl = process.env.WEB_URL || (isProduction ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      
      let redirectPath = '/';
      if (user.role === 'streamer' && user.channel?.slug) {
        redirectPath = `/channel/${user.channel.slug}`;
      } else if (user.role === 'streamer') {
        redirectPath = '/dashboard';
      }
      
      console.log('Auth successful, redirecting to:', `${redirectUrl}${redirectPath}`);
      
      // Use 302 redirect (temporary) to ensure cookie is sent
      res.status(302).redirect(`${redirectUrl}${redirectPath}`);
    } catch (error) {
      console.error('Auth error:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        // Log Prisma errors in detail
        if (error.message.includes('P2002') || error.message.includes('Unique constraint')) {
          console.error('Database unique constraint violation - user or channel may already exist');
        }
        if (error.message.includes('P2003') || error.message.includes('Foreign key constraint')) {
          console.error('Database foreign key constraint violation');
        }
      }
      // Log error as JSON for better debugging
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      const redirectUrl = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? `https://${process.env.DOMAIN}` : 'http://localhost:5173');
      const errorReason = error instanceof Error ? encodeURIComponent(error.message.substring(0, 100)) : 'unknown';
      res.redirect(`${redirectUrl}/?error=auth_failed&reason=exception&details=${errorReason}`);
    }
  },

  logout: (req: AuthRequest, res: Response) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  },
};

