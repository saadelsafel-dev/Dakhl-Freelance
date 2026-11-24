import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, handleFirestoreError, OperationType, storage } from "./firebase";
import { parseGoogleDriveVideoUrl, sanitizeExternalHttpUrl } from "./media";
import type {
  ChatMessageRecord,
  ConnectionRequestRecord,
  ConnectionRequestStatus,
  DakhlProfile,
  ExperienceLevel,
  NotificationRecord,
  NotificationType,
  PortfolioProject,
  TopupRequestRecord,
  WalletRecord,
  WalletSettingsRecord,
} from "../types/profile";

export const SUPERUSER_EMAIL = "saadelsafel@gmail.com";
export const DEFAULT_MIN_TOPUP_TRANSACTIONS = 5;
export const MAX_TOPUP_TRANSACTIONS = 1000;
export const DEFAULT_TRANSACTION_UNIT_PRICE_EGP = 20;

export function isSuperUserAccount(email: string | null | undefined, emailVerified: boolean) {
  return Boolean(emailVerified && email && email.trim().toLowerCase() === SUPERUSER_EMAIL);
}

export function timestampToMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function formatArabicDate(ms: number) {
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function mapWalletSettingsDoc(data: Record<string, unknown> | undefined): WalletSettingsRecord {
  const price =
    data && typeof data.transaction_price_egp === "number" && data.transaction_price_egp >= 1
      ? Math.trunc(data.transaction_price_egp)
      : DEFAULT_TRANSACTION_UNIT_PRICE_EGP;
  const minTx =
    data && typeof data.min_transactions === "number" && data.min_transactions >= 1
      ? Math.trunc(data.min_transactions)
      : DEFAULT_MIN_TOPUP_TRANSACTIONS;
  return {
    transaction_price_egp: price,
    min_transactions: minTx,
    updatedAtMs: data ? timestampToMillis(data.updatedAt) : 0,
  };
}

export async function saveWalletSettings(params: {
  adminUid: string;
  transactionPriceEgp: number;
  minTransactions: number;
}): Promise<void> {
  const price = Math.trunc(params.transactionPriceEgp);
  const minTx = Math.trunc(params.minTransactions);
  if (
    !Number.isFinite(price) ||
    price < 1 ||
    price > 100000 ||
    !Number.isFinite(minTx) ||
    minTx < 1 ||
    minTx > 1000
  ) {
    throw new Error("INVALID_WALLET_SETTINGS");
  }

  const path = "app_settings/wallet";
  try {
    await setDoc(doc(db, "app_settings", "wallet"), {
      transaction_price_egp: price,
      min_transactions: minTx,
      updatedBy: params.adminUid,
      updatedAt: serverTimestamp(),
    });
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

async function compressReceiptImage(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("INVALID_IMAGE"));
      element.src = imageUrl;
    });

    const maxSide = 900;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.72;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 260000 && quality > 0.3) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }

    if (dataUrl.length > 280000) {
      const smallerCanvas = document.createElement("canvas");
      smallerCanvas.width = Math.max(1, Math.round(width * 0.65));
      smallerCanvas.height = Math.max(1, Math.round(height * 0.65));
      const smallCtx = smallerCanvas.getContext("2d");
      if (smallCtx) {
        smallCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
        dataUrl = smallerCanvas.toDataURL("image/jpeg", 0.55);
      }
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("BLOB_FAILED"));
        },
        "image/jpeg",
        0.72,
      );
    });

    return { blob, dataUrl };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function uploadReceiptImage(file: File, userId: string): Promise<string> {
  const { blob, dataUrl } = await compressReceiptImage(file);

  try {
    const storageRef = ref(storage, `receipts/${userId}/${crypto.randomUUID()}.jpg`);
    const uploadPromise = uploadBytes(storageRef, blob, { contentType: "image/jpeg" }).then(() =>
      getDownloadURL(storageRef),
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("STORAGE_TIMEOUT")), 6000),
    );
    const url = await Promise.race([uploadPromise, timeoutPromise]);
    if (url && url.length <= 300000) {
      return url;
    }
  } catch {
    // Fallback to compact compressed JPEG data URL when Storage bucket is unavailable on Spark tier
  }

  if (dataUrl.length > 295000) {
    throw new Error("RECEIPT_TOO_LARGE");
  }
  return dataUrl;
}

