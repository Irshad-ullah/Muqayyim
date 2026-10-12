import mongoose from 'mongoose';
import ErrorLog, { LOG_LEVELS } from '../../models/ErrorLog.js';
import SecurityEvent from '../../models/SecurityEvent.js';
import { auditLog } from '../utils/auditLog.js';
import { handleServerError } from '../../utils/serverError.js';
import { listAiErrorLogs, getAiErrorLog, acknowledgeAiErrorLog, getAiLogSummary } from '../../services/aiServiceClient.js';

// Admin views over the error logs of all services (Core and Gateway entries
// live in core_db; AI entries are fetched from AIServices) and the security
// events. Stacks are only returned by the detail endpoint.

const MAX_LIMIT = 100;
const MAX_MERGE_DEPTH = 1000; // newest N entries per service considered when merging
const SERVICES = ['core', 'ai', 'gateway'];
const AI_UNAVAILABLE_NOTICE = 'AIServices logs are unavailable right now; showing Core and Gateway entries only.';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toInt = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const parseDate = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);

const readFilters = (q) => ({
  service: SERVICES.includes(q.service) ? q.service : undefined,
  level: LOG_LEVELS.includes(q.level) ? q.level : undefined,
  module: typeof q.module === 'string' && q.module.trim() ? q.module.trim().slice(0, 60) : undefined,
  from: parseDate(q.from),
  to: parseDate(q.to),
  search: typeof q.search === 'string' && q.search.trim() ? q.search.trim().slice(0, 200) : undefined,
  acknowledged: q.acknowledged === 'true' ? true : q.acknowledged === 'false' ? false : undefined,
  page: toInt(q.page, 1),
  limit: Math.min(toInt(q.limit, 20), MAX_LIMIT),
});

const coreQuery = (f) => {
  const query = {};
  query.service = f.service ? f.service : { $in: ['core', 'gateway'] };
  if (f.level) query.level = f.level;
  if (f.module) query.module = f.module;
  if (f.acknowledged !== undefined) query.acknowledged = f.acknowledged ? true : { $ne: true };
  if (f.from || f.to) {
    query.timestamp = {};
    if (f.from) query.timestamp.$gte = f.from;
    if (f.to) query.timestamp.$lte = f.to;
  }
  if (f.search) {
    const re = new RegExp(escapeRegex(f.search), 'i');
    query.$or = [{ message: re }, { errorType: re }, { requestId: re }];
  }
  return query;
};

const toRow = (doc) => {
  const { _id, stack, ...rest } = doc;
  return { id: String(_id), ...rest };
};

// Params forwarded to AIServices (same filters, AI paginates itself).
const aiParams = (f, page, limit) => {
  const p = { page, limit };
  for (const k of ['level', 'module', 'search']) if (f[k]) p[k] = f[k];
  if (f.from) p.from = f.from.toISOString();
  if (f.to) p.to = f.to.toISOString();
  if (f.acknowledged !== undefined) p.acknowledged = String(f.acknowledged);
  return p;
};

// @route   GET /api/admin/logs/errors
export const listErrorLogs = async (req, res) => {
  try {
    const f = readFilters(req.query);
    const includeCore = f.service !== 'ai';
    const includeAi = !f.service || f.service === 'ai';
    const merging = includeCore && includeAi;
    const depth = Math.min(f.page * f.limit, MAX_MERGE_DEPTH);
    const skip = (f.page - 1) * f.limit;

    const [core, ai] = await Promise.all([
      includeCore
        ? (async () => {
            const q = coreQuery(f);
            const find = ErrorLog.find(q).select('-stack').sort({ timestamp: -1 }).lean();
            if (merging) find.limit(depth);
            else find.skip(skip).limit(f.limit);
            const [docs, total] = await Promise.all([find, ErrorLog.countDocuments(q)]);
            return { rows: docs.map(toRow), total };
          })()
        : { rows: [], total: 0 },
      includeAi
        ? listAiErrorLogs(merging ? aiParams(f, 1, depth) : aiParams(f, f.page, f.limit), req)
        : { ok: true, data: { data: [], total: 0 } },
    ]);

    const partial = includeAi && !ai.ok;
    const aiRows = ai.ok ? (ai.data?.data || []).map((r) => ({ ...r, service: 'ai' })) : [];
    const aiTotal = ai.ok ? ai.data?.total || 0 : 0;

    let rows = merging || !includeCore ? [...core.rows, ...aiRows] : core.rows;
    if (merging) {
      rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      rows = rows.slice(skip, skip + f.limit);
    }
    const total = core.total + aiTotal;

    return res.json({
      success: true,
      data: rows,
      pagination: { total, page: f.page, limit: f.limit, pages: Math.max(1, Math.ceil(total / f.limit)) },
      partial,
      ...(partial ? { notice: AI_UNAVAILABLE_NOTICE } : {}),
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to fetch error logs' });
  }
};

const isCoreService = (s) => s === 'core' || s === 'gateway';

// @route   GET /api/admin/logs/errors/:service/:id   (includes the stack)
export const getErrorLog = async (req, res) => {
  try {
    const { service, id } = req.params;
    if (!SERVICES.includes(service)) return res.status(404).json({ success: false, message: 'Log entry not found' });

    if (isCoreService(service)) {
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'Log entry not found' });
      const doc = await ErrorLog.findOne({ _id: id, service }).lean();
      if (!doc) return res.status(404).json({ success: false, message: 'Log entry not found' });
      const { _id, ...rest } = doc;
      return res.json({ success: true, data: { id: String(_id), ...rest } });
    }

    const ai = await getAiErrorLog(id, req);
    if (!ai.ok) return res.status(503).json({ success: false, code: 'AI_LOGS_UNAVAILABLE', message: AI_UNAVAILABLE_NOTICE });
    if (ai.notFound || !ai.data?.data) return res.status(404).json({ success: false, message: 'Log entry not found' });
    return res.json({ success: true, data: { ...ai.data.data, service: 'ai' } });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to fetch log entry' });
  }
};

