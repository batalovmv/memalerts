import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  ALLOWED_USERS_MAX_COUNT,
  BOT_RESPONSE_MAX_LEN,
  BOT_TRIGGER_MAX_LEN,
  CHAT_COMMAND_ALLOWED_ROLES,
  VKVIDEO_ROLE_IDS_MAX_COUNT,
  type BotCommandBody,
  type BotCommandUpdatePayload,
  isPrismaErrorCode,
  normalizeAllowedRoles,
  normalizeAllowedUsers,
  normalizeMessage,
  normalizeTrigger,
  normalizeVkVideoAllowedRoleIds,
  requireChannelId,
} from './botShared.js';

export const botCommandsHandlers = {
  getCommands: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const items = await prisma.chatBotCommand.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          trigger: true,
          response: true,
          enabled: true,
          onlyWhenLive: true,
          allowedRoles: true,
          allowedUsers: true,
          vkvideoAllowedRoleIds: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ items });
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2022')) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },

  createCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const commandBody = req.body as BotCommandBody;
    const { trigger, triggerNormalized } = normalizeTrigger(commandBody.trigger);
    const responseText = normalizeMessage(commandBody.response);
    const onlyWhenLiveRaw = commandBody.onlyWhenLive;
    const onlyWhenLive = onlyWhenLiveRaw === undefined ? false : onlyWhenLiveRaw;
    const allowedRolesParsed = normalizeAllowedRoles(commandBody.allowedRoles);
    const allowedUsersParsed = normalizeAllowedUsers(commandBody.allowedUsers);
    const vkvideoAllowedRoleIdsParsed = normalizeVkVideoAllowedRoleIds(commandBody.vkvideoAllowedRoleIds);

    if (!trigger) return res.status(400).json({ error: 'Bad Request', message: 'Trigger is required' });
    if (!responseText) return res.status(400).json({ error: 'Bad Request', message: 'Response is required' });
    if (typeof onlyWhenLive !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'onlyWhenLive must be boolean' });
    }
    if (allowedRolesParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedRoles must be an array of roles (${CHAT_COMMAND_ALLOWED_ROLES.join(', ')})`,
      });
    }
    if (allowedUsersParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedUsers must be an array of lowercase twitch logins (max ${ALLOWED_USERS_MAX_COUNT})`,
      });
    }
    if (vkvideoAllowedRoleIdsParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `vkvideoAllowedRoleIds must be an array of role ids (max ${VKVIDEO_ROLE_IDS_MAX_COUNT})`,
      });
    }
    if (trigger.length > BOT_TRIGGER_MAX_LEN) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: `Trigger is too long (max ${BOT_TRIGGER_MAX_LEN})` });
    }
    if (responseText.length > BOT_RESPONSE_MAX_LEN) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: `Response is too long (max ${BOT_RESPONSE_MAX_LEN})` });
    }

    try {
      const row = await prisma.chatBotCommand.create({
        data: {
          channelId,
          trigger,
          triggerNormalized,
          response: responseText,
          enabled: true,
          onlyWhenLive,
          allowedRoles: allowedRolesParsed ?? [],
          allowedUsers: allowedUsersParsed ?? [],
          vkvideoAllowedRoleIds: vkvideoAllowedRoleIdsParsed ?? [],
        },
        select: {
          id: true,
          trigger: true,
          response: true,
          enabled: true,
          onlyWhenLive: true,
          allowedRoles: true,
          allowedUsers: true,
          vkvideoAllowedRoleIds: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return res.status(201).json(row);
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2022')) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      if (isPrismaErrorCode(error, 'P2002')) {
        return res.status(409).json({ error: 'Conflict', message: 'Command trigger already exists' });
      }
      throw error;
    }
  },

  patchCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const params = req.params as { id?: string };
    const id = String(params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'Bad Request', message: 'Missing id' });

    const commandBody = req.body as BotCommandBody;
    const enabled = commandBody.enabled;
    const onlyWhenLive = commandBody.onlyWhenLive;
    const allowedRolesParsed = normalizeAllowedRoles(commandBody.allowedRoles);
    const allowedUsersParsed = normalizeAllowedUsers(commandBody.allowedUsers);
    const vkvideoAllowedRoleIdsParsed = normalizeVkVideoAllowedRoleIds(commandBody.vkvideoAllowedRoleIds);
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });
    }
    if (onlyWhenLive !== undefined && typeof onlyWhenLive !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'onlyWhenLive must be boolean' });
    }
    if (allowedRolesParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedRoles must be an array of roles (${CHAT_COMMAND_ALLOWED_ROLES.join(', ')})`,
      });
    }
    if (allowedUsersParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedUsers must be an array of lowercase twitch logins (max ${ALLOWED_USERS_MAX_COUNT})`,
      });
    }
    if (vkvideoAllowedRoleIdsParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `vkvideoAllowedRoleIds must be an array of role ids (max ${VKVIDEO_ROLE_IDS_MAX_COUNT})`,
      });
    }

    if (
      enabled === undefined &&
      onlyWhenLive === undefined &&
      allowedRolesParsed === undefined &&
      allowedUsersParsed === undefined &&
      vkvideoAllowedRoleIdsParsed === undefined
    ) {
      return res.status(400).json({
        error: 'Bad Request',
        message:
          'At least one field is required (enabled, onlyWhenLive, allowedRoles, allowedUsers, vkvideoAllowedRoleIds)',
      });
    }

    const data: BotCommandUpdatePayload = {};
    if (enabled !== undefined) data.enabled = enabled;
    if (onlyWhenLive !== undefined) data.onlyWhenLive = onlyWhenLive;
    if (allowedRolesParsed !== undefined) data.allowedRoles = allowedRolesParsed;
    if (allowedUsersParsed !== undefined) data.allowedUsers = allowedUsersParsed;
    if (vkvideoAllowedRoleIdsParsed !== undefined) data.vkvideoAllowedRoleIds = vkvideoAllowedRoleIdsParsed;

    try {
      const updated = await prisma.chatBotCommand.updateMany({
        where: { id, channelId },
        data,
      });
      if (updated.count === 0) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });

      const row = await prisma.chatBotCommand.findUnique({
        where: { id },
        select: {
          id: true,
          trigger: true,
          response: true,
          enabled: true,
          onlyWhenLive: true,
          allowedRoles: true,
          allowedUsers: true,
          vkvideoAllowedRoleIds: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!row) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });
      return res.json(row);
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2021') || isPrismaErrorCode(error, 'P2022')) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },

  deleteCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const deleteParams = req.params as { id?: string };
    const id = String(deleteParams.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'Bad Request', message: 'Missing id' });

    const deleted = await prisma.chatBotCommand.deleteMany({
      where: { id, channelId },
    });
    if (deleted.count === 0) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });
    return res.json({ ok: true });
  },
};
