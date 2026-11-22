# 02 --- Technical Architecture

## 1. Recommended stack

  -----------------------------------------------------------------------
  Layer                               Technology
  ----------------------------------- -----------------------------------
  Frontend                            React + TypeScript + Vite

  UI                                  Tailwind CSS + shadcn/ui

  Server-state                        TanStack Query

  Forms and validation                React Hook Form + Zod

  Backend platform                    Supabase

  Database                            PostgreSQL

  Authentication                      Supabase Auth

  Realtime                            Supabase Realtime

  File storage                        Supabase Storage

  Server-side logic                   PostgreSQL functions/RPC + Supabase
                                      Edge Functions

  Scheduled jobs                      Supabase Cron / scheduled Edge
                                      Functions

  Search                              PostgreSQL Full Text Search +
                                      `pg_trgm`

  Hosting                             Vercel

  Initial app format                  Responsive web app / PWA
  -----------------------------------------------------------------------

## 2. High-level system

``` text
User Browser / PWA                 Admin Dashboard
        |                                  |
        +--------------- HTTPS ------------+
                           |
                    React + TypeScript
                           |
                  Supabase client SDK
                           |
        +------------------+--------------------+
        |                  |                    |
      Auth             PostgreSQL             Storage
                           |                 (private/public
                     Secure RPCs              buckets)
                           |
                 Edge Functions / Cron
                           |
                Realtime events / chat
```

## 3. Trust boundaries

The browser is untrusted. Never rely on client-side code for: - Wallet
balance calculations. - Financial ledger writes. - Payment approval. -
Connection acceptance and charges. - Admin role assignment. - Moderation
actions. - Expiry and inactivity enforcement.

Sensitive operations must run in trusted server-side code or PostgreSQL
transactions. Every operation must derive the acting user from the
authenticated session (`auth.uid()`), not from a user ID supplied by the
browser.

## 4. Backend responsibilities

### PostgreSQL

Use PostgreSQL for: - Relational data and constraints. - Row Level
Security (RLS). - Atomic wallet and connection transactions. - Unique
constraints and idempotency. - Search indexes. - Audit records.

### Edge Functions

Use Edge Functions for: - Secure orchestration where appropriate. -
Admin actions that need server-side authorization. - Sending
notifications or external service calls. - Future payment provider
integrations. - Moderation integrations, if added.

### Cron

Scheduled tasks: - Expire pending connection requests after 48 hours. -
Close inactive conversations after 7 days. - Clean up expired temporary
records where policy permits. - Run reconciliation and operational
checks.

## 5. Suggested folder structure

``` text
dakhl/
├── public/
├── src/
│   ├── app/
│   │   ├── router/
│   │   └── providers/
│   ├── components/
│   │   ├── ui/
│   │   ├── shared/
│   │   └── layout/
│   ├── features/
│   │   ├── auth/
│   │   ├── profile/
│   │   ├── discovery/
│   │   ├── opportunities/
│   │   ├── connections/
│   │   ├── messaging/
│   │   ├── wallet/
│   │   ├── payments/
│   │   ├── boosts/
│   │   └── moderation/
│   ├── admin/
│   ├── hooks/
│   ├── lib/
│   ├── services/
│   ├── types/
│   └── utils/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   ├── approve-topup/
│   │   ├── accept-connection/
│   │   ├── send-message/
│   │   ├── moderate-message/
│   │   └── scheduled-maintenance/
│   └── seed.sql
└── tests/
    ├── integration/
    ├── security/
    └── financial/
```

## 6. Environment variables

Frontend-safe values may include: - Supabase project URL. - Supabase
publishable/anon key.

Never expose: - Supabase service-role key. - Database password. -
Payment provider secrets. - Admin service credentials. - Private signing
keys.

Use Vercel environment variables for deployment and separate
development/production Supabase projects where practical.

## 7. API and RPC design principles

-   Validate all input server-side.
-   Authorize every request using the authenticated user and trusted
    role data.
-   Use transactions for multi-step financial or state-changing
    operations.
-   Make retryable operations idempotent.
-   Return clear, non-sensitive error codes.
-   Do not return private user or payment data unnecessarily.
-   Log security-sensitive admin actions.

## 8. Deployment environments

Recommended: - Local development. - Staging Supabase project. -
Production Supabase project.

Apply migrations through version control. Do not make undocumented
production schema edits in the dashboard. Test RLS and financial flows
in staging before deployment.
