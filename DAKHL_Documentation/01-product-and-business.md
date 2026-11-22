# 01 --- Product and Business Requirements

## 1. Product definition

DAKHL is a two-sided opportunity and professional discovery marketplace.
It helps opportunity publishers and people seeking income find one
another. DAKHL supplies the tools and discovery network; it does not
guarantee that a user will receive a client, job, or income.

## 2. User model

Every person has one account. The same account can: - Publish a project,
task, or work opportunity. - Search for people with relevant skills. -
Present skills, experience, and portfolio examples. - Search for
opportunities and apply or request a connection. - Accept incoming
connection requests.

A user does not need a CV or professional history to join. The
onboarding flow should help a beginner describe what they can do, what
they want to learn, and what kind of work they are seeking.

## 3. Profile

### Public profile fields

-   Display name / username.
-   Profile photo or avatar.
-   Short bio.
-   Broad location (for example, city or area).
-   Skills and categories.
-   Experience entries, if any.
-   Portfolio items or samples, if any.
-   Ratings and reviews, when earned through eligible interactions.
-   Response-rate or response-time indicators, calculated from platform
    activity.

### Private fields

-   Email address.
-   Phone number.
-   Authentication identifiers and security metadata.
-   Payment references and wallet details.
-   Private verification documents.

Do not expose a raw user record publicly if it contains private fields.
Use a dedicated public-profile view or RPC that returns only explicitly
approved columns.

## 4. Discovery

Users should be discoverable through: - Search by name and skills. -
Categories and skill tags. - Location filters. - Experience level
filters. - Work type filters. - Suggested profiles and opportunities.

Search can begin with PostgreSQL full-text search and `pg_trgm`; a
dedicated search service is not required for the first release.

## 5. Opportunities feed

Users can publish opportunities for free. A post should include: -
Title. - Description. - Category. - Required skills. - Work type
(remote, on-site, hybrid, where relevant). - Location or remote
availability. - Compensation information, if the publisher chooses to
disclose it. - Deadline or status. - Publisher identity and profile
link.

Opportunity publishing rules: - The publisher must have an active
account. - The platform should provide report and moderation controls. -
Misleading, fraudulent, discriminatory, illegal, or exploitative
opportunities can be removed under published policies. - Paid Boost
changes visibility only; it must not falsely imply verification or
guarantee applicants.

## 6. Connections and monetization

-   Sending a connection request is free.
-   The request remains pending for 48 hours.
-   The receiver can accept or reject it.
-   On acceptance, EGP 20 is deducted from each party.
-   The total EGP 40 is gross platform revenue.
-   If either party lacks the required balance, acceptance fails and
    neither party is charged.
-   The fee must be disclosed clearly to both users before they enter
    the request/acceptance flow.
-   The financial operation and connection creation must succeed or fail
    as one atomic transaction.

The agreed behavior is that a single acceptance by the receiving user
triggers both charges. This is a potentially sensitive commercial rule
and must be made conspicuous in the UI.

## 7. Wallet

-   Minimum top-up: EGP 200.
-   The full top-up amount is usable wallet credit.
-   At launch, users transfer through Vodafone Cash and submit a top-up
    request.
-   An administrator verifies receipt independently before crediting the
    wallet.
-   Users can view their current balance and transaction history.
-   Users cannot edit balances or create financial ledger entries
    themselves.

## 8. Messaging

-   Text-only in-app chat for the first release.
-   Chat opens after a connection is accepted and paid.
-   Conversation closes after 7 days without a message.
-   The inactivity timer is based on `last_message_at`, not conversation
    creation time.
-   A closed conversation is not reopened for new work; users create a
    new connection request.
-   No voice or video calling in the first release.

## 9. User trust

DAKHL should reduce fraud and off-platform leakage without making
unrealistic guarantees: - Keep contact details private. - Detect phone
numbers, emails, URLs, social handles, and obfuscated contact attempts
in messages. - Use rate limits and spam detection. - Provide user
reporting and moderation queues. - Apply proportionate sanctions with
reasons and an appeal route. - Avoid automatic punishment based on a
single ambiguous numeric string.

No platform can guarantee that users will never exchange contact
information outside the app. The product should state that it uses
reasonable safeguards, not promise perfect prevention.

## 10. Business model

Potential revenue streams: 1. EGP 20 from each side when a connection
request is accepted. 2. Paid Boost for opportunity posts or profiles. 3.
Future optional premium tools, only if they provide clear additional
value.

Do not count wallet deposits as revenue. A top-up is a liability/credit
balance until the user spends it or it is otherwise lawfully recognized.
Revenue recognition and unspent balances require accountant review.

## 11. Non-goals for first release

-   DAKHL does not guarantee jobs, clients, income, or successful
    hiring.
-   No built-in voice/video calls.
-   No automatic Vodafone Cash API settlement at launch.
-   No complex AI matching requirement for MVP.
-   No public display of phone numbers or email addresses.
