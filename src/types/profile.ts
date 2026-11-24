export type ExperienceLevel = "beginner" | "intermediate" | "professional" | "no_experience";
export type AccountType = "freelancer" | "client";

export interface PortfolioProject {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  video_drive_url: string | null;
}

export interface DakhlProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  cover_url?: string | null;
  governorate: string | null;
  city: string | null;
  bio: string | null;
  portfolio_url?: string | null;
  projects?: PortfolioProject[];
  experience_level: ExperienceLevel | null;
  profile_completed: boolean;
  skills: string[];
  interests: string[];
  has_balance?: boolean;
  wallet_priority?: number;
  review_score?: number;
  review_count?: number;
  account_type?: AccountType;
}

export interface AuthMeta {
  email: string;
  emailVerified: boolean;
  isSuperUser: boolean;
}

export interface WalletRecord {
  userId: string;
  balance_egp: number;
  remaining_transactions: number;
  is_unlocked: boolean;
  updatedAtMs: number;
}

export type TopupStatus = "pending" | "approved" | "rejected";

export interface TopupRequestRecord {
  id: string;
  userId: string;
  userDisplayName: string;
  username: string;
  userEmail: string;
  requested_transactions: number;
  calculated_amount_egp: number;
  transfer_reference: string | null;
  receipt_image_url: string;
  status: TopupStatus;
  approved_transactions: number | null;
  approved_amount_egp: number | null;
  admin_note: string | null;
  reviewed_by: string | null;
  createdAtMs: number;
}

export interface WalletTransactionRecord {
  id: string;
  userId: string;
  type: "credit" | "debit";
  title: string;
  amount_egp: number;
  transactions_delta: number;
  requestId: string | null;
  createdBy: string;
  createdAtMs: number;
}

export interface WalletSettingsRecord {
  transaction_price_egp: number;
  min_transactions: number;
  updatedAtMs: number;
}

export type ConnectionRequestStatus = "pending" | "accepted" | "declined";

export interface ConnectionRequestRecord {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  fromUsername: string;
  fromAccountType: AccountType;
  toUserId: string;
  toDisplayName: string;
  toUsername: string;
  message: string;
  status: ConnectionRequestStatus;
  createdAtMs: number;
  respondedAtMs: number | null;
}

export type NotificationType =
  | "client_request"
  | "request_accepted"
  | "request_declined"
  | "chat_message";

export interface NotificationRecord {
  id: string;
  userId: string;
  actorUserId: string;
  actorDisplayName: string;
  actorUsername: string;
  actorAccountType: AccountType;
  type: NotificationType;
  title: string;
  body: string;
  requestId: string;
  is_read: boolean;
  createdAtMs: number;
}

export interface ChatMessageRecord {
  id: string;
  requestId: string;
  senderId: string;
  recipientId: string;
  senderDisplayName: string;
  text: string;
  createdAtMs: number;
}
