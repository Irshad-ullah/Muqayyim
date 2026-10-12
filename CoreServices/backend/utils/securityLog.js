import mongoose from 'mongoose';
import SecurityEvent from '../models/SecurityEvent.js';
import { maskDeep } from './mask.js';

// Security event log: one console line plus a `security_events` document
// (same retention as error logs). Callers pass userId, ip and the requestId
// (X-Request-Id) for correlation. Never pass passwords or tokens — details are
// masked anyway. Writing is fire-and-forget and never throws.
export const logSecurityEvent = (event, details = {}) => {
  const entry = { event, at: new Date().toISOString(), ...details };
  console.warn(`[Security] ${event}`, JSON.stringify(entry));

  const { userId, ip, requestId, ...rest } = details;
  if (mongoose.connection.readyState === 1) {
    SecurityEvent.create({
      event,
      userId: userId != null ? String(userId) : undefined,
      ip,
      requestId,
      details: maskDeep(rest),
    }).catch((err) => console.error('[Security] Could not store event:', err.message));
  }
  return entry;
};
