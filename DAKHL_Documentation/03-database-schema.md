# 03 --- Database Schema (Proposed)

This is a logical schema baseline. Exact columns, enums, indexes, and
foreign-key behavior should be finalized in SQL migrations.

## 1. Identity and profiles

### `profiles`

-   `id` UUID primary key, references `auth.users(id)`.
-   `username` unique.
-   `display_name`.
-   `bio`.
-   `avatar_path`.
-   `location_city` / `location_area` (broad location only).
-   `created_at`, `updated_at`.
-   Private email/phone fields should not be mixed into a publicly
    readable row unless RLS and views are carefully designed.

### `user_skills`

-   `id`.
-   `user_id`.
-   `skill_id` or normalized skill name.
-   `proficiency_level` (optional).
-   `created_at`.

### `user_experience`

-   `id`, `user_id`, title, organization (optional), description,
    start/end dates.

### `portfolio_items`

-   `id`, `user_id`, title, description, asset path or external
    reference (if allowed), visibility, timestamps.

### `user_reviews`

-   `id`, reviewer user ID, reviewed user ID, connection ID, rating,
    review text, status, created_at.
-   Enforce that reviews can only be created for eligible
    completed/accepted interactions according to product policy.
-   Prevent duplicate reviews for the same eligible interaction.

### `user_verifications`

-   `id`, `user_id`, verification type, status, private evidence path,
    reviewer, reviewed_at, created_at.
-   Verification evidence must be private.

## 2. Opportunities

### `opportunities`

-   `id`, `publisher_id`, title, description, category_id.
-   `work_type`, `location`, compensation fields (optional).
-   `status` (draft, published, paused, closed, removed).
-   `published_at`, `expires_at`, timestamps.

### Supporting tables

-   `opportunity_categories`
-   `opportunity_skills`
-   `opportunity_views`
-   `opportunity_saves`
-   `opportunity_applications` (if applications are part of the chosen
    MVP flow)
-   `opportunity_boosts`

Boost records should include start/end time, purchased amount, status,
and the opportunity/profile being promoted. Do not let the client
directly set a boosted status.

## 3. Connections and messaging

### `connection_requests`

-   `id`.
-   `sender_id`, `receiver_id`.
-   `opportunity_id` (nullable, if request relates to an opportunity).
-   `message` (optional introductory note).
-   `status` (pending, accepted, rejected, cancelled, expired).
-   `created_at`, `expires_at`, `responded_at`.

### `connections`

-   `id`.
-   `user_low_id`, `user_high_id` (canonical ordering of the two UUIDs).
-   `connection_request_id` unique.
-   `status`.
-   `created_at`.

Canonical user ordering helps prevent duplicate connections in opposite
directions. Add constraints/indexes to prevent duplicate pending
requests or active connections for the same pair.

### `conversations`

-   `id`, `connection_id` unique.
-   `status` (active, inactive_closed, blocked, admin_suspended).
-   `last_message_at`.
-   `closed_at`, `created_at`.

### `conversation_members`

-   `conversation_id`, `user_id`.
-   Composite primary key (`conversation_id`, `user_id`).

### `messages`

-   `id`, `conversation_id`, `sender_id`.
-   `body`.
-   `moderation_status`.
-   `created_at`, `edited_at` (if editing is supported).
-   Consider a separate moderation event table rather than silently
    overwriting message history.

### `message_reports`

-   `id`, `message_id`, `reporter_id`, reason, status, created_at,
    resolution metadata.

## 4. Wallet and payment records

### `wallets`

-   `user_id` primary key.
-   `balance_minor` or integer EGP piastres (recommended to avoid
    floating-point errors).
-   `currency` (EGP).
-   `updated_at`.

### `wallet_transactions`

Append-only financial ledger: - `id`. - `wallet_user_id`. -
`amount_minor` (positive credit, negative debit). -
`transaction_type`. - `reference_type`, `reference_id`. -
`idempotency_key` unique where applicable. - `created_at`. - `metadata`
limited to non-sensitive operational context.

Never edit or delete posted ledger entries. Correct mistakes with
compensating transactions.

### `payment_orders`

-   `id`, `user_id`.
-   `amount_minor`.
-   `method` (vodafone_cash_manual at launch).
-   `status` (submitted, under_review, approved, rejected, cancelled).
-   `payer_reference` / transaction reference (carefully protected).
-   `proof_storage_path` private.
-   `submitted_at`, `reviewed_at`, `reviewed_by`.
-   `rejection_reason` (user-safe explanation).

### `payment_reviews`

-   `id`, `payment_order_id`, reviewer, decision, notes, created_at.
-   Preserve review history.

### Other finance tables

-   `payment_events` (if needed for future integrations).
-   `refunds`.
-   `platform_fees` or a revenue-account ledger, if the accounting
    design requires it.
-   `boost_purchases`.

## 5. Administration and audit

### `admin_audit_logs`

-   `id`.
-   `admin_user_id`.
-   `action`.
-   `target_type`, `target_id`.
-   `reason`.
-   `before_data` / `after_data` where appropriate and safe.
-   `created_at`.
-   Do not store secrets or unnecessary sensitive message contents in
    audit metadata.

### Roles

Use a trusted role source, such as a protected roles table or
server-managed JWT `app_metadata`. Never authorize administrators using
user-editable `user_metadata`.

## 6. Important indexes and constraints

-   Unique `profiles.username`.
-   Foreign keys for all ownership relationships.
-   Index `opportunities(status, published_at DESC)`.
-   Index skills and categories for discovery.
-   Index `connection_requests(receiver_id, status, expires_at)`.
-   Canonical pair uniqueness for active connections.
-   Index `messages(conversation_id, created_at)`.
-   Unique payment transaction reference where the provider/reference
    semantics allow it.
-   Unique idempotency keys for financial operations.
-   Check constraints to prevent negative top-up amounts and invalid
    ratings.
-   Use integer minor currency units, not floating-point amounts.

## 7. Views and public data

Create a restricted public-profile view or RPC that returns only
approved fields. Ensure the view respects the intended RLS behavior for
the deployed PostgreSQL/Supabase version. Test anonymous and
authenticated access explicitly.

Do not expose: - Phone/email. - Payment proof or references. -
Verification documents. - Wallet transaction details belonging to other
users. - Private moderation or admin notes.