export async function submitTopupRequest(params: {
  profile: DakhlProfile;
  userEmail: string;
  requestedTransactions: number;
  unitPriceEgp: number;
  minTransactions: number;
  transferReference: string;
  receiptFile: File;
}): Promise<void> {
  const count = Math.trunc(params.requestedTransactions);
  const unitPrice = Math.trunc(params.unitPriceEgp);
  if (
    !Number.isFinite(count) ||
    count < params.minTransactions ||
    count > MAX_TOPUP_TRANSACTIONS ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 1
  ) {
    throw new Error("INVALID_TRANSACTION_COUNT");
  }

  const calculatedAmountEgp = count * unitPrice;
  const receiptUrl = await uploadReceiptImage(params.receiptFile, params.profile.id);
  const requestId = crypto.randomUUID();
  const path = `topup_requests/${requestId}`;
  const cleanRef = params.transferReference.trim().slice(0, 120) || null;

  try {
    await setDoc(doc(db, "topup_requests", requestId), {
      id: requestId,
      userId: params.profile.id,
      userDisplayName: params.profile.display_name.trim().slice(0, 80),
      username: params.profile.username,
      userEmail: params.userEmail.trim().slice(0, 160),
      requested_transactions: count,
      calculated_amount_egp: calculatedAmountEgp,
      transfer_reference: cleanRef,
      receipt_image_url: receiptUrl,
      status: "pending",
      approved_transactions: null,
      approved_amount_egp: null,
      admin_note: null,
      reviewed_by: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewedAt: null,
    });
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function approveTopupRequest(params: {
  request: TopupRequestRecord;
  adminUid: string;
  approvedTransactions: number;
  approvedAmountEgp: number;
  adminNote: string;
}): Promise<void> {
  const txCount = Math.trunc(params.approvedTransactions);
  const amountEgp = Math.trunc(params.approvedAmountEgp);
  if (txCount < 1 || txCount > 100000 || amountEgp < 0 || amountEgp > 10000000) {
    throw new Error("INVALID_APPROVAL_VALUES");
  }

  const reqRef = doc(db, "topup_requests", params.request.id);
  const walletRef = doc(db, "wallets", params.request.userId);
  const profileRef = doc(db, "profiles", params.request.userId);
  const txId = crypto.randomUUID();
  const txRef = doc(db, "wallet_transactions", txId);
  const cleanNote = params.adminNote.trim().slice(0, 300) || null;

  try {
    await runTransaction(db, async (transaction) => {
      const [reqSnap, walletSnap, profileSnap] = await Promise.all([
        transaction.get(reqRef),
        transaction.get(walletRef),
        transaction.get(profileRef),
      ]);

      if (!reqSnap.exists() || reqSnap.data().status !== "pending") {
        throw new Error("REQUEST_ALREADY_REVIEWED");
      }

      const prevBalance =
        walletSnap.exists() && typeof walletSnap.data().balance_egp === "number"
          ? walletSnap.data().balance_egp
          : 0;
      const prevRemaining =
        walletSnap.exists() && typeof walletSnap.data().remaining_transactions === "number"
          ? walletSnap.data().remaining_transactions
          : 0;

      const nextBalance = prevBalance + amountEgp;
      const nextRemaining = prevRemaining + txCount;
      const nextHasBalance = nextBalance > 0 || nextRemaining > 0;

      if (!walletSnap.exists()) {
        transaction.set(walletRef, {
          userId: params.request.userId,
          balance_egp: nextBalance,
          remaining_transactions: nextRemaining,
          is_unlocked: nextRemaining > 0,
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.update(walletRef, {
          balance_egp: nextBalance,
          remaining_transactions: nextRemaining,
          is_unlocked: nextRemaining > 0,
          updatedAt: serverTimestamp(),
        });
      }

      if (profileSnap.exists()) {
        const isClientProfile = profileSnap.data().account_type === "client";
        transaction.update(profileRef, {
          has_balance: isClientProfile ? false : nextHasBalance,
          wallet_priority: isClientProfile
            ? 0
            : computeWalletPriority(nextBalance, nextRemaining),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.update(reqRef, {
        status: "approved",
        approved_transactions: txCount,
        approved_amount_egp: amountEgp,
        admin_note: cleanNote,
        reviewed_by: params.adminUid,
        updatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        id: txId,
        userId: params.request.userId,
        type: "credit",
        title: `شحن رصيد معتمد (${txCount} معاملات)`,
        amount_egp: amountEgp,
        transactions_delta: txCount,
        requestId: params.request.id,
        createdBy: params.adminUid,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "REQUEST_ALREADY_REVIEWED") {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `topup_requests/${params.request.id}`);
  }
}

export async function rejectTopupRequest(params: {
  requestId: string;
  adminUid: string;
  adminNote: string;
}): Promise<void> {
  const reqRef = doc(db, "topup_requests", params.requestId);
  const cleanNote = params.adminNote.trim().slice(0, 300) || "لم يتم تأكيد التحويل";

  try {
    await updateDoc(reqRef, {
      status: "rejected",
      approved_transactions: 0,
      approved_amount_egp: 0,
      admin_note: cleanNote,
      reviewed_by: params.adminUid,
      updatedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
    });
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.UPDATE, `topup_requests/${params.requestId}`);
  }
}

export async function manualCreditWallet(params: {
  targetUserId: string;
  adminUid: string;
  addTransactions: number;
  addAmountEgp: number;
  title?: string;
}): Promise<void> {
  const txDelta = Math.trunc(params.addTransactions);
  const amountDelta = Math.trunc(params.addAmountEgp);
  if (txDelta < 1 || txDelta > 100000 || amountDelta < 0 || amountDelta > 10000000) {
    throw new Error("INVALID_MANUAL_CREDIT");
  }

  const walletRef = doc(db, "wallets", params.targetUserId);
  const profileRef = doc(db, "profiles", params.targetUserId);
  const txId = crypto.randomUUID();
  const txRef = doc(db, "wallet_transactions", txId);
  const cleanTitle = (params.title?.trim() || `إضافة رصيد يدوية (${txDelta} معاملات)`).slice(0, 120);

  try {
    await runTransaction(db, async (transaction) => {
      const [walletSnap, profileSnap] = await Promise.all([
        transaction.get(walletRef),
        transaction.get(profileRef),
      ]);
      const prevBalance =
        walletSnap.exists() && typeof walletSnap.data().balance_egp === "number"
          ? walletSnap.data().balance_egp
          : 0;
      const prevRemaining =
        walletSnap.exists() && typeof walletSnap.data().remaining_transactions === "number"
          ? walletSnap.data().remaining_transactions
          : 0;

      const nextBalance = prevBalance + amountDelta;
      const nextRemaining = prevRemaining + txDelta;
      const nextHasBalance = nextBalance > 0 || nextRemaining > 0;

      if (!walletSnap.exists()) {
        transaction.set(walletRef, {
          userId: params.targetUserId,
          balance_egp: nextBalance,
          remaining_transactions: nextRemaining,
          is_unlocked: nextRemaining > 0,
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.update(walletRef, {
          balance_egp: nextBalance,
          remaining_transactions: nextRemaining,
          is_unlocked: nextRemaining > 0,
          updatedAt: serverTimestamp(),
        });
      }

      if (profileSnap.exists()) {
        const isClientProfile = profileSnap.data().account_type === "client";
        transaction.update(profileRef, {
          has_balance: isClientProfile ? false : nextHasBalance,
          wallet_priority: isClientProfile
            ? 0
            : computeWalletPriority(nextBalance, nextRemaining),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(txRef, {
        id: txId,
        userId: params.targetUserId,
        type: "credit",
        title: cleanTitle,
        amount_egp: amountDelta,
        transactions_delta: txDelta,
        requestId: null,
        createdBy: params.adminUid,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.WRITE, `wallets/${params.targetUserId}`);
  }
}

export function computeWalletPriority(balanceEgp: number, remainingTransactions: number): number {
  const safeBalance = Math.max(0, Math.min(10000000, Math.trunc(balanceEgp || 0)));
  const safeTx = Math.max(0, Math.min(99, Math.trunc(remainingTransactions || 0)));
  return safeBalance * 100 + safeTx;
}

export async function syncProfileBalanceVisibility(
  userId: string,
  hasBalance: boolean,
  backfillFreelancerType = false,
  walletPriority?: number,
): Promise<void> {
  const profileRef = doc(db, "profiles", userId);
  const payload: Record<string, unknown> = {
    has_balance: hasBalance,
    updatedAt: serverTimestamp(),
  };
  if (typeof walletPriority === "number" && Number.isFinite(walletPriority)) {
    payload.wallet_priority = Math.max(0, Math.min(1000000100, Math.trunc(walletPriority)));
  }
  if (backfillFreelancerType) {
    payload.account_type = "freelancer";
  }
  try {
    await updateDoc(profileRef, payload);
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${userId}`);
  }
}

export function mapProjectsArray(raw: unknown): PortfolioProject[] {
  if (!Array.isArray(raw)) return [];
  const items: PortfolioProject[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(obj.id) ? obj.id : "";
    const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 80) : "";
    if (!id || title.length < 2) continue;

    const description =
      typeof obj.description === "string" && obj.description.trim()
        ? obj.description.trim().slice(0, 300)
        : null;
    const imageUrl =
      typeof obj.image_url === "string" &&
      obj.image_url.length <= 180000 &&
      /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(obj.image_url)
        ? obj.image_url
        : null;
    const videoDriveUrl =
      typeof obj.video_drive_url === "string"
        ? parseGoogleDriveVideoUrl(obj.video_drive_url)
        : null;

    if (!imageUrl && !videoDriveUrl) continue;
    const normalizedImage = imageUrl;
    const normalizedVideo = normalizedImage ? null : videoDriveUrl;
    items.push({
      id,
      title,
      description,
      image_url: normalizedImage,
      video_drive_url: normalizedVideo,
    });
    if (items.length >= 3) break;
  }
  return items;
}

export async function updateUserProfile(params: {
  userId: string;
  display_name: string;
  avatar_url: string | null;
  cover_url?: string | null;
  governorate: string | null;
  city: string | null;
  bio: string | null;
  portfolio_url: string | null;
  projects: PortfolioProject[];
  experience_level: ExperienceLevel;
  skills: string[];
  interests: string[];
}): Promise<void> {
  const cleanName = params.display_name.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new Error("INVALID_DISPLAY_NAME");
  }

  const cleanSkills = params.skills
    .map((s) => s.trim())
    .filter((s) => s.length >= 1 && s.length <= 60)
    .slice(0, 20);
  const cleanInterests = params.interests
    .map((s) => s.trim())
    .filter((s) => s.length >= 1 && s.length <= 60)
    .slice(0, 20);
  if (cleanInterests.length < 1) {
    throw new Error("INVALID_INTERESTS");
  }

  const cleanPortfolioUrl = params.portfolio_url
    ? sanitizeExternalHttpUrl(params.portfolio_url)
    : null;
  if (params.portfolio_url && params.portfolio_url.trim() && !cleanPortfolioUrl) {
    throw new Error("INVALID_PORTFOLIO_URL");
  }

  const cleanProjects = mapProjectsArray(params.projects).slice(0, 3);
  const cleanAvatar =
    params.avatar_url && params.avatar_url.length <= 50000 ? params.avatar_url : null;
  const cleanCover =
    typeof params.cover_url === "string" &&
    params.cover_url.length <= 165000 &&
    /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(params.cover_url)
      ? params.cover_url
      : null;

  const path = `profiles/${params.userId}`;
  try {
    await updateDoc(doc(db, "profiles", params.userId), {
      display_name: cleanName,
      avatar_url: cleanAvatar,
      cover_url: cleanCover,
      governorate: params.governorate?.trim().slice(0, 80) || null,
      city: params.city?.trim().slice(0, 80) || null,
      bio: params.bio?.trim().slice(0, 500) || null,
      portfolio_url: cleanPortfolioUrl,
      projects: cleanProjects,
      experience_level: params.experience_level,
      skills: cleanSkills,
      interests: cleanInterests,
      updatedAt: serverTimestamp(),
    });
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function mapProfileDoc(id: string, data: Record<string, unknown>): DakhlProfile {
  const rawPortfolio =
    typeof data.portfolio_url === "string" ? sanitizeExternalHttpUrl(data.portfolio_url) : null;
  const rawCover =
    typeof data.cover_url === "string" &&
    data.cover_url.length <= 165000 &&
    /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(data.cover_url)
      ? data.cover_url
      : null;
  return {
    id: typeof data.id === "string" ? data.id : id,
    username: typeof data.username === "string" ? data.username : "",
    display_name: typeof data.display_name === "string" ? data.display_name : "",
    avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : null,
    cover_url: rawCover,
    governorate: typeof data.governorate === "string" ? data.governorate : null,
    city: typeof data.city === "string" ? data.city : null,
    bio: typeof data.bio === "string" ? data.bio : null,
    portfolio_url: rawPortfolio,
    projects: mapProjectsArray(data.projects),
    experience_level: (data.experience_level as DakhlProfile["experience_level"]) ?? null,
    profile_completed: Boolean(data.profile_completed),
    skills: Array.isArray(data.skills) ? data.skills.filter((s): s is string => typeof s === "string") : [],
    interests: Array.isArray(data.interests)
      ? data.interests.filter((s): s is string => typeof s === "string")
      : [],
    has_balance: Boolean(data.has_balance),
    wallet_priority:
      typeof data.wallet_priority === "number" && Number.isFinite(data.wallet_priority)
        ? Math.max(0, Math.trunc(data.wallet_priority))
        : 0,
    review_score:
      typeof data.review_score === "number" && Number.isFinite(data.review_score)
        ? Math.max(0, Math.min(5, data.review_score))
        : 0,
    review_count:
      typeof data.review_count === "number" && Number.isFinite(data.review_count)
        ? Math.max(0, Math.trunc(data.review_count))
        : 0,
    account_type: data.account_type === "client" ? "client" : "freelancer",
  };
}

export function mapWalletDoc(userId: string, data: Record<string, unknown> | undefined): WalletRecord {
  if (!data) {
    return {
      userId,
      balance_egp: 0,
      remaining_transactions: 0,
      is_unlocked: false,
      updatedAtMs: 0,
    };
  }
  const balance = typeof data.balance_egp === "number" ? data.balance_egp : 0;
  const remaining = typeof data.remaining_transactions === "number" ? data.remaining_transactions : 0;
  return {
    userId,
    balance_egp: balance,
    remaining_transactions: remaining,
    is_unlocked: Boolean(data.is_unlocked) && remaining > 0,
    updatedAtMs: timestampToMillis(data.updatedAt),
  };
}

export function mapConnectionRequestDoc(
  id: string,
  data: Record<string, unknown>,
): ConnectionRequestRecord {
  const statusRaw = data.status;
  const status: ConnectionRequestStatus =
    statusRaw === "accepted" || statusRaw === "declined" ? statusRaw : "pending";
  return {
    id: typeof data.id === "string" ? data.id : id,
    fromUserId: typeof data.fromUserId === "string" ? data.fromUserId : "",
    fromDisplayName: typeof data.fromDisplayName === "string" ? data.fromDisplayName : "",
    fromUsername: typeof data.fromUsername === "string" ? data.fromUsername : "",
    fromAccountType: data.fromAccountType === "client" ? "client" : "freelancer",
    toUserId: typeof data.toUserId === "string" ? data.toUserId : "",
    toDisplayName: typeof data.toDisplayName === "string" ? data.toDisplayName : "",
    toUsername: typeof data.toUsername === "string" ? data.toUsername : "",
    message: typeof data.message === "string" ? data.message : "",
    status,
    createdAtMs: timestampToMillis(data.createdAt),
    respondedAtMs: data.respondedAt ? timestampToMillis(data.respondedAt) : null,
  };
}

export function mapNotificationDoc(id: string, data: Record<string, unknown>): NotificationRecord {
  const rawType = data.type;
  const type: NotificationType =
    rawType === "request_accepted" ||
    rawType === "request_declined" ||
    rawType === "chat_message"
      ? rawType
      : "client_request";
  return {
    id: typeof data.id === "string" ? data.id : id,
    userId: typeof data.userId === "string" ? data.userId : "",
    actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : "",
    actorDisplayName: typeof data.actorDisplayName === "string" ? data.actorDisplayName : "",
    actorUsername: typeof data.actorUsername === "string" ? data.actorUsername : "",
    actorAccountType: data.actorAccountType === "client" ? "client" : "freelancer",
    type,
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    requestId: typeof data.requestId === "string" ? data.requestId : "",
    is_read: Boolean(data.is_read),
    createdAtMs: timestampToMillis(data.createdAt),
  };
}

export async function sendClientConnectionRequest(params: {
  sender: DakhlProfile;
  target: DakhlProfile;
  message: string;
}): Promise<string> {
  if (params.sender.id === params.target.id) {
    throw new Error("CANNOT_CONTACT_SELF");
  }

  const requestId = crypto.randomUUID();
  const cleanMessage = params.message.trim().slice(0, 500);
  const fromType = params.sender.account_type === "client" ? "client" : "freelancer";
  const fromDisplayName = params.sender.display_name.trim().slice(0, 80);
  const toDisplayName = params.target.display_name.trim().slice(0, 80);
  const senderRoleLabel = fromType === "client" ? "العميل" : "العضو";
  const title = `طلب تواصل جديد من ${senderRoleLabel} ${fromDisplayName}`.slice(0, 120);
  const body = (
    cleanMessage ||
    `يرغب ${senderRoleLabel} ${fromDisplayName} (@${params.sender.username}) في التواصل معك حول مشروع.`
  ).slice(0, 500);

  const batch = writeBatch(db);
  batch.set(doc(db, "connection_requests", requestId), {
    id: requestId,
    fromUserId: params.sender.id,
    fromDisplayName,
    fromUsername: params.sender.username,
    fromAccountType: fromType,
    toUserId: params.target.id,
    toDisplayName,
    toUsername: params.target.username,
    message: cleanMessage,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    respondedAt: null,
  });

  batch.set(doc(db, "notifications", requestId), {
    id: requestId,
    userId: params.target.id,
    actorUserId: params.sender.id,
    actorDisplayName: fromDisplayName,
    actorUsername: params.sender.username,
    actorAccountType: fromType,
    type: "client_request",
    title,
    body,
    requestId,
    is_read: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.WRITE, `connection_requests/${requestId}`);
  }
  return requestId;
}

export async function respondToConnectionRequest(params: {
  request: ConnectionRequestRecord;
  responder: DakhlProfile;
  decision: "accepted" | "declined";
  isSuperUser?: boolean;
}): Promise<{ deductedEgp: number; remainingTransactions: number | null }> {
  if (params.request.toUserId !== params.responder.id) {
    throw new Error("UNAUTHORIZED_REQUEST_RESPONSE");
  }
  if (params.request.status !== "pending") {
    throw new Error("REQUEST_ALREADY_RESPONDED");
  }

  const notifId = `${params.request.id}_reply`;
  const responderType = params.responder.account_type === "client" ? "client" : "freelancer";
  const responderName = params.responder.display_name.trim().slice(0, 80);
  const notifType: NotificationType =
    params.decision === "accepted" ? "request_accepted" : "request_declined";
  const title =
    params.decision === "accepted"
      ? `قبل ${responderName} طلب التواصل`.slice(0, 120)
      : `اعتذر ${responderName} عن طلب التواصل`.slice(0, 120);
  const body =
    params.decision === "accepted"
      ? `وافق ${responderName} (@${params.responder.username}) على طلب التواصل ويمكنكما الآن المتابعة في قسم الرسائل.`
      : `اعتذر ${responderName} (@${params.responder.username}) عن قبول طلب التواصل حاليًا.`;

  const reqRef = doc(db, "connection_requests", params.request.id);
  const notifRef = doc(db, "notifications", notifId);
  const walletRef = doc(db, "wallets", params.responder.id);
  const profileRef = doc(db, "profiles", params.responder.id);
  const settingsRef = doc(db, "app_settings", "wallet");

  let deductedEgp = 0;
  let remainingTransactions: number | null = null;

  try {
    await runTransaction(db, async (transaction) => {
      if (params.decision === "accepted") {
        const [reqSnap, walletSnap, profileSnap, settingsSnap] = await Promise.all([
          transaction.get(reqRef),
          transaction.get(walletRef),
          transaction.get(profileRef),
          transaction.get(settingsRef),
        ]);

        if (!reqSnap.exists() || reqSnap.data().status !== "pending") {
          throw new Error("REQUEST_ALREADY_RESPONDED");
        }
        if (reqSnap.data().toUserId !== params.responder.id) {
          throw new Error("UNAUTHORIZED_REQUEST_RESPONSE");
        }

        const walletExists = walletSnap.exists();
        const prevBalance =
          walletExists && typeof walletSnap.data().balance_egp === "number"
            ? Math.max(0, Math.trunc(walletSnap.data().balance_egp))
            : 0;
        const prevRemaining =
          walletExists && typeof walletSnap.data().remaining_transactions === "number"
            ? Math.max(0, Math.trunc(walletSnap.data().remaining_transactions))
            : 0;

        if (!params.isSuperUser && (!walletExists || prevRemaining < 1)) {
          throw new Error("INSUFFICIENT_TRANSACTIONS");
        }

        if (walletExists && prevRemaining >= 1) {
          const configuredPrice =
            settingsSnap.exists() &&
            typeof settingsSnap.data().transaction_price_egp === "number" &&
            settingsSnap.data().transaction_price_egp >= 1
              ? Math.trunc(settingsSnap.data().transaction_price_egp)
              : DEFAULT_TRANSACTION_UNIT_PRICE_EGP;

          deductedEgp = Math.min(prevBalance, configuredPrice);
          const nextBalance = prevBalance - deductedEgp;
          const nextRemaining = prevRemaining - 1;
          const nextHasBalance = nextBalance > 0 || nextRemaining > 0;
          remainingTransactions = nextRemaining;

          transaction.update(walletRef, {
            balance_egp: nextBalance,
            remaining_transactions: nextRemaining,
            is_unlocked: nextRemaining > 0,
            updatedAt: serverTimestamp(),
          });

          const txId = `${params.request.id}_debit`;
          const requesterLabel =
            params.request.fromDisplayName.trim() || params.request.fromUsername || "العميل";
          transaction.set(doc(db, "wallet_transactions", txId), {
            id: txId,
            userId: params.responder.id,
            type: "debit",
            title: `رسوم قبول طلب تواصل (${requesterLabel})`.slice(0, 120),
            amount_egp: deductedEgp,
            transactions_delta: -1,
            requestId: params.request.id,
            createdBy: params.responder.id,
            createdAt: serverTimestamp(),
          });

          if (profileSnap.exists()) {
            const isClientProfile = profileSnap.data().account_type === "client";
            transaction.update(profileRef, {
              has_balance: isClientProfile ? false : nextHasBalance,
              wallet_priority: isClientProfile
                ? 0
                : computeWalletPriority(nextBalance, nextRemaining),
              updatedAt: serverTimestamp(),
            });
          }
        }
      } else {
        const reqSnap = await transaction.get(reqRef);
        if (!reqSnap.exists() || reqSnap.data().status !== "pending") {
          throw new Error("REQUEST_ALREADY_RESPONDED");
        }
        if (reqSnap.data().toUserId !== params.responder.id) {
          throw new Error("UNAUTHORIZED_REQUEST_RESPONSE");
        }
      }

      transaction.update(reqRef, {
        status: params.decision,
        updatedAt: serverTimestamp(),
        respondedAt: serverTimestamp(),
      });

      transaction.set(notifRef, {
        id: notifId,
        userId: params.request.fromUserId,
        actorUserId: params.responder.id,
        actorDisplayName: responderName,
        actorUsername: params.responder.username,
        actorAccountType: responderType,
        type: notifType,
        title,
        body: body.slice(0, 500),
        requestId: params.request.id,
        is_read: false,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message === "REQUEST_ALREADY_RESPONDED" ||
        error.message === "UNAUTHORIZED_REQUEST_RESPONSE" ||
        error.message === "INSUFFICIENT_TRANSACTIONS")
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `connection_requests/${params.request.id}`);
  }

  return { deductedEgp, remainingTransactions };
}

export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, "notifications", notifId), {
      is_read: true,
    });
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

export async function markAllNotificationsRead(notifIds: string[]): Promise<void> {
  if (notifIds.length === 0) return;
  try {
    for (let i = 0; i < notifIds.length; i += 400) {
      const chunk = notifIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.update(doc(db, "notifications", id), { is_read: true });
      }
      await batch.commit();
    }
  } catch (error: unknown) {
    handleFirestoreError(error, OperationType.WRITE, "notifications");
  }
}

export function mapChatMessageDoc(id: string, data: Record<string, unknown>): ChatMessageRecord {
  return {
    id: typeof data.id === "string" ? data.id : id,
    requestId: typeof data.requestId === "string" ? data.requestId : "",
    senderId: typeof data.senderId === "string" ? data.senderId : "",
    recipientId: typeof data.recipientId === "string" ? data.recipientId : "",
    senderDisplayName: typeof data.senderDisplayName === "string" ? data.senderDisplayName : "",
    text: typeof data.text === "string" ? data.text : "",
    createdAtMs: timestampToMillis(data.createdAt),
  };
}

export async function sendChatMessage(params: {
  requestId: string;
  sender: DakhlProfile;
  recipientId: string;
  text: string;
}): Promise<string> {
  const cleanText = params.text.trim().slice(0, 1000);
  if (!cleanText) {
    throw new Error("EMPTY_MESSAGE");
  }
  if (!params.requestId || !params.recipientId || params.sender.id === params.recipientId) {
    throw new Error("INVALID_CHAT_RECIPIENT");
  }

  const messageId = crypto.randomUUID();
  const rawName = params.sender.display_name.trim() || params.sender.username || "عضو دخل";
  const senderDisplayName = (rawName.length >= 2 ? rawName : "عضو دخل").slice(0, 80);
  const senderType = params.sender.account_type === "client" ? "client" : "freelancer";
  const title = `رسالة جديدة من ${senderDisplayName}`.slice(0, 120);
  const body = cleanText.slice(0, 500);

  const batch = writeBatch(db);
  batch.set(doc(db, "connection_requests", params.requestId, "messages", messageId), {
    id: messageId,
    requestId: params.requestId,
    senderId: params.sender.id,
    recipientId: params.recipientId,
    senderDisplayName,
    participants: [params.sender.id, params.recipientId],
    text: cleanText,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, "notifications", messageId), {
    id: messageId,
    userId: params.recipientId,
    actorUserId: params.sender.id,
    actorDisplayName: senderDisplayName,
    actorUsername: params.sender.username,
    actorAccountType: senderType,
    type: "chat_message",
    title,
    body,
    requestId: params.requestId,
    is_read: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error: unknown) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `connection_requests/${params.requestId}/messages/${messageId}`,
    );
  }
  return messageId;
}
