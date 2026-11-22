# DAKHL --- Technical Documentation

**Version:** Architecture v1.0\
**Date:** 22 November 2026\
**Product:** DAKHL (دخل) --- منصة لاكتشاف فرص الدخل والتواصل المهني

## 1. Product vision

DAKHL is a marketplace and professional discovery network that connects
people who publish work opportunities or projects with people who offer
skills or seek income. It is not a traditional job board, and the
platform does not promise to supply clients or jobs itself. Users create
profiles, publish opportunities, discover one another, and connect
through in-app messaging.

The platform can launch with marketing focused on 6th of October, Egypt,
while remaining open to users from anywhere.

### Core principles

-   One account per person; each user can both publish opportunities and
    seek work.
-   Beginners can create profiles even without a CV or previous
    experience.
-   Public profiles show only approved public information.
-   Opportunity publishing is free; paid Boost increases visibility.
-   Connection requests are free to send. When accepted, EGP 20 is
    charged to each party.
-   Messaging is text-only in the first release.
-   Vodafone Cash top-ups are manually reviewed by an administrator at
    launch.
-   Fees, expiry rules, and wallet balances must be transparent before
    users commit.

## 2. Confirmed product decisions

  -----------------------------------------------------------------------
  Area                                Decision
  ----------------------------------- -----------------------------------
  Product name                        DAKHL

  Audience                            Anyone, any location; initial
                                      marketing focus: 6th of October

  Account model                       One flexible account per user

  Profiles                            Public discovery, with private
                                      contact and sensitive data

  Opportunities feed                  Separate feed; publishing is free

  Boost                               Paid visibility promotion

  Wallet minimum top-up               EGP 200, fully usable wallet credit

  Top-up method at launch             Manual Vodafone Cash transfer +
                                      admin confirmation

  Connection request                  Free to send

  Request expiry                      48 hours

  Acceptance fee                      EGP 20 from each party (EGP 40
                                      gross platform revenue)

  Chat                                In-app text chat only

  Conversation inactivity             Closes after 7 days without a
                                      message

  New work after closure              New connection request and
                                      applicable fees

  Calls/video                         Not in the first release
  -----------------------------------------------------------------------

## 3. Important commercial clarification

The EGP 40 collected when a connection is accepted is **gross platform
revenue**, not net profit. Payment handling, taxes, refunds, support,
hosting, moderation, and other operating costs must be accounted for
separately.

The EGP 200 minimum top-up is stored wallet credit, not a non-refundable
activation fee. Users should be able to see their balance and ledger,
understand when fees are charged, and review the refund and withdrawal
policy before paying.

## 4. Documentation index

-   `01-product-and-business.md` --- product scope, user journeys,
    rules, and monetization.
-   `02-technical-architecture.md` --- stack, system boundaries, folder
    structure, and architecture.
-   `03-database-schema.md` --- proposed PostgreSQL entities,
    relationships, and constraints.
-   `04-wallet-and-payments.md` --- wallet ledger, manual Vodafone Cash
    top-ups, and financial safety.
-   `05-connections-and-chat.md` --- connection lifecycle, atomic
    acceptance, and messaging.
-   `06-security-and-moderation.md` --- RLS, privacy, abuse prevention,
    moderation, and audit.
-   `07-admin-and-operations.md` --- admin dashboard, operational
    workflows, and launch controls.
-   `08-roadmap-and-testing.md` --- delivery phases, acceptance
    criteria, and test plan.

## 5. Status and assumptions

This is the agreed baseline architecture, not a claim that the product
is already implemented or legally approved. Table names and
implementation details can be refined during migrations, but the
confirmed product decisions above should not change without an explicit
product decision.

Before accepting real money, obtain qualified Egyptian legal/accounting
advice about prepaid balances, stored value, refunds, consumer
protection, tax treatment, and applicable payment regulations.
