# JPR Command Center

The private app JPR runs from: clients and agreements (CRM), jobs, candidates and the candidate-to-job pipeline (ATS), and the "What needs me?" home screen.

- Next.js 16 (App Router, `src/proxy.ts` for session refresh), Tailwind 4
- Supabase for auth (magic link), Postgres with row level security, and resume storage
- Database schema lives in `../supabase/migrations`

## Run locally

```bash
cp .env.example .env.local   # fill in the Supabase URL and publishable key
npm install
npm run dev
```

Only emails listed in `staff_invites` become staff when they first sign in; anyone else lands on a no-access page.

After changing the schema, regenerate `src/lib/database.types.ts` from the Supabase project.
