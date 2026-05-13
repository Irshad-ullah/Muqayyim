import AdminLog from '../models/AdminLog.js';

// Fire-and-forget audit log — never throws so it never breaks an API call.
export const auditLog = async (adminId, action, resource, resourceId, details, req, status = 'success') => {
  try {
    await AdminLog.create({
      adminId,
      action,
      resource,
      resourceId: resourceId ? String(resourceId) : null,
      details,
      ipAddress: req?.ip || '',
      userAgent: req?.headers?.['user-agent'] || '',
      status,
    });
  } catch (err) {
    console.error('[AuditLog] Failed to write log:', err.message);
  }
};
