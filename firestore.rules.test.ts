/**
 * Payload-First Security TDD specification for Dakhl Firestore Security Rules.
 * Verifies that all "Dirty Dozen" adversarial payloads are rejected with PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: "get" | "list" | "create" | "update" | "delete";
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: "PERMISSION_DENIED";
}

export const dirtyDozenCases: SecurityTestCase[] = [
  {
    id: 1,
    name: "Unauthenticated profile access",
    operation: "get",
    path: "/profiles/user123",
    auth: null,
    expected: "PERMISSION_DENIED",
  },
  {
    id: 2,
    name: "Unverified email profile creation",
    operation: "create",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: false },
    payload: {
      id: "user123",
      username: "user_123",
      display_name: "Test User",
      experience_level: "beginner",
      profile_completed: true,
      skills: ["تصميم"],
      interests: ["تصميم"],
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 3,
    name: "Identity spoofing on profile ID",
    operation: "create",
    path: "/profiles/attacker",
    auth: { uid: "attacker", email_verified: true },
    payload: {
      id: "victim",
      username: "attacker_handle",
      display_name: "Attacker",
      experience_level: "beginner",
      profile_completed: true,
      skills: [],
      interests: ["تصميم"],
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 4,
    name: "Shadow ghost field injection (isAdmin)",
    operation: "create",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: true },
    payload: {
      id: "user123",
      username: "user_123",
      display_name: "Test User",
      experience_level: "beginner",
      profile_completed: true,
      skills: [],
      interests: ["تصميم"],
      isAdmin: true,
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 5,
    name: "Username hijacking via update",
    operation: "update",
    path: "/usernames/taken_name",
    auth: { uid: "attacker", email_verified: true },
    payload: { userId: "attacker" },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 6,
    name: "Orphaned profile without atomic username reservation",
    operation: "create",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: true },
    payload: {
      id: "user123",
      username: "unreserved_name",
      display_name: "Test User",
      experience_level: "beginner",
      profile_completed: true,
      skills: [],
      interests: ["تصميم"],
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 7,
    name: "Orphaned username reservation without profile",
    operation: "create",
    path: "/usernames/orphan_name",
    auth: { uid: "user123", email_verified: true },
    payload: { userId: "user123" },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 8,
    name: "Invalid username format / ID poisoning",
    operation: "create",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: true },
    payload: {
      id: "user123",
      username: "BAD-USERNAME!!",
      display_name: "Test User",
      experience_level: "beginner",
      profile_completed: true,
      skills: [],
      interests: ["تصميم"],
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 9,
    name: "Skills array size limit exceeded (>20)",
    operation: "create",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: true },
    payload: {
      id: "user123",
      username: "user_123",
      display_name: "Test User",
      experience_level: "beginner",
      profile_completed: true,
      skills: Array.from({ length: 21 }, (_, idx) => `skill_${idx}`),
      interests: ["تصميم"],
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 10,
    name: "Array element type poisoning in interests",
    operation: "create",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: true },
    payload: {
      id: "user123",
      username: "user_123",
      display_name: "Test User",
      experience_level: "beginner",
      profile_completed: true,
      skills: [],
      interests: [12345],
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 11,
    name: "Immutable createdAt mutation on update",
    operation: "update",
    path: "/profiles/user123",
    auth: { uid: "user123", email_verified: true },
    payload: {
      createdAt: "2020-01-01T00:00:00Z",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 12,
    name: "Blanket list scraping on profiles",
    operation: "list",
    path: "/profiles",
    auth: { uid: "user123", email_verified: true },
    expected: "PERMISSION_DENIED",
  },
];
