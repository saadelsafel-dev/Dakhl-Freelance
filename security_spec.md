# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Superuser Admin Authority**: Only the verified superuser (`saadelsafel@gmail.com` with `email_verified == true`) can write `/wallets/{userId}`, approve/reject `/topup_requests/{requestId}`, or write `/wallet_transactions/{txId}`.
2. **No Self-Crediting**: Normal users CANNOT create or update `/wallets/{userId}` or `/wallet_transactions/{txId}` under any circumstance.
3. **Minimum 5 Transactions Rule**: Every `/topup_requests/{requestId}` created by a user MUST have `requested_transactions >= 5`, `calculated_amount_egp >= 100`, non-empty `receipt_image_url`, and initial `status == "pending"`.
4. **Terminal State Locking**: Once a top-up request transitions from `pending` to `approved` or `rejected`, it CANNOT be modified again.
5. **Atomic Approval**: Approving a `topup_requests/{requestId}` requires `/wallets/{userId}` to be written atomically in the same transaction (`existsAfter(...)`).
6. **PII & Query Isolation**: Non-admin users can only `get` and `list` their own `topup_requests` and `wallet_transactions` (`resource.data.userId == request.auth.uid`).

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
10. **Normal User Blanket List Query on Top-up Requests**: Normal user calling `getDocs(collection(db, "topup_requests"))` without `where("userId", "==", uid)`.
11. **Ledger Tampering**: Normal user creating or anyone updating/deleting `/wallet_transactions/tx1`.
12. **Shadow Ghost Field Injection**: Injecting `isAdmin: true` into `/profiles/user123` or `/topup_requests/req1`.
