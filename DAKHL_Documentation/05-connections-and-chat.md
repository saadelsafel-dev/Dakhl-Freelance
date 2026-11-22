# 05 --- Connection Requests and Chat

## 1. Connection request lifecycle

Statuses: - `pending` - `accepted` - `rejected` - `cancelled` -
`expired`

A request is free to send and expires 48 hours after creation if no
decision is made.

## 2. Sending a request

The server should: - Derive sender from `auth.uid()`. - Validate
receiver exists and is eligible. - Reject self-requests. - Validate
message length and rate limits. - Prevent duplicate pending requests for
the same user pair. - Prevent requests when an active connection already
exists, according to the agreed policy. - Set
`expires_at = created_at + 48 hours`.

A canonical pair key (ordered low/high user IDs) can help enforce
uniqueness regardless of request direction.

## 3. Acceptance behavior and fees

The agreed product rule is: when the receiver accepts, EGP 20 is
deducted from each party.

Before the receiver confirms, the UI must clearly say: - The receiver
will be charged EGP 20. - The sender will also be charged EGP 20. - The
total platform charge is EGP 40. - Acceptance opens an in-app text
conversation. - The conversation closes after 7 days without a message.

If either user lacks EGP 20, acceptance fails without charging either
user. Show a clear explanation and allow the relevant user(s) to top up.

## 4. Atomic acceptance function

Implement a database transaction/RPC such as
`accept_connection_request(request_id)`.

Recommended sequence: 1. Read authenticated caller from `auth.uid()`. 2.
Lock the request row using `SELECT ... FOR UPDATE`. 3. Confirm request
is pending. 4. Confirm caller is the receiver. 5. Confirm current time
is before `expires_at`. 6. Lock both wallet rows in deterministic
user-ID order to avoid deadlocks. 7. Confirm each wallet has at least
EGP 20. 8. Confirm no conflicting active connection exists. 9. Debit EGP
20 from each wallet. 10. Insert two append-only ledger entries with
unique references/idempotency keys. 11. Insert the connection. 12.
Insert conversation and both conversation members. 13. Update request to
`accepted` and set `responded_at`. 14. Record any required
revenue/accounting entry. 15. Commit.

Any error must roll back the entire transaction. The RPC must not accept
arbitrary sender/receiver IDs from the client as authoritative values.

## 5. Expiration

A scheduled job runs periodically and changes pending requests to
`expired` when `expires_at <= now()`.

The acceptance function must still check expiry itself. Cron is for
cleanup and user experience, not the only enforcement mechanism.

## 6. Chat rules

-   Text messages only in v1.
-   Only conversation members can read or send messages.
-   Messages can be delivered using Supabase Realtime.
-   Every send operation validates membership, conversation status,
    message length, rate limits, and moderation rules.
-   Update `last_message_at` when a valid message is inserted.
-   No voice/video calls in v1.

## 7. Inactivity closure

A scheduled job closes conversations when:
`status = active AND last_message_at <= now() - interval '7 days'`.

Use `last_message_at`; do not calculate from conversation creation time.
The server must check the inactivity rule when sending a message too, so
a delayed Cron job cannot leave an expired conversation writable.

Once closed, the conversation remains closed. New work requires a new
connection request and new applicable charges.

## 8. Duplicate and race-condition protection

-   Use row locks during acceptance.
-   Use unique constraints for one connection per canonical pair where
    appropriate.
-   Use unique `connection_request_id` on connections.
-   Use idempotency keys for charges.
-   Ensure two concurrent accept requests cannot charge twice.
-   Ensure a request cannot be both accepted and rejected.
-   Test opposite-direction requests and simultaneous requests.

## 9. Messaging privacy

Do not expose contact details in public profiles or message metadata.
Add report controls. If a message is blocked by automated filtering,
explain the reason and provide a route to appeal or contact support.
