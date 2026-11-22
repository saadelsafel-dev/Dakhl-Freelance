# 07 --- Admin Dashboard and Operations

## 1. Admin modules

Recommended dashboard sections: - Overview. - Users. - Profile
verification. - Wallets and payment orders. - Connections. -
Opportunities. - Moderation and reports. - Boosts. - Analytics. -
Settings. - Audit logs.

## 2. Payment review workflow

Finance administrators should see: - Payment order ID. - User profile
link. - Requested amount. - Submitted transaction reference. - Proof
image (private access). - Submission time. - Current status. - Previous
review actions.

Actions: - Approve after independently verifying actual receipt. -
Reject with a user-facing reason. - Escalate for a second review. - Add
internal notes.

Approval must invoke the secure top-up function; never update wallet
balances directly in the dashboard.

## 3. User management

Admin capabilities may include: - Search users. - View public profile
and account status. - Review verification requests. - Apply restrictions
with reason and duration. - Review appeals. - View relevant audit
history.

Do not expose sensitive user data to every admin role.

## 4. Opportunity moderation

-   Review reported opportunities.
-   Hide or remove policy-violating posts.
-   Request clarification from the publisher.
-   Restore a post after successful appeal.
-   Record reason and moderator.

## 5. Reports and appeals

A report should include: - Reporter. - Target type and ID. - Reason
category. - Optional explanation. - Relevant message/post reference. -
Status and timestamps.

An appeal should reference the original moderation action and preserve
the decision history.

## 6. Audit logging

Record sensitive actions such as: - Top-up approval/rejection. - Refund
issuance. - Admin role changes. - User suspension/ban. - Opportunity
removal. - Access to private verification/payment evidence. - Moderation
access to reported messages. - Changes to fees or system settings.

Audit records should be append-only for normal admin users. Do not
include secrets or unnecessary private content.

## 7. Operational monitoring

Monitor: - Failed top-up approvals. - Duplicate transaction
references. - Ledger/balance mismatches. - Failed connection
acceptance. - Realtime/chat errors. - Scheduled job failures. - Sudden
spikes in reports or new accounts. - Storage usage and upload failures.

Create an incident process for suspected financial abuse or data
exposure.

## 8. Admin security

-   Require strong authentication and preferably MFA for administrators.
-   Apply least-privilege roles.
-   Avoid shared admin accounts.
-   Log admin sessions and sensitive actions.
-   Review admin access periodically.
-   Keep production access limited.
