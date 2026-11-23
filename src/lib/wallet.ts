import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, handleFirestoreError, OperationType, storage } from "./firebase";
import type {
  DakhlProfile,
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
  const txId = crypto.randomUUID();
  const txRef = doc(db, "wallet_transactions", txId);
  const cleanNote = params.adminNote.trim().slice(0, 300) || null;

  try {
    await runTransaction(db, async (transaction) => {
      const [reqSnap, walletSnap] = await Promise.all([
        transaction.get(reqRef),
        transaction.get(walletRef),
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
  const txId = crypto.randomUUID();
  const txRef = doc(db, "wallet_transactions", txId);
  const cleanTitle = (params.title?.trim() || `إضافة رصيد يدوية (${txDelta} معاملات)`).slice(0, 120);

  try {
    await runTransaction(db, async (transaction) => {
      const walletSnap = await transaction.get(walletRef);
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
