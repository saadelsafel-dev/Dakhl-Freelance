# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Superuser Admin Authority**: Only the verified superuser (`saadelsafel@gmail.com` with `email_verified == true`) can write `/wallets/{userId}`, approve/reject `/topup_requests/{requestId}`, or write `/wallet_transactions/{txId}`.
2. **No Self-Crediting**: Normal users CANNOT create or update `/wallets/{userId}` or `/wallet_transactions/{txId}` under any circumstance.
3. **Minimum 5 Transactions Rule**: Every `/topup_requests/{requestId}` created by a user MUST have `requested_transactions >= 5`, `calculated_amount_egp >= 100`, non-empty `receipt_image_url`, and initial `status == "pending"`.
4. **Terminal State Locking**: Once a top-up request transitions from `pending` to `approved` or `rejected`, it CANNOT be modified again.
5. **Atomic Approval**: Approving a `topup_requests/{requestId}` requires `/wallets/{userId}` to be written atomically in the same transaction (`existsAfter(...)`).
6. **PII & Query Isolation**: Non-admin users can only `get` and `list` their own `topup_requests` and `wallet_transactions` (`resource.data.userId == request.auth.uid`).
7. **Directory Balance Visibility & Client Privacy**: Normal signed-in users can only `get` or `list` `/profiles/{userId}` documents where `has_balance == true` (or their own profile). Client accounts (`account_type == "client"`) must always have `has_balance == false` and are never readable or listable by other non-admin users. Normal users CANNOT set or modify `has_balance`, and `account_type` is immutable once set (legacy profiles without `account_type` can only be backfilled to `"freelancer"`).
8. **Safe Profile Cover, Portfolio & Projects**: Profile owners can update their own profile fields including `cover_url` (WebP data URL `<= 165KB`), `portfolio_url` (strictly `http://` or `https://`, `<= 300` chars), and up to 3 `projects` (each strictly either a WebP image data URL `<= 180KB` OR a canonical `https://drive.google.com/file/d/<id>/preview` embed URL).
9. **Client Connection Requests & Isolated Real-Time Notifications**: Verified users can send `/connection_requests/{requestId}` only from `fromUserId == request.auth.uid` to a different existing freelancer profile (`toUserId != request.auth.uid`), atomically paired with a `/notifications/{requestId}` document targeting `toUserId`. Only `toUserId` can transition `status` once from `"pending"` to `"accepted"` or `"declined"` while atomically creating the reply notification `/notifications/{requestId + '_reply'}` for `fromUserId`. Notifications in `/notifications/{notifId}` are strictly private to `userId == request.auth.uid` (or admin), and owners may update only `is_read: true`.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Self-Crediting Wallet**: Normal user writing `/wallets/user123` with `balance_egp: 99999`.
2. **Self-Approving Top-up Request**: Normal user creating `/topup_requests/req1` with `status: "approved"`.
3. **Bypassing 5-Transaction Minimum**: Normal user creating `/topup_requests/req1` with `requested_transactions: 2`.
4. **Missing Receipt Image**: Normal user creating `/topup_requests/req1` with empty `receipt_image_url: ""`.
5. **Spoofed Admin Email (Unverified)**: Attacker with `email: "saadelsafel@gmail.com"` and `email_verified: false` attempting to update `/wallets/user123`.
6. **Re-Approving Terminal Request**: Admin or user updating a `topup_requests/req1` that already has `status: "approved"`.
7. **Normal User Updating Pending Request**: Normal user modifying `requested_transactions` or `status` on `/topup_requests/req1` after submission.
8. **Orphaned Approval**: Approving `/topup_requests/req1` without atomically writing `/wallets/{userId}` in the same transaction.
9. **Normal User Reading Another User's Top-up Request**: User A reading `/topup_requests/req_of_user_b`.
10. **Normal User Blanket List Query on Profiles**: Normal user calling `getDocs(collection(db, "profiles"))` without `where("has_balance", "==", true)`.
11. **Self-Setting `has_balance: true` or Role Escalation on Profile**: Normal user creating `/profiles/user123` with `has_balance: true`, switching an existing `"freelancer"` profile to `"client"`, or reading another user's `"client"` profile.
12. **Shadow Ghost Field Injection & Spoofed Notifications**: Injecting `isAdmin: true` into `/profiles/user123` or `/topup_requests/req1`, reading another user's `/notifications/{notifId}`, or creating a `/notifications/{notifId}` with `actorUserId != auth.uid` or without an atomic `/connection_requests/{requestId}` write.
