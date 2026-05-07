import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useSearchParams, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import CVParsingPage from './pages/CVParsingPage.jsx';

// Preserves ?token= (and any other query params) when redirecting / → /cv-parsing.
// Plain <Navigate to="/cv-parsing"> silently drops the search string, which
// means the JWT injected by Module 1 is lost before TokenBootstrap can read it.
function RootRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/cv-parsing${search}`} replace />;
}

/**
 * Reads the ?token= query param injected by Module 1's Dashboard when it
 * redirects the user here. Saves it as 'authToken' (the key cvService.js
 * reads) and strips the param from the URL so it isn't visible or bookmarked.
 */
function TokenBootstrap() {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      localStorage.setItem('authToken', token);
      // Remove ?token= from the address bar without a full page reload
      setSearchParams((prev) => {
        prev.delete('token');
        return prev;
      }, { replace: true });
    }
  }, []);  // run once on mount

  return null;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route
          path="/cv-parsing"
          element={
            <>
              <TokenBootstrap />
              <CVParsingPage />
            </>
          }
        />
        <Route path="*" element={<Navigate to="/cv-parsing" replace />} />
      </Routes>
      <Toaster position="top-right" />
    </>
  );
}
