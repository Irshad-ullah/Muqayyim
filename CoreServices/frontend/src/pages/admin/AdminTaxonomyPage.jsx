import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, Database, History, ListChecks, Tags } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { taxonomyService } from '../../services/taxonomyService.js';
import DataSourcesTab from './taxonomy/DataSourcesTab.jsx';
import PreviewPublishTab from './taxonomy/PreviewPublishTab.jsx';
import HistoryTab from './taxonomy/HistoryTab.jsx';
import ProfessionsTab from './taxonomy/ProfessionsTab.jsx';
import SkillTaxonomyTab from './taxonomy/SkillTaxonomyTab.jsx';
import { LockBanner } from './taxonomy/components.jsx';
import usePolling from './taxonomy/usePolling.js';

// Admin → Professions & Skills (09c, Module 10 FE-4 / FR12.4 / FR12.5): dataset imports with
// preview and publish, snapshots and restore, and direct edits of professions and skills.
// While the taxonomy lock is held (by anyone) every changing button is disabled and the
// banner says who holds it and why; the lock is polled every 2 s only while it is held.

const TABS = [
  { key: 'sources', label: 'Data sources', icon: Database },
  { key: 'publish', label: 'Preview & publish', icon: ListChecks },
  { key: 'history', label: 'History', icon: History },
  { key: 'professions', label: 'Professions', icon: Briefcase },
  { key: 'skills', label: 'Skill taxonomy', icon: Tags },
];

export default function AdminTaxonomyPage() {
  const [tab, setTab] = useState('sources');
  const [lock, setLock] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);

  const refreshLock = useCallback(async () => {
    try {
      const res = await taxonomyService.getLock();
      setLock(res.data || null);
    } catch {
      // Keep the last known state; the tabs show their own errors.
    }
  }, []);

  useEffect(() => {
    refreshLock();
  }, [refreshLock]);

  usePolling(refreshLock, Boolean(lock));

  const shared = { lock, refreshLock, setLock };

  return (
    <AdminLayout title="Professions & Skills">
      <div className="mb-5 inline-flex flex-wrap bg-white border border-slate-200 rounded-xl p-1" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
              tab === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      <LockBanner lock={lock} />
      {tab === 'sources' && (
        <DataSourcesTab
          {...shared}
          onUploaded={(job) => {
            setSelectedJobId(job.job_id);
            setTab('publish');
          }}
        />
      )}
      {tab === 'publish' && <PreviewPublishTab {...shared} selectedJobId={selectedJobId} onSelectJob={setSelectedJobId} />}
      {tab === 'history' && <HistoryTab {...shared} />}
      {tab === 'professions' && <ProfessionsTab {...shared} />}
      {tab === 'skills' && <SkillTaxonomyTab {...shared} />}
    </AdminLayout>
  );
}
