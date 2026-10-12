import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/adminService.js', () => ({
  adminService: {
    getErrorLogs: vi.fn(),
    getErrorLog: vi.fn(),
    acknowledgeErrorLog: vi.fn(),
    getSecurityEvents: vi.fn(),
  },
}));
// The real layout needs auth context and a router; the page logic doesn't.
vi.mock('../../components/admin/AdminLayout.jsx', () => ({
  default: ({ children, title }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { adminService } = await import('../../services/adminService.js');
const { default: AdminLogsPage, buildErrorLogParams } = await import('./AdminLogsPage.jsx');

const ROWS = [
  { id: 'c1', service: 'core', level: 'critical', module: 'database', errorType: 'MongoNetworkError', message: 'db down', requestId: 'req-core-0001-abcd', timestamp: '2026-10-12T10:00:00Z', acknowledged: false },
  { id: 'a1', service: 'ai', level: 'warning', module: 'cv-parsing', errorType: 'CV_TEXT_EXTRACTION_FAILED', message: 'empty pdf', requestId: 'req-ai-0001-abcd', timestamp: '2026-10-12T09:00:00Z', acknowledged: true },
];
const listResponse = (overrides = {}) => ({
  data: ROWS,
  pagination: { total: 2, page: 1, limit: 20, pages: 1 },
  partial: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  adminService.getErrorLogs.mockResolvedValue(listResponse());
  adminService.getSecurityEvents.mockResolvedValue({
    data: [{ id: 's1', event: 'Account locked', userId: 'u1', ip: '1.2.3.4', requestId: 'sec-req-0001', timestamp: '2026-10-12T08:00:00Z', details: { failedLoginAttempts: 5 } }],
    events: ['Account locked', 'Password changed'],
    pagination: { total: 1, page: 1, limit: 20, pages: 1 },
  });
});

afterEach(cleanup);

const lastParams = () => adminService.getErrorLogs.mock.calls.at(-1)[0];

describe('AdminLogsPage — error logs', () => {
  test('renders entries from all services', async () => {
    render(<AdminLogsPage />);
    const rows = await screen.findAllByTestId('error-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('MongoNetworkError')).toBeTruthy();
    expect(within(rows[0]).getByText('critical')).toBeTruthy();
    expect(within(rows[0]).getByText('Core')).toBeTruthy();
    expect(within(rows[1]).getByText('AI')).toBeTruthy();
    expect(within(rows[1]).getByLabelText('Acknowledged')).toBeTruthy();
    expect(adminService.getErrorLogs).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  test('filters call the API with the right params', async () => {
    const user = userEvent.setup();
    render(<AdminLogsPage />);
    await screen.findAllByTestId('error-row');

    await user.selectOptions(screen.getByLabelText('Service'), 'ai');
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, service: 'ai' }));

    await user.selectOptions(screen.getByLabelText('Level'), 'critical');
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, service: 'ai', level: 'critical' }));

    await user.click(screen.getByLabelText('Unacknowledged only'));
    await waitFor(() => expect(lastParams()).toMatchObject({ acknowledged: 'false' }));

    await user.type(screen.getByLabelText('Module'), 'cv-parsing');
    await user.type(screen.getByLabelText('Search'), 'req-ai-0001');
    await user.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() =>
      expect(lastParams()).toEqual({
        page: 1,
        limit: 20,
        service: 'ai',
        level: 'critical',
        module: 'cv-parsing',
        search: 'req-ai-0001',
        acknowledged: 'false',
      }),
    );
  });

  test('date filters are sent as ISO timestamps', () => {
    const params = buildErrorLogParams(
      { service: '', level: '', module: '', search: '', unacknowledged: false, from: '2026-10-01T00:00', to: '2026-10-02T12:30' },
      2,
    );
    expect(params.page).toBe(2);
    expect(new Date(params.from).toISOString()).toBe(params.from);
    expect(new Date(params.to).toISOString()).toBe(params.to);
  });

  test('row click opens the drawer with the stack; acknowledge updates the row', async () => {
    const user = userEvent.setup();
    adminService.getErrorLog.mockResolvedValue({ data: { ...ROWS[0], stack: 'MongoNetworkError: db down\n    at connect' } });
    adminService.acknowledgeErrorLog.mockResolvedValue({ data: { ...ROWS[0], acknowledged: true, acknowledgedAt: '2026-10-12T10:05:00Z' } });

    render(<AdminLogsPage />);
    const [first] = await screen.findAllByTestId('error-row');
    expect(within(first).queryByLabelText('Acknowledged')).toBeNull();

    await user.click(first);
    const drawer = await screen.findByRole('dialog', { name: 'Error details' });
    expect(adminService.getErrorLog).toHaveBeenCalledWith('core', 'c1');
    expect(await within(drawer).findByText(/at connect/)).toBeTruthy();
    expect(within(drawer).getByText('req-core-0001-abcd')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Copy request ID' })).toBeTruthy();

    await user.click(within(drawer).getByRole('button', { name: /^acknowledge$/i }));
    expect(adminService.acknowledgeErrorLog).toHaveBeenCalledWith('core', 'c1');
    await waitFor(() => expect(within(first).getByLabelText('Acknowledged')).toBeTruthy());
    expect(within(drawer).getByText(/^Acknowledged/)).toBeTruthy();
  });

  test('shows a notice when results are partial', async () => {
    adminService.getErrorLogs.mockResolvedValue(
      listResponse({ partial: true, notice: 'AIServices logs are unavailable right now; showing Core and Gateway entries only.' }),
    );
    render(<AdminLogsPage />);
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('AIServices logs are unavailable'));
  });
});

describe('AdminLogsPage — security events', () => {
  test('tab loads events and filters by event type', async () => {
    const user = userEvent.setup();
    render(<AdminLogsPage />);
    await user.click(screen.getByRole('tab', { name: /security events/i }));
    const rows = await screen.findAllByTestId('security-row');
    expect(within(rows[0]).getByText('Account locked')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Event'), 'Password changed');
    await waitFor(() =>
      expect(adminService.getSecurityEvents.mock.calls.at(-1)[0]).toEqual({ page: 1, limit: 20, event: 'Password changed' }),
    );

    // The filter re-fetched and re-rendered the table: query the rows again.
    const [fresh] = await screen.findAllByTestId('security-row');
    await user.click(fresh);
    const drawer = await screen.findByRole('dialog', { name: 'Security event' });
    expect(within(drawer).getByText(/failedLoginAttempts/)).toBeTruthy();
  });
});
