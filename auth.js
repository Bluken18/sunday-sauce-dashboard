// ── Supabase config ───────────────────────────────────────────────
const SUPABASE_URL  = 'https://ucdjvmoushzkfgghhpmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_mblO9OE9YSzQubL_X7xMNg_QLMKIyRW';

// Admin user ID — only this account can access the dashboard.
// RLS on session_analytics also restricts reads to this UUID.
const ADMIN_USER_ID = 'e453127a-a51a-489a-b1b9-fe861e47c8af';

// The anon key is safe to expose client-side because RLS policies
// restrict all reads on session_analytics to ADMIN_USER_ID only.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

async function checkSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    if (session.user.id !== ADMIN_USER_ID) {
      await sb.auth.signOut();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function requireAuth() {
  const ok = await checkSession();
  if (!ok) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}
