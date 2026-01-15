import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
export const STREAMER_COOKIE = __ENV.STREAMER_COOKIE || __ENV.AUTH_COOKIE || '';
export const VIEWER_COOKIE = __ENV.VIEWER_COOKIE || __ENV.AUTH_COOKIE || '';
export const PUBLIC_CHANNEL_SLUG = __ENV.PUBLIC_CHANNEL_SLUG || 'perf_test_channel';

export function authParams(cookie, tags = {}) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return { headers, tags };
}

export function checkOk(res) {
  return check(res, { 'status 200': (r) => r.status === 200 });
}

export function logIfError(res, label) {
  if (res.status >= 400) {
    console.error(`${label} failed`, res.status, res.body);
  }
}

export function getJson(res) {
  try {
    return res.json();
  } catch (_err) {
    return null;
  }
}










