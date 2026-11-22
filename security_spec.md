# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Identity Ownership**: A `profiles/{userId}` document can only be read or written by the authenticated, email-verified user whose `request.auth.uid == userId` and `data.id == userId`.
2. **Atomic Username Uniqueness**: A `profiles/{userId}` document cannot be created without atomically creating or owning the matching `usernames/{username}` reservation document, and a `usernames/{username}` reservation cannot be created without atomically creating/updating `profiles/{userId}` with that exact `username`.
3. **Strict Schema & No Ghost Fields**: Every write must match the exact allowed keys defined in `firebase-blueprint.json` (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` + full schema validator on update).
4. **Temporal & Immutable Integrity**: `createdAt` and `updatedAt` must equal `request.time` on create; `id` and `createdAt` are immutable on update, and `updatedAt` must equal `request.time`.
5. **Bounded Collections & Strings**: `skills` max 20 items (first item validated 1..60 chars), `interests` 1..20 items (first item validated 1..60 chars), `username` matches `^[a-z0-9_]{3,24}$`, `display_name` 2..80 chars, `bio` <= 300 chars.
6. **Zero List Enumeration**: Both `/profiles` and `/usernames` forbid `list` queries (`allow list: if false`).

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Profile Read/Write**: Unauthenticated user reading or writing `/profiles/user123`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempting to create `/profiles/user123`.
3. **Identity Spoofing**: User `attackerUid` writing `/profiles/victimUid` or setting `data.id = "victimUid"` inside `/profiles/attackerUid`.
4. **Shadow/Ghost Field Injection**: Creating `/profiles/user123` with an extra field `{ isAdmin: true }` or `{ role: "admin" }`.
5. **Username Stealing**: User B attempting to create `/usernames/taken_name` when it already exists for User A.
6. **Orphaned Profile (Bypassing Username Reservation)**: Creating `/profiles/user123` with `username: "alice"` without atomically creating `/usernames/alice` in the same batch.
7. **Orphaned Username Reservation**: Creating `/usernames/alice` without atomically writing `/profiles/user123` with `username: "alice"`.
8. **Invalid Username Format / ID Poisoning**: Creating `/profiles/user123` with `username: "INVALID-NAME!!"` or a 1.5KB `userId` path.
9. **Array Bombing**: Creating `/profiles/user123` with 25 items in `skills` (> 20 limit) or 0 items in `interests`.
10. **Array Element Type Poisoning**: Creating `/profiles/user123` with `interests: [12345]` instead of strings.
11. **Timestamp Forgery / Immutable Field Mutation**: Creating `/profiles/user123` with a backdated `createdAt` (`!== request.time`) or updating `createdAt` / `id` later.
12. **Blanket List Query Scraping**: Attempting `getDocs(collection(db, "profiles"))` or `getDocs(collection(db, "usernames"))`.
