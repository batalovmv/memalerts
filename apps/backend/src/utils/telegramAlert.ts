import { logger } from './logger.js';

function isAlertsEnabled(): boolean {
  const raw = String(process.env.ALERTS_TELEGRAM_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function getPrefix(): string {
  const explicit = String(process.env.ALERTS_TELEGRAM_PREFIX || '').trim();
  if (explicit) return explicit;
  const instance = String(process.env.INSTANCE || '').trim();
  if (instance) return instance;
  const domain = String(process.env.DOMAIN || '').trim();
  if (domain) return domain;
  return 'backend';
}

export async function sendTelegramAlert(message: string): Promise<boolean> {
  if (!isAlertsEnabled()) return false;

  const token = String(process.env.ALERTS_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.ALERTS_TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) {
    logger.warn('alerts.telegram.missing_config');
    return false;
  }

  const prefix = getPrefix();
  const text = prefix ? `[${prefix}] ${message}` : message;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('alerts.telegram.failed', { status: res.status, response: body.slice(0, 200) });
      return false;
    }
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
    logger.warn('alerts.telegram.error', { errorMessage: errMsg });
    return false;
  }
}
