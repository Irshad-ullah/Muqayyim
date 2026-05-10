/**
 * emailValidator.js
 *
 * Three-layer email validation pipeline:
 *   1. RFC-5321 format check (regex)          — synchronous, ~0 ms
 *   2. Disposable-domain blocklist            — synchronous, ~0 ms
 *   3. DNS MX record lookup                   — async, ~50–200 ms on warm cache
 *
 * Why no SMTP-level probe?
 *   Most SMTP servers reply 250 OK to RCPT TO regardless of whether the
 *   mailbox exists (catch-all behaviour), making the check unreliable.
 *   Probing also risks getting your server's IP blacklisted by RBLs.
 *   DNS MX lookup is fast, reliable, and has no side-effects.
 *
 * Fail-open policy:
 *   Network-level DNS errors (timeout, ECONNREFUSED) resolve as valid:true
 *   to avoid blocking legitimate users when DNS infrastructure is flaky.
 *   Only hard negative DNS responses (ENOTFOUND, ENODATA, ESERVFAIL) reject.
 */

import dns from "dns/promises";
import net from "net";

// RFC-5321 compliant pattern. Covers the overwhelming majority of real addresses.
const FORMAT_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// DNS lookup timeout (ms). Fail-open on expiry to avoid blocking registration.
const MX_TIMEOUT_MS = 3000;
const SMTP_TIMEOUT_MS = 5000;
const SMTP_VERIFICATION_ENABLED =
  process.env.SMTP_VERIFICATION_ENABLED === "true";
const SMTP_VERIFICATION_FROM =
  process.env.SMTP_VERIFICATION_FROM || "verify@localhost";
const SMTP_HELO_HOST = process.env.SMTP_HELO_HOST || "localhost";

// Curated list of well-known disposable / temporary email providers.
const DISPOSABLE_DOMAINS = new Set([
  // Guerrilla Mail family
  "guerrillamail.com",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "grr.la",
  "spam4.me",
  // YOPmail family
  "yopmail.com",
  "yopmail.fr",
  "yopmail.pp.ua",
  // Temp-mail family
  "temp-mail.org",
  "tempmail.com",
  "tempmail.de",
  "tempmail.it",
  "tempr.email",
  // Trashmail family
  "trashmail.com",
  "trashmail.at",
  "trashmail.io",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "trashmailer.com",
  "trashymail.com",
  // Mailinator & clones
  "mailinator.com",
  "mailin8r.com",
  "mailnull.com",
  // Common one-offs
  "10minutemail.com",
  "fakeinbox.com",
  "dispostable.com",
  "throwaway.email",
  "discard.email",
  "spamevader.com",
  "emailondeck.com",
  "getonemail.com",
  "mailexpire.com",
  "crazymailing.com",
  "binkmail.com",
  "harakirimail.com",
  "spamgob.com",
  "spaml.de",
  "spamspot.com",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.org",
  "maildrop.cc",
  "spamgourmet.com",
  "spamgourmet.net",
  "throwam.com",
  "objectmail.com",
  "filzmail.com",
]);

// ─── Step 1: Format ──────────────────────────────────────────────────────────

const checkFormat = (email) => {
  if (!email || typeof email !== "string") {
    return { valid: false, reason: "Email is required" };
  }
  if (!FORMAT_REGEX.test(email)) {
    return {
      valid: false,
      reason:
        "Invalid email format. Please enter a valid email address (e.g. name@example.com)",
    };
  }
  return { valid: true };
};

// ─── Step 2: Disposable domain ───────────────────────────────────────────────

const checkDisposable = (email) => {
  const domain = email.split("@")[1]?.toLowerCase();
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      valid: false,
      reason:
        "Disposable or temporary email addresses are not allowed. Please use a real email address.",
    };
  }
  return { valid: true };
};

// ─── Step 3: DNS MX lookup ───────────────────────────────────────────────────

const resolveMxRecords = async (domain) => {
  const lookupPromise = dns.resolveMx(domain);
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ timedOut: true }), MX_TIMEOUT_MS),
  );

  const result = await Promise.race([lookupPromise, timeoutPromise]);
  if (result?.timedOut) {
    return { timedOut: true, records: [] };
  }

  return { timedOut: false, records: result };
};

