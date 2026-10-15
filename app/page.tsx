'use client';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import Login from '@/components/Login';
import Workspace from '@/components/Workspace';
import { ToastProvider } from '@/components/ui/Toast';
import { displayName } from '@/lib/username';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-wrap">
        <section className="setup-card">
          <div className="logo" aria-hidden>N</div>
          <h1>Configure Supabase</h1>
          <p>Add your project URL and publishable key to <code>.env.local</code>, then restart the development server.</p>
          <pre>{'NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key'}</pre>
        </section>
      </main>
    );
  }

  const user = session?.user;

  return (
    <ToastProvider>
      {loading ? (
        <div className="splash" aria-busy="true" aria-label="Loading" />
      ) : user ? (
        <Workspace key={user.id} userId={user.id} name={displayName(user.email ?? '')} />
      ) : (
        <Login />
      )}
    </ToastProvider>
  );
}
