import React, { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParsedSummary from './ParsedSummary.jsx';

afterEach(cleanup);

const PARSED = {
  skills: [{ name: 'React', confidence: 0.95 }],
  experience: [
    { title: 'Software Engineer', company: 'Systems Ltd', startDate: '2022-01', endDate: '', current: true, description: '', confidence: 0.85, needsReview: [] },
    { title: 'Web Development Intern', company: 'TechCorp', startDate: '', endDate: '', current: false, description: '', confidence: 0.6, needsReview: ['startDate', 'endDate'] },
  ],
  education: [{ degree: 'BS', field: 'CS', institution: 'FAST NUCES', startDate: '2016', endDate: '2020', gpa: '', confidence: 0.85, needsReview: [] }],
  certifications: [
    { name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', date: '2023', url: '', needsReview: [] },
    { name: 'Machine Learning Specialization', issuer: '', date: '', url: '', needsReview: ['issuer'] },
  ],
  projects: [{ name: 'Muqayyim', description: 'Career platform', technologies: ['React'], githubUrl: 'https://github.com/a/muqayyim', liveUrl: '', needsReview: [] }],
};

// The page owns the data; this mirrors its section_replace handling.
function Harness({ onSave }) {
  const [data, setData] = useState(structuredClone(PARSED));
  const onEdit = (a) => a.type === 'section_replace' && setData((d) => ({ ...d, [a.key]: a.items }));
  return <ParsedSummary parsedData={data} isLoading={false} onEdit={onEdit} onDelete={() => {}} onSave={onSave} />;
}

describe('CV review — needsReview and the Verify block', () => {
  test('flagged fields are highlighted with a hint and Verify is blocked until they are filled', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    const intern = screen.getByTestId('experience-1');
    const start = within(intern).getByLabelText(/^Start date/);
    const end = within(intern).getByLabelText(/^End date/);
    expect(start.getAttribute('data-review')).toBe('true');
    expect(end.getAttribute('data-review')).toBe('true');
    expect(within(intern).getByText('Please add a start date')).toBeTruthy();
    expect(within(screen.getByTestId('experience-0')).getByLabelText(/^Start date/).getAttribute('data-review')).toBeNull();

    const issuer = within(screen.getByTestId('certifications-1')).getByLabelText(/^Issuer/);
    expect(issuer.getAttribute('data-review')).toBe('true');

    const save = screen.getByRole('button', { name: /confirm & save/i });
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId('verify-blockers').textContent).toMatch(/Experience 2 › Start date/);
    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();

    await user.type(start, 'Jun 2019');
    await user.type(end, '2019-08');
    expect(start.getAttribute('data-review')).toBeNull();
    expect(save.disabled).toBe(true); // issuer still missing
    await user.type(issuer, 'Coursera');

    expect(save.disabled).toBe(false);
    expect(screen.queryByTestId('verify-blockers')).toBeNull();
    await user.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('a rule error (end before start) keeps Verify blocked and shows under the field', async () => {
    const user = userEvent.setup();
    render(<Harness onSave={vi.fn()} />);
    const intern = screen.getByTestId('experience-1');
    await user.type(within(intern).getByLabelText(/^Start date/), '2021-05');
    await user.type(within(intern).getByLabelText(/^End date/), '2020-01');
    await user.type(within(screen.getByTestId('certifications-1')).getByLabelText(/^Issuer/), 'Coursera');
    expect(within(intern).getByText('End date must be after the start date')).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm & save/i }).disabled).toBe(true);
  });

  test('certifications are shown and counted', () => {
    render(<Harness onSave={vi.fn()} />);
    expect(screen.getByTestId('parsed-counts').textContent).toMatch(/2 certifications/);
    expect(within(screen.getByTestId('review-certifications')).getByDisplayValue('AWS Certified Cloud Practitioner')).toBeTruthy();
  });
});
