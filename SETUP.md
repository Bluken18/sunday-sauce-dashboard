# Sunday Sauce Admin Dashboard — Setup Guide

## 1. Run the Supabase migration

```bash
cd /path/to/Cooking
supabase db push
```

Or if running migrations manually:

```bash
supabase migration up
```

This creates the `session_analytics` table with RLS policies.

## 2. Get your admin user ID

1. Open `dashboard.sundaysauce.app` (after deploying — step 4 below)
2. Enter your email and click "Send login link"
3. Click the link in your email — you'll land on the dashboard (it will show "Access denied" the first time, that's expected)
4. Find your Supabase user ID:

```sql
-- Run in Supabase SQL Editor:
SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL';
```

5. **Update the RLS policy** — paste your UUID in two places:

   **a) Migration file** (`supabase/migrations/20260410_create_session_analytics.sql`):
   ```sql
   using (auth.uid()::text = 'YOUR-UUID-HERE');
   ```
   Then re-run the migration:
   ```bash
   supabase db push
   ```

   Or update directly in the SQL Editor:
   ```sql
   DROP POLICY "Admin can read session analytics" ON public.session_analytics;
   CREATE POLICY "Admin can read session analytics"
     ON public.session_analytics FOR SELECT
     USING (auth.uid()::text = 'YOUR-UUID-HERE');
   ```

   **b) Dashboard auth.js** — update `ADMIN_USER_ID`:
   ```js
   const ADMIN_USER_ID = 'YOUR-UUID-HERE';
   ```

6. **Update Supabase credentials in auth.js**:
   ```js
   const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON = 'YOUR_ANON_KEY';
   ```

   Find these in: Supabase Dashboard > Settings > API

## 3. Create the GitHub repo and deploy

```bash
cd sunday-sauce-dashboard

git init
git add .
git commit -m "Initial dashboard"
gh repo create bluken18/sunday-sauce-dashboard --public --source=. --push
```

Then enable GitHub Pages:
1. Go to github.com/bluken18/sunday-sauce-dashboard > Settings > Pages
2. Source: **Deploy from a branch**
3. Branch: **main** / root
4. Save

## 4. Configure the custom domain (Namecheap)

1. Log in to Namecheap
2. Go to **Domain List** > click **sundaysauce.app** > **Advanced DNS**
3. Add a new record:
   - **Type:** CNAME Record
   - **Host:** dashboard
   - **Value:** bluken18.github.io
   - **TTL:** Automatic
4. Save

## 5. Set custom domain in GitHub Pages

1. Go to github.com/bluken18/sunday-sauce-dashboard > Settings > Pages
2. Under **Custom domain**, enter: `dashboard.sundaysauce.app`
3. Click **Save**
4. Wait for DNS check to pass (may take a few minutes)
5. Check **Enforce HTTPS** once available

## 6. Verify end to end

1. Visit `https://dashboard.sundaysauce.app`
2. You should see the login page
3. Enter your admin email, click "Send login link"
4. Click the magic link in your email
5. Dashboard should load with empty states (no sessions yet)
6. Run a test session in the app — after it ends, the session should appear in the dashboard within 5 minutes (auto-refresh interval)

### Troubleshooting

- **"Access denied"**: Your user ID in `auth.js` doesn't match the RLS policy UUID. Make sure both are identical.
- **No data showing**: Check that the `session_analytics` table has rows (`SELECT * FROM session_analytics LIMIT 5;` in SQL Editor). If empty, the SessionTracker in `main.py` hasn't written yet.
- **DNS not resolving**: CNAME records can take up to 30 minutes to propagate. Check with `dig dashboard.sundaysauce.app`.
- **Mixed content errors**: Make sure HTTPS is enforced in GitHub Pages settings.