// @route   PATCH /api/admin/logs/errors/:service/:id/acknowledge
export const acknowledgeErrorLog = async (req, res) => {
  try {
    const { service, id } = req.params;
    if (!SERVICES.includes(service)) return res.status(404).json({ success: false, message: 'Log entry not found' });
    const acknowledgedBy = req.user.id;
    let data;

    if (isCoreService(service)) {
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'Log entry not found' });
      const doc = await ErrorLog.findOneAndUpdate(
        { _id: id, service },
        { $set: { acknowledged: true, acknowledgedBy, acknowledgedAt: new Date() } },
        { new: true, projection: { stack: 0 } },
      ).lean();
      if (!doc) return res.status(404).json({ success: false, message: 'Log entry not found' });
      data = toRow(doc);
    } else {
      const ai = await acknowledgeAiErrorLog(id, acknowledgedBy, req);
      if (!ai.ok) return res.status(503).json({ success: false, code: 'AI_LOGS_UNAVAILABLE', message: AI_UNAVAILABLE_NOTICE });
      if (ai.notFound || !ai.data?.data) return res.status(404).json({ success: false, message: 'Log entry not found' });
      data = { ...ai.data.data, service: 'ai' };
    }

    await auditLog(req.user.userId, 'ACK_ERROR_LOG', 'ErrorLog', id, { service }, req);
    return res.json({ success: true, message: 'Log entry acknowledged', data });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to acknowledge log entry' });
  }
};

// @route   GET /api/admin/logs/security
export const listSecurityEvents = async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 20), MAX_LIMIT);
    const query = {};
    if (typeof req.query.event === 'string' && req.query.event.trim()) query.event = req.query.event.trim();
    if (typeof req.query.userId === 'string' && req.query.userId.trim()) query.userId = req.query.userId.trim();
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = from;
      if (to) query.timestamp.$lte = to;
    }

    const [docs, total, events] = await Promise.all([
      SecurityEvent.find(query).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SecurityEvent.countDocuments(query),
      SecurityEvent.distinct('event'),
    ]);
    return res.json({
      success: true,
      data: docs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })),
      events: events.sort(),
      pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to fetch security events' });
  }
};

const emptyCounts = () => ({ warning: 0, error: 0, critical: 0 });

// @route   GET /api/admin/logs/summary   (last 24 hours, by service and level)
export const getLogSummary = async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [grouped, ai] = await Promise.all([
      ErrorLog.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: { service: '$service', level: '$level' }, count: { $sum: 1 } } },
      ]),
      getAiLogSummary(since.toISOString(), req),
    ]);

    const byService = { core: emptyCounts(), ai: emptyCounts(), gateway: emptyCounts() };
    for (const { _id, count } of grouped) {
      if (byService[_id.service] && _id.level in byService[_id.service]) byService[_id.service][_id.level] = count;
    }
    if (ai.ok && ai.data?.counts) {
      for (const level of LOG_LEVELS) byService.ai[level] = Number(ai.data.counts[level]) || 0;
    }
    const totals = emptyCounts();
    for (const counts of Object.values(byService)) for (const level of LOG_LEVELS) totals[level] += counts[level];

    return res.json({
      success: true,
      since,
      byService,
      totals,
      partial: !ai.ok,
      ...(ai.ok ? {} : { notice: AI_UNAVAILABLE_NOTICE }),
    });
  } catch (error) {
    return handleServerError(res, req, error, { module: 'admin', message: 'Failed to fetch log summary' });
  }
};
