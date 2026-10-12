import mongoose from 'mongoose';
import User from '../models/User.js';
import { sendEmailRaw } from '../utils/emailService.js';
import { alertsEnabled, alertThrottleMs } from '../config/logging.js';

// Emails all active admins about critical errors (from Core, or from AIServices
// via POST /internal/alerts). Throttled to one email per (service, errorType)
// per ALERT_THROTTLE_MINUTES. Failures go to the console only — never back into
// the error log — to avoid alert loops.

const lastSent = new Map();
const ADMIN_CACHE_MS = 10 * 60 * 1000;
let adminEmails = [];
let adminEmailsAt = 0;

// Admin emails are cached so alerts still go out when MongoDB itself is down.
export const refreshAdminEmails = async () => {
  if (mongoose.connection.readyState !== 1) return adminEmails;
  try {
    const admins = await User.find({ role: 'Admin', isActive: { $ne: false } }).select('email').lean();
    adminEmails = admins.map((a) => a.email).filter(Boolean);
    adminEmailsAt = Date.now();
  } catch (err) {
    console.error('[Alerts] Could not refresh admin emails:', err.message);
  }
  return adminEmails;
};

export const markAdminEmailsStale = () => {
  adminEmailsAt = 0;
};

const getAdminEmails = async () =>
  Date.now() - adminEmailsAt > ADMIN_CACHE_MS ? refreshAdminEmails() : adminEmails;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Returns 'sent' | 'throttled' | 'disabled' | 'no-recipients' | 'failed'.
export const sendCriticalAlert = async (entry) => {
  if (!alertsEnabled()) return 'disabled';
  const key = `${entry.service}:${entry.errorType}`;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < alertThrottleMs()) return 'throttled';
  lastSent.set(key, now);

  try {
    const to = await getAdminEmails();
    if (!to.length) {
      console.error('[Alerts] Critical error but no active admin emails are known');
      return 'no-recipients';
    }
    const when = new Date(entry.timestamp || now).toISOString();
    const subject = `[MUQAYYIM] Critical error in ${entry.service}: ${entry.errorType}`;
    // Deliberately no stack trace in the email.
    const html = `
      <h2>Critical error</h2>
      <table cellpadding="4">
        <tr><td><b>Service</b></td><td>${escapeHtml(entry.service)}</td></tr>
        <tr><td><b>Module</b></td><td>${escapeHtml(entry.module)}</td></tr>
        <tr><td><b>Error type</b></td><td>${escapeHtml(entry.errorType)}</td></tr>
        <tr><td><b>Message</b></td><td>${escapeHtml(entry.message)}</td></tr>
        <tr><td><b>Request ID</b></td><td>${escapeHtml(entry.requestId || '—')}</td></tr>
        <tr><td><b>Time (UTC)</b></td><td>${escapeHtml(when)}</td></tr>
      </table>
      <p>Open Admin → Error Logs for details. Further alerts for this error type are
      suppressed for ${Math.round(alertThrottleMs() / 60000)} minutes.</p>`;
    const ok = await sendEmailRaw(to.join(','), subject, html);
    if (!ok) {
      console.error(`[Alerts] Failed to send critical alert for ${key}`);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error(`[Alerts] Failed to send critical alert for ${key}:`, err.message);
    return 'failed';
  }
};

// Test helper.
export const resetAlertState = () => {
  lastSent.clear();
  adminEmails = [];
  adminEmailsAt = 0;
};
