import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

// Helper function to get redirect URL based on environment and request
const getRedirectUrl = (req?: AuthRequest, stateOrigin?: string): string => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:entry',message:'getRedirectUrl called',data:{hasWebUrl:!!process.env.WEB_URL,webUrl:process.env.WEB_URL,hasDomain:!!process.env.DOMAIN,domain:process.env.DOMAIN,nodeEnv:process.env.NODE_ENV,hasReq:!!req,reqHost:req?.get('host'),reqReferer:req?.get('referer'),stateOrigin},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // First priority: use origin from state (set during OAuth initiation)
  if (stateOrigin) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:stateOrigin',message:'Using origin from state',data:{stateOrigin},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return stateOrigin;
  }
  
  // Second priority: determine domain from Host header (for beta detection)
  if (req) {
    const host = req.get('host') || '';
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:hostCheck',message:'Checking Host header',data:{host},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // If request came to beta domain, redirect to beta
    if (host.includes('beta.')) {
      const betaUrl = `https://${host.split(':')[0]}`;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:betaFromHost',message:'Using beta domain from Host header',data:{host,betaUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return betaUrl;
    }
  }
  
  // First, use WEB_URL if explicitly set (this is the primary way)
  if (process.env.WEB_URL) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:webUrl',message:'Using WEB_URL',data:{webUrl:process.env.WEB_URL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return process.env.WEB_URL;
  }
  
  // Fallback: construct from DOMAIN if in production
  if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
    const fallbackUrl = `https://${process.env.DOMAIN}`;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:domainFallback',message:'Using DOMAIN fallback',data:{domain:process.env.DOMAIN,fallbackUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return fallbackUrl;
  }
  
  // Development fallback
  const devUrl = 'http://localhost:5173';
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:getRedirectUrl:devFallback',message:'Using dev fallback',data:{devUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:initiateTwitchAuth:originCheck',message:'Checking origin',data:{originHost,referer,isBeta,reqHeaders:Object.keys(req.headers)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:initiateTwitchAuth',message:'Initiating Twitch auth',data:{originHost,isBeta,stateData,authUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.log('Initiating Twitch auth, redirecting to:', authUrl);
    res.redirect(authUrl);
  },

  handleTwitchCallback: async (req: AuthRequest, res: Response) => {
    const { code, error, state } = req.query;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:handleTwitchCallback:entry',message:'Callback received',data:{hasCode:!!code,hasError:!!error,hasState:!!state,stateType:typeof state,stateValue:state,reqHost:req.get('host'),reqReferer:req.get('referer'),reqHeaders:Object.keys(req.headers)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Extract origin from state if present
    let stateOrigin: string | undefined;
    let stateRedirectTo: string | undefined;
    if (state && typeof state === 'string') {
      try {
        const decodedState = decodeURIComponent(state);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:handleTwitchCallback:stateDecode',message:'Decoding state',data:{state,decodedState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        const stateData = JSON.parse(decodedState);
        stateOrigin = stateData.origin;
        stateRedirectTo = stateData.redirectTo;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:handleTwitchCallback:stateParse',message:'Parsed state data',data:{state,decodedState,stateData,stateOrigin,stateRedirectTo},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      } catch (e) {
        // State might be old format (just redirect path), ignore
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:handleTwitchCallback:stateParseError',message:'Failed to parse state, using old format',data:{state,error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      }
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:handleTwitchCallback:noState',message:'No state parameter',data:{state,stateType:typeof state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }

    console.log('Twitch callback received:', { 
      code: code ? 'present' : 'missing', 
      error, 
      stateOrigin, 
      state,
      stateType: typeof state,
      stateValue: state,
      queryParams: Object.keys(req.query),
      fullQuery: req.query
    });

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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:194',message:'Creating new user with tokens',data:{twitchUserId:twitchUser.id,hasAccessToken:!!tokenData.access_token,hasRefreshToken:!!tokenData.refresh_token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:250',message:'Updating existing user tokens',data:{userId:user.id,hasAccessToken:!!tokenData.access_token,hasRefreshToken:!!tokenData.refresh_token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:260',message:'User tokens updated',data:{userId:user.id,hasAccessToken:!!user.twitchAccessToken,hasRefreshToken:!!user.twitchRefreshToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
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
      
      // Determine cookie domain based on redirect URL
      // If redirecting to beta, we need to set cookie domain to work for beta
      // If redirecting to production, use production domain
      let cookieDomain: string | undefined;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:determineCookieDomain',message:'Determining cookie domain',data:{stateOrigin,hasStateOrigin:!!stateOrigin},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      if (stateOrigin && stateOrigin.includes('beta.')) {
        // For beta, set domain to .twitchmemes.ru so cookie works for both beta and production
        // Extract base domain (e.g., .twitchmemes.ru from beta.twitchmemes.ru)
        try {
          const url = new URL(stateOrigin);
          const hostname = url.hostname;
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:parseBetaDomain',message:'Parsing beta domain',data:{stateOrigin,hostname,parts:hostname.split('.')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          // Extract base domain (twitchmemes.ru) and add dot prefix
          const parts = hostname.split('.');
          if (parts.length >= 2) {
            cookieDomain = '.' + parts.slice(-2).join('.');
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:cookieDomainSet',message:'Cookie domain determined',data:{cookieDomain,hostname,parts},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
          }
        } catch (e) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:cookieDomainError',message:'Failed to parse cookie domain',data:{stateOrigin,error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          // If parsing fails, don't set domain
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:noBetaDomain',message:'Not setting cookie domain (not beta)',data:{stateOrigin,includesBeta:stateOrigin?.includes('beta.')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
      }
      
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
      // Browser will automatically set it to the current domain

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:setCookie',message:'Setting cookie',data:{stateOrigin,cookieDomain,cookieOptions,redirectUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:cookieSet',message:'Cookie set in response',data:{setCookieHeader:setCookieHeader?.toString(),cookieOptions,redirectUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.log('Set-Cookie header:', setCookieHeader);
      console.log('Response headers before redirect:', Object.keys(res.getHeaders()));
      
      if (!setCookieHeader) {
        console.error('WARNING: Set-Cookie header is not set!');
      }

      // Redirect to user's profile if streamer, otherwise to home
      // Pass req and stateOrigin to determine correct redirect domain
      const redirectUrl = getRedirectUrl(req, stateOrigin);
      
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'authController.ts:handleTwitchCallback:redirect',message:'Final redirect URL',data:{redirectUrl,redirectPath,finalRedirectUrl,state,userRole:user.role},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
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
};

