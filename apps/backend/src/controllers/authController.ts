import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

// Helper function to get redirect URL based on environment and request
const getRedirectUrl = (req?: AuthRequest, stateOrigin?: string): string => {
  // First priority: use origin from state (set during OAuth initiation)
  if (stateOrigin) {
    return stateOrigin;
  }
  
  // Second priority: determine domain from Host header (for beta detection)
  if (req) {
    const host = req.get('host') || '';
    
    // If request came to beta domain, redirect to beta
    if (host.includes('beta.')) {
      const betaUrl = `https://${host.split(':')[0]}`;
      return betaUrl;
    }
  }
  
  // First, use WEB_URL if explicitly set (this is the primary way)
  if (process.env.WEB_URL) {
    return process.env.WEB_URL;
  }
  
  // Fallback: construct from DOMAIN if in production
  if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
    const fallbackUrl = `https://${process.env.DOMAIN}`;
    return fallbackUrl;
  }
  
  // Development fallback
  const devUrl = 'http://localhost:5173';
  return devUrl;
};

// Simple Twitch OAuth implementation (you can replace with passport-twitch-new)
export const authController = {
  initiateTwitchAuth: (req: AuthRequest, res: Response) => {
    // For MVP, we'll generate state but skip verification
    // In production, use proper session storage or signed cookies
    const clientId = process.env.TWITCH_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.TWITCH_CALLBACK_URL || '');
    const scopes = encodeURIComponent('user:read:email channel:read:redemptions channel:manage:redemptions');

    if (!clientId) {
      console.error('TWITCH_CLIENT_ID is not set');
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_client_id`);
    }

    if (!redirectUri) {
      console.error('TWITCH_CALLBACK_URL is not set');
      const redirectUrl = getRedirectUrl(req);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_callback_url`);
    }

    // Get redirect_to parameter from query string (where user wants to go after login)
    const redirectTo = (req.query.redirect_to as string) || '';
    
    // Store origin domain in state to determine redirect target after callback
    // Check both Host header and Referer to determine if request came from beta
    const originHost = req.get('host') || '';
    const referer = req.get('referer') || '';
    const isBeta = originHost.includes('beta.') || referer.includes('beta.');
    
    // Determine origin URL - prefer beta if detected, otherwise use WEB_URL or construct from host
    let originUrl: string | undefined;
    if (isBeta) {
      if (originHost.includes('beta.')) {
        originUrl = `https://${originHost.split(':')[0]}`;
      } else if (referer.includes('beta.')) {
        // Extract beta domain from referer
        try {
          const refererUrl = new URL(referer);
          originUrl = `${refererUrl.protocol}//${refererUrl.host}`;
        } catch (e) {
          // Fallback to WEB_URL if available
          originUrl = process.env.WEB_URL?.includes('beta') ? process.env.WEB_URL : undefined;
        }
      }
    }
    
    const stateData = {
      redirectTo: redirectTo || undefined,
      origin: originUrl
    };
    // Always create state if we have any data, even if origin is undefined (for production)
    const state = encodeURIComponent(JSON.stringify(stateData));

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}${state ? `&state=${state}` : ''}`;
    console.log('Initiating Twitch auth, redirecting to:', authUrl);
    res.redirect(authUrl);
  },

  handleTwitchCallback: async (req: AuthRequest, res: Response) => {
    const { code, error, state } = req.query;

    // Extract origin from state if present
    let stateOrigin: string | undefined;
    let stateRedirectTo: string | undefined;
    if (state && typeof state === 'string') {
      try {
        const decodedState = decodeURIComponent(state);
        const stateData = JSON.parse(decodedState);
        stateOrigin = stateData.origin;
        stateRedirectTo = stateData.redirectTo;
      } catch (e) {
        // State might be old format (just redirect path), ignore
      }
    }

    console.log('Twitch callback received:', { code: code ? 'present' : 'missing', error, stateOrigin, state });

    if (error) {
      console.error('Twitch OAuth error:', error);
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=${error}`);
    }

    if (!code) {
      console.error('No code in callback');
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_code`);
    }

    try {
      console.log('Exchanging code for token...');
      
      // Check if this is production backend handling beta callback
      // If callback came to production domain but state indicates beta origin,
      // we need to handle it specially
      const isProductionBackend = !process.env.DOMAIN?.includes('beta.') && process.env.PORT !== '3002';
      const isBetaCallback = stateOrigin && stateOrigin.includes('beta.');
      const requestHost = req.get('host') || '';
      const callbackCameToProduction = !requestHost.includes('beta.');
      
      // Exchange code for token
      // Use the callback URL that was registered with Twitch (must match exactly)
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
        const redirectUrl = getRedirectUrl(req, stateOrigin);
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
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=no_user`);
      }

      console.log('Twitch user found:', twitchUser.login);

      // Find or create user with proper error handling
      let user;
      try {
        user = await prisma.user.findUnique({
          where: { twitchUserId: twitchUser.id },
          include: { wallets: true, channel: true },
        });
      } catch (error: any) {
        // If error is about missing columns, try query without color fields
        if (error.message && error.message.includes('does not exist')) {
          user = await prisma.user.findUnique({
            where: { twitchUserId: twitchUser.id },
            include: { 
              wallets: true,
              channel: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  twitchChannelId: true,
                  rewardIdForCoins: true,
                  coinPerPointRatio: true,
                  createdAt: true,
                },
              },
            },
          });
        } else {
          throw error;
        }
      }

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
              // Generate random slug (8 characters: alphanumeric)
              const generateRandomSlug = () => {
                const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
                let result = '';
                for (let i = 0; i < 8; i++) {
                  result += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                return result;
              };
              
              // Ensure slug is unique
              let slug = generateRandomSlug();
              let existingChannel = await tx.channel.findUnique({ where: { slug } });
              let attempts = 0;
              while (existingChannel && attempts < 10) {
                slug = generateRandomSlug();
                existingChannel = await tx.channel.findUnique({ where: { slug } });
                attempts++;
              }
              
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
                profileImageUrl: twitchUser.profile_image_url || null,
                role,
                channelId,
                twitchAccessToken: tokenData.access_token,
                twitchRefreshToken: tokenData.refresh_token || null,
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
            // Update existing user with new tokens
            user = await prisma.user.update({
              where: { twitchUserId: twitchUser.id },
              data: {
                twitchAccessToken: tokenData.access_token,
                twitchRefreshToken: tokenData.refresh_token || null,
                profileImageUrl: twitchUser.profile_image_url || null,
                displayName: twitchUser.display_name,
              },
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
        // Update tokens for existing user
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            twitchAccessToken: tokenData.access_token,
            twitchRefreshToken: tokenData.refresh_token || null,
            profileImageUrl: twitchUser.profile_image_url || null,
            displayName: twitchUser.display_name,
          },
          include: { wallets: true, channel: true },
        });
      }

      // Ensure wallet exists for user's channel (if user has a channel)
      if (user && user.channelId) {
        const userChannelId = user.channelId; // Store to avoid null check issues
        const existingWallet = user.wallets?.find(w => w.channelId === userChannelId);
        if (!existingWallet) {
          console.log('Wallet missing for channel, creating wallet...');
          try {
            await prisma.wallet.create({
              data: {
                userId: user.id,
                channelId: userChannelId,
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
        const redirectUrl = getRedirectUrl(req, stateOrigin);
        return res.redirect(`${redirectUrl}/?error=auth_failed&reason=user_null`);
      }

      // If this is beta backend and user logged in on beta domain, grant beta access automatically
      const isBetaBackend = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
      const isBetaLogin = isBetaRedirect || (stateOrigin && stateOrigin.includes('beta.'));
      
      if (isBetaBackend && isBetaLogin && !user.hasBetaAccess) {
        console.log('Granting beta access to user:', user.id);
        user = await prisma.user.update({
          where: { id: user.id },
          data: { hasBetaAccess: true },
          include: { wallets: true, channel: true },
        });
      }

      console.log('User created/found, generating JWT...');
      
      // If production backend received callback for beta, create temporary token and redirect to beta
      if (isProductionBackend && isBetaCallback && callbackCameToProduction) {
        // Create a short-lived token for beta backend to use
        const tempToken = jwt.sign(
          {
            userId: user.id,
            role: user.role,
            channelId: user.channelId,
            tempForBeta: true,
          },
          process.env.JWT_SECRET!,
          { expiresIn: '5m' } as SignOptions // Short-lived token
        );
        
        // Redirect to beta backend with temporary token
        // Beta backend will exchange this for a proper cookie
        const betaAuthUrl = `${stateOrigin}/auth/twitch/complete?token=${encodeURIComponent(tempToken)}&state=${encodeURIComponent(state as string)}`;
        console.log('Redirecting to beta backend for cookie setup:', betaAuthUrl);
        return res.redirect(betaAuthUrl);
      }
      
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
      
      // Determine redirect URL first (needed for cookie domain)
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      
      // If production backend received callback for beta, we need to handle it after token exchange
      // We'll create a temporary token and redirect to beta backend
      // (isProductionBackend, isBetaCallback, callbackCameToProduction are already declared above)
      if (isProductionBackend && isBetaCallback && callbackCameToProduction) {
        console.log('Production backend received beta callback, will redirect to beta backend after token exchange');
      }
      
      // Determine cookie domain based on redirect URL
      // IMPORTANT: For security, beta and production cookies must be isolated
      // - For beta: use exact domain (beta.twitchmemes.ru) without dot prefix to isolate from production
      // - For production: don't set domain explicitly - browser will set it to current domain only
      let cookieDomain: string | undefined;
      
      // Check both stateOrigin and redirectUrl for beta detection
      const isBetaRedirect = (stateOrigin && stateOrigin.includes('beta.')) || (redirectUrl && redirectUrl.includes('beta.'));
      
      if (isBetaRedirect) {
        // For beta, use the exact beta domain (without dot prefix) to isolate from production
        // This ensures cookies are NOT shared between beta and production
        try {
          const urlToParse = redirectUrl || stateOrigin;
          if (urlToParse) {
            const url = new URL(urlToParse);
            const hostname = url.hostname;
            // Use exact hostname for beta (e.g., beta.twitchmemes.ru) without dot prefix
            // This prevents cookie from working on production domain
            cookieDomain = hostname;
          }
        } catch (e) {
          // If parsing fails, don't set domain - browser will handle it
        }
      }
      // For production, don't set domain - browser will automatically set it to the current domain only
      
      const cookieOptions: any = {
        httpOnly: true,
        secure: isProduction, // Only send over HTTPS in production
        sameSite: 'lax', // Changed from 'strict' to allow OAuth redirects
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/', // Ensure cookie is available for all paths
      };

      // Set domain only if we determined it should be set for beta
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }
      // Otherwise, don't set domain explicitly - let browser handle it
      console.log('Setting cookie with options:', {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        path: cookieOptions.path,
        domain: cookieOptions.domain,
        maxAge: cookieOptions.maxAge,
        isProduction,
        stateOrigin,
        cookieDomain,
        'cookieDomain set': !!cookieDomain,
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
      // redirectUrl was already determined above for cookie domain
      let redirectPath = '/';
      
      // Check if state parameter contains a redirect path (user came from a specific page)
      if (stateRedirectTo) {
        // Use redirect path from state
        redirectPath = stateRedirectTo;
      } else if (state && typeof state === 'string') {
        // Try to parse as old format (just path)
        try {
          const decodedState = decodeURIComponent(state);
          // If state is a channel profile path, redirect there
          if (decodedState.startsWith('/channel/')) {
            redirectPath = decodedState;
          } else {
            // Otherwise, redirect to dashboard for streamers
            redirectPath = user.role === 'streamer' ? '/dashboard' : '/';
          }
        } catch (e) {
          // Invalid state format, use default
          redirectPath = user.role === 'streamer' ? '/dashboard' : '/';
        }
      } else {
        // No state parameter - default behavior: dashboard for streamers (not channel profile)
        if (user.role === 'streamer') {
          redirectPath = '/dashboard';
        }
      }
      
      const finalRedirectUrl = `${redirectUrl}${redirectPath}`;
      console.log('Auth successful, redirecting to:', finalRedirectUrl, 'state:', state);
      
      // Use 302 redirect (temporary) to ensure cookie is sent
      res.status(302).redirect(finalRedirectUrl);
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
      
      // Extract stateOrigin from state if available
      let stateOrigin: string | undefined;
      if (req.query.state && typeof req.query.state === 'string') {
        try {
          const decodedState = decodeURIComponent(req.query.state);
          const stateData = JSON.parse(decodedState);
          stateOrigin = stateData.origin;
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      const errorReason = error instanceof Error ? encodeURIComponent(error.message.substring(0, 100)) : 'unknown';
      res.redirect(`${redirectUrl}/?error=auth_failed&reason=exception&details=${errorReason}`);
    }
  },

  logout: (req: AuthRequest, res: Response) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  },

  completeBetaAuth: async (req: AuthRequest, res: Response) => {
    // This endpoint is called by beta backend when production backend redirects with temp token
    const { token, state } = req.query;

    if (!token || typeof token !== 'string') {
      return res.redirect('/?error=auth_failed&reason=no_token');
    }

    try {
      // Verify the temporary token
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        role: string;
        channelId?: string;
        tempForBeta?: boolean;
      };

      if (!decoded.tempForBeta) {
        return res.redirect('/?error=auth_failed&reason=invalid_token');
      }

      // Extract redirect path from state if present
      let redirectPath = '/';
      let stateOrigin: string | undefined;
      if (state && typeof state === 'string') {
        try {
          const decodedState = decodeURIComponent(state);
          const stateData = JSON.parse(decodedState);
          stateOrigin = stateData.origin;
          if (stateData.redirectTo) {
            redirectPath = stateData.redirectTo;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Generate proper JWT token for beta
      const betaToken = jwt.sign(
        {
          userId: decoded.userId,
          role: decoded.role,
          channelId: decoded.channelId,
        },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
      );

      // Set cookie for beta domain
      const isProduction = process.env.NODE_ENV === 'production';
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      
      // Determine cookie domain for beta
      let cookieDomain: string | undefined;
      if (redirectUrl && redirectUrl.includes('beta.')) {
        try {
          const url = new URL(redirectUrl);
          cookieDomain = url.hostname;
        } catch (e) {
          // Ignore
        }
      }

      const cookieOptions: any = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
      };

      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }

      res.cookie('token', betaToken, cookieOptions);

      // Redirect to appropriate page
      const finalRedirectUrl = `${redirectUrl}${redirectPath}`;
      console.log('Beta auth completed, redirecting to:', finalRedirectUrl);
      res.redirect(finalRedirectUrl);
    } catch (error) {
      console.error('Error completing beta auth:', error);
      res.redirect('/?error=auth_failed&reason=token_verification_failed');
    }
  },
};

