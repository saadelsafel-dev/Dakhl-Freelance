# 04 --- Wallet and Vodafone Cash Payments

## 1. Wallet principles

-   Minimum top-up: EGP 200.
-   The full amount becomes usable wallet credit after approval.
-   A top-up is not an activation fee.
-   Users can see balance and their own transaction history.
-   Users cannot directly write balances or ledger entries.
-   Financial records are append-only; corrections use
    reversal/compensating entries.

Represent EGP amounts as integer piastres (`amount_minor`) to avoid
floating-point errors.

## 2. Manual Vodafone Cash top-up flow

1.  User opens Wallet and creates a top-up order for at least EGP 200.
2.  The app displays the current official Vodafone Cash receiving
    instructions.
3.  User transfers the amount through Vodafone Cash.
4.  User submits the transaction reference and optional proof image.
5.  The order becomes `under_review`.
6.  An authorized finance administrator independently checks the
    receiving wallet/account and verifies that the money actually
    arrived.
7.  Admin approves or rejects with a reason.
8.  Approval invokes a secure server-side operation that credits the
    wallet exactly once.
9.  User receives an in-app status notification.

A screenshot alone is not proof that funds were received. The
administrator must verify the actual incoming transaction using the
receiving account records.

## 3. Payment order states

``` text
submitted -> under_review -> approved
                         -> rejected
submitted -> cancelled
```

Use a strict state machine. A rejected or approved order cannot be
approved again. A user must not be able to change the order amount or
transaction reference after submission without creating an auditable
revision or a new order.

## 4. Secure approval operation

An `approve_topup(payment_order_id)` operation should: - Verify the
caller is an authorized finance administrator. - Lock the payment order
row. - Confirm status is `under_review`. - Confirm the transaction has
been independently verified. - Check that the external transaction
reference has not already been credited. - Insert one positive wallet
ledger entry. - Update the wallet balance within the same database
transaction, if a cached balance is maintained. - Mark the order
approved and record reviewer/time. - Write an admin audit log. - Use a
unique idempotency key so retries cannot credit twice.

All steps must commit or roll back together.

## 5. Ledger and balance consistency

The ledger should be the financial source of truth. A cached
`wallets.balance_minor` can improve read performance, but it must only
be changed by trusted database functions.

Run periodic reconciliation: - Compare cached balances to the sum of
posted ledger transactions. - Detect duplicate references. - Detect
orders marked approved without a corresponding credit. - Detect ledger
entries without a valid source record. - Alert administrators instead of
silently rewriting history.

## 6. Connection acceptance charges

When a request is accepted: - Debit EGP 20 from the sender. - Debit EGP
20 from the receiver. - Record two separate ledger entries. - Record
platform gross revenue of EGP 40 using the accounting model. - Create
the connection and conversation. - Mark the request accepted.

This must be one atomic transaction. If either wallet has insufficient
balance, neither user is charged and no connection is created.

## 7. Refunds and disputes

Define a published policy before launch: - What happens if a top-up was
sent twice? - What happens if the wrong amount was transferred? - Can
unspent wallet credit be refunded? - What happens when an account is
suspended? - What happens if a charged connection is technically
unavailable? - How are mistaken admin approvals corrected?

Do not delete ledger entries to refund. Post a separate refund/credit
transaction linked to the original entry.

## 8. Legal and accounting review

Prepaid wallet balances may create regulatory, consumer-protection, tax,
and accounting obligations. Before accepting real money, consult
qualified Egyptian legal and accounting professionals about: - Whether
the proposed wallet model is permitted. - Whether DAKHL may hold or
issue stored value. - Whether a licensed payment provider or other
structure is required. - Refund, expiry, and dormant-balance rules. -
Tax and revenue recognition. - Required company registration, contracts,
and disclosures.

Do not assume that manual Vodafone Cash collection automatically avoids
payment-service requirements.