const resolveDomainARecords = async (domain) => {
  const lookupPromise = dns.resolve(domain);
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ timedOut: true }), MX_TIMEOUT_MS),
  );

  const result = await Promise.race([lookupPromise, timeoutPromise]);
  if (result?.timedOut) {
    return { timedOut: true, addresses: [] };
  }

  return { timedOut: false, addresses: result };
};

const checkMXRecord = async (email) => {
  const domain = email.split("@")[1];

  let mxResult;
  try {
    mxResult = await resolveMxRecords(domain);
  } catch (err) {
    if (["ENOTFOUND", "ENODATA", "ESERVFAIL"].includes(err.code)) {
      return {
        valid: false,
        reason: `The domain "${domain}" does not exist or has no mail server configured`,
      };
    }
    return { valid: true };
  }

  if (mxResult.timedOut) {
    return { valid: true };
  }

  if (!Array.isArray(mxResult.records) || mxResult.records.length === 0) {
    let aResult;
    try {
      aResult = await resolveDomainARecords(domain);
    } catch (err) {
      return { valid: true };
    }

    if (aResult.timedOut) {
      return { valid: true };
    }

    if (!Array.isArray(aResult.addresses) || aResult.addresses.length === 0) {
      return {
        valid: false,
        reason: `The domain "${domain}" has no mail server configured`,
      };
    }
  }

  return { valid: true };
};

const readResponse = (socket) => {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\r\n")) {
        cleanup();
        resolve(buffer.trim());
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onTimeout = () => {
      cleanup();
      reject(new Error("SMTP verification timed out"));
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);
  });
};

const sendSmtpCommand = async (socket, command) => {
  socket.write(`${command}\r\n`);
  const response = await readResponse(socket);
  const code = parseInt(response.slice(0, 3), 10);
  return { code, response };
};

const checkSMTPAddress = async (email) => {
  const domain = email.split("@")[1];
  let mxResult;

  try {
    mxResult = await resolveMxRecords(domain);
  } catch (err) {
    return { valid: true };
  }

  if (
    mxResult.timedOut ||
    !Array.isArray(mxResult.records) ||
    mxResult.records.length === 0
  ) {
    return { valid: true };
  }

  const sortedMx = mxResult.records
    .filter((record) => record.exchange)
    .sort((a, b) => a.priority - b.priority);

  for (const mx of sortedMx) {
    const socket = net.createConnection({
      host: mx.exchange,
      port: 25,
      timeout: SMTP_TIMEOUT_MS,
    });

    try {
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
        socket.once("timeout", () =>
          reject(new Error("SMTP connection timed out")),
        );
      });

      const greeting = await readResponse(socket);
      const greetingCode = parseInt(greeting.slice(0, 3), 10);
      if (greetingCode !== 220) {
        socket.end();
        continue;
      }

      const helo = await sendSmtpCommand(socket, `HELO ${SMTP_HELO_HOST}`);
      if (helo.code < 200 || helo.code >= 400) {
        socket.end();
        continue;
      }

      const mailFrom = await sendSmtpCommand(
        socket,
        `MAIL FROM:<${SMTP_VERIFICATION_FROM}>`,
      );
      if (mailFrom.code < 200 || mailFrom.code >= 400) {
        socket.end();
        continue;
      }

      const rcptTo = await sendSmtpCommand(socket, `RCPT TO:<${email}>`);
      socket.end();

      if ([250, 251].includes(rcptTo.code)) {
        return { valid: true };
      }
      if ([550, 551, 553].includes(rcptTo.code)) {
        return {
          valid: false,
          reason: `The email address "${email}" was rejected by the mail server for ${mx.exchange}`,
        };
      }

      return { valid: true };
    } catch {
      socket.destroy();
      continue;
    }
  }

  return { valid: true };
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the full three-layer validation pipeline.
 *
 * @param {string} email - Raw email string from the request body.
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export const validateEmail = async (email) => {
  const normalized = (email || "").trim().toLowerCase();

  const formatResult = checkFormat(normalized);
  if (!formatResult.valid) return formatResult;

  const disposableResult = checkDisposable(normalized);
  if (!disposableResult.valid) return disposableResult;

  const mxResult = await checkMXRecord(normalized);
  if (!mxResult.valid) return mxResult;

  if (SMTP_VERIFICATION_ENABLED) {
    const smtpResult = await checkSMTPAddress(normalized);
    if (!smtpResult.valid) return smtpResult;
  }

  return { valid: true };
};

export default validateEmail;
