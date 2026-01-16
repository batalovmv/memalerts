import type { Server } from 'socket.io';
import type { AuthRequest } from '../../../middleware/auth.js';
import { channelMetaCache } from '../../viewer/cache.js';
import { nsKey, redisDel } from '../../../utils/redisCache.js';
import { logger } from '../../../utils/logger.js';
import { getErrorMessage } from './shared.js';

export function invalidateCatalogCacheOnModeChange(params: {
  bodyRec: Record<string, unknown>;
  channelRec: Record<string, unknown>;
}) {
  const { bodyRec, channelRec } = params;
  if (bodyRec.memeCatalogMode !== undefined) {
    const channelSlug = String(channelRec.slug || '')
      .trim()
      .toLowerCase();
    channelMetaCache.delete(channelSlug);
    void redisDel(nsKey('channel_meta', channelSlug));
    void redisDel(nsKey('public_channel_meta', channelSlug));
  }
}

export function invalidateChannelMetaCache(params: {
  updatedChannel: Record<string, unknown>;
  channelRec: Record<string, unknown>;
}) {
  try {
    const updatedChannelRec = params.updatedChannel;
    const slugLower = String(updatedChannelRec.slug || params.channelRec.slug || '').toLowerCase();
    if (slugLower) {
      channelMetaCache.delete(slugLower);
      void redisDel(nsKey('channel_meta', slugLower));
    }
  } catch {
    // ignore
  }
}

export function emitSubmissionsStatus(params: {
  req: AuthRequest;
  updatedChannel: Record<string, unknown>;
  channelRec: Record<string, unknown>;
}) {
  try {
    const io: Server = params.req.app.get('io');
    const slug = String(params.updatedChannel.slug || params.channelRec.slug || '').toLowerCase();
    if (slug) {
      io.to(`channel:${slug}`).emit('submissions:status', {
        enabled: params.updatedChannel.submissionsEnabled ?? true,
        onlyWhenLive: params.updatedChannel.submissionsOnlyWhenLive ?? false,
      });
    }
  } catch (emitErr) {
    logger.error('admin.channel_settings.emit_submissions_status_failed', {
      errorMessage: getErrorMessage(emitErr),
    });
  }
}

export function emitOverlayConfig(params: {
  req: AuthRequest;
  updatedChannel: Record<string, unknown>;
  channelRec: Record<string, unknown>;
}) {
  try {
    const io: Server = params.req.app.get('io');
    const slug = String(params.updatedChannel.slug || params.channelRec.slug || '').toLowerCase();
    if (slug) {
      io.to(`channel:${slug}`).emit('overlay:config', {
        overlayMode: params.updatedChannel.overlayMode ?? 'queue',
        overlayShowSender: params.updatedChannel.overlayShowSender ?? false,
        overlayMaxConcurrent: params.updatedChannel.overlayMaxConcurrent ?? 3,
        overlayStyleJson: params.updatedChannel.overlayStyleJson ?? null,
      });
    }
  } catch (emitErr) {
    logger.error('admin.channel_settings.emit_overlay_config_failed', {
      errorMessage: getErrorMessage(emitErr),
    });
  }
}
