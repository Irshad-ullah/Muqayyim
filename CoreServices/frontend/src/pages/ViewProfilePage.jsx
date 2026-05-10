import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, PenSquare, UserX } from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import Step6Review from '../components/profile/steps/Step6Review.jsx';
import { profileService } from '../services/profileService.js';
import { useAuth } from '../context/AuthContext.jsx';

const hasProfileData = (p) =>
  p &&
  (p.summary?.trim() ||
    p.experience?.length ||
    p.education?.length ||
    p.skills?.cv?.length ||
    p.skills?.manual?.length ||
    p.skills?.extracted?.length ||
    p.projects?.cv?.length ||
    p.projects?.github?.length ||
    p.projects?.manual?.length ||
    p.certifications?.length);

export default function ViewProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    profileService
      .getProfile()
      .then(({ profile: p }) => setProfile(p || null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Link>
              <div className="w-px h-5 bg-slate-200" />
              <div>
                <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
                <p className="text-xs text-slate-400 mt-0.5">{user?.name}</p>
              </div>
            </div>
            <Link
              to="/profile-builder"
              className="btn-secondary w-auto px-4 py-2 text-sm"
            >
              <PenSquare className="w-4 h-4" /> Edit Profile
            </Link>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-24">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* No profile data */}
          {!loading && !hasProfileData(profile) && (
            <div className="card p-12 flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <UserX className="w-8 h-8 text-slate-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-700 mb-1">No profile data found</p>
                <p className="text-sm text-slate-400">
                  Build your profile first to view it here.
                </p>
              </div>
              <Link to="/profile-builder" className="btn-primary w-auto px-6 py-2.5 text-sm mt-2">
                <PenSquare className="w-4 h-4" /> Build Profile
              </Link>
            </div>
          )}

          {/* Profile view */}
          {!loading && hasProfileData(profile) && (
            <Step6Review profile={profile} />
          )}

        </div>
      </main>
    </div>
  );
}
