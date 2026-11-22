# 06 --- Security, Privacy, and Moderation

## 1. Security baseline

-   Enable RLS on every user-facing table.
-   Deny access by default, then grant only required operations.
-   Test policies as anonymous users, normal users, conversation
    members, and admins.
-   Keep service-role keys and secrets server-side.
-   Validate all input on the server.
-   Rate-limit authentication, requests, messages, search, and uploads.
-   Use secure file upload rules and content-type/size validation.
-   Keep dependencies updated and scan for known vulnerabilities.

RLS is necessary but not sufficient. Financial and privileged operations
require trusted database functions or Edge Functions with explicit
authorization.

## 2. Roles and admin authorization

Admin privileges must come from a trusted server-controlled source, such
as a protected role table or JWT `app_metadata`. Never trust
`user_metadata` for admin authorization because users may be able to
edit it.

Suggested roles: - `user` - `moderator` - `finance_admin` -
`super_admin`

Use least privilege. A moderator should not automatically be able to
approve top-ups; a finance admin should not automatically be able to
read all private conversations.

## 3. Profile privacy

Public profile output should be an explicit allowlist: - Display name. -
Avatar. - Bio. - Broad location. - Skills. - Experience and portfolio
items marked public. - Eligible reviews and public metrics.

Private data includes: - Phone and email. - Authentication and security
details. - Wallet data. - Payment references and proof. - Verification
evidence. - Private moderation notes.

Use a dedicated public-profile view or RPC. Do not expose a full
`profiles` table and hope the frontend hides private fields.

## 4. Storage security

Suggested buckets: - `avatars` --- public or controlled public-read,
with authenticated owner writes. - `portfolio` --- public only for
explicitly published items. - `payment-proofs` --- private; user can
upload/read their own proof, authorized finance admins can review. -
`verification-documents` --- private; access restricted to owner and
authorized verification reviewers.

Use signed URLs for private files. Validate file size, extension, MIME
type, and ownership. Do not trust a filename or browser-provided content
type alone.

## 5. Wallet security

Users must not: - Update their wallet balance. - Insert or modify wallet
ledger entries. - Approve their own top-ups. - Change payment order
status directly. - Reuse a transaction reference to obtain repeated
credit.

All money movement must be executed by narrowly scoped trusted functions
and recorded in the ledger.

## 6. Contact-sharing controls

The product wants users to keep initial communication inside DAKHL.
Implement reasonable safeguards: - Detect phone-number patterns, email
addresses, URLs, social handles, and common obfuscations. - Normalize
Arabic and Latin digits before detection. - Detect spacing, punctuation,
and written-out digit patterns where feasible. - Apply rate limits to
repeated attempts. - Let users report suspicious messages. - Keep a
review queue for uncertain matches.

Important: do not automatically punish every numeric string. Phone-like
sequences may appear in legitimate job descriptions, addresses, prices,
order IDs, or technical content. Prefer block/warn/review according to
confidence and context.

No system can guarantee that users will never exchange details
elsewhere. Do not market this as perfect prevention.

## 7. Moderation and sanctions

Use proportionate enforcement: 1. In-product warning. 2. Temporary
messaging or posting restriction. 3. Temporary account suspension. 4.
Permanent ban for serious or repeated abuse.

For each action: - Store reason and supporting evidence. - Record
moderator and timestamp. - Notify the user with a clear explanation
where safe. - Provide an appeal path. - Keep an audit trail. - Avoid
arbitrary or humiliating punishments.

## 8. Fraud and opportunity safety

-   Allow users to report fake or misleading opportunities.
-   Flag duplicate or suspicious posts.
-   Require clear descriptions of the work and compensation where
    possible.
-   Do not imply that verification guarantees a job or payment.
-   Display verification status accurately.
-   Provide safety guidance: do not pay an employer to obtain a job
    unless a clearly disclosed, legitimate platform charge applies.
-   Track repeat offenders and suspicious account patterns.

## 9. Admin access to messages

Message access for moderation should be limited to legitimate reports,
safety incidents, or clearly defined policy cases. Log privileged
access. Do not provide casual unrestricted browsing of private
conversations.

## 10. Security testing checklist

-   User A cannot read User B's wallet or payment proof.
-   Non-members cannot read a conversation.
-   A user cannot send messages as another user.
-   A user cannot approve a top-up.
-   A user cannot edit admin roles.
-   A user cannot write ledger entries.
-   Concurrent acceptance cannot double-charge.
-   Expired requests cannot be accepted.
-   Closed conversations cannot receive messages.
-   Private storage objects cannot be fetched by unauthorized users.
