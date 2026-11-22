# 08 --- Roadmap, Acceptance Criteria, and Testing

## 1. Delivery roadmap

### Phase 1 --- Foundation

-   Create Supabase project(s).
-   Configure Auth.
-   Create profiles and trusted roles.
-   Build initial migrations.
-   Enable and test RLS.
-   Build responsive app shell and onboarding.

### Phase 2 --- Discovery

-   Public profile view.
-   Skills and categories.
-   Search and filters.
-   Opportunity creation and feed.
-   Save/report opportunity.
-   Basic profile editing and portfolio.

### Phase 3 --- Financial engine

-   Wallet tables and append-only ledger.
-   Top-up order creation.
-   Private payment-proof storage.
-   Admin payment review.
-   Secure approval RPC.
-   Reconciliation checks.
-   Financial and authorization tests.

### Phase 4 --- Connection engine

-   Send/cancel/reject/expire requests.
-   Atomic acceptance and double charge.
-   Connection creation.
-   Conversation creation and membership.
-   Realtime text chat.
-   Seven-day inactivity closure.

### Phase 5 --- Trust and moderation

-   Message and opportunity reporting.
-   Contact-sharing detection.
-   Admin moderation queues.
-   Verification workflow.
-   Sanctions and appeals.
-   Audit logging.

### Phase 6 --- Growth and launch

-   Paid Boost.
-   Analytics.
-   Performance checks.
-   Security review.
-   Legal/accounting review.
-   Production monitoring and support process.
-   PWA installability and launch marketing.

## 2. MVP launch gate

Do not launch real-money functionality until: - Wallet ledger and cached
balances reconcile. - Top-up approval is idempotent. - Payment
references cannot be credited twice. - Users cannot edit balances. -
Connection acceptance is atomic. - Both parties are charged only when
both have sufficient funds. - Fee disclosures are clear. - Refund and
dispute policies are published. - Legal/accounting review is complete.

## 3. Functional acceptance criteria

### Profiles

-   A user can create a profile without a CV.
-   A user can both publish opportunities and seek work.
-   Public viewers see only approved public fields.
-   Private contact/payment information is never exposed.

### Opportunities

-   An authenticated user can publish a free opportunity.
-   The publisher can edit or close their own opportunity.
-   Users can search and filter opportunities.
-   Users can report suspicious posts.
-   Only authorized moderators can remove or restore posts.

### Wallet

-   Top-up request minimum is EGP 200.
-   User can see pending/approved/rejected status.
-   Approval credits the exact amount once.
-   User cannot directly alter balance or ledger.
-   Duplicate payment references are rejected or escalated.

### Connections

-   Sending a request is free.
-   Request expires after 48 hours.
-   Only receiver can accept/reject.
-   Acceptance charges EGP 20 from both parties.
-   If either balance is insufficient, no charge and no connection
    occur.
-   Repeated/concurrent acceptance cannot double-charge.

### Chat

-   Only members can read/send.
-   Text only in v1.
-   Last message updates inactivity timestamp.
-   Conversation closes after 7 days without a message.
-   A closed conversation cannot be revived by sending a message.

### Moderation

-   Users can report content.
-   Admin decisions are auditable.
-   Sanctions include reasons and appeal handling.
-   Automated contact detection does not blindly punish ambiguous
    content.

## 4. Required automated tests

### Financial

-   Minimum top-up validation.
-   Approval credits once.
-   Duplicate approval attempt does not credit twice.
-   Duplicate transaction reference is blocked.
-   Refund creates compensating entry.
-   Ledger and cached balance stay consistent.

### Concurrency

-   Two simultaneous accept calls result in one successful charge only.
-   Wallet locks are acquired in deterministic order.
-   Opposite-direction requests cannot create duplicate active
    connections.

### Authorization

-   Anonymous user cannot access private records.
-   User cannot read another user's wallet.
-   User cannot read another user's payment proof.
-   User cannot insert financial ledger rows.
-   User cannot change roles.
-   Non-member cannot read a conversation.

### Lifecycle

-   Request expires at 48 hours.
-   Expired request cannot be accepted even if Cron has not run.
-   Conversation closes at 7 days since last message.
-   A message cannot be sent after inactivity closure.

## 5. Launch metrics

Track: - Profile completion rate. - New opportunities per week. -
Search-to-profile-view rate. - Connection request rate. - Request
acceptance rate. - Percentage of accepted requests where both users had
sufficient balance. - Time to first reply. - Seven-day conversation
closure rate. - Reports per 100 active users. - Top-up approval time and
rejection rate. - Repeat usage and paid Boost conversion.

Do not optimize only for connection-fee revenue. A healthy marketplace
needs genuine opportunities, useful matches, safe interactions, and
repeat value.

## 6. Open implementation decisions

These details were not fully specified and should be decided before the
relevant feature is built: - Exact opportunity application flow versus
connection-request-first flow. - Whether a user can request another
connection after rejection, and any cooldown. - Whether the same pair
can reconnect after a conversation closes. - Exact Boost pricing,
duration, ranking behavior, and refund policy. - Rating eligibility and
review dispute process. - Whether wallet withdrawals/refunds are
supported and under what conditions. - Exact retention periods for
messages, payment proofs, and verification files. - Whether users can
edit or delete messages. - Whether location is optional and how precise
it may be.

Keep these as explicit product decisions rather than silently inventing
behavior in code.
