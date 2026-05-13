import React, { useEffect, useState, useCallback } from 'react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { adminService } from '../../services/adminService.js';
import toast from 'react-hot-toast';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Shield,
  UserCheck,
  UserX,
  Trash2,
  AlertCircle,
  Filter,
} from 'lucide-react';

const ROLES = ['All', 'JobSeeker', 'Admin'];
const STATUSES = ['All', 'active', 'inactive'];

const CV_STATUS_COLORS = {
  'Not Uploaded': 'bg-slate-100 text-slate-600',
  Uploaded: 'bg-blue-100 text-blue-700',
  Processing: 'bg-amber-100 text-amber-700',
  Verified: 'bg-emerald-100 text-emerald-700',
};

function RoleBadge({ role }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
        role === 'Admin'
          ? 'bg-indigo-100 text-indigo-700'
          : 'bg-slate-100 text-slate-600'
      }`}
    >
      {role === 'Admin' && <Shield className="w-3 h-3" />}
      {role}
    </span>
  );
}

function StatusDot({ isActive }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isActive !== false ? 'text-emerald-600' : 'text-red-500'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive !== false ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {isActive !== false ? 'Active' : 'Inactive'}
    </span>
  );
}

function UserInitials({ name }) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';
  return (
    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-semibold text-indigo-700">{initials}</span>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 15, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // userId being actioned

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchInput, setSearchInput] = useState('');

  const fetchUsers = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const params = { page, limit: 15 };
        if (search) params.search = search;
        if (roleFilter !== 'All') params.role = roleFilter;
        if (statusFilter !== 'All') params.status = statusFilter;

        const data = await adminService.getUsers(params);
        setUsers(data.data);
        setPagination(data.pagination);
      } catch (err) {
        setError(err?.response?.data?.message || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    },
    [search, roleFilter, statusFilter]
  );

  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleToggleStatus = async (user) => {
    const next = user.isActive === false ? true : false;
    setActionLoading(user._id);
    try {
      await adminService.toggleUserStatus(user._id, next);
      toast.success(`User ${next ? 'activated' : 'deactivated'}`);
      fetchUsers(pagination.page);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (user) => {
    const nextRole = user.role === 'Admin' ? 'JobSeeker' : 'Admin';
    if (!window.confirm(`Change ${user.name}'s role to ${nextRole}?`)) return;

    setActionLoading(user._id);
    try {
      await adminService.updateUserRole(user._id, nextRole);
      toast.success(`Role changed to ${nextRole}`);
      fetchUsers(pagination.page);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update role');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Permanently delete ${user.name}? This cannot be undone.`)) return;

    setActionLoading(user._id);
    try {
      await adminService.deleteUser(user._id);
      toast.success('User deleted');
      fetchUsers(pagination.page);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete user');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <AdminLayout title="User Management">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setSearchInput(''); }}
              className="px-3 py-2 border border-slate-200 bg-white text-sm text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Clear
            </button>
          )}
        </form>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button
            onClick={() => fetchUsers(pagination.page)}
            className="p-2 border border-slate-200 bg-white rounded-lg hover:bg-slate-50 text-slate-500 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Total count */}
      <p className="text-xs text-slate-500 mb-3">
        {pagination.total} user{pagination.total !== 1 ? 's' : ''} found
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">CV Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Joined</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 bg-slate-200 rounded w-28 animate-pulse" />
                          <div className="h-3 bg-slate-100 rounded w-40 animate-pulse" />
                        </div>
                      </div>
                    </td>
                    {[...Array(4)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 rounded w-16 animate-pulse" />
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded w-20 animate-pulse ml-auto" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const busy = actionLoading === u._id;
                  return (
                    <tr key={u._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      {/* User */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <UserInitials name={u.name} />
                          <div>
                            <p className="font-medium text-slate-800">{u.name}</p>
                            <p className="text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        <RoleBadge role={u.role} />
                      </td>

                      {/* CV Status */}
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CV_STATUS_COLORS[u.cvStatus] || 'bg-slate-100 text-slate-600'}`}>
                          {u.cvStatus}
                        </span>
                      </td>

                      {/* Active */}
                      <td className="px-4 py-3">
                        <StatusDot isActive={u.isActive} />
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(u.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* Toggle active */}
                          <button
                            onClick={() => handleToggleStatus(u)}
                            disabled={busy}
                            title={u.isActive !== false ? 'Deactivate' : 'Activate'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              u.isActive !== false
                                ? 'text-amber-500 hover:bg-amber-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            } disabled:opacity-40`}
                          >
                            {u.isActive !== false ? (
                              <UserX className="w-4 h-4" />
                            ) : (
                              <UserCheck className="w-4 h-4" />
                            )}
                          </button>

                          {/* Toggle role */}
                          <button
                            onClick={() => handleRoleChange(u)}
                            disabled={busy}
                            title={u.role === 'Admin' ? 'Demote to JobSeeker' : 'Promote to Admin'}
                            className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors disabled:opacity-40"
                          >
                            <Shield className="w-4 h-4" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(u)}
                            disabled={busy}
                            title="Delete user"
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">
              Page {pagination.page} of {pagination.pages} · {pagination.total} total
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchUsers(pagination.page - 1)}
                disabled={pagination.page <= 1 || loading}
                className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => fetchUsers(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages || loading}
                className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
