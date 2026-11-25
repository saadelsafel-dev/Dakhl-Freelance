import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import logo from "./logo.png";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  Bell,
  BellRing,
  BriefcaseBusiness,
  Camera,
  Check,
  CheckCheck,
  CheckCircle2,
  CircleHelp,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  FileText,
  FolderKanban,
  Heart,
  House,
  ImagePlus,
  Link2,
  LoaderCircle,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { auth, db, handleFirestoreError, OperationType } from "./lib/firebase";
import {
  AVATAR_WEBP_MAX_LENGTH,
  convertImageToWebpDataUrl,
  COVER_WEBP_MAX_LENGTH,
  extractTextSegmentsWithLinks,
  parseGoogleDriveVideoUrl,
  PROJECT_IMAGE_MAX_LENGTH,
  sanitizeExternalHttpUrl,
} from "./lib/media";
import {
  addProfileProject,
  approveTopupRequest,
  cancelConnectionDeal,
  computeWalletPriority,
  confirmDealDelivery,
  deleteProfileProject,
  fetchProfileSubcollectionProjects,
  formatArabicDate,
  INACTIVITY_CHECKIN_MS,
  manualCreditWallet,
  mapChatMessageDoc,
  mapConnectionRequestDoc,
  mapNotificationDoc,
  mapProfileDoc,
  mapWalletDoc,
  mapWalletSettingsDoc,
  markAllNotificationsRead,
  markDealNotDeliveredYet,
  markNotificationRead,
  MAX_TOPUP_TRANSACTIONS,
  rejectTopupRequest,
  respondToConnectionRequest,
  saveWalletSettings,
  sendChatMessage,
  sendClientConnectionRequest,
  submitTopupRequest,
  syncProfileBalanceVisibility,
  timestampToMillis,
  updateUserProfile,
} from "./lib/wallet";
import type {
  AuthMeta,
  ChatMessageRecord,
  ConnectionRequestRecord,
  ConnectionRequestStatus,
  DakhlProfile,
  DealStatus,
  DeliveryCheckStatus,
  ExperienceLevel,
  NotificationRecord,
  PortfolioProject,
  TopupRequestRecord,
  TopupStatus,
  WalletRecord,
  WalletSettingsRecord,
  WalletTransactionRecord,
} from "./types/profile";

type Section =
  | "home"
  | "discover"
  | "opportunities"
  | "messages"
  | "assign"
  | "notifications"
  | "wallet"
  | "profile"
  | "admin";

type Opportunity = {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  skills: string[];
  time: string;
  avatar: string;
  tone: string;
};

type ChatThread = {
  id: string;
  partnerId: string;
  partnerUsername: string;
  name: string;
  last: string;
  time: string;
  lastMs: number;
  avatar: string;
  tone: string;
  initialMessage?: string;
  initialMessageSenderId?: string;
  initialTime?: string;
  hasUnread?: boolean;
  request: ConnectionRequestRecord;
  dealStatus: DealStatus;
  acceptedFeeEgp: number;
  checkInBaselineMs: number;
  inactiveDurationMs: number;
  needsDeliveryCheckIn: boolean;
  deliveryCheckStatus: DeliveryCheckStatus;
  deliveryCheckedAtMs: number | null;
  deliveredAtMs: number | null;
  cancelledAtMs: number | null;
  refundedAmountEgp: number | null;
};

const DIRECTORY_CATEGORIES: { id: string; keywords: string[] }[] = [
  { id: "الكل", keywords: [] },
  { id: "تصميم", keywords: ["تصميم", "ui", "ux", "جرافيك"] },
  { id: "برمجة وتطوير", keywords: ["برمجة", "تطوير", "ويب", "تطبيق"] },
  { id: "كتابة ومحتوى", keywords: ["كتابة", "محتوى"] },
  { id: "تسويق", keywords: ["تسويق", "تواصل"] },
  { id: "ترجمة", keywords: ["ترجمة"] },
  { id: "تصوير ومونتاج", keywords: ["تصوير", "مونتاج", "فيديو"] },
  { id: "إدخال بيانات", keywords: ["إدخال", "بيانات"] },
  { id: "خدمة عملاء", keywords: ["خدمة", "عملاء"] },
  { id: "تعليم وإدارة", keywords: ["تعليم", "تدريب", "إدارية"] },
];

function matchesDirectoryCategory(member: DakhlProfile, categoryId: string): boolean {
  if (categoryId === "الكل") return true;
  const tags = [...member.skills, ...member.interests].map((item) => item.toLowerCase());
  const preset = DIRECTORY_CATEGORIES.find((item) => item.id === categoryId);
  if (preset) {
    return preset.keywords.some((kw) => tags.some((tag) => tag.includes(kw)));
  }
  const normalized = categoryId.trim().toLowerCase();
  return tags.some((tag) => tag.includes(normalized));
}

const opportunities: Opportunity[] = [];

const baseNavItems: { id: Section; label: string; icon: typeof House }[] = [
  { id: "home", label: "الرئيسية", icon: House },
  { id: "discover", label: "اكتشف أشخاصًا", icon: Compass },
  { id: "opportunities", label: "الفرص", icon: BriefcaseBusiness },
  { id: "messages", label: "الرسائل", icon: MessageCircle },
  { id: "assign", label: "تعيين", icon: Users },
  { id: "notifications", label: "الإشعارات", icon: Bell },
  { id: "wallet", label: "المحفظة", icon: Wallet },
];

const DIRECTORY_PAGE_SIZE = 24;
const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;

const sectionTitles: Record<Section, string> = {
  home: "الرئيسية",
  discover: "اكتشف أشخاصًا",
  opportunities: "فرص مناسبة لك",
  messages: "رسائلك",
  assign: "تعيين",
  notifications: "الإشعارات وطلبات العملاء",
  wallet: "محفظتك",
  profile: "ملفي الشخصي",
  admin: "إدارة المحافظ والشحن",
};

function App({
  profile,
  onSignOut,
  authMeta,
}: {
  profile: DakhlProfile;
  onSignOut: () => Promise<void>;
  authMeta: AuthMeta;
}) {
  const [section, setSection] = useState<Section>("home");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("الكل");
  const [dialog, setDialog] = useState<"connect" | "topup" | "publish" | null>(null);
  const [connectTarget, setConnectTarget] = useState<DakhlProfile | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [messageText, setMessageText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessageRecord[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [lastMessageByRequestId, setLastMessageByRequestId] = useState<
    Record<string, { text: string; createdAtMs: number }>
  >({});
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const effectiveSectionRef = useRef<Section>("home");
  const effectiveActiveChatRef = useRef<string | null>(null);

  const [wallet, setWallet] = useState<WalletRecord>(() => mapWalletDoc(profile.id, undefined));
  const [walletSettings, setWalletSettings] = useState<WalletSettingsRecord>(() =>
    mapWalletSettingsDoc(undefined),
  );
  const [walletReady, setWalletReady] = useState(false);
  const [myRequests, setMyRequests] = useState<TopupRequestRecord[]>([]);
  const [myTransactions, setMyTransactions] = useState<WalletTransactionRecord[]>([]);

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState<NotificationRecord[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<ConnectionRequestRecord[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<ConnectionRequestRecord[]>([]);
  const [notifPopoverOpen, setNotifPopoverOpen] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [dealActionBusyId, setDealActionBusyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [browserNotifPermission, setBrowserNotifPermission] = useState<NotificationPermission>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied",
  );
  const notifContainerRef = useRef<HTMLDivElement | null>(null);
  const initialNotifLoadedRef = useRef(false);
  const seenNotifIdsRef = useRef<Record<string, boolean>>({});

  const [adminRequests, setAdminRequests] = useState<TopupRequestRecord[]>([]);
  const [adminWallets, setAdminWallets] = useState<Record<string, WalletRecord>>({});
  const [adminWalletsReady, setAdminWalletsReady] = useState(false);
  const [adminProfiles, setAdminProfiles] = useState<DakhlProfile[]>([]);
  const [directoryHasMore, setDirectoryHasMore] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const directoryCursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const directoryLoadedRef = useRef(false);
  const directoryFetchedAtRef = useRef(0);
  const directoryRequestInFlightRef = useRef(false);
  const [missingAccountTypeIds, setMissingAccountTypeIds] = useState<Record<string, boolean>>({});
  const [fundedProfiles, setFundedProfiles] = useState<DakhlProfile[]>([]);
  const syncedBalanceFlagsRef = useRef<Record<string, boolean>>({});
  const syncedWalletPriorityRef = useRef<Record<string, number>>({});
  const syncedAccountTypeRef = useRef<Record<string, boolean>>({});
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  const [previewProfile, setPreviewProfile] = useState<DakhlProfile | null>(null);
  const [manualCreditTarget, setManualCreditTarget] = useState<DakhlProfile | null>(null);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) {
    throw fatalError;
  }

  const isSuperUser = authMeta.isSuperUser;
  const isClient = !isSuperUser && profile.account_type === "client";
  const isLocked =
    !isSuperUser && !isClient && (!wallet.is_unlocked || wallet.remaining_transactions <= 0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const navItems = useMemo(() => {
    if (isSuperUser) {
      return [...baseNavItems, { id: "admin" as Section, label: "إدارة المحافظ", icon: ShieldCheck }];
    }
    return baseNavItems;
  }, [isSuperUser]);

  useEffect(() => {
    if (!notifPopoverOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        notifContainerRef.current &&
        event.target instanceof Node &&
        !notifContainerRef.current.contains(event.target)
      ) {
        setNotifPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [notifPopoverOpen]);

  useEffect(() => {
    const walletPath = `wallets/${profile.id}`;
    const unsubWallet = onSnapshot(
      doc(db, "wallets", profile.id),
      (snapshot) => {
        setWallet(mapWalletDoc(profile.id, snapshot.exists() ? snapshot.data() : undefined));
        setWalletReady(true);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.GET, walletPath);
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => unsubWallet();
  }, [profile.id]);

  useEffect(() => {
    const isWalletView = section === "wallet" || (isLocked && section !== "messages");
    const isAdminView = isSuperUser && section === "admin";
    if (!isWalletView && !isAdminView) {
      setMyRequests([]);
      setMyTransactions([]);
      return;
    }

    let unsubRequests = () => {};
    let unsubTx = () => {};
    if (isWalletView && !isSuperUser) {
      const reqQuery = query(collection(db, "topup_requests"), where("userId", "==", profile.id));
      unsubRequests = onSnapshot(
        reqQuery,
        (snapshot) => {
          const items = snapshot.docs.map((d) => mapTopupRequestDoc(d.id, d.data()));
          items.sort((a, b) => b.createdAtMs - a.createdAtMs);
          setMyRequests(items);
        },
        (error) => {
          if (!auth.currentUser) return;
          try {
            handleFirestoreError(error, OperationType.LIST, "topup_requests");
          } catch (wrapped: unknown) {
            if (wrapped instanceof Error) setFatalError(wrapped);
          }
        },
      );

      const txQuery = query(
        collection(db, "wallet_transactions"),
        where("userId", "==", profile.id),
      );
      unsubTx = onSnapshot(
        txQuery,
        (snapshot) => {
          const items = snapshot.docs.map((d) => mapTransactionDoc(d.id, d.data()));
          items.sort((a, b) => b.createdAtMs - a.createdAtMs);
          setMyTransactions(items);
        },
        (error) => {
          if (!auth.currentUser) return;
          try {
            handleFirestoreError(error, OperationType.LIST, "wallet_transactions");
          } catch (wrapped: unknown) {
            if (wrapped instanceof Error) setFatalError(wrapped);
          }
        },
      );
    }

    const settingsPath = "app_settings/wallet";
    const unsubSettings = onSnapshot(
      doc(db, "app_settings", "wallet"),
      (snapshot) => {
        setWalletSettings(mapWalletSettingsDoc(snapshot.exists() ? snapshot.data() : undefined));
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.GET, settingsPath);
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => {
      unsubRequests();
      unsubTx();
      unsubSettings();
    };
  }, [isLocked, isSuperUser, profile.id, section]);

  useEffect(() => {
    initialNotifLoadedRef.current = false;
    seenNotifIdsRef.current = {};

    const unreadQuery = query(
      collection(db, "notifications"),
      where("userId", "==", profile.id),
      where("is_read", "==", false),
    );
    const unsubUnread = onSnapshot(
      unreadQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapNotificationDoc(d.id, d.data()));
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setUnreadNotifications(items);

        if (!initialNotifLoadedRef.current) {
          for (const item of items) seenNotifIdsRef.current[item.id] = true;
          initialNotifLoadedRef.current = true;
          return;
        }

        for (const item of items) {
          if (seenNotifIdsRef.current[item.id]) continue;
          seenNotifIdsRef.current[item.id] = true;
          const viewingSameChat =
            item.type === "chat_message" &&
            effectiveSectionRef.current === "messages" &&
            effectiveActiveChatRef.current === item.requestId;
          if (viewingSameChat) continue;

          setToast(`إشعار جديد: ${item.title}`);
          window.setTimeout(() => setToast(""), 4200);
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              new Notification(item.title, {
                body: item.body || "لديك إشعار جديد في منصة دخل.",
              });
            } catch {
              // Ignore browser notification errors inside restricted iframes
            }
          }
        }
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "notifications");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => unsubUnread();
  }, [profile.id]);

  useEffect(() => {
    if (section !== "notifications" && !notifPopoverOpen) {
      setNotifications([]);
      return;
    }

    const notifQuery = query(collection(db, "notifications"), where("userId", "==", profile.id));
    const unsubNotifs = onSnapshot(
      notifQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapNotificationDoc(d.id, d.data()));
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setNotifications(items);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "notifications");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );
    return () => unsubNotifs();
  }, [notifPopoverOpen, profile.id, section]);

  useEffect(() => {
    if (section !== "messages") return;
    const chatNotifQuery = query(
      collection(db, "notifications"),
      where("userId", "==", profile.id),
      where("type", "==", "chat_message"),
    );
    const unsubChatNotifs = onSnapshot(
      chatNotifQuery,
      (snapshot) => {
        setLastMessageByRequestId((prev) => {
          const next = { ...prev };
          for (const d of snapshot.docs) {
            const item = mapNotificationDoc(d.id, d.data());
            if (!item.requestId || !item.body) continue;
            const existing = next[item.requestId];
            if (!existing || item.createdAtMs >= existing.createdAtMs) {
              next[item.requestId] = { text: item.body, createdAtMs: item.createdAtMs };
            }
          }
          return next;
        });
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "notifications");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );
    return () => unsubChatNotifs();
  }, [profile.id, section]);

  const needsConnections =
    isLocked || ["home", "discover", "messages", "assign", "notifications"].includes(section);

  useEffect(() => {
    if (!needsConnections) {
      setIncomingRequests([]);
      setOutgoingRequests([]);
      return;
    }

    const incomingConnQuery = query(
      collection(db, "connection_requests"),
      where("toUserId", "==", profile.id),
    );
    const unsubIncomingConn = onSnapshot(
      incomingConnQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapConnectionRequestDoc(d.id, d.data()));
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setIncomingRequests(items);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "connection_requests");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    const outgoingConnQuery = query(
      collection(db, "connection_requests"),
      where("fromUserId", "==", profile.id),
    );
    const unsubOutgoingConn = onSnapshot(
      outgoingConnQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapConnectionRequestDoc(d.id, d.data()));
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setOutgoingRequests(items);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "connection_requests");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => {
      unsubIncomingConn();
      unsubOutgoingConn();
    };
  }, [needsConnections, profile.id]);

  const shouldLoadAdminData =
    isSuperUser && (section === "admin" || section === "assign");

  useEffect(() => {
    if (!shouldLoadAdminData) {
      setAdminRequests([]);
      setAdminWallets({});
      setAdminWalletsReady(false);
      setAdminProfiles([]);
      return;
    }

    const unsubAllRequests = onSnapshot(
      collection(db, "topup_requests"),
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapTopupRequestDoc(d.id, d.data()));
        items.sort((a, b) => {
          if (a.status === "pending" && b.status !== "pending") return -1;
          if (a.status !== "pending" && b.status === "pending") return 1;
          return b.createdAtMs - a.createdAtMs;
        });
        setAdminRequests(items);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "topup_requests");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    const unsubAllWallets = onSnapshot(
      collection(db, "wallets"),
      (snapshot) => {
        const map: Record<string, WalletRecord> = {};
        for (const d of snapshot.docs) {
          map[d.id] = mapWalletDoc(d.id, d.data());
        }
        setAdminWallets(map);
        setAdminWalletsReady(true);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "wallets");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    const unsubAllProfiles = onSnapshot(
      collection(db, "profiles"),
      (snapshot) => {
        const missingMap: Record<string, boolean> = {};
        const list: DakhlProfile[] = snapshot.docs.map((d) => {
          const data = d.data();
          if (typeof data.account_type !== "string" || !data.account_type.trim()) {
            missingMap[d.id] = true;
          }
          return mapProfileDoc(d.id, data);
        });
        setMissingAccountTypeIds(missingMap);
        setAdminProfiles(list);
      },
      (error) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "profiles");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => {
      unsubAllRequests();
      unsubAllWallets();
      unsubAllProfiles();
    };
  }, [shouldLoadAdminData]);

  useEffect(() => {
    if (!isSuperUser || !adminWalletsReady) return;

    for (const userProfile of adminProfiles) {
      if (!userProfile.profile_completed) continue;
      const userWallet = adminWallets[userProfile.id];
      const isClientProfile = userProfile.account_type === "client";
      const expectedHasBalance = isClientProfile
        ? false
        : (userWallet?.balance_egp ?? 0) > 0 || (userWallet?.remaining_transactions ?? 0) > 0;
      const expectedWalletPriority = isClientProfile
        ? 0
        : computeWalletPriority(
            userWallet?.balance_egp ?? 0,
            userWallet?.remaining_transactions ?? 0,
          );
      const currentFlag = Boolean(userProfile.has_balance);
      const currentPriority = userProfile.wallet_priority ?? 0;
      const needsBalanceSync =
        currentFlag !== expectedHasBalance &&
        syncedBalanceFlagsRef.current[userProfile.id] !== expectedHasBalance;
      const needsPrioritySync =
        currentPriority !== expectedWalletPriority &&
        syncedWalletPriorityRef.current[userProfile.id] !== expectedWalletPriority;
      const needsTypeBackfill =
        Boolean(missingAccountTypeIds[userProfile.id]) &&
        !syncedAccountTypeRef.current[userProfile.id];

      if (needsBalanceSync || needsPrioritySync || needsTypeBackfill) {
        if (needsBalanceSync) {
          syncedBalanceFlagsRef.current[userProfile.id] = expectedHasBalance;
        }
        if (needsPrioritySync) {
          syncedWalletPriorityRef.current[userProfile.id] = expectedWalletPriority;
        }
        if (needsTypeBackfill) {
          syncedAccountTypeRef.current[userProfile.id] = true;
        }
        void syncProfileBalanceVisibility(
          userProfile.id,
          expectedHasBalance,
          needsTypeBackfill,
          expectedWalletPriority,
        ).catch((error: unknown) => {
          console.error("Background profile sync skipped for user:", userProfile.id, error);
        });
      }
    }
  }, [isSuperUser, adminWalletsReady, adminProfiles, adminWallets, missingAccountTypeIds]);

  const shouldLoadDirectory =
    !isLocked &&
    ["home", "discover", "assign"].includes(section) &&
    !(isSuperUser && section === "assign");

  useEffect(() => {
    if (!shouldLoadDirectory) return;
    const cacheIsFresh =
      directoryLoadedRef.current &&
      Date.now() - directoryFetchedAtRef.current < DIRECTORY_CACHE_TTL_MS;
    if (cacheIsFresh || directoryRequestInFlightRef.current) return;

    directoryRequestInFlightRef.current = true;
    setDirectoryLoading(true);
    setFundedProfiles([]);
    directoryCursorRef.current = null;
    setDirectoryHasMore(false);
    const firstPageQuery = query(
      collection(db, "profiles"),
      where("has_balance", "==", true),
      orderBy(documentId()),
      limit(DIRECTORY_PAGE_SIZE),
    );
    void getDocs(firstPageQuery)
      .then((snapshot) => {
        const list = snapshot.docs
          .map((d) => mapProfileDoc(d.id, d.data()))
          .filter((member) => member.account_type !== "client");
        setFundedProfiles(list);
        directoryLoadedRef.current = true;
        directoryFetchedAtRef.current = Date.now();
        directoryCursorRef.current =
          snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
        setDirectoryHasMore(snapshot.size === DIRECTORY_PAGE_SIZE);
      })
      .catch((error: unknown) => {
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(error, OperationType.LIST, "profiles");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      })
      .finally(() => {
        directoryRequestInFlightRef.current = false;
        setDirectoryLoading(false);
      });
  }, [shouldLoadDirectory]);

  const loadMoreDirectory = async () => {
    const cursor = directoryCursorRef.current;
    if (
      !cursor ||
      directoryLoading ||
      directoryRequestInFlightRef.current ||
      !directoryHasMore
    ) {
      return;
    }

    directoryRequestInFlightRef.current = true;
    setDirectoryLoading(true);
    try {
      const nextPageQuery = query(
        collection(db, "profiles"),
        where("has_balance", "==", true),
        orderBy(documentId()),
        startAfter(cursor),
        limit(DIRECTORY_PAGE_SIZE),
      );
      const snapshot = await getDocs(nextPageQuery);
      const list = snapshot.docs
        .map((d) => mapProfileDoc(d.id, d.data()))
        .filter((member) => member.account_type !== "client");
      setFundedProfiles((current) => [
        ...current,
        ...list.filter((member) => !current.some((existing) => existing.id === member.id)),
      ]);
      if (snapshot.docs.length > 0) {
        directoryCursorRef.current = snapshot.docs[snapshot.docs.length - 1];
      }
      setDirectoryHasMore(snapshot.size === DIRECTORY_PAGE_SIZE);
      directoryFetchedAtRef.current = Date.now();
    } catch (error: unknown) {
      if (!auth.currentUser) return;
      try {
        handleFirestoreError(error, OperationType.LIST, "profiles");
      } catch (wrapped: unknown) {
        if (wrapped instanceof Error) setFatalError(wrapped);
      }
    } finally {
      directoryRequestInFlightRef.current = false;
      setDirectoryLoading(false);
    }
  };

  const visibleDirectoryProfiles = useMemo(() => {
    const source = isSuperUser && section === "assign" ? adminProfiles : fundedProfiles;
    const list = source.filter((member) => {
      if (member.account_type === "client") return false;
      if (isSuperUser && section === "assign") {
        const w = adminWallets[member.id];
        return (w?.balance_egp ?? 0) > 0 || (w?.remaining_transactions ?? 0) > 0;
      }
      return Boolean(member.has_balance);
    });
    return [...list].sort((a, b) => {
      // 1) Review priority (average rating, then review count)
      const aHasReviews = (a.review_count ?? 0) > 0 && (a.review_score ?? 0) > 0;
      const bHasReviews = (b.review_count ?? 0) > 0 && (b.review_score ?? 0) > 0;
      const aReviewScore = aHasReviews ? (a.review_score ?? 0) : 0;
      const bReviewScore = bHasReviews ? (b.review_score ?? 0) : 0;
      if (bReviewScore !== aReviewScore) return bReviewScore - aReviewScore;

      const aReviewCount = a.review_count ?? 0;
      const bReviewCount = b.review_count ?? 0;
      if (bReviewCount !== aReviewCount) return bReviewCount - aReviewCount;

      // 2) Wallet balance priority (highest wallet balance first)
      const aWalletScore = isSuperUser && section === "assign"
        ? computeWalletPriority(
            adminWallets[a.id]?.balance_egp ?? 0,
            adminWallets[a.id]?.remaining_transactions ?? 0,
          )
        : (a.wallet_priority ?? 0);
      const bWalletScore = isSuperUser && section === "assign"
        ? computeWalletPriority(
            adminWallets[b.id]?.balance_egp ?? 0,
            adminWallets[b.id]?.remaining_transactions ?? 0,
          )
        : (b.wallet_priority ?? 0);
      if (bWalletScore !== aWalletScore) return bWalletScore - aWalletScore;

      // 3) Projects count, then display name
      const projectDiff = (b.projects?.length ?? 0) - (a.projects?.length ?? 0);
      if (projectDiff !== 0) return projectDiff;
      return a.display_name.localeCompare(b.display_name, "ar");
    });
  }, [isSuperUser, adminProfiles, fundedProfiles, adminWallets, section]);

  const filteredDirectoryProfiles = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return visibleDirectoryProfiles.filter((member) => {
      const tags = [...member.skills, ...member.interests];
      const haystack =
        `${member.display_name} ${member.username} ${member.city ?? ""} ${member.governorate ?? ""} ${member.bio ?? ""} ${tags.join(" ")}`.toLowerCase();
      const matchesSearch = !queryText || haystack.includes(queryText);
      const matchesFilter = matchesDirectoryCategory(member, activeFilter);
      return matchesSearch && matchesFilter;
    });
  }, [visibleDirectoryProfiles, activeFilter, search]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const unitPriceEgp = walletSettings.transaction_price_egp;
  const minTransactions = walletSettings.min_transactions;

  const openConnection = (member: DakhlProfile) => {
    if (member.id === profile.id) {
      showToast("لا يمكنك إرسال طلب تواصل إلى نفسك.");
      return;
    }
    if (isLocked) {
      setSection("wallet");
      showToast("يرجى شحن المحفظة أولًا لفتح التواصل.");
      return;
    }
    setConnectTarget(member);
    setDialog("connect");
  };

  const openPublish = () => {
    if (isLocked) {
      setSection("wallet");
      showToast("يرجى شحن المحفظة أولًا لإضافة فرصة.");
      return;
    }
    setDialog("publish");
  };

  const unreadNotifCount = unreadNotifications.length;
  const unreadChatCount = unreadNotifications.filter(
    (item) => !item.is_read && item.type === "chat_message",
  ).length;

  const requestsById = useMemo(() => {
    const map: Record<string, ConnectionRequestRecord> = {};
    for (const req of incomingRequests) {
      map[req.id] = req;
    }
    for (const req of outgoingRequests) {
      map[req.id] = req;
    }
    return map;
  }, [incomingRequests, outgoingRequests]);

  const outgoingStatusByTarget = useMemo(() => {
    const map: Record<string, ConnectionRequestStatus> = {};
    for (const req of outgoingRequests) {
      const current = map[req.toUserId];
      if (current === "accepted") continue;
      if (req.status === "accepted" || req.status === "pending" || !current) {
        map[req.toUserId] = req.status;
      }
    }
    return map;
  }, [outgoingRequests]);

  const acceptedThreads = useMemo<ChatThread[]>(() => {
    const unreadChatIds: Record<string, boolean> = {};
    for (const n of unreadNotifications) {
      if (n.type !== "chat_message" || !n.requestId) continue;
      unreadChatIds[n.requestId] = true;
    }

    const combined = [...incomingRequests, ...outgoingRequests]
      .filter((req) => req.status === "accepted")
      .sort(
        (a, b) =>
          (b.respondedAtMs ?? b.createdAtMs) - (a.respondedAtMs ?? a.createdAtMs) ||
          b.id.localeCompare(a.id),
      );

    const seenPartners: Record<string, boolean> = {};
    const list: ChatThread[] = [];
    for (const req of combined) {
      const incoming = req.toUserId === profile.id;
      const partnerId = incoming ? req.fromUserId : req.toUserId;
      if (!partnerId || seenPartners[partnerId]) continue;
      seenPartners[partnerId] = true;
      const partnerName = incoming ? req.fromDisplayName : req.toDisplayName;
      const partnerUsername = incoming ? req.fromUsername : req.toUsername;
      const baseMs = req.respondedAtMs ?? req.createdAtMs;
      const fromActive = lastMessageByRequestId[req.id];
      const latest = fromActive;
      const latestMessageMs = Math.max(
        baseMs,
        req.lastMessageAtMs ?? 0,
        latest && latest.createdAtMs >= baseMs ? latest.createdAtMs : 0,
      );
      const lastMs = latestMessageMs;
      const dealStatus: DealStatus = req.deal_status ?? "active";
      const deliveryCheckStatus: DeliveryCheckStatus = req.delivery_check_status ?? "pending";
      const deliveryCheckedAtMs = req.delivery_checked_at_ms ?? null;
      const checkInBaselineMs = Math.max(latestMessageMs, deliveryCheckedAtMs ?? 0);
      const inactiveDurationMs = Math.max(0, nowMs - checkInBaselineMs);
      const needsDeliveryCheckIn =
        dealStatus === "active" && inactiveDurationMs >= INACTIVITY_CHECKIN_MS;

      const lastText =
        dealStatus === "cancelled"
          ? "تم إلغاء المعاملة"
          : dealStatus === "delivered"
            ? "✓ تم تأكيد تسليم العمل"
            : latest && latest.createdAtMs >= baseMs
              ? latest.text
              : req.message || "تم قبول طلب التواصل";
      list.push({
        id: req.id,
        partnerId,
        partnerUsername,
        name: partnerName,
        last: lastText,
        time: formatArabicDate(lastMs),
        lastMs,
        avatar: getInitials(partnerName),
        tone: incoming ? "blue" : "rose",
        initialMessage: req.message || undefined,
        initialMessageSenderId: req.fromUserId,
        initialTime: formatArabicDate(req.createdAtMs),
        hasUnread: Boolean(unreadChatIds[req.id]) || needsDeliveryCheckIn,
        request: req,
        dealStatus,
        acceptedFeeEgp: req.accepted_fee_egp ?? unitPriceEgp,
        checkInBaselineMs,
        inactiveDurationMs,
        needsDeliveryCheckIn,
        deliveryCheckStatus,
        deliveryCheckedAtMs,
        deliveredAtMs: req.deliveredAtMs ?? null,
        cancelledAtMs: req.cancelledAtMs ?? null,
        refundedAmountEgp: req.refunded_amount_egp ?? null,
      });
    }
    list.sort((a, b) => b.lastMs - a.lastMs || b.id.localeCompare(a.id));
    return list;
  }, [
    incomingRequests,
    outgoingRequests,
    profile.id,
    unreadNotifications,
    lastMessageByRequestId,
    nowMs,
    unitPriceEgp,
  ]);

  const checkInPendingThreads = useMemo(
    () => acceptedThreads.filter((thread) => thread.needsDeliveryCheckIn),
    [acceptedThreads],
  );

  const canAccessSection = (target: Section) =>
    !isLocked || target === "wallet" || (target === "messages" && acceptedThreads.length > 0);

  const navigateTo = (target: Section) => {
    if (!canAccessSection(target)) {
      setSection("wallet");
      showToast(
        `كل الأقسام مقفولة حاليًا — اشحن رصيدك (${formatArabicNumber(minTransactions)} معاملات على الأقل) لفتح الحساب.`,
      );
      return;
    }
    setSection(target);
  };

  const effectiveActiveChatId = useMemo(() => {
    if (activeChat && acceptedThreads.some((thread) => thread.id === activeChat)) {
      return activeChat;
    }
    return acceptedThreads[0]?.id ?? null;
  }, [activeChat, acceptedThreads]);

  const activeThread = useMemo(
    () => acceptedThreads.find((thread) => thread.id === effectiveActiveChatId) ?? null,
    [acceptedThreads, effectiveActiveChatId],
  );

  const pendingAdminCount = adminRequests.filter((req) => req.status === "pending").length;
  const effectiveSection: Section = canAccessSection(section) ? section : "wallet";

  useEffect(() => {
    effectiveSectionRef.current = effectiveSection;
    effectiveActiveChatRef.current = effectiveActiveChatId;
  }, [effectiveSection, effectiveActiveChatId]);

  useEffect(() => {
    if (effectiveSection !== "messages" || !effectiveActiveChatId) {
      setChatMessages([]);
      setChatLoading(false);
      return;
    }

    setChatLoading(true);
    const messagesQuery = query(
      collection(db, "connection_requests", effectiveActiveChatId, "messages"),
      where("participants", "array-contains", profile.id),
    );
    const unsubMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => {
          const mapped = mapChatMessageDoc(d.id, d.data());
          if (mapped.createdAtMs === 0 && d.metadata.hasPendingWrites) {
            mapped.createdAtMs = Date.now();
          }
          return mapped;
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
        setChatMessages(list);
        setChatLoading(false);
        const lastMsg = list[list.length - 1];
        if (lastMsg) {
          setLastMessageByRequestId((prev) => {
            const current = prev[effectiveActiveChatId];
            if (
              current &&
              current.text === lastMsg.text &&
              current.createdAtMs === lastMsg.createdAtMs
            ) {
              return prev;
            }
            return {
              ...prev,
              [effectiveActiveChatId]: {
                text: lastMsg.text,
                createdAtMs: lastMsg.createdAtMs,
              },
            };
          });
        }
      },
      (error) => {
        setChatLoading(false);
        if (!auth.currentUser) return;
        try {
          handleFirestoreError(
            error,
            OperationType.LIST,
            `connection_requests/${effectiveActiveChatId}/messages`,
          );
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => unsubMessages();
  }, [effectiveSection, effectiveActiveChatId, profile.id]);

  useEffect(() => {
    if (effectiveSection !== "messages" || !effectiveActiveChatId) return;
    const unreadIds = unreadNotifications
      .filter(
        (n) => !n.is_read && n.type === "chat_message" && n.requestId === effectiveActiveChatId,
      )
      .map((n) => n.id);
    if (unreadIds.length > 0) {
      void markAllNotificationsRead(unreadIds).catch(() => {});
    }
  }, [effectiveSection, effectiveActiveChatId, unreadNotifications]);

  const sendMessage = async () => {
    const text = messageText.trim();
    if (!text || !activeThread || sendingMessage) return;

    setSendingMessage(true);
    setMessageText("");
    try {
      await sendChatMessage({
        requestId: activeThread.id,
        sender: profile,
        recipientId: activeThread.partnerId,
        text,
      });
    } catch (error: unknown) {
      setMessageText(text);
      if (error instanceof Error && error.message === "EMPTY_MESSAGE") {
        showToast("اكتب رسالة قبل الإرسال.");
      } else if (error instanceof Error) {
        setFatalError(error);
      }
    } finally {
      setSendingMessage(false);
    }
  };

  const openChatThread = (requestId?: string, partnerId?: string) => {
    if (requestId && acceptedThreads.some((t) => t.id === requestId)) {
      setActiveChat(requestId);
    } else if (partnerId) {
      const match = acceptedThreads.find((t) => t.partnerId === partnerId);
      if (match) setActiveChat(match.id);
    }
    navigateTo("messages");
  };

  const handleMarkNotifRead = async (notifId: string) => {
    try {
      await markNotificationRead(notifId);
    } catch (error: unknown) {
      if (error instanceof Error) setFatalError(error);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    const unreadIds = unreadNotifications.map((item) => item.id);
    if (unreadIds.length === 0) return;
    try {
      await markAllNotificationsRead(unreadIds);
      showToast("تم تحديد جميع الإشعارات كمقروءة.");
    } catch (error: unknown) {
      if (error instanceof Error) setFatalError(error);
    }
  };

  const handleRespondRequest = async (
    request: ConnectionRequestRecord,
    decision: "accepted" | "declined",
    relatedNotifId?: string,
  ) => {
    setRespondingRequestId(request.id);
    try {
      const result = await respondToConnectionRequest({
        request,
        responder: profile,
        decision,
        isSuperUser,
      });
      if (relatedNotifId) {
        void markNotificationRead(relatedNotifId).catch(() => {});
      }
      if (decision === "accepted") {
        if (result.remainingTransactions !== null) {
          showToast(
            `تم قبول طلب ${request.fromDisplayName} وخصم ${formatArabicNumber(result.deductedEgp)} ج.م (معاملة واحدة) — المتبقي: ${formatArabicNumber(result.remainingTransactions)}.`,
          );
        } else {
          showToast(
            `تم قبول طلب ${request.fromDisplayName} وإرسال إشعار له — يمكنكما المتابعة في «الرسائل».`,
          );
        }
      } else {
        showToast(`تم رفض طلب ${request.fromDisplayName} وإبلاغه بذلك.`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "REQUEST_ALREADY_RESPONDED") {
        showToast("تم الرد على هذا الطلب مسبقًا.");
      } else if (error instanceof Error && error.message === "INSUFFICIENT_TRANSACTIONS") {
        showToast("رصيد المعاملات غير كافٍ — يرجى شحن المحفظة أولًا لقبول الطلب.");
      } else if (error instanceof Error) {
        setFatalError(error);
      }
    } finally {
      setRespondingRequestId(null);
    }
  };

  const handleMarkNotDeliveredYet = async (request: ConnectionRequestRecord) => {
    setDealActionBusyId(request.id);
    try {
      await markDealNotDeliveredYet({ request, actor: profile });
      setNowMs(Date.now());
      showToast("تم تسجيل أن التسليم لم يتم بعد — تستمر المعاملة نشطة.");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "DEAL_ALREADY_DELIVERED") {
        showToast("تم تأكيد تسليم هذه المعاملة مسبقًا.");
      } else if (error instanceof Error && error.message === "DEAL_ALREADY_CANCELLED") {
        showToast("تم إلغاء هذه المعاملة مسبقًا.");
      } else if (error instanceof Error) {
        setFatalError(error);
      }
    } finally {
      setDealActionBusyId(null);
    }
  };

  const handleConfirmDelivery = async (request: ConnectionRequestRecord) => {
    setDealActionBusyId(request.id);
    try {
      await confirmDealDelivery({ request, actor: profile });
      setNowMs(Date.now());
      showToast("تم تأكيد تسليم العمل — المعاملة مكتملة ولا تُرد الرسوم بعد التسليم.");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "DEAL_ALREADY_DELIVERED") {
        showToast("تم تأكيد تسليم هذه المعاملة مسبقًا.");
      } else if (error instanceof Error && error.message === "DEAL_ALREADY_CANCELLED") {
        showToast("تم إلغاء هذه المعاملة مسبقًا.");
      } else if (error instanceof Error) {
        setFatalError(error);
      }
    } finally {
      setDealActionBusyId(null);
    }
  };

  const handleCancelDeal = async (request: ConnectionRequestRecord) => {
    setDealActionBusyId(request.id);
    try {
      const result = await cancelConnectionDeal({ request, actor: profile });
      setNowMs(Date.now());
      if (result.refundedTransaction && result.refundedEgp > 0) {
        showToast(
          `تم إلغاء المعاملة وإرجاع ${formatArabicNumber(result.refundedEgp)} ج.م ومعاملة واحدة لمحفظة المستقل بنجاح.`,
        );
      } else if (result.refundedTransaction) {
        showToast("تم إلغاء المعاملة وإعادة معاملة واحدة لمحفظة المستقل.");
      } else {
        showToast("تم إلغاء المعاملة وإغلاق المحادثة.");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "CANNOT_CANCEL_DELIVERED") {
        showToast("تم التسليم بالفعل — لا يمكن إلغاء المعاملة أو استرداد الرسوم بعد التسليم.");
      } else if (error instanceof Error && error.message === "DEAL_ALREADY_CANCELLED") {
        showToast("تم إلغاء هذه المعاملة مسبقًا.");
      } else if (error instanceof Error) {
        setFatalError(error);
      }
    } finally {
      setDealActionBusyId(null);
    }
  };

  const handleEnableBrowserNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      showToast("متصفحك لا يدعم تنبيهات سطح المكتب.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setBrowserNotifPermission(permission);
      if (permission === "granted") {
        showToast("تم تفعيل تنبيهات المتصفح الفورية بنجاح.");
      } else {
        showToast("لم يتم السماح بتنبيهات المتصفح — ستصل الإشعارات داخل المنصة مباشرة.");
      }
    } catch {
      showToast("تعذّر طلب إذن تنبيهات المتصفح.");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigateTo("home")} aria-label="العودة للرئيسية">
          <span className="brand-logo-window">
            <img className="brand-logo" src={logo} alt="DAKHL" />
          </span>
        </button>
        <label className="global-search">
          <Search size={18} />
          <input
            value={search}
            disabled={isLocked}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              isLocked
                ? "الحساب مقفول حتى شحن المحفظة..."
                : "ابحث عن مهارة، فرصة، أو شخص..."
            }
          />
        </label>
        <div className="top-actions">
          <button className="create-button" onClick={openPublish}>
            {isLocked ? <Lock size={16} /> : <Plus size={17} />}
            <span>أضف فرصة</span>
          </button>
          <div className="notif-bell-wrap" ref={notifContainerRef}>
            <button
              type="button"
              className={`notif-bell-button ${notifPopoverOpen || effectiveSection === "notifications" ? "active" : ""}`}
              aria-label="الإشعارات"
              title="الإشعارات"
              onClick={() => {
                if (isLocked) {
                  navigateTo("notifications");
                  return;
                }
                setNotifPopoverOpen((open) => !open);
              }}
            >
              <Bell size={17} />
              {unreadNotifCount > 0 && (
                <span className="notif-badge-dot">
                  {unreadNotifCount > 99 ? "99+" : formatArabicNumber(unreadNotifCount)}
                </span>
              )}
            </button>
            {notifPopoverOpen && !isLocked && (
              <div className="notif-popover" role="region" aria-label="أحدث الإشعارات">
                <div className="notif-popover-head">
                  <strong>
                    الإشعارات{" "}
                    {unreadNotifCount > 0
                      ? `(${formatArabicNumber(unreadNotifCount)} جديدة)`
                      : ""}
                  </strong>
                  {unreadNotifCount > 0 && (
                    <button
                      type="button"
                      className="text-link"
                      style={{ border: 0, background: "none", padding: 0 }}
                      onClick={() => void handleMarkAllNotifsRead()}
                    >
                      تحديد الكل كمقروء
                    </button>
                  )}
                </div>
                <div className="notif-popover-list">
                  {notifications.length > 0 ? (
                    notifications.slice(0, 6).map((notif) => (
                      <button
                        key={notif.id}
                        type="button"
                        className={`notif-popover-item ${notif.is_read ? "" : "unread"}`}
                        onClick={() => {
                          if (!notif.is_read) {
                            void handleMarkNotifRead(notif.id);
                          }
                          setNotifPopoverOpen(false);
                          if (
                            (notif.type === "chat_message" ||
                              notif.type === "request_accepted" ||
                              notif.type === "deal_delivered" ||
                              notif.type === "deal_cancelled") &&
                            notif.requestId
                          ) {
                            openChatThread(notif.requestId);
                          } else {
                            navigateTo("notifications");
                          }
                        }}
                      >
                        <div className="notif-popover-item-title">
                          <span>{notif.title}</span>
                          {!notif.is_read && (
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: "var(--green)",
                                flex: "none",
                              }}
                            />
                          )}
                        </div>
                        <span className="notif-popover-item-body">{notif.body}</span>
                        <time>{formatArabicDate(notif.createdAtMs)}</time>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state" style={{ margin: 12, padding: 18 }}>
                      لا توجد إشعارات بعد. ستظهر هنا فور وصول طلبات عملاء أو ردود.
                    </div>
                  )}
                </div>
                <div className="notif-popover-foot">
                  <button
                    type="button"
                    className="connect-button"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      setNotifPopoverOpen(false);
                      navigateTo("notifications");
                    }}
                  >
                    عرض كل الإشعارات <ArrowLeft size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className="top-avatar"
            onClick={() => navigateTo("profile")}
            aria-label="ملفي الشخصي"
          >
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : getInitials(profile.display_name)}
          </button>
          <button
            className="logout-button"
            onClick={() => void onSignOut()}
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="page-layout">
        <aside className="right-sidebar">
          <div className="sidebar-profile">
            <div className="profile-avatar">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : getInitials(profile.display_name)}
            </div>
            <div className="sidebar-profile-copy">
              <strong>{profile.display_name}</strong>
              <span>
                {isSuperUser
                  ? "الإدارة · Superuser"
                  : isClient
                    ? "صاحب مشروع (عميل)"
                    : [profile.city, profile.governorate].filter(Boolean).join("، ") ||
                      `مستقل · ${experienceLabel(profile.experience_level)}`}
              </span>
            </div>
          </div>
          <div className="side-label">القائمة</div>
          <nav className="side-nav" aria-label="التنقل الرئيسي">
            {navItems.map((item) => {
              const Icon = item.icon;
              const itemLocked = !canAccessSection(item.id);
              return (
                <button
                  key={item.id}
                  className={`nav-link ${effectiveSection === item.id ? "active" : ""}`}
                  onClick={() => navigateTo(item.id)}
                >
                  <Icon size={19} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {itemLocked && <Lock size={14} style={{ marginRight: "auto", opacity: 0.65 }} />}
                  {!itemLocked &&
                    item.id === "messages" &&
                    (unreadChatCount > 0 || checkInPendingThreads.length > 0) && (
                      <span
                        style={{
                          marginRight: "auto",
                          background: checkInPendingThreads.length > 0 ? "#b86b1b" : "#244e41",
                          color: "#ffffff",
                          borderRadius: 99,
                          padding: "1px 7px",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {formatArabicNumber(unreadChatCount + checkInPendingThreads.length)}
                      </span>
                    )}
                  {!itemLocked && item.id === "notifications" && unreadNotifCount > 0 && (
                    <span
                      style={{
                        marginRight: "auto",
                        background: "#d75247",
                        color: "#ffffff",
                        borderRadius: 99,
                        padding: "1px 7px",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {formatArabicNumber(unreadNotifCount)}
                    </span>
                  )}
                  {item.id === "admin" && pendingAdminCount > 0 && (
                    <span
                      style={{
                        marginRight: "auto",
                        background: "#d7ee8f",
                        color: "#143f32",
                        borderRadius: 99,
                        padding: "1px 7px",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {formatArabicNumber(pendingAdminCount)}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-divider" />
          <button
            className={`nav-link ${effectiveSection === "profile" ? "active" : ""}`}
            onClick={() => navigateTo("profile")}
          >
            <FileText size={19} strokeWidth={1.8} />
            <span>ملفي الشخصي</span>
            {isLocked && <Lock size={14} style={{ marginRight: "auto", opacity: 0.65 }} />}
          </button>
        </aside>

        <main className="main-content">
          <div className="mobile-greeting">
            <h1>أهلًا، {profile.display_name}</h1>
          </div>
          {effectiveSection !== "home" && (
            <div className="content-heading">
              <div>
                <h1>
                  {isLocked && effectiveSection === "wallet"
                    ? "تفعيل الحساب والمحفظة"
                    : sectionTitles[effectiveSection]}
                </h1>
              </div>
            </div>
          )}

          {!walletReady && !isSuperUser && !isClient ? (
            <div className="empty-state">جارٍ التحقق من حالة المحفظة...</div>
          ) : isLocked && effectiveSection === "wallet" ? (
            <WalletContent
              isLocked
              isClient={false}
              wallet={wallet}
              unitPriceEgp={unitPriceEgp}
              minTransactions={minTransactions}
              requests={myRequests}
              transactions={myTransactions}
              onTopup={() => setDialog("topup")}
              onPreviewReceipt={setReceiptPreviewUrl}
            />
          ) : (
            <>
              {effectiveSection === "home" && (
                <HomeContent
                  profile={profile}
                  search={search}
                  setSearch={setSearch}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  filteredMembers={filteredDirectoryProfiles}
                  loadingMembers={directoryLoading}
                  outgoingStatusByTarget={outgoingStatusByTarget}
                  setSection={navigateTo}
                  onConnect={(member) => openConnection(member)}
                  onOpenMessages={(partnerId?: string) => openChatThread(undefined, partnerId)}
                  onPreviewProfile={setPreviewProfile}
                  saved={saved}
                  setSaved={setSaved}
                  onPublish={openPublish}
                  onOpenOpportunity={() => navigateTo("opportunities")}
                />
              )}
              {effectiveSection === "discover" && (
                <DiscoverContent
                  currentUserId={profile.id}
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  members={filteredDirectoryProfiles}
                  search={search}
                  setSearch={setSearch}
                  outgoingStatusByTarget={outgoingStatusByTarget}
                  onConnect={(member) => openConnection(member)}
                  onOpenMessages={(partnerId?: string) => openChatThread(undefined, partnerId)}
                  onPreviewProfile={setPreviewProfile}
                  saved={saved}
                  setSaved={setSaved}
                  hasMore={directoryHasMore}
                  loadingMore={directoryLoading}
                  onLoadMore={() => void loadMoreDirectory()}
                />
              )}
              {effectiveSection === "opportunities" && (
                <OpportunitiesContent onSave={(title) => showToast(`تم حفظ «${title}» للمراجعة`)} />
              )}
              {effectiveSection === "messages" && (
                <MessagesContent
                  currentUserId={profile.id}
                  chats={acceptedThreads}
                  activeChat={effectiveActiveChatId}
                  setActiveChat={setActiveChat}
                  messages={chatMessages}
                  loadingMessages={chatLoading}
                  messageText={messageText}
                  setMessageText={setMessageText}
                  sendingMessage={sendingMessage}
                  dealActionBusyId={dealActionBusyId}
                  onSend={() => void sendMessage()}
                  onMarkNotDelivered={(req) => void handleMarkNotDeliveredYet(req)}
                  onConfirmDelivery={(req) => void handleConfirmDelivery(req)}
                  onCancelDeal={(req) => void handleCancelDeal(req)}
                />
              )}
              {effectiveSection === "assign" && (
                <AssignContent
                  currentUserId={profile.id}
                  isSuperUser={isSuperUser}
                  profiles={visibleDirectoryProfiles}
                  wallets={adminWallets}
                  outgoingStatusByTarget={outgoingStatusByTarget}
                  search={search}
                  setSearch={setSearch}
                  saved={saved}
                  setSaved={setSaved}
                  onConnect={(member) => openConnection(member)}
                  onOpenMessages={(partnerId?: string) => openChatThread(undefined, partnerId)}
                  onPreviewProfile={setPreviewProfile}
                  onOpenManualCredit={setManualCreditTarget}
                  hasMore={directoryHasMore}
                  loadingMore={directoryLoading}
                  onLoadMore={() => void loadMoreDirectory()}
                />
              )}
              {effectiveSection === "notifications" && (
                <NotificationsContent
                  currentUserId={profile.id}
                  notifications={notifications}
                  requestsById={requestsById}
                  checkInPendingThreads={checkInPendingThreads}
                  respondingRequestId={respondingRequestId}
                  browserNotifPermission={browserNotifPermission}
                  onEnableBrowserNotifs={() => void handleEnableBrowserNotifications()}
                  onMarkRead={(id) => void handleMarkNotifRead(id)}
                  onMarkAllRead={() => void handleMarkAllNotifsRead()}
                  onRespondRequest={(req, decision, notifId) =>
                    void handleRespondRequest(req, decision, notifId)
                  }
                  onOpenAssign={() => navigateTo("assign")}
                  onOpenMessages={(reqId?: string) => openChatThread(reqId)}
                />
              )}
              {effectiveSection === "wallet" && (
                <WalletContent
                  isLocked={false}
                  isClient={isClient}
                  wallet={wallet}
                  unitPriceEgp={unitPriceEgp}
                  minTransactions={minTransactions}
                  requests={myRequests}
                  transactions={myTransactions}
                  onTopup={() => setDialog("topup")}
                  onPreviewReceipt={setReceiptPreviewUrl}
                />
              )}
              {effectiveSection === "profile" && (
                <ProfileContent
                  profile={profile}
                  onPreviewImage={(url, title) => setLightboxImage({ url, title })}
                  onNotify={showToast}
                  onFatalError={setFatalError}
                />
              )}
              {effectiveSection === "admin" && isSuperUser && (
                <AdminContent
                  adminUid={profile.id}
                  unitPriceEgp={unitPriceEgp}
                  minTransactions={minTransactions}
                  requests={adminRequests}
                  profiles={adminProfiles}
                  wallets={adminWallets}
                  onPreviewReceipt={setReceiptPreviewUrl}
                  onOpenManualCredit={setManualCreditTarget}
                  onNotify={showToast}
                  onFatalError={setFatalError}
                />
              )}
            </>
          )}
        </main>

        <aside className="left-sidebar">
          <div className="balance-card">
            <div className="balance-card-top">
              <span>
                {isSuperUser ? "حساب الإدارة" : isClient ? "حساب عميل" : "رصيد المحفظة"}
              </span>
              <span className="wallet-icon">
                <Wallet size={17} />
              </span>
            </div>
            <strong>
              {isSuperUser ? (
                <>
                  مفعل <small>Superuser</small>
                </>
              ) : isClient ? (
                <>
                  مفتوح <small>صاحب مشروع</small>
                </>
              ) : (
                <>
                  {formatArabicNumber(wallet.balance_egp)} <small>ج.م</small>
                </>
              )}
            </strong>
            {!isSuperUser && !isClient && (
              <div style={{ fontSize: 11, color: "#c7d7cd", marginTop: 4 }}>
                المعاملات المتاحة: {formatArabicNumber(wallet.remaining_transactions)}
              </div>
            )}
            {isClient && (
              <div style={{ fontSize: 11, color: "#58715b", marginTop: 4 }}>
                حسابك مفتوح ولا يظهر في «تعيين»
              </div>
            )}
            <button
              onClick={() =>
                isSuperUser
                  ? navigateTo("admin")
                  : isClient
                    ? navigateTo("assign")
                    : navigateTo("wallet")
              }
            >
              {isSuperUser ? (
                <>
                  إدارة الطلبات
                  {section === "admin" && ` (${formatArabicNumber(pendingAdminCount)})`}
                </>
              ) : isClient ? (
                <>
                  تصفح المستقلين <ArrowLeft size={15} />
                </>
              ) : (
                <>
                  طلب شحن رصيد <Plus size={15} />
                </>
              )}
            </button>
          </div>
          <div className="fee-note">
            <h3>رسوم المعاملات</h3>
            <p>افتح المحفظة لمعرفة رسوم المعاملات الحالية وشروط الشحن.</p>
          </div>
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>بياناتك الخاصة، مثل رقم هاتفك، لا تظهر على ملفك العام.</span>
          </div>
        </aside>
      </div>

      <nav className="mobile-nav" aria-label="التنقل">
        {baseNavItems.map((item) => {
          const Icon = item.icon;
          const itemLocked = !canAccessSection(item.id);
          return (
            <button
              key={item.id}
              className={effectiveSection === item.id ? "active" : ""}
              onClick={() => navigateTo(item.id)}
            >
              <span className="mobile-nav-icon-wrap">
                {itemLocked ? <Lock size={18} /> : <Icon size={20} />}
                {!itemLocked &&
                  ((item.id === "notifications" && unreadNotifCount > 0) ||
                    (item.id === "messages" &&
                      (unreadChatCount > 0 || checkInPendingThreads.length > 0))) && (
                    <span className="mobile-nav-dot" />
                  )}
              </span>
              <span>
                {item.label === "اكتشف أشخاصًا"
                  ? "اكتشف"
                  : item.label === "فرص مناسبة لك"
                    ? "الفرص"
                    : item.label}
              </span>
            </button>
          );
        })}
        {isSuperUser && (
          <button
            className={effectiveSection === "admin" ? "active" : ""}
            onClick={() => navigateTo("admin")}
          >
            <ShieldCheck size={20} />
            <span>الإدارة</span>
          </button>
        )}
      </nav>

      {dialog === "topup" && (
        <TopupRequestDialog
          profile={profile}
          userEmail={authMeta.email}
          unitPriceEgp={unitPriceEgp}
          minTransactions={minTransactions}
          onClose={() => setDialog(null)}
          onSuccess={() => {
            setDialog(null);
            showToast("تم إرسال طلب الشحن وإرفاق صورة التحويل بنجاح — بانتظار مراجعة الإدارة.");
          }}
          onFatalError={setFatalError}
        />
      )}

      {dialog === "connect" && connectTarget && (
        <ConnectRequestDialog
          sender={profile}
          target={connectTarget}
          unitPriceEgp={unitPriceEgp}
          onClose={() => {
            setDialog(null);
            setConnectTarget(null);
          }}
          onSuccess={() => {
            const targetName = connectTarget.display_name;
            setDialog(null);
            setConnectTarget(null);
            showToast(`تم إرسال طلب التواصل وإشعار ${targetName} بنجاح.`);
          }}
          onFatalError={setFatalError}
        />
      )}

      {dialog === "publish" && (
        <Dialog
          onClose={() => setDialog(null)}
          onConfirm={() => {
            showToast("نشر الفرص قيد التفعيل.");
            setDialog(null);
          }}
        />
      )}

      {manualCreditTarget && isSuperUser && (
        <ManualCreditDialog
          target={manualCreditTarget}
          adminUid={profile.id}
          unitPriceEgp={unitPriceEgp}
          minTransactions={minTransactions}
          currentWallet={adminWallets[manualCreditTarget.id]}
          onClose={() => setManualCreditTarget(null)}
          onSuccess={(addedTx, addedEgp) => {
            setManualCreditTarget(null);
            showToast(
              `تمت إضافة ${formatArabicNumber(addedTx)} معاملات (${formatArabicNumber(addedEgp)} ج.م) لحساب ${manualCreditTarget.display_name}.`,
            );
          }}
          onFatalError={setFatalError}
        />
      )}

      {receiptPreviewUrl && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReceiptPreviewUrl(null);
          }}
        >
          <section className="dialog-card" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
            <button
              className="dialog-close"
              onClick={() => setReceiptPreviewUrl(null)}
              aria-label="إغلاق"
            >
              <X size={19} />
            </button>
            <h2 style={{ marginTop: 4 }}>صورة إيصال التحويل</h2>
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid var(--line)",
                background: "#f7f8f6",
              }}
            >
              <img
                src={receiptPreviewUrl}
                alt="صورة إيصال التحويل"
                style={{ display: "block", width: "100%", maxHeight: "65vh", objectFit: "contain" }}
              />
            </div>
          </section>
        </div>
      )}

      {lightboxImage && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLightboxImage(null);
          }}
        >
          <section className="dialog-card" role="dialog" aria-modal="true" style={{ maxWidth: 640 }}>
            <button
              className="dialog-close"
              onClick={() => setLightboxImage(null)}
              aria-label="إغلاق"
            >
              <X size={19} />
            </button>
            <h2 style={{ marginTop: 4 }}>{lightboxImage.title}</h2>
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid var(--line)",
                background: "#f7f8f6",
              }}
            >
              <img
                src={lightboxImage.url}
                alt={lightboxImage.title}
                style={{ display: "block", width: "100%", maxHeight: "70vh", objectFit: "contain" }}
              />
            </div>
          </section>
        </div>
      )}

      {previewProfile && (
        <ProfilePreviewDialog
          member={previewProfile}
          currentUserId={profile.id}
          isSuperUser={isSuperUser}
          outgoingStatus={outgoingStatusByTarget[previewProfile.id]}
          onClose={() => setPreviewProfile(null)}
          onConnect={(member) => {
            setPreviewProfile(null);
            openConnection(member);
          }}
          onOpenMessages={() => {
            const partnerId = previewProfile.id;
            setPreviewProfile(null);
            openChatThread(undefined, partnerId);
          }}
          onPreviewImage={(url, title) => setLightboxImage({ url, title })}
        />
      )}

      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function HomeContent(props: {
  profile: DakhlProfile;
  search: string;
  setSearch: (value: string) => void;
  activeFilter: string;
  setActiveFilter: (value: string) => void;
  filteredMembers: DakhlProfile[];
  loadingMembers: boolean;
  outgoingStatusByTarget: Record<string, ConnectionRequestStatus>;
  setSection: (section: Section) => void;
  onConnect: (member: DakhlProfile) => void;
  onOpenMessages: (partnerId?: string) => void;
  onPreviewProfile: (member: DakhlProfile) => void;
  saved: string[];
  setSaved: (value: string[] | ((current: string[]) => string[])) => void;
  onPublish: () => void;
  onOpenOpportunity: () => void;
}) {
  const filters = DIRECTORY_CATEGORIES.slice(0, 6).map((item) => item.id);
  const profileLocation =
    [props.profile.city, props.profile.governorate].filter(Boolean).join("، ") || "ملفك الشخصي";
  const badgeItems =
    props.profile.skills.length > 0
      ? props.profile.skills.slice(0, 3)
      : props.profile.interests.slice(0, 3);

  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <h2>من مهارتك، يبدأ دخلُك.</h2>
          <p>فرص عمل ومشاريع تناسب مهاراتك.</p>
          <div className="welcome-actions">
            <button className="banner-primary" onClick={() => props.setSection("opportunities")}>
              شاهد الفرص <ArrowLeft size={16} />
            </button>
            <button className="banner-link" onClick={props.onPublish}>
              <Plus size={15} /> أضف فرصة
            </button>
          </div>
        </div>
        <div className="banner-art" aria-label="ملخص ملفك الشخصي">
          <div
            className="opportunity-ticket"
            role="button"
            tabIndex={0}
            onClick={() => props.setSection("profile")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.setSection("profile");
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <div className="ticket-top">
              <span className="ticket-mark">{getInitials(props.profile.display_name)}</span>
              <span className="ticket-status">{experienceLabel(props.profile.experience_level)}</span>
            </div>
            <span className="ticket-caption">{profileLocation}</span>
            <strong>{props.profile.display_name}</strong>
            <div className="ticket-skills">
              {badgeItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="ticket-bottom">
              <span dir="ltr">@{props.profile.username}</span>
              <ArrowLeft size={15} />
            </div>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-title-row">
          <h2>أشخاص قد يهمّك التعرف عليهم</h2>
          <button className="text-link" onClick={() => props.setSection("discover")}>
            اكتشف الجميع <ArrowLeft size={15} />
          </button>
        </div>
        <div className="filter-row" style={{ flexWrap: "wrap" }}>
          <label className="inline-search">
            <Search size={16} />
            <input
              value={props.search}
              onChange={(event) => props.setSearch(event.target.value)}
              placeholder="ابحث بالاسم أو المهارة"
            />
          </label>
          {filters.map((filter) => (
            <button
              key={filter}
              className={`filter-chip ${props.activeFilter === filter ? "selected" : ""}`}
              onClick={() => props.setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="people-grid">
          {props.filteredMembers.slice(0, 3).map((member) => (
            <MemberDirectoryCard
              key={member.id}
              member={member}
              currentUserId={props.profile.id}
              outgoingStatus={props.outgoingStatusByTarget[member.id]}
              saved={props.saved.includes(member.id)}
              onToggleSave={() =>
                props.setSaved((current) =>
                  current.includes(member.id)
                    ? current.filter((id) => id !== member.id)
                    : [...current, member.id],
                )
              }
              onConnect={props.onConnect}
              onOpenMessages={props.onOpenMessages}
              onPreviewProfile={props.onPreviewProfile}
            />
          ))}
          {props.filteredMembers.length === 0 && (
            <div className="empty-state">
              {props.loadingMembers
                ? "جارٍ تحميل المستقلين..."
                : props.search.trim() || props.activeFilter !== "الكل"
                ? "لا توجد نتائج مطابقة. جرّب كلمة بحث أخرى."
                : "لا يوجد أعضاء متاحون للعرض حاليًا."}
            </div>
          )}
        </div>
      </section>

      <section className="section-block opportunity-preview">
        <div className="section-title-row">
          <h2>فرص بدأت للتو</h2>
          <button className="text-link" onClick={() => props.setSection("opportunities")}>
            كل الفرص <ArrowLeft size={15} />
          </button>
        </div>
        {opportunities.length > 0 ? (
          opportunities
            .slice(0, 2)
            .map((opportunity) => (
              <OpportunityRow
                key={opportunity.id}
                opportunity={opportunity}
                onOpen={props.onOpenOpportunity}
              />
            ))
        ) : (
          <div className="empty-state">لا توجد فرص منشورة حاليًا.</div>
        )}
      </section>
    </>
  );
}

function DiscoverContent(props: {
  currentUserId: string;
  activeFilter: string;
  setActiveFilter: (value: string) => void;
  members: DakhlProfile[];
  search: string;
  setSearch: (value: string) => void;
  outgoingStatusByTarget: Record<string, ConnectionRequestStatus>;
  onConnect: (member: DakhlProfile) => void;
  onOpenMessages: (partnerId?: string) => void;
  onPreviewProfile: (member: DakhlProfile) => void;
  saved: string[];
  setSaved: (value: string[] | ((current: string[]) => string[])) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section className="section-block discover-page" style={{ marginTop: 0 }}>
      <div className="discover-toolbar">
        <div className="filter-row" style={{ flexWrap: "wrap", width: "100%" }}>
          <label className="inline-search">
            <Search size={16} />
            <input
              value={props.search}
              onChange={(event) => props.setSearch(event.target.value)}
              placeholder="ابحث بالاسم، التخصص، أو المهارة"
            />
          </label>
          {DIRECTORY_CATEGORIES.map((category) => (
            <button
              key={category.id}
              className={`filter-chip ${props.activeFilter === category.id ? "selected" : ""}`}
              onClick={() => props.setActiveFilter(category.id)}
            >
              {category.id}
            </button>
          ))}
        </div>
      </div>
      <div className="people-grid">
        {props.members.map((member) => (
          <MemberDirectoryCard
            key={member.id}
            member={member}
            currentUserId={props.currentUserId}
            outgoingStatus={props.outgoingStatusByTarget[member.id]}
            saved={props.saved.includes(member.id)}
            onToggleSave={() =>
              props.setSaved((current) =>
                current.includes(member.id)
                  ? current.filter((id) => id !== member.id)
                  : [...current, member.id],
              )
            }
            onConnect={props.onConnect}
            onOpenMessages={props.onOpenMessages}
            onPreviewProfile={props.onPreviewProfile}
          />
        ))}
        {props.members.length === 0 && (
          <div className="empty-state">
            {props.loadingMore
              ? "جارٍ تحميل المستقلين..."
              : props.search.trim() || props.activeFilter !== "الكل"
              ? "لا توجد نتائج مطابقة لهذا التصنيف."
              : "لا يوجد أعضاء متاحون للاكتشاف حاليًا."}
          </div>
        )}
      </div>
      {props.hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
          <button
            type="button"
            className="primary-button"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            {props.loadingMore ? "جارٍ التحميل..." : "عرض المزيد من المستقلين"}
          </button>
        </div>
      )}
    </section>
  );
}

function MemberDirectoryCard({
  member,
  currentUserId,
  outgoingStatus,
  saved,
  onToggleSave,
  onConnect,
  onOpenMessages,
  onPreviewProfile,
}: {
  member: DakhlProfile;
  currentUserId: string;
  outgoingStatus?: ConnectionRequestStatus;
  saved: boolean;
  onToggleSave: () => void;
  onConnect: (member: DakhlProfile) => void;
  onOpenMessages: (partnerId?: string) => void;
  onPreviewProfile: (member: DakhlProfile) => void;
}) {
  const locationText = [member.city, member.governorate].filter(Boolean).join("، ") || "غير محدد";
  const tags = Array.from(new Set([...member.skills, ...member.interests]));

  return (
    <article className="person-card">
      <div className="person-card-top">
        <div className="person-avatar blue" style={{ overflow: "hidden" }}>
          {member.avatar_url ? (
            <img
              src={member.avatar_url}
              alt={member.display_name}
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
            />
          ) : (
            getInitials(member.display_name)
          )}
        </div>
        <button
          className={`save-button ${saved ? "saved" : ""}`}
          aria-label={saved ? "إزالة من المحفوظات" : "حفظ الملف"}
          onClick={onToggleSave}
        >
          <Heart size={17} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="person-name-row">
        <h3>{member.display_name}</h3>
      </div>
      <p className="person-role">
        @{member.username} · {experienceLabel(member.experience_level)}
      </p>
      <div className="person-location">
        <MapPin size={14} />
        {locationText}
        {(member.projects?.length ?? 0) > 0 && (
          <span style={{ marginRight: "auto", color: "#24543c", fontWeight: 600 }}>
            {formatArabicNumber(member.projects?.length ?? 0)} مشاريع
          </span>
        )}
      </div>
      <div className="skill-list">
        {tags.slice(0, 4).map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>
      <div className="person-card-footer">
        <button
          type="button"
          className="connect-button"
          onClick={() => onPreviewProfile(member)}
        >
          <Eye size={14} /> عرض الأعمال
        </button>
        {member.id === currentUserId ? (
          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
            ملفك الشخصي
          </span>
        ) : outgoingStatus === "accepted" ? (
          <button
            type="button"
            className="connect-button"
            onClick={() => onOpenMessages(member.id)}
          >
            تم القبول · المحادثات <ArrowLeft size={14} />
          </button>
        ) : outgoingStatus === "pending" ? (
          <span style={{ fontSize: 10, color: "#67766c", fontWeight: 600 }}>
            تم إرسال الطلب
          </span>
        ) : (
          <button className="connect-button" onClick={() => onConnect(member)}>
            تواصل <ArrowLeft size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

function AssignContent({
  currentUserId,
  isSuperUser,
  profiles,
  wallets,
  outgoingStatusByTarget,
  search,
  setSearch,
  saved,
  setSaved,
  onConnect,
  onOpenMessages,
  onPreviewProfile,
  onOpenManualCredit,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  currentUserId: string;
  isSuperUser: boolean;
  profiles: DakhlProfile[];
  wallets: Record<string, WalletRecord>;
  outgoingStatusByTarget: Record<string, ConnectionRequestStatus>;
  search: string;
  setSearch: (value: string) => void;
  saved: string[];
  setSaved: (value: string[] | ((current: string[]) => string[])) => void;
  onConnect: (member: DakhlProfile) => void;
  onOpenMessages: (partnerId?: string) => void;
  onPreviewProfile: (member: DakhlProfile) => void;
  onOpenManualCredit: (target: DakhlProfile) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [skillFilter, setSkillFilter] = useState("الكل");

  const visibleMembers = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return profiles.filter((member) => {
      if (member.account_type === "client") return false;
      const userWallet = wallets[member.id];
      const hasBalance = isSuperUser
        ? (userWallet?.balance_egp ?? 0) > 0 || (userWallet?.remaining_transactions ?? 0) > 0
        : Boolean(member.has_balance);

      if (!hasBalance) return false;

      const tags = [...member.skills, ...member.interests];
      const matchesSkill = matchesDirectoryCategory(member, skillFilter);

      const haystack = `${member.display_name} ${member.username} ${member.city ?? ""} ${member.governorate ?? ""} ${member.bio ?? ""} ${tags.join(" ")}`.toLowerCase();
      const matchesSearch = !queryText || haystack.includes(queryText);

      return matchesSkill && matchesSearch;
    });
  }, [profiles, wallets, isSuperUser, skillFilter, search]);

  return (
    <section className="section-block discover-page" style={{ marginTop: 0 }}>
      <div className="discover-toolbar">
        <div className="filter-row" style={{ flexWrap: "wrap", width: "100%" }}>
          <label className="inline-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالاسم، اسم المستخدم، أو المهارة"
            />
          </label>
          {DIRECTORY_CATEGORIES.map((category) => (
            <button
              key={category.id}
              className={`filter-chip ${skillFilter === category.id ? "selected" : ""}`}
              onClick={() => setSkillFilter(category.id)}
            >
              {category.id}
            </button>
          ))}
        </div>
      </div>

      <div className="people-grid">
        {visibleMembers.map((member) => {
          const userWallet = wallets[member.id];
          const balanceEgp = userWallet?.balance_egp ?? 0;
          const remainingTx = userWallet?.remaining_transactions ?? 0;
          const hasBalance = isSuperUser
            ? balanceEgp > 0 || remainingTx > 0
            : Boolean(member.has_balance);
          const locationText = [member.city, member.governorate].filter(Boolean).join("، ") || "غير محدد";
          const tags = member.skills.length > 0 ? member.skills : member.interests;
          const isSaved = saved.includes(member.id);

          return (
            <article className="person-card" key={member.id}>
              <div className="person-card-top">
                <div className="person-avatar blue" style={{ overflow: "hidden" }}>
                  {member.avatar_url ? (
                    <img
                      src={member.avatar_url}
                      alt={member.display_name}
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                    />
                  ) : (
                    getInitials(member.display_name)
                  )}
                </div>
                <button
                  className={`save-button ${isSaved ? "saved" : ""}`}
                  aria-label={isSaved ? "إزالة من المحفوظات" : "حفظ الملف"}
                  onClick={() =>
                    setSaved((current) =>
                      current.includes(member.id)
                        ? current.filter((id) => id !== member.id)
                        : [...current, member.id],
                    )
                  }
                >
                  <Heart size={17} fill={isSaved ? "currentColor" : "none"} />
                </button>
              </div>
              <div className="person-name-row">
                <h3>{member.display_name}</h3>
              </div>
              <p className="person-role">
                @{member.username} · {experienceLabel(member.experience_level)}
              </p>
              <div className="person-location">
                <MapPin size={14} />
                {locationText}
                {(member.projects?.length ?? 0) > 0 && (
                  <span style={{ marginRight: "auto", color: "#24543c", fontWeight: 600 }}>
                    {formatArabicNumber(member.projects?.length ?? 0)} مشاريع
                  </span>
                )}
              </div>
              <div className="skill-list">
                {tags.slice(0, 4).map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
              <div className="person-card-footer">
                {isSuperUser ? (
                  <>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: hasBalance ? "#24543c" : "#997467",
                      }}
                    >
                      {hasBalance
                        ? `الرصيد: ${formatArabicNumber(balanceEgp)} ج.م`
                        : "رصيد ٠ · للإدارة"}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        className="connect-button"
                        onClick={() => onPreviewProfile(member)}
                      >
                        <Eye size={13} /> الملف
                      </button>
                      <button
                        type="button"
                        className="connect-button"
                        onClick={() => onOpenManualCredit(member)}
                      >
                        <Plus size={13} /> إضافة رصيد
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="connect-button"
                      onClick={() => onPreviewProfile(member)}
                    >
                      <Eye size={14} /> عرض الأعمال
                    </button>
                    {member.id === currentUserId ? (
                      <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
                        ملفك الشخصي
                      </span>
                    ) : outgoingStatusByTarget[member.id] === "accepted" ? (
                      <button
                        type="button"
                        className="connect-button"
                        onClick={() => onOpenMessages(member.id)}
                      >
                        تم القبول · المحادثات <ArrowLeft size={14} />
                      </button>
                    ) : outgoingStatusByTarget[member.id] === "pending" ? (
                      <span style={{ fontSize: 10, color: "#67766c", fontWeight: 600 }}>
                        تم إرسال الطلب
                      </span>
                    ) : (
                      <button className="connect-button" onClick={() => onConnect(member)}>
                        تواصل <ArrowLeft size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
        {visibleMembers.length === 0 && (
          <div className="empty-state">
            {loadingMore
              ? "جارٍ تحميل المستقلين..."
              : search.trim() || skillFilter !== "الكل"
              ? "لا توجد نتائج مطابقة للبحث الحالي."
              : "لا يوجد مستقلون لديهم رصيد متاح للعرض حاليًا."}
          </div>
        )}
      </div>
      {hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
          <button
            type="button"
            className="primary-button"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            {loadingMore ? "جارٍ التحميل..." : "عرض المزيد من المستقلين"}
          </button>
        </div>
      )}
    </section>
  );
}

function OpportunitiesContent({ onSave }: { onSave: (title: string) => void }) {
  return (
    <section className="section-block opportunity-list-page">
      <div className="opportunity-page-intro">
        <div>
          <strong>فرص المجتمع</strong>
          <span>التصفح والنشر مجانيان.</span>
        </div>
      </div>
      {opportunities.length > 0 ? (
        opportunities.map((opportunity) => (
          <OpportunityRow
            key={opportunity.id}
            opportunity={opportunity}
            onSave={() => onSave(opportunity.title)}
            expanded
          />
        ))
      ) : (
        <div className="empty-state">لا توجد فرص منشورة حاليًا.</div>
      )}
    </section>
  );
}

function OpportunityRow({
  opportunity,
  onSave,
  onOpen,
  expanded = false,
}: {
  opportunity: Opportunity;
  onSave?: () => void;
  onOpen?: () => void;
  expanded?: boolean;
}) {
  return (
    <article className={`opportunity-row ${expanded ? "expanded" : ""}`}>
      <div className={`company-avatar ${opportunity.tone}`}>{opportunity.avatar}</div>
      <div className="opportunity-main">
        <div className="opportunity-meta">
          <span>{opportunity.company}</span>
          <time>{opportunity.time}</time>
        </div>
        <h3>{opportunity.title}</h3>
        <div className="opportunity-tags">
          <span>
            <MapPin size={13} />
            {opportunity.location}
          </span>
          <span>
            <BriefcaseBusiness size={13} />
            {opportunity.type}
          </span>
        </div>
        {expanded && (
          <div className="skill-list opportunity-skills">
            {opportunity.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        )}
      </div>
      <button
        className="row-action"
        aria-label={expanded ? "احفظ الفرصة" : "عرض كل الفرص"}
        onClick={expanded ? onSave : onOpen}
      >
        {expanded ? "احفظها" : <ArrowLeft size={17} />}
      </button>
    </article>
  );
}

function formatChatClock(ms: number) {
  if (!ms || ms <= 0) return "الآن";
  return new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatElapsedQuietArabic(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  if (totalMinutes < 60) {
    return `منذ ${formatArabicNumber(Math.max(1, totalMinutes))} د`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `منذ ${formatArabicNumber(totalHours)} س`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0
    ? `منذ ${formatArabicNumber(days)} ي و${formatArabicNumber(remHours)} س`
    : `منذ ${formatArabicNumber(days)} يوم`;
}

function MessagesContent(props: {
  currentUserId: string;
  chats: ChatThread[];
  activeChat: string | null;
  setActiveChat: (id: string) => void;
  messages: ChatMessageRecord[];
  loadingMessages: boolean;
  messageText: string;
  setMessageText: (value: string) => void;
  sendingMessage: boolean;
  dealActionBusyId: string | null;
  onSend: () => void;
  onMarkNotDelivered: (req: ConnectionRequestRecord) => void;
  onConfirmDelivery: (req: ConnectionRequestRecord) => void;
  onCancelDeal: (req: ConnectionRequestRecord) => void;
}) {
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"deliver" | "cancel" | null>(null);
  const [dealMenuOpen, setDealMenuOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const dealMenuRef = useRef<HTMLDivElement | null>(null);
  const currentThread =
    props.chats.find((chat) => chat.id === props.activeChat) ?? props.chats[0] ?? null;

  useEffect(() => {
    setConfirmAction(null);
    setDealMenuOpen(false);
  }, [currentThread?.id, currentThread?.dealStatus]);

  useEffect(() => {
    if (!dealMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!dealMenuRef.current?.contains(event.target as Node)) {
        setDealMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDealMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dealMenuOpen]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    currentThread?.id,
    currentThread?.dealStatus,
    currentThread?.needsDeliveryCheckIn,
    props.messages.length,
  ]);

  const isBusy = Boolean(currentThread && props.dealActionBusyId === currentThread.id);
  const isDelivered = currentThread?.dealStatus === "delivered";
  const isCancelled = currentThread?.dealStatus === "cancelled";
  const isActiveDeal = currentThread?.dealStatus === "active";

  return (
    <section className={`messages-panel ${mobileListOpen ? "mobile-list-open" : ""}`}>
      <div className="chat-list">
        <div className="chat-list-title">
          <h3>المحادثات ({formatArabicNumber(props.chats.length)})</h3>
        </div>
        {props.chats.length > 0 ? (
          props.chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => {
                props.setActiveChat(chat.id);
                setMobileListOpen(false);
              }}
              className={`chat-preview ${currentThread?.id === chat.id ? "current" : ""}`}
            >
              <div className={`person-avatar small ${chat.tone}`}>{chat.avatar}</div>
              <div className="chat-preview-copy">
                <div>
                  <strong>{chat.name}</strong>
                  {chat.needsDeliveryCheckIn ? (
                    <span className="deal-list-pill checkin">سلمت؟</span>
                  ) : chat.dealStatus === "delivered" ? (
                    <span className="deal-list-pill delivered">سُلّمت</span>
                  ) : chat.dealStatus === "cancelled" ? (
                    <span className="deal-list-pill cancelled">ملغاة</span>
                  ) : (
                    chat.hasUnread && <span className="chat-unread-dot" aria-label="رسالة جديدة" />
                  )}
                  <time>{chat.time}</time>
                </div>
                <p>{chat.last}</p>
              </div>
            </button>
          ))
        ) : (
          <div className="empty-state" style={{ marginTop: 12 }}>
            لا توجد محادثات بعد.
          </div>
        )}
      </div>
      <div className="chat-window">
        {currentThread ? (
          <>
            <div className="chat-header">
              <button
                type="button"
                className="chat-back-btn"
                onClick={() => setMobileListOpen(true)}
                aria-label="عرض قائمة المحادثات"
              >
                <ArrowRight size={14} /> المحادثات
              </button>
              <div className={`person-avatar small ${currentThread.tone}`}>{currentThread.avatar}</div>
              <div className="chat-header-copy">
                <strong>{currentThread.name}</strong>
                <span>
                  <span dir="ltr">@{currentThread.partnerUsername}</span> ·{" "}
                  {isDelivered
                    ? "تم تأكيد التسليم"
                    : isCancelled
                      ? "معاملة ملغاة"
                      : `آخر تفاعل ${formatElapsedQuietArabic(currentThread.inactiveDurationMs)}`}
                </span>
              </div>
              {isActiveDeal && !confirmAction && (
                <div className="deal-menu-wrap" ref={dealMenuRef}>
                  <button
                    type="button"
                    className={`deal-menu-trigger ${dealMenuOpen ? "active" : ""}`}
                    aria-label="خيارات المعاملة"
                    aria-expanded={dealMenuOpen}
                    aria-controls="deal-actions-menu"
                    onClick={() => setDealMenuOpen((open) => !open)}
                  >
                    <MoreVertical size={19} />
                  </button>
                  {dealMenuOpen && (
                    <div className="deal-menu" id="deal-actions-menu" aria-label="خيارات المعاملة">
                      {currentThread.deliveryCheckStatus === "not_delivered" && (
                        <div className="deal-menu-status">لسا مسلمش</div>
                      )}
                      <button
                        type="button"
                        className="deal-menu-item deliver"
                        disabled={isBusy}
                        onClick={() => {
                          setDealMenuOpen(false);
                          setConfirmAction("deliver");
                        }}
                      >
                        <CheckCircle2 size={16} />
                        سلمت
                      </button>
                      <button
                        type="button"
                        className="deal-menu-item cancel"
                        disabled={isBusy}
                        onClick={() => {
                          setDealMenuOpen(false);
                          setConfirmAction("cancel");
                        }}
                      >
                        <RotateCcw size={16} />
                        إلغاء المعاملة
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {isActiveDeal && confirmAction && (
              <div className={`deal-confirm-bar ${confirmAction}`}>
                <span>
                  {confirmAction === "deliver"
                    ? "تأكيد تسليم العمل؟ بعد التأكيد تُغلق المعاملة كمكتملة ولا تُرد الرسوم."
                    : `تأكيد إلغاء المعاملة؟ سيتم إرجاع ${formatArabicNumber(currentThread.acceptedFeeEgp)} ج.م (ومعاملة واحدة) لمحفظة المستقل.`}
                </span>
                <div className="deal-confirm-buttons">
                  <button
                    type="button"
                    className={`deal-btn ${confirmAction === "deliver" ? "deliver-solid" : "cancel-solid"}`}
                    disabled={isBusy}
                    onClick={() => {
                      const action = confirmAction;
                      setConfirmAction(null);
                      if (action === "deliver") {
                        props.onConfirmDelivery(currentThread.request);
                      } else {
                        props.onCancelDeal(currentThread.request);
                      }
                    }}
                  >
                    {isBusy ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : confirmAction === "deliver" ? (
                      "نعم، تأكيد التسليم"
                    ) : (
                      "تأكيد الإلغاء والاسترداد"
                    )}
                  </button>
                  <button
                    type="button"
                    className="deal-btn subtle"
                    disabled={isBusy}
                    onClick={() => setConfirmAction(null)}
                  >
                    تراجع
                  </button>
                </div>
              </div>
            )}

            {isDelivered && (
              <div className="deal-terminal-banner delivered">
                <CheckCircle2 size={15} />
                <span>
                  تم تأكيد التسليم — المعاملة مكتملة، والرسوم المخصومة غير قابلة للاسترداد بعد التسليم.
                </span>
              </div>
            )}

            {isCancelled && (
              <div className="deal-terminal-banner cancelled">
                <RotateCcw size={15} />
                <span>
                  تم إلغاء المعاملة قبل التسليم
                  {typeof currentThread.refundedAmountEgp === "number" &&
                  currentThread.refundedAmountEgp > 0
                    ? ` — عادت ${formatArabicNumber(currentThread.refundedAmountEgp)} ج.م ومعاملة واحدة إلى محفظة المستقل.`
                    : "."}
                </span>
              </div>
            )}

            <div className="chat-messages-scroll" ref={scrollContainerRef}>
              <div className="chat-notice">
                <Check size={13} />
                تم قبول طلب التواصل — كل الرسائل هنا محفوظة وتصل للطرفين مباشرة.
              </div>
              {currentThread.initialMessage && (
                <div
                  className={`chat-bubble ${
                    currentThread.initialMessageSenderId === props.currentUserId
                      ? "sent"
                      : "received"
                  }`}
                >
                  {currentThread.initialMessage}
                  <time>
                    {currentThread.initialTime ?? currentThread.time}
                    {currentThread.initialMessageSenderId === props.currentUserId && (
                      <Check size={12} />
                    )}
                  </time>
                </div>
              )}
              {props.loadingMessages && props.messages.length === 0 ? (
                <div className="chat-date">جارٍ تحميل الرسائل...</div>
              ) : (
                props.messages.map((msg) => {
                  const isMine = msg.senderId === props.currentUserId;
                  return (
                    <div key={msg.id} className={`chat-bubble ${isMine ? "sent" : "received"}`}>
                      {msg.text}
                      <time>
                        {formatChatClock(msg.createdAtMs)}
                        {isMine && <CheckCheck size={12} />}
                      </time>
                    </div>
                  );
                })
              )}

              {currentThread.needsDeliveryCheckIn && isActiveDeal && (
                <div className="deal-checkin-card" role="region" aria-label="متابعة حالة التسليم">
                  <div className="deal-checkin-head">
                    <Clock size={16} />
                    <strong>
                      مرّت ٢٤ ساعة بدون رسائل بين الطرفين — هل تم تسليم العمل؟
                    </strong>
                  </div>
                  <p>
                    سلمت؟ يمكنك تأكيد التسليم لإتمام المعاملة (لا تُرد الرسوم بعد التسليم)، أو
                    اختيار «لسا مسلمش»، أو إلغاء المعاملة لإرجاع{" "}
                    {formatArabicNumber(currentThread.acceptedFeeEgp)} ج.م لمحفظة المستقل.
                  </p>
                  <div className="deal-checkin-actions">
                    <button
                      type="button"
                      className="deal-btn deliver-solid"
                      disabled={isBusy}
                      onClick={() => props.onConfirmDelivery(currentThread.request)}
                    >
                      {isBusy ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      سلمت ✓
                    </button>
                    <button
                      type="button"
                      className="deal-btn subtle"
                      disabled={isBusy}
                      onClick={() => props.onMarkNotDelivered(currentThread.request)}
                    >
                      لسا مسلمش
                    </button>
                    <button
                      type="button"
                      className="deal-btn cancel"
                      disabled={isBusy}
                      onClick={() => setConfirmAction("cancel")}
                    >
                      <RotateCcw size={13} /> إلغاء المعاملة (استرداد{" "}
                      {formatArabicNumber(currentThread.acceptedFeeEgp)} ج.م)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {isCancelled ? (
              <div className="deal-closed-composer">
                تم إغلاق المحادثة وإلغاء المعاملة — أُعيدت الرسوم لمحفظة المستقل.
              </div>
            ) : (
              <form
                className="chat-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  props.onSend();
                }}
              >
                <input
                  value={props.messageText}
                  maxLength={1000}
                  disabled={props.sendingMessage}
                  onChange={(event) => props.setMessageText(event.target.value)}
                  placeholder={`اكتب رسالة إلى ${currentThread.name}...`}
                />
                <button
                  type="submit"
                  className="send-button"
                  disabled={props.sendingMessage || !props.messageText.trim()}
                  aria-label="إرسال"
                >
                  {props.sendingMessage ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="empty-state" style={{ margin: "auto 0" }}>
            لا توجد رسائل حاليًا. تبدأ المحادثات بعد قبول طلبات التواصل.
          </div>
        )}
      </div>
    </section>
  );
}

function NotificationsContent({
  currentUserId,
  notifications,
  requestsById,
  checkInPendingThreads,
  respondingRequestId,
  browserNotifPermission,
  onEnableBrowserNotifs,
  onMarkRead,
  onMarkAllRead,
  onRespondRequest,
  onOpenAssign,
  onOpenMessages,
}: {
  currentUserId: string;
  notifications: NotificationRecord[];
  requestsById: Record<string, ConnectionRequestRecord>;
  checkInPendingThreads: ChatThread[];
  respondingRequestId: string | null;
  browserNotifPermission: NotificationPermission;
  onEnableBrowserNotifs: () => void;
  onMarkRead: (notifId: string) => void;
  onMarkAllRead: () => void;
  onRespondRequest: (
    req: ConnectionRequestRecord,
    decision: "accepted" | "declined",
    relatedNotifId?: string,
  ) => void;
  onOpenAssign: () => void;
  onOpenMessages: (requestId?: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "unread" | "requests">("all");
  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const clientRequestCount = notifications.filter((n) => n.type === "client_request").length;
  const supportsBrowserNotifications =
    typeof window !== "undefined" && "Notification" in window;

  const visibleNotifications = useMemo(() => {
    if (filter === "unread") return notifications.filter((n) => !n.is_read);
    if (filter === "requests") return notifications.filter((n) => n.type === "client_request");
    return notifications;
  }, [notifications, filter]);

  return (
    <section className="notif-page">
      <div className="wallet-info">
        <div className="info-icon">
          <BellRing size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <strong>إشعارات العملاء وطلبات العمل الفورية</strong>
          <p>
            تصلك هنا فورًا كل طلبات التواصل من العملاء وأصحاب المشاريع لتتمكن من قبولها أو الرد عليها مباشرة.
          </p>
        </div>
        {supportsBrowserNotifications && browserNotifPermission !== "granted" && (
          <button
            type="button"
            className="primary-button"
            style={{ whiteSpace: "nowrap", fontSize: 11, padding: "8px 12px" }}
            onClick={onEnableBrowserNotifs}
          >
            <Bell size={14} /> تفعيل تنبيهات المتصفح
          </button>
        )}
        {supportsBrowserNotifications && browserNotifPermission === "granted" && (
          <span className="notif-status-tag accepted">
            <Check size={13} /> تنبيهات المتصفح مفعّلة
          </span>
        )}
      </div>

      {checkInPendingThreads.length > 0 && (
        <div className="deal-checkin-card">
          <div className="deal-checkin-head">
            <Clock size={16} />
            <strong>
              لديك {formatArabicNumber(checkInPendingThreads.length)} محادثة مرّ عليها ٢٤ ساعة دون
              تفاعل — سلمت؟
            </strong>
          </div>
          <p>افتح المحادثة لاختيار «سلمت» أو «لسا مسلمش» أو إلغاء المعاملة واسترداد الرسوم:</p>
          <div className="deal-checkin-actions">
            {checkInPendingThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="deal-btn subtle"
                onClick={() => onOpenMessages(thread.id)}
              >
                <MessageCircle size={13} /> {thread.name} (سلمت؟)
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="notif-toolbar">
        <div className="filter-row" style={{ marginBottom: 0, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`filter-chip ${filter === "all" ? "selected" : ""}`}
            onClick={() => setFilter("all")}
          >
            الكل ({formatArabicNumber(notifications.length)})
          </button>
          <button
            type="button"
            className={`filter-chip ${filter === "unread" ? "selected" : ""}`}
            onClick={() => setFilter("unread")}
          >
            غير مقروءة ({formatArabicNumber(unreadCount)})
          </button>
          <button
            type="button"
            className={`filter-chip ${filter === "requests" ? "selected" : ""}`}
            onClick={() => setFilter("requests")}
          >
            طلبات العملاء ({formatArabicNumber(clientRequestCount)})
          </button>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="cancel-button" onClick={onMarkAllRead}>
            <CheckCheck size={14} style={{ verticalAlign: "middle", marginLeft: 5 }} />
            تحديد الكل كمقروء
          </button>
        )}
      </div>

      <div className="notif-list">
        {visibleNotifications.length > 0 ? (
          visibleNotifications.map((notif) => {
            const relatedRequest = notif.requestId ? requestsById[notif.requestId] : undefined;
            const isIncomingPending =
              notif.type === "client_request" &&
              relatedRequest &&
              relatedRequest.toUserId === currentUserId &&
              relatedRequest.status === "pending";
            const isBusy = Boolean(relatedRequest && respondingRequestId === relatedRequest.id);
            const senderRole =
              notif.actorAccountType === "client" ? "عميل · صاحب مشروع" : "مستقل";

            return (
              <article
                key={notif.id}
                className={`notif-card ${notif.is_read ? "" : "unread"}`}
              >
                <div
                  className={`notif-card-icon ${
                    notif.type === "request_accepted" || notif.type === "deal_delivered"
                      ? "accepted"
                      : notif.type === "request_declined" || notif.type === "deal_cancelled"
                        ? "declined"
                        : ""
                  }`}
                >
                  {notif.type === "request_accepted" || notif.type === "deal_delivered" ? (
                    <Check size={18} />
                  ) : notif.type === "request_declined" || notif.type === "deal_cancelled" ? (
                    <X size={18} />
                  ) : (
                    <BellRing size={18} />
                  )}
                </div>
                <div className="notif-card-body">
                  <div className="notif-card-head">
                    <strong>{notif.title}</strong>
                    <time>{formatArabicDate(notif.createdAtMs)}</time>
                  </div>
                  <div className="notif-card-meta">
                    من: {notif.actorDisplayName} (<span dir="ltr">@{notif.actorUsername}</span>) ·{" "}
                    {senderRole}
                  </div>
                  <div className="notif-card-message">{notif.body}</div>

                  <div className="notif-card-actions">
                    {relatedRequest && (
                      <span
                        className={`notif-status-tag ${
                          relatedRequest.deal_status === "cancelled"
                            ? "declined"
                            : relatedRequest.status
                        }`}
                      >
                        {relatedRequest.deal_status === "delivered"
                          ? "تم التسليم"
                          : relatedRequest.deal_status === "cancelled"
                            ? "أُلغيت المعاملة"
                            : relatedRequest.status === "accepted"
                              ? "تم قبول الطلب"
                              : relatedRequest.status === "declined"
                                ? "تم الاعتذار عن الطلب"
                                : "بانتظار الرد"}
                      </span>
                    )}

                    {isIncomingPending && relatedRequest && (
                      <>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={isBusy}
                          title="قبول الطلب وخصم معاملة واحدة من رصيد المحفظة"
                          style={{ padding: "7px 12px", fontSize: 11 }}
                          onClick={() => onRespondRequest(relatedRequest, "accepted", notif.id)}
                        >
                          {isBusy ? (
                            <LoaderCircle className="spin" size={13} />
                          ) : (
                            <Check size={13} />
                          )}
                          قبول الطلب (خصم معاملة)
                        </button>
                        <button
                          type="button"
                          className="cancel-button"
                          disabled={isBusy}
                          style={{ padding: "7px 12px", fontSize: 11 }}
                          onClick={() => onRespondRequest(relatedRequest, "declined", notif.id)}
                        >
                          رفض
                        </button>
                      </>
                    )}

                    {relatedRequest?.status === "accepted" && (
                      <button
                        type="button"
                        className="connect-button"
                        style={{ fontSize: 11 }}
                        onClick={() => onOpenMessages(relatedRequest.id)}
                      >
                        فتح المحادثة <ArrowLeft size={13} />
                      </button>
                    )}

                    {!notif.is_read && (
                      <button
                        type="button"
                        className="connect-button"
                        style={{ marginRight: "auto", color: "#5f6e65" }}
                        onClick={() => onMarkRead(notif.id)}
                      >
                        <Check size={13} /> تحديد كمقروء
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-state">
            {filter !== "all" ? (
              "لا توجد إشعارات ضمن هذا التصنيف حاليًا."
            ) : (
              <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
                <span>لا توجد إشعارات بعد. عندما يتواصل معك عميل سيظهر التنبيه هنا فورًا.</span>
                <button
                  type="button"
                  className="cancel-button"
                  onClick={onOpenAssign}
                >
                  تصفح قائمة «تعيين»
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function WalletContent({
  isLocked,
  isClient,
  wallet,
  unitPriceEgp,
  minTransactions,
  requests,
  transactions,
  onTopup,
  onPreviewReceipt,
}: {
  isLocked: boolean;
  isClient: boolean;
  wallet: WalletRecord;
  unitPriceEgp: number;
  minTransactions: number;
  requests: TopupRequestRecord[];
  transactions: WalletTransactionRecord[];
  onTopup: () => void;
  onPreviewReceipt: (url: string) => void;
}) {
  const hasPending = requests.some((req) => req.status === "pending");

  return (
    <section className="wallet-page">
      <div className="wallet-summary">
        <div>
          <span>
            {isLocked
              ? "الحساب مقفول — يتطلب شحن المحفظة"
              : isClient
                ? "محفظة العميل (الحساب مفتوح)"
                : "رصيدك المتاح"}
          </span>
          <strong>
            {formatArabicNumber(wallet.balance_egp)} <small>جنيه مصري</small>
          </strong>
          <p>
            {isLocked ? <Lock size={15} /> : <ShieldCheck size={15} />}
            {" "}
            {isClient
              ? "حساب عميل · التصفح والتواصل متاحان مباشرة"
              : `المعاملات المتاحة: ${formatArabicNumber(wallet.remaining_transactions)} معاملة`}
          </p>
        </div>
        <button className="primary-button" onClick={onTopup}>
          <Plus size={17} /> طلب شحن رصيد
        </button>
      </div>

      <div className="wallet-info">
        <div className="info-icon">
          {isLocked ? <Lock size={18} /> : <CircleHelp size={18} />}
        </div>
        <div>
          <strong>
            {isLocked
              ? "كل الأقسام مقفولة حتى يتم شحن محفظتك من الإدارة"
              : isClient
                ? "حساب صاحب مشروع (عميل) — جميع الأقسام مفتوحة لك"
                : `أقل عدد معاملات للشحن هو ${formatArabicNumber(minTransactions)} معاملات (${formatArabicNumber(unitPriceEgp)} ج.م للمعاملة)`}
          </strong>
          <p>
            {isLocked
              ? hasPending
                ? "طلبك قيد المراجعة الآن. بمجرد تأكيد التحويل وإضافة الرصيد يدويًا من الإدارة ستُفتح جميع أقسام المنصة تلقائيًا."
                : `قدّم طلب شحن بعدد المحاولات المطلوبة (${formatArabicNumber(minTransactions)} معاملات على الأقل · ${formatArabicNumber(unitPriceEgp)} ج.م للمعاملة) وأرفق صورة التحويل، وستقوم الإدارة بمراجعة الطلب وإضافة الرصيد يدويًا لفتح الحساب.`
              : isClient
                ? "يمكنك تصفح المستقلين في «تعيين» واستخدام جميع أقسام المنصة بحرية، وملفك غير ظاهر للآخرين في قائمة «تعيين»."
                : "تتم مراجعة طلبات الشحن وصورة التحويل يدويًا وإضافة الرصيد إلى محفظتك."}
          </p>
        </div>
      </div>

      <div className="transaction-card">
        <div className="section-title-row">
          <div>
            <h2>طلبات الشحن الخاصة بك</h2>
          </div>
        </div>
        {requests.length > 0 ? (
          requests.map((req) => (
            <div className="transaction-row" key={req.id}>
              <span className={`transaction-icon ${req.status === "rejected" ? "debit" : "credit"}`}>
                {req.status === "approved" ? (
                  <Check size={17} />
                ) : req.status === "rejected" ? (
                  <X size={17} />
                ) : (
                  <Wallet size={17} />
                )}
              </span>
              <div className="transaction-copy">
                <strong>
                  طلب {formatArabicNumber(req.requested_transactions)} معاملات ·{" "}
                  {topupStatusLabel(req.status)}
                </strong>
                <span>
                  {formatArabicDate(req.createdAtMs)}
                  {req.transfer_reference ? ` · مرجع: ${req.transfer_reference}` : ""}
                  {req.admin_note ? ` · ملاحظة الإدارة: ${req.admin_note}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="cancel-button"
                onClick={() => onPreviewReceipt(req.receipt_image_url)}
              >
                <Eye size={14} /> الإيصال
              </button>
              <strong className={req.status === "rejected" ? "debit" : "credit"}>
                {formatArabicNumber(req.approved_amount_egp ?? req.calculated_amount_egp)} ج.م
              </strong>
            </div>
          ))
        ) : (
          <div className="empty-state">لم تقدّم أي طلب شحن بعد.</div>
        )}
      </div>

      <div className="transaction-card">
        <div className="section-title-row">
          <div>
            <h2>آخر العمليات المالية</h2>
          </div>
        </div>
        {transactions.length > 0 ? (
          transactions.map((item) => (
            <div className="transaction-row" key={item.id}>
              <span className={`transaction-icon ${item.type}`}>
                {item.type === "credit" ? <ArrowDownLeft size={17} /> : <ArrowUpLeft size={17} />}
              </span>
              <div className="transaction-copy">
                <strong>{item.title}</strong>
                <span>{formatArabicDate(item.createdAtMs)}</span>
              </div>
              <strong className={item.type}>
                {item.type === "credit" ? "+" : "−"} {formatArabicNumber(item.amount_egp)} ج.م
              </strong>
            </div>
          ))
        ) : (
          <div className="empty-state">لا توجد عمليات مسجلة في محفظتك بعد.</div>
        )}
      </div>
    </section>
  );
}

function AdminContent({
  adminUid,
  unitPriceEgp,
  minTransactions,
  requests,
  profiles,
  wallets,
  onPreviewReceipt,
  onOpenManualCredit,
  onNotify,
  onFatalError,
}: {
  adminUid: string;
  unitPriceEgp: number;
  minTransactions: number;
  requests: TopupRequestRecord[];
  profiles: DakhlProfile[];
  wallets: Record<string, WalletRecord>;
  onPreviewReceipt: (url: string) => void;
  onOpenManualCredit: (target: DakhlProfile) => void;
  onNotify: (message: string) => void;
  onFatalError: (error: Error) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | TopupStatus>("pending");
  const [txDrafts, setTxDrafts] = useState<Record<string, string>>({});
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState(String(unitPriceEgp));
  const [minTxInput, setMinTxInput] = useState(String(minTransactions));
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setPriceInput(String(unitPriceEgp));
  }, [unitPriceEgp]);

  useEffect(() => {
    setMinTxInput(String(minTransactions));
  }, [minTransactions]);

  const visibleRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((req) => req.status === statusFilter);
  }, [requests, statusFilter]);

  const pendingCount = requests.filter((req) => req.status === "pending").length;

  async function handleSaveSettings() {
    const parsedPrice = Math.trunc(Number(priceInput));
    const parsedMinTx = Math.trunc(Number(minTxInput));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1 || parsedPrice > 100000) {
      onNotify("أدخل سعر معاملة صحيحًا (١ ج.م فأكثر).");
      return;
    }
    if (!Number.isFinite(parsedMinTx) || parsedMinTx < 1 || parsedMinTx > 1000) {
      onNotify("أدخل حدًا أدنى صحيحًا لعدد المعاملات (١ فأكثر).");
      return;
    }

    setSavingSettings(true);
    try {
      await saveWalletSettings({
        adminUid,
        transactionPriceEgp: parsedPrice,
        minTransactions: parsedMinTx,
      });
      onNotify(
        `تم تحديث التسعير: ${formatArabicNumber(parsedPrice)} ج.م للمعاملة (بحد أدنى ${formatArabicNumber(parsedMinTx)} معاملات).`,
      );
    } catch (error: unknown) {
      if (error instanceof Error) onFatalError(error);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleApprove(req: TopupRequestRecord) {
    const approvedTx = Number(txDrafts[req.id] ?? req.requested_transactions);
    const approvedEgp = Number(amountDrafts[req.id] ?? req.calculated_amount_egp);
    if (!Number.isFinite(approvedTx) || approvedTx < 1) {
      onNotify("أدخل عدد معاملات صحيحًا (١ فأكثر).");
      return;
    }
    if (!Number.isFinite(approvedEgp) || approvedEgp < 0) {
      onNotify("أدخل مبلغًا صحيحًا.");
      return;
    }

    setBusyId(req.id);
    try {
      await approveTopupRequest({
        request: req,
        adminUid,
        approvedTransactions: approvedTx,
        approvedAmountEgp: approvedEgp,
        adminNote: noteDrafts[req.id] ?? "",
      });
      onNotify(
        `تم اعتماد طلب ${req.userDisplayName} وإضافة ${formatArabicNumber(approvedTx)} معاملات إلى محفظته.`,
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "REQUEST_ALREADY_REVIEWED") {
        onNotify("تمت مراجعة هذا الطلب بالفعل.");
      } else if (error instanceof Error) {
        onFatalError(error);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(req: TopupRequestRecord) {
    setBusyId(req.id);
    try {
      await rejectTopupRequest({
        requestId: req.id,
        adminUid,
        adminNote: noteDrafts[req.id] ?? "",
      });
      onNotify(`تم رفض طلب ${req.userDisplayName}.`);
    } catch (error: unknown) {
      if (error instanceof Error) onFatalError(error);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="wallet-page">
      <div className="wallet-summary">
        <div>
          <span>لوحة تحكم الإدارة (Superuser)</span>
          <strong>
            {formatArabicNumber(pendingCount)} <small>طلبات قيد المراجعة</small>
          </strong>
          <p>
            <ShieldCheck size={15} /> إجمالي الطلبات: {formatArabicNumber(requests.length)} · إجمالي
            الحسابات: {formatArabicNumber(profiles.length)} · سعر المعاملة:{" "}
            {formatArabicNumber(unitPriceEgp)} ج.م
          </p>
        </div>
      </div>

      <div className="transaction-card">
        <div className="section-title-row">
          <div>
            <h2>إعدادات تسعير المعاملات</h2>
          </div>
        </div>
        <div className="setup-fields" style={{ marginTop: 12 }}>
          <label>
            <span>سعر المعاملة الواحدة (ج.م)</span>
            <input
              type="number"
              min={1}
              max={100000}
              value={priceInput}
              onChange={(event) => setPriceInput(event.target.value)}
            />
          </label>
          <label>
            <span>الحد الأدنى لعدد المعاملات</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={minTxInput}
              onChange={(event) => setMinTxInput(event.target.value)}
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary-button"
              disabled={savingSettings}
              onClick={() => void handleSaveSettings()}
            >
              {savingSettings ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              حفظ التسعير
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              الحد الأدنى الحالي للشحن: {formatArabicNumber(minTransactions)} معاملات (
              {formatArabicNumber(minTransactions * unitPriceEgp)} ج.م)
            </span>
          </div>
        </div>
      </div>

      <div className="filter-row" style={{ marginBottom: 0 }}>
        {(
          [
            { id: "pending", label: `قيد المراجعة (${formatArabicNumber(pendingCount)})` },
            { id: "all", label: "الكل" },
            { id: "approved", label: "تمت الموافقة" },
            { id: "rejected", label: "مرفوض" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            className={`filter-chip ${statusFilter === tab.id ? "selected" : ""}`}
            onClick={() => setStatusFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="transaction-card">
        <div className="section-title-row">
          <div>
            <h2>طلبات الشحن الواردة</h2>
          </div>
        </div>
        {visibleRequests.length > 0 ? (
          visibleRequests.map((req) => {
            const isBusy = busyId === req.id;
            const txValue = txDrafts[req.id] ?? String(req.requested_transactions);
            const amountValue = amountDrafts[req.id] ?? String(req.calculated_amount_egp);
            const noteValue = noteDrafts[req.id] ?? "";

            return (
              <div
                key={req.id}
                style={{
                  borderTop: "1px solid #f0f2f0",
                  padding: "14px 0",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div className="transaction-row" style={{ borderTop: 0, padding: 0 }}>
                  <span className={`transaction-icon ${req.status === "rejected" ? "debit" : "credit"}`}>
                    {req.status === "approved" ? (
                      <Check size={17} />
                    ) : req.status === "rejected" ? (
                      <X size={17} />
                    ) : (
                      <Wallet size={17} />
                    )}
                  </span>
                  <div className="transaction-copy">
                    <strong>
                      {req.userDisplayName} (@{req.username}) · {topupStatusLabel(req.status)}
                    </strong>
                    <span>
                      {req.userEmail} · {formatArabicDate(req.createdAtMs)}
                      {req.transfer_reference ? ` · مرجع التحويل: ${req.transfer_reference}` : ""}
                    </span>
                  </div>
                  <strong className="credit">
                    {formatArabicNumber(req.requested_transactions)} معاملات (
                    {formatArabicNumber(req.calculated_amount_egp)} ج.م)
                  </strong>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={() => onPreviewReceipt(req.receipt_image_url)}
                  >
                    <Eye size={14} /> عرض صورة التحويل
                  </button>
                  {req.status !== "pending" && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      المعتمد: {formatArabicNumber(req.approved_transactions ?? 0)} معاملات (
                      {formatArabicNumber(req.approved_amount_egp ?? 0)} ج.م)
                      {req.admin_note ? ` · ${req.admin_note}` : ""}
                    </span>
                  )}
                </div>

                {req.status === "pending" && (
                  <div className="setup-fields" style={{ marginTop: 4 }}>
                    <label>
                      <span>عدد المعاملات المراد إضافتها</span>
                      <input
                        type="number"
                        min={1}
                        value={txValue}
                        onChange={(event) => {
                          const nextTx = event.target.value;
                          setTxDrafts((prev) => ({ ...prev, [req.id]: nextTx }));
                          const parsed = Number(nextTx);
                          if (Number.isFinite(parsed) && parsed >= 1) {
                            setAmountDrafts((prev) => ({
                              ...prev,
                              [req.id]: String(Math.trunc(parsed) * unitPriceEgp),
                            }));
                          }
                        }}
                      />
                    </label>
                    <label>
                      <span>الرصيد المعتمد (ج.م)</span>
                      <input
                        type="number"
                        min={0}
                        value={amountValue}
                        onChange={(event) =>
                          setAmountDrafts((prev) => ({ ...prev, [req.id]: event.target.value }))
                        }
                      />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span>ملاحظة للمستخدم (اختياري)</span>
                      <input
                        value={noteValue}
                        maxLength={300}
                        placeholder="مثال: تم تأكيد التحويل وفتح الحساب"
                        onChange={(event) =>
                          setNoteDrafts((prev) => ({ ...prev, [req.id]: event.target.value }))
                        }
                      />
                    </label>
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={isBusy}
                        onClick={() => void handleApprove(req)}
                      >
                        {isBusy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                        اعتماد وإضافة الرصيد
                      </button>
                      <button
                        type="button"
                        className="cancel-button"
                        disabled={isBusy}
                        onClick={() => void handleReject(req)}
                      >
                        رفض الطلب
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty-state">لا توجد طلبات شحن في هذا التصنيف.</div>
        )}
      </div>

      <div className="transaction-card">
        <div className="section-title-row">
          <div>
            <h2>محافظ المستخدمين (إضافة رصيد يدوية)</h2>
          </div>
        </div>
        {profiles.length > 0 ? (
          profiles.map((userProfile) => {
            const userWallet = wallets[userProfile.id];
            const balance = userWallet?.balance_egp ?? 0;
            const remaining = userWallet?.remaining_transactions ?? 0;
            const unlocked = userWallet?.is_unlocked && remaining > 0;
            const isClientUser = userProfile.account_type === "client";
            return (
              <div className="transaction-row" key={userProfile.id}>
                <div className="transaction-copy">
                  <strong>
                    {userProfile.display_name} (@{userProfile.username}) ·{" "}
                    {isClientUser ? "عميل" : "مستقل"}
                  </strong>
                  <span>
                    {isClientUser
                      ? "حساب عميل (مفتوح مباشرة · مخفي من «تعيين»)"
                      : `الحالة: ${unlocked ? "مفعل" : "مقفول"} · الرصيد: ${formatArabicNumber(balance)} ج.م · المعاملات المتاحة: ${formatArabicNumber(remaining)}`}
                  </span>
                </div>
                {!isClientUser && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onOpenManualCredit(userProfile)}
                  >
                    <Plus size={14} /> إضافة رصيد
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty-state">لا يوجد مستخدمون مسجلون بعد.</div>
        )}
      </div>
    </section>
  );
}

function TopupRequestDialog({
  profile,
  userEmail,
  unitPriceEgp,
  minTransactions,
  onClose,
  onSuccess,
  onFatalError,
}: {
  profile: DakhlProfile;
  userEmail: string;
  unitPriceEgp: number;
  minTransactions: number;
  onClose: () => void;
  onSuccess: () => void;
  onFatalError: (error: Error) => void;
}) {
  const [attempts, setAttempts] = useState(String(minTransactions));
  const [transferReference, setTransferReference] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const previewUrl = useMemo(
    () => (receiptFile ? URL.createObjectURL(receiptFile) : ""),
    [receiptFile],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const numericAttempts = Math.trunc(Number(attempts) || 0);
  const calculatedEgp = Math.max(0, numericAttempts) * unitPriceEgp;

  function chooseReceipt(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("اختر صورة إيصال التحويل بصيغة JPG أو PNG أو WebP وبحجم لا يتجاوز ١٠ ميجابايت.");
      event.target.value = "";
      return;
    }
    setReceiptFile(file);
    setError("");
  }

  async function handleSubmit() {
    setError("");
    if (
      !Number.isFinite(numericAttempts) ||
      numericAttempts < minTransactions ||
      numericAttempts > MAX_TOPUP_TRANSACTIONS
    ) {
      setError(`أقل عدد معاملات للشحن هو ${formatArabicNumber(minTransactions)} معاملات.`);
      return;
    }
    if (!receiptFile) {
      setError("يرجى إرفاق صورة التحويل لإرسال الطلب.");
      return;
    }

    setSubmitting(true);
    try {
      await submitTopupRequest({
        profile,
        userEmail,
        requestedTransactions: numericAttempts,
        unitPriceEgp,
        minTransactions,
        transferReference,
        receiptFile,
      });
      onSuccess();
    } catch (submitError: unknown) {
      if (submitError instanceof Error && submitError.message === "RECEIPT_TOO_LARGE") {
        setError("حجم الصورة كبير جدًا حتى بعد الضغط. اختر صورة أوضح بحجم أصغر.");
      } else if (submitError instanceof Error && submitError.message === "INVALID_TRANSACTION_COUNT") {
        setError(`أقل عدد معاملات هو ${formatArabicNumber(minTransactions)} معاملات.`);
      } else if (submitError instanceof Error) {
        onFatalError(submitError);
      } else {
        setError("تعذر إرسال الطلب. حاول مرة أخرى.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <button
          className="dialog-close"
          onClick={onClose}
          disabled={submitting}
          aria-label="إغلاق"
        >
          <X size={19} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="dialog-icon">
            <Wallet size={20} />
          </div>
          <strong dir="ltr" style={{ fontSize: 14, color: "#143f32", letterSpacing: "0.02em" }}>
            01020117504
          </strong>
        </div>
        <h2 id="dialog-title">طلب شحن المحفظة</h2>
        <p className="dialog-description">
          حدد عدد المعاملات المطلوبة ({formatArabicNumber(minTransactions)} معاملات على الأقل)
          وأرفق صورة التحويل لتفعيل الرصيد من الإدارة.
        </p>

        <label className="field-label" htmlFor="topup-attempts">
          عدد المعاملات (المحاولات) المطلوبة
        </label>
        <div className="amount-input">
          <input
            id="topup-attempts"
            type="number"
            min={minTransactions}
            max={MAX_TOPUP_TRANSACTIONS}
            value={attempts}
            onChange={(event) => setAttempts(event.target.value)}
          />
          <span>معاملة</span>
        </div>

        <div className="fee-breakdown">
          <div>
            <span>سعر المعاملة الواحدة</span>
            <strong>{formatArabicNumber(unitPriceEgp)} ج.م</strong>
          </div>
          <div className="fee-total">
            <span>المبلغ المطلوب تحويله</span>
            <strong>{formatArabicNumber(calculatedEgp)} ج.م</strong>
          </div>
          <small>
            الحد الأدنى للشحن هو {formatArabicNumber(minTransactions)} معاملات (
            {formatArabicNumber(minTransactions * unitPriceEgp)} ج.م).
          </small>
        </div>

        <label className="field-label" htmlFor="topup-reference">
          رقم التحويل أو رقم المحفظة المحوّل منها (اختياري)
        </label>
        <input
          id="topup-reference"
          className="dialog-input"
          maxLength={120}
          value={transferReference}
          onChange={(event) => setTransferReference(event.target.value)}
          placeholder="مثال: 010xxxxxxx أو رقم العملية"
        />

        <label className="field-label">صورة التحويل (مطلوبة)</label>
        <label className="avatar-upload" style={{ marginTop: 6 }}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseReceipt} />
          <span className="avatar-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="معاينة صورة التحويل" />
            ) : (
              <ImagePlus size={22} />
            )}
          </span>
          <span>
            <strong>{receiptFile ? receiptFile.name : "اختر صورة إيصال التحويل"}</strong>
            <small>JPG أو PNG أو WebP · تراجع يدويًا من الإدارة</small>
          </span>
        </label>

        {error && (
          <div className="auth-message error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="primary-button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <LoaderCircle className="spin" size={16} /> : null}
            إرسال طلب الشحن <ArrowLeft size={15} />
          </button>
          <button type="button" className="cancel-button" disabled={submitting} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </section>
    </div>
  );
}

function ManualCreditDialog({
  target,
  adminUid,
  unitPriceEgp,
  minTransactions,
  currentWallet,
  onClose,
  onSuccess,
  onFatalError,
}: {
  target: DakhlProfile;
  adminUid: string;
  unitPriceEgp: number;
  minTransactions: number;
  currentWallet?: WalletRecord;
  onClose: () => void;
  onSuccess: (addedTx: number, addedEgp: number) => void;
  onFatalError: (error: Error) => void;
}) {
  const [txCount, setTxCount] = useState(String(minTransactions));
  const [amountEgp, setAmountEgp] = useState(String(minTransactions * unitPriceEgp));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const parsedTx = Math.trunc(Number(txCount));
    const parsedEgp = Math.trunc(Number(amountEgp));
    if (!Number.isFinite(parsedTx) || parsedTx < 1) {
      setError("أدخل عدد معاملات صحيحًا (١ فأكثر).");
      return;
    }
    if (!Number.isFinite(parsedEgp) || parsedEgp < 0) {
      setError("أدخل مبلغًا صحيحًا.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await manualCreditWallet({
        targetUserId: target.id,
        adminUid,
        addTransactions: parsedTx,
        addAmountEgp: parsedEgp,
        title: note.trim() || undefined,
      });
      onSuccess(parsedTx, parsedEgp);
    } catch (err: unknown) {
      if (err instanceof Error) onFatalError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="dialog-card" role="dialog" aria-modal="true">
        <button className="dialog-close" onClick={onClose} disabled={saving} aria-label="إغلاق">
          <X size={19} />
        </button>
        <div className="dialog-icon">
          <ShieldCheck size={20} />
        </div>
        <h2>إضافة رصيد يدوي — {target.display_name}</h2>
        <p className="dialog-description">
          الرصيد الحالي: {formatArabicNumber(currentWallet?.balance_egp ?? 0)} ج.م · المعاملات
          المتاحة: {formatArabicNumber(currentWallet?.remaining_transactions ?? 0)}
        </p>

        <label className="field-label" htmlFor="manual-tx">
          عدد المعاملات المضافة
        </label>
        <div className="amount-input">
          <input
            id="manual-tx"
            type="number"
            min={1}
            value={txCount}
            onChange={(event) => {
              const val = event.target.value;
              setTxCount(val);
              const parsed = Number(val);
              if (Number.isFinite(parsed) && parsed >= 1) {
                setAmountEgp(String(Math.trunc(parsed) * unitPriceEgp));
              }
            }}
          />
          <span>معاملة</span>
        </div>

        <label className="field-label" htmlFor="manual-egp">
          المبلغ المضاف (ج.م)
        </label>
        <div className="amount-input">
          <input
            id="manual-egp"
            type="number"
            min={0}
            value={amountEgp}
            onChange={(event) => setAmountEgp(event.target.value)}
          />
          <span>ج.م</span>
        </div>

        <label className="field-label" htmlFor="manual-note">
          وصف العملية (اختياري)
        </label>
        <input
          id="manual-note"
          className="dialog-input"
          maxLength={120}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="مثال: شحن يدوي من الإدارة"
        />

        {error && (
          <div className="auth-message error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : null}
            إضافة الرصيد <Check size={15} />
          </button>
          <button type="button" className="cancel-button" disabled={saving} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </section>
    </div>
  );
}

const profileSkillSuggestions = [
  "تصميم جرافيك",
  "تصميم UI/UX",
  "كتابة المحتوى",
  "التسويق الرقمي",
  "إدارة وسائل التواصل",
  "البرمجة",
  "تطوير الويب",
  "إدخال البيانات",
  "الترجمة",
  "التصوير",
  "المونتاج",
  "خدمة العملاء",
];

const profileInterestOptions = [
  "تصميم",
  "برمجة",
  "تسويق",
  "إدخال بيانات",
  "كتابة ومحتوى",
  "ترجمة",
  "تصوير ومونتاج",
  "خدمة عملاء",
  "تعليم وتدريب",
  "أعمال إدارية",
];

const profileExperienceOptions: { value: ExperienceLevel; label: string }[] = [
  { value: "beginner", label: "مبتدئ" },
  { value: "intermediate", label: "متوسط" },
  { value: "professional", label: "محترف" },
  { value: "no_experience", label: "لا أملك خبرة بعد" },
];

function BioTextWithLinks({ text }: { text: string }) {
  const segments = extractTextSegmentsWithLinks(text);
  return (
    <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
      {segments.map((seg, index) =>
        seg.type === "link" ? (
          <a
            key={`${seg.href}-${index}`}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--green)", textDecoration: "underline", fontWeight: 500 }}
          >
            {seg.value}
          </a>
        ) : (
          <span key={index}>{seg.value}</span>
        ),
      )}
    </p>
  );
}

function ProjectCard({
  project,
  onPreviewImage,
  onDelete,
}: {
  project: PortfolioProject;
  onPreviewImage: (url: string, title: string) => void;
  onDelete?: () => void;
}) {
  return (
    <article
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "#fff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {project.image_url && (
        <button
          type="button"
          onClick={() => onPreviewImage(project.image_url!, project.title)}
          style={{
            border: 0,
            padding: 0,
            background: "#f2f4f1",
            width: "100%",
            aspectRatio: "16 / 10",
            overflow: "hidden",
          }}
          aria-label={`عرض صورة ${project.title}`}
        >
          <img
            src={project.image_url}
            alt={project.title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </button>
      )}
      {project.video_drive_url && (
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: "#111a16",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <iframe
            src={project.video_drive_url}
            title={project.title}
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", border: 0, display: "block" }}
          />
        </div>
      )}
      <div style={{ padding: "12px 14px", display: "grid", gap: 6, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: 13, color: "var(--ink)" }}>{project.title}</strong>
          {onDelete && (
            <button
              type="button"
              className="cancel-button"
              onClick={onDelete}
              style={{ padding: "4px 8px", fontSize: 10, color: "#8d5149" }}
              aria-label={`حذف مشروع ${project.title}`}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {project.description && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
            {project.description}
          </p>
        )}
      </div>
    </article>
  );
}

function ProfileContent({
  profile,
  onPreviewImage,
  onNotify,
  onFatalError,
}: {
  profile: DakhlProfile;
  onPreviewImage: (url: string, title: string) => void;
  onNotify: (message: string) => void;
  onFatalError: (error: Error) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [displayName, setDisplayName] = useState(profile.display_name);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [coverUrl, setCoverUrl] = useState<string | null>(profile.cover_url ?? null);
  const [governorate, setGovernorate] = useState(profile.governorate ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [portfolioUrl, setPortfolioUrl] = useState(profile.portfolio_url ?? "");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(
    profile.experience_level ?? "no_experience",
  );
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [customSkill, setCustomSkill] = useState("");
  const [interests, setInterests] = useState<string[]>(profile.interests);
  const [subcollectionProjects, setSubcollectionProjects] = useState<PortfolioProject[]>([]);
  const [projects, setProjects] = useState<PortfolioProject[]>(profile.projects ?? []);

  const [projMediaType, setProjMediaType] = useState<"image" | "video">("image");
  const [projTitle, setProjTitle] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projImageUrl, setProjImageUrl] = useState<string | null>(null);
  const [projVideoUrl, setProjVideoUrl] = useState("");
  const [projError, setProjError] = useState("");
  const [projBusy, setProjBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<"avatar" | "cover" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProfileSubcollectionProjects(profile.id, true)
      .then((items) => {
        if (!cancelled) setSubcollectionProjects(items);
      })
      .catch((error: unknown) => {
        console.error("Failed loading profile subcollection projects:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const legacyProjects = useMemo(() => profile.projects ?? [], [profile.projects]);
  const savedProjects = useMemo(() => {
    const byId = new Map<string, PortfolioProject>();
    for (const item of legacyProjects) byId.set(item.id, item);
    for (const item of subcollectionProjects) byId.set(item.id, item);
    return Array.from(byId.values()).slice(0, 3);
  }, [legacyProjects, subcollectionProjects]);
  const subcollectionProjectIds = useMemo(
    () => new Set(subcollectionProjects.map((item) => item.id)),
    [subcollectionProjects],
  );

  useEffect(() => {
    if (!editing && !addingProject) {
      setDisplayName(profile.display_name);
      setAvatarUrl(profile.avatar_url);
      setCoverUrl(profile.cover_url ?? null);
      setGovernorate(profile.governorate ?? "");
      setCity(profile.city ?? "");
      setBio(profile.bio ?? "");
      setPortfolioUrl(profile.portfolio_url ?? "");
      setExperienceLevel(profile.experience_level ?? "no_experience");
      setSkills(profile.skills);
      setInterests(profile.interests);
      setProjects(savedProjects);
    }
  }, [profile, editing, addingProject, savedProjects]);

  const location = [profile.city, profile.governorate].filter(Boolean).join("، ");
  const accountLabel =
    profile.account_type === "client" ? "صاحب مشروع (عميل)" : "مستقل (فريلانسر)";
  const activeCover = editing ? coverUrl : (profile.cover_url ?? null);
  const activeAvatar = editing ? avatarUrl : profile.avatar_url;

  function resetProjectDraft() {
    setProjMediaType("image");
    setProjTitle("");
    setProjDesc("");
    setProjImageUrl(null);
    setProjVideoUrl("");
    setProjError("");
  }

  async function saveQuickProfileMedia(nextAvatar: string | null, nextCover: string | null, notice: string) {
    await updateUserProfile({
      userId: profile.id,
      display_name: profile.display_name,
      avatar_url: nextAvatar,
      cover_url: nextCover,
      governorate: profile.governorate,
      city: profile.city,
      bio: profile.bio,
      portfolio_url: profile.portfolio_url ?? null,
      experience_level: profile.experience_level ?? "no_experience",
      skills: profile.skills,
      interests: profile.interests,
    });
    onNotify(notice);
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>, saveImmediately = false) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      const msg = "اختر صورة صالحة بحجم لا يتجاوز ٨ ميجابايت.";
      if (saveImmediately) onNotify(msg);
      else setEditError(msg);
      return;
    }
    setMediaBusy("avatar");
    try {
      const webpUrl = await convertImageToWebpDataUrl(file, {
        maxSide: 220,
        maxLength: AVATAR_WEBP_MAX_LENGTH,
      });
      setAvatarUrl(webpUrl);
      setEditError("");
      if (saveImmediately) {
        await saveQuickProfileMedia(webpUrl, profile.cover_url ?? null, "تم تحديث الصورة الشخصية.");
      }
    } catch (error: unknown) {
      const msg = "تعذر معالجة الصورة المختارة. جرّب صورة أخرى.";
      if (saveImmediately && error instanceof Error && error.message !== "IMAGE_TOO_LARGE" && error.message !== "INVALID_IMAGE") {
        onFatalError(error);
      } else if (saveImmediately) {
        onNotify(msg);
      } else {
        setEditError(msg);
      }
    } finally {
      setMediaBusy(null);
    }
  }

  async function handleCoverChange(event: ChangeEvent<HTMLInputElement>, saveImmediately = false) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      const msg = "اختر صورة غلاف صالحة بحجم لا يتجاوز ١٠ ميجابايت.";
      if (saveImmediately) onNotify(msg);
      else setEditError(msg);
      return;
    }
    setMediaBusy("cover");
    try {
      const webpUrl = await convertImageToWebpDataUrl(file, {
        maxSide: 1000,
        maxLength: COVER_WEBP_MAX_LENGTH,
      });
      setCoverUrl(webpUrl);
      setEditError("");
      if (saveImmediately) {
        await saveQuickProfileMedia(profile.avatar_url, webpUrl, "تم تحديث صورة الغلاف.");
      }
    } catch (error: unknown) {
      const msg = "تعذر معالجة صورة الغلاف. جرّب صورة أخرى.";
      if (saveImmediately && error instanceof Error && error.message !== "IMAGE_TOO_LARGE" && error.message !== "INVALID_IMAGE") {
        onFatalError(error);
      } else if (saveImmediately) {
        onNotify(msg);
      } else {
        setEditError(msg);
      }
    } finally {
      setMediaBusy(null);
    }
  }

  async function handleRemoveCover(saveImmediately = false) {
    setCoverUrl(null);
    if (!saveImmediately) return;
    setMediaBusy("cover");
    try {
      await saveQuickProfileMedia(profile.avatar_url, null, "تمت إزالة صورة الغلاف.");
    } catch (error: unknown) {
      if (error instanceof Error) onFatalError(error);
    } finally {
      setMediaBusy(null);
    }
  }

  function formatProfileSaveError(error: unknown, fallback: string): string {
    console.error("Profile project/save error:", error);
    const raw = error instanceof Error ? error.message : String(error ?? "");
    const lower = raw.toLowerCase();
    if (raw === "IMAGE_TOO_LARGE") {
      return "حجم الصورة كبير جدًا حتى بعد الضغط. جرّب صورة أخرى أصغر.";
    }
    if (raw === "INVALID_IMAGE") {
      return "الملف المختار ليس صورة صالحة.";
    }
    if (raw === "INVALID_PORTFOLIO_URL") {
      return "أدخل رابط بورتفوليو صحيحًا يبدأ بـ https:// أو http://.";
    }
    if (lower.includes("quota") || lower.includes("resource-exhausted")) {
      return "تم تجاوز الحد اليومي لقاعدة البيانات مؤقتًا. حاول مرة أخرى لاحقًا.";
    }
    if (lower.includes("maximum") || lower.includes("exceeds") || lower.includes("invalid-argument")) {
      return "حجم الصور والبيانات في الملف الشخصي كبير جدًا. جرّب صورة أصغر حجمًا.";
    }
    if (lower.includes("permission") || lower.includes("insufficient")) {
      return "تعذر التحقق من صلاحية الحفظ أو صيغة البيانات. حاول مرة أخرى.";
    }
    return fallback;
  }

  async function handleProjectImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setProjError("اختر صورة صالحة للمشروع بحجم لا يتجاوز ١٠ ميجابايت.");
      return;
    }
    setProjBusy(true);
    setProjError("");
    try {
      const webpUrl = await convertImageToWebpDataUrl(file, {
        maxSide: 960,
        maxLength: PROJECT_IMAGE_MAX_LENGTH,
      });
      setProjImageUrl(webpUrl);
    } catch (error: unknown) {
      setProjError(formatProfileSaveError(error, "تعذر تجهيز الصورة. جرّب صورة أخرى."));
    } finally {
      setProjBusy(false);
    }
  }

  function buildValidatedDraftProject(): PortfolioProject | null {
    const cleanTitle = projTitle.trim().slice(0, 80);
    if (cleanTitle.length < 2) {
      setProjError("اكتب عنوانًا للمشروع (حرفان على الأقل).");
      return null;
    }

    if (projMediaType === "image") {
      if (!projImageUrl) {
        setProjError("اختر صورة للمشروع أولًا.");
        return null;
      }
      return {
        id: crypto.randomUUID(),
        title: cleanTitle,
        description: projDesc.trim().slice(0, 300) || null,
        image_url: projImageUrl,
        video_drive_url: null,
      };
    }

    const parsedDriveUrl = parseGoogleDriveVideoUrl(projVideoUrl);
    if (!parsedDriveUrl) {
      setProjError("أدخل رابط فيديو صحيحًا من Google Drive.");
      return null;
    }

    return {
      id: crypto.randomUUID(),
      title: cleanTitle,
      description: projDesc.trim().slice(0, 300) || null,
      image_url: null,
      video_drive_url: parsedDriveUrl,
    };
  }

  async function handleAddStandaloneProject() {
    if (savedProjects.length >= 3) {
      setProjError("يمكنك إضافة ٣ مشاريع بحد أقصى.");
      return;
    }
    const newProject = buildValidatedDraftProject();
    if (!newProject) return;

    setProjBusy(true);
    setProjError("");
    try {
      const created = await addProfileProject(profile, newProject);
      setSubcollectionProjects((curr) =>
        [...curr.filter((item) => item.id !== created.id), created].slice(0, 3),
      );
      resetProjectDraft();
      setAddingProject(false);
      onNotify("تمت إضافة المشروع إلى ملفك الشخصي.");
    } catch (error: unknown) {
      setProjError(
        formatProfileSaveError(error, "تعذر حفظ المشروع. لم تُحفظ البيانات؛ حاول مرة أخرى."),
      );
    } finally {
      setProjBusy(false);
    }
  }

  async function handleDeleteStandaloneProject(projectId: string) {
    setProjBusy(true);
    setProjError("");
    try {
      if (subcollectionProjectIds.has(projectId)) {
        await deleteProfileProject(profile.id, projectId);
        setSubcollectionProjects((curr) => curr.filter((p) => p.id !== projectId));
      } else {
        const nextLegacyProjects = legacyProjects.filter((p) => p.id !== projectId);
        await updateUserProfile({
          userId: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          cover_url: profile.cover_url ?? null,
          governorate: profile.governorate,
          city: profile.city,
          bio: profile.bio,
          portfolio_url: profile.portfolio_url ?? null,
          projects: nextLegacyProjects,
          experience_level: profile.experience_level ?? "no_experience",
          skills: profile.skills,
          interests: profile.interests,
        });
      }
      onNotify("تم حذف المشروع.");
    } catch (error: unknown) {
      onNotify(formatProfileSaveError(error, "تعذر حذف المشروع. حاول مرة أخرى."));
    } finally {
      setProjBusy(false);
    }
  }

  function addCustomSkill() {
    const val = customSkill.trim();
    if (!val || val.length > 60 || skills.some((s) => s.toLowerCase() === val.toLowerCase())) return;
    if (skills.length >= 20) {
      setEditError("يمكنك اختيار ٢٠ مهارة بحد أقصى.");
      return;
    }
    setSkills((current) => [...current, val]);
    setCustomSkill("");
    setEditError("");
  }

  async function handleSaveEdit() {
    setEditError("");
    const cleanName = displayName.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setEditError("اكتب اسمًا كاملًا بين حرفين و٨٠ حرفًا.");
      return;
    }
    if (interests.length < 1) {
      setEditError("اختر مجالًا واحدًا على الأقل في الفرص التي تهمك.");
      return;
    }

    let cleanPortfolio: string | null = null;
    if (portfolioUrl.trim()) {
      cleanPortfolio = sanitizeExternalHttpUrl(portfolioUrl);
      if (!cleanPortfolio) {
        setEditError("أدخل رابط بورتفوليو صحيحًا يبدأ بـ https:// أو http://.");
        return;
      }
    }

    const finalProjects = [...projects];
    const hasPendingProjectDraft = Boolean(
      projTitle.trim() || projDesc.trim() || projImageUrl || projVideoUrl.trim(),
    );
    if (hasPendingProjectDraft) {
      if (finalProjects.length >= 3) {
        setEditError("الحد الأقصى للمشاريع هو ٣ مشاريع.");
        return;
      }
      const drafted = buildValidatedDraftProject();
      if (!drafted) {
        setEditError("تحقق من بيانات المشروع المضاف أو امسح حقوله.");
        return;
      }
      finalProjects.push(drafted);
    }

    setSaving(true);
    try {
      const cappedFinal = finalProjects.slice(0, 3);
      const finalIds = new Set(cappedFinal.map((p) => p.id));
      const legacyIds = new Set(legacyProjects.map((p) => p.id));
      const removedSubIds = subcollectionProjects
        .filter((p) => !finalIds.has(p.id))
        .map((p) => p.id);
      const keptLegacy = legacyProjects.filter((p) => finalIds.has(p.id));
      const newSubProjects = cappedFinal.filter(
        (p) => !legacyIds.has(p.id) && !subcollectionProjectIds.has(p.id),
      );

      for (const id of removedSubIds) {
        await deleteProfileProject(profile.id, id);
      }
      const createdSubProjects: PortfolioProject[] = [];
      for (const item of newSubProjects) {
        const created = await addProfileProject(profile, item);
        createdSubProjects.push(created);
      }

      setSubcollectionProjects((curr) => [
        ...curr.filter((p) => finalIds.has(p.id)),
        ...createdSubProjects,
      ]);

      await updateUserProfile({
        userId: profile.id,
        display_name: cleanName,
        avatar_url: avatarUrl,
        cover_url: coverUrl,
        governorate: governorate.trim() || null,
        city: city.trim() || null,
        bio: bio.trim() || null,
        portfolio_url: cleanPortfolio,
        projects: keptLegacy.length !== legacyProjects.length ? keptLegacy : undefined,
        experience_level: experienceLevel,
        skills,
        interests,
      });
      resetProjectDraft();
      setEditing(false);
      onNotify("تم حفظ تعديلات ملفك الشخصي بنجاح.");
    } catch (error: unknown) {
      setEditError(
        formatProfileSaveError(error, "تعذر حفظ التعديلات. لم تُحفظ البيانات؛ حاول مرة أخرى."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="profile-page">
      <div className="profile-cover">
        {activeCover && (
          <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            <img
              src={activeCover}
              alt="صورة الغلاف"
              onClick={!editing ? () => onPreviewImage(activeCover, "صورة الغلاف") : undefined}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                cursor: !editing ? "pointer" : "default",
              }}
            />
          </div>
        )}

        <div
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <label
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid #d8e0d8",
              color: "var(--ink)",
              fontSize: 10,
              fontWeight: 600,
              cursor: mediaBusy ? "wait" : "pointer",
            }}
          >
            <input
              type="file"
              accept="image/*"
              disabled={mediaBusy !== null}
              onChange={(e) => void handleCoverChange(e, !editing)}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            />
            {mediaBusy === "cover" ? <LoaderCircle className="spin" size={13} /> : <Camera size={13} />}
            <span>{activeCover ? "تغيير الغلاف" : "إضافة غلاف"}</span>
          </label>
          {activeCover && (
            <button
              type="button"
              disabled={mediaBusy !== null}
              onClick={() => void handleRemoveCover(!editing)}
              aria-label="إزالة صورة الغلاف"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "rgba(255, 255, 255, 0.92)",
                border: "1px solid #d8e0d8",
                color: "#8d5149",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <div className="profile-avatar large" style={{ zIndex: 2, overflow: "visible" }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {activeAvatar ? (
              <img
                src={activeAvatar}
                alt={profile.display_name}
                onClick={!editing ? () => onPreviewImage(activeAvatar, profile.display_name) : undefined}
                style={{ cursor: !editing ? "pointer" : "default" }}
              />
            ) : (
              getInitials(profile.display_name)
            )}
          </div>
          <label
            title="تغيير الصورة الشخصية"
            aria-label="تغيير الصورة الشخصية"
            style={{
              position: "absolute",
              bottom: -3,
              left: -3,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "var(--green)",
              color: "#fff",
              border: "2px solid #fff",
              display: "grid",
              placeItems: "center",
              cursor: mediaBusy ? "wait" : "pointer",
            }}
          >
            <input
              type="file"
              accept="image/*"
              disabled={mediaBusy !== null}
              onChange={(e) => void handleAvatarChange(e, !editing)}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            />
            {mediaBusy === "avatar" ? <LoaderCircle className="spin" size={12} /> : <Camera size={12} />}
          </label>
        </div>
      </div>

      {editing ? (
        <div className="profile-details">
          <div className="profile-details-head" style={{ marginBottom: 18 }}>
            <div>
              <h2>تعديل الملف الشخصي</h2>
              <p>@{profile.username} · {accountLabel}</p>
            </div>
            <button
              type="button"
              className="cancel-button"
              disabled={saving}
              onClick={() => {
                resetProjectDraft();
                setEditError("");
                setEditing(false);
              }}
            >
              إلغاء
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <label className="avatar-upload" style={{ marginBottom: 0 }}>
              <input
                type="file"
                accept="image/*"
                disabled={mediaBusy !== null}
                onChange={(e) => void handleAvatarChange(e, false)}
              />
              <span className="avatar-preview">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <ImagePlus size={22} />}
              </span>
              <span>
                <strong>تغيير الصورة الشخصية</strong>
                <small>اختر صورة جديدة لملفك</small>
              </span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label className="avatar-upload" style={{ marginBottom: 0, flex: 1 }}>
                <input
                  type="file"
                  accept="image/*"
                  disabled={mediaBusy !== null}
                  onChange={(e) => void handleCoverChange(e, false)}
                />
                <span className="avatar-preview" style={{ borderRadius: 8, width: 76 }}>
                  {coverUrl ? <img src={coverUrl} alt="" /> : <ImagePlus size={20} />}
                </span>
                <span>
                  <strong>{coverUrl ? "تغيير صورة الغلاف" : "إضافة صورة غلاف"}</strong>
                  <small>تظهر أعلى ملفك الشخصي</small>
                </span>
              </label>
              {coverUrl && (
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => void handleRemoveCover(false)}
                  style={{ color: "#8d5149", padding: "6px 8px" }}
                  aria-label="إزالة صورة الغلاف"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="setup-fields">
            <label>
              <span>الاسم الكامل</span>
              <input
                value={displayName}
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label>
              <span>رابط الأعمال / البورتفوليو (اختياري)</span>
              <input
                value={portfolioUrl}
                maxLength={300}
                dir="ltr"
                placeholder="https://behance.net/..."
                onChange={(e) => setPortfolioUrl(e.target.value)}
              />
            </label>
            <label>
              <span>المحافظة</span>
              <input
                value={governorate}
                maxLength={80}
                onChange={(e) => setGovernorate(e.target.value)}
              />
            </label>
            <label>
              <span>المدينة</span>
              <input
                value={city}
                maxLength={80}
                onChange={(e) => setCity(e.target.value)}
              />
            </label>
          </div>

          <label className="setup-label">
            <span>نبذة عني (يمكنك كتابة روابط داخل النبذة أيضًا)</span>
            <textarea
              value={bio}
              maxLength={500}
              rows={4}
              placeholder="اكتب نبذة مختصرة عن خبرتك أو رابط معرض أعمالك..."
              onChange={(e) => setBio(e.target.value)}
            />
          </label>

          <div className="profile-section">
            <h3>المهارات</h3>
            <div className="selection-grid">
              {profileSkillSuggestions.map((skill) => {
                const selected = skills.includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    className={`selection-chip ${selected ? "selected" : ""}`}
                    onClick={() =>
                      setSkills((current) =>
                        selected
                          ? current.filter((item) => item !== skill)
                          : current.length < 20
                            ? [...current, skill]
                            : current,
                      )
                    }
                  >
                    {selected && <Check size={14} />}
                    {skill}
                  </button>
                );
              })}
            </div>
            <div className="custom-skill-form">
              <input
                value={customSkill}
                maxLength={60}
                placeholder="أضف مهارة أخرى"
                onChange={(e) => setCustomSkill(e.target.value)}
              />
              <button type="button" disabled={!customSkill.trim()} onClick={addCustomSkill}>
                إضافة
              </button>
            </div>
            {skills.length > 0 && (
              <div className="chosen-skills">
                {skills.map((skill) => (
                  <button
                    type="button"
                    key={skill}
                    onClick={() => setSkills((curr) => curr.filter((s) => s !== skill))}
                  >
                    {skill}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="profile-section">
            <h3>مستوى الخبرة</h3>
            <div className="selection-grid">
              {profileExperienceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`selection-chip ${experienceLevel === option.value ? "selected" : ""}`}
                  onClick={() => setExperienceLevel(option.value)}
                >
                  {experienceLevel === option.value && <Check size={14} />}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="profile-section">
            <h3>الفرص التي تهمني</h3>
            <div className="selection-grid">
              {profileInterestOptions.map((item) => {
                const selected = interests.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    className={`selection-chip ${selected ? "selected" : ""}`}
                    onClick={() =>
                      setInterests((current) =>
                        selected
                          ? current.filter((x) => x !== item)
                          : current.length < 20
                            ? [...current, item]
                            : current,
                      )
                    }
                  >
                    {selected && <Check size={14} />}
                    {item}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="profile-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>أعمالي ومشاريعي ({formatArabicNumber(projects.length)} / ٣)</h3>
            </div>
            {projects.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                {projects.map((proj) => (
                  <ProjectCard
                    key={proj.id}
                    project={proj}
                    onPreviewImage={onPreviewImage}
                    onDelete={() =>
                      setProjects((current) => current.filter((item) => item.id !== proj.id))
                    }
                  />
                ))}
              </div>
            )}

            {projects.length < 3 && (
              <div
                style={{
                  border: "1px dashed #d3dcd4",
                  borderRadius: 10,
                  padding: 14,
                  background: "#f9faf8",
                  display: "grid",
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 12, color: "var(--ink)" }}>إضافة مشروع جديد</strong>
                <div className="selection-grid" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className={`selection-chip ${projMediaType === "image" ? "selected" : ""}`}
                    onClick={() => {
                      setProjMediaType("image");
                      setProjVideoUrl("");
                      setProjError("");
                    }}
                  >
                    <ImagePlus size={14} /> صورة
                  </button>
                  <button
                    type="button"
                    className={`selection-chip ${projMediaType === "video" ? "selected" : ""}`}
                    onClick={() => {
                      setProjMediaType("video");
                      setProjImageUrl(null);
                      setProjError("");
                    }}
                  >
                    <Video size={14} /> فيديو
                  </button>
                </div>
                <div className="setup-fields" style={{ marginBottom: 0 }}>
                  <label style={projMediaType === "image" ? { gridColumn: "1 / -1" } : undefined}>
                    <span>عنوان المشروع</span>
                    <input
                      value={projTitle}
                      maxLength={80}
                      placeholder="مثال: تصميم هوية بصرية"
                      onChange={(e) => setProjTitle(e.target.value)}
                    />
                  </label>
                  {projMediaType === "video" && (
                    <label>
                      <span>رابط فيديو من Google Drive</span>
                      <input
                        value={projVideoUrl}
                        maxLength={300}
                        dir="ltr"
                        placeholder="https://drive.google.com/file/d/..."
                        onChange={(e) => setProjVideoUrl(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <label className="setup-label" style={{ marginTop: 0 }}>
                  <span>وصف مختصر (اختياري)</span>
                  <textarea
                    value={projDesc}
                    maxLength={300}
                    rows={2}
                    placeholder="تفاصيل سريعة عن المشروع..."
                    onChange={(e) => setProjDesc(e.target.value)}
                  />
                </label>
                {projMediaType === "image" && (
                  <label className="avatar-upload" style={{ marginBottom: 0 }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleProjectImageChange(e)}
                    />
                    <span className="avatar-preview" style={{ borderRadius: 8 }}>
                      {projImageUrl ? <img src={projImageUrl} alt="" /> : <ImagePlus size={20} />}
                    </span>
                    <span>
                      <strong>{projImageUrl ? "تم اختيار صورة المشروع" : "اختر صورة للمشروع"}</strong>
                      <small>ارفع صورة واضحة من جهازك</small>
                    </span>
                  </label>
                )}
                {projError && (
                  <div className="auth-message error" role="alert" style={{ marginBottom: 0 }}>
                    {projError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="cancel-button"
                    disabled={projBusy}
                    onClick={() => {
                      const created = buildValidatedDraftProject();
                      if (!created) return;
                      setProjects((curr) => [...curr, created]);
                      resetProjectDraft();
                    }}
                  >
                    <Plus size={14} /> إدراج في القائمة
                  </button>
                  {projMediaType === "image" && projImageUrl && (
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={() => setProjImageUrl(null)}
                    >
                      إزالة الصورة
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {editError && (
            <div className="auth-message error" role="alert" style={{ marginTop: 14 }}>
              {editError}
            </div>
          )}

          <div className="dialog-actions" style={{ marginTop: 18 }}>
            <button
              type="button"
              className="primary-button"
              disabled={saving || projBusy}
              onClick={() => void handleSaveEdit()}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              حفظ التعديلات
            </button>
            <button
              type="button"
              className="cancel-button"
              disabled={saving}
              onClick={() => {
                resetProjectDraft();
                setEditError("");
                setEditing(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <div className="profile-details">
          <div className="profile-details-head">
            <div>
              <div className="person-name-row">
                <h2>{profile.display_name}</h2>
              </div>
              <p>
                @{profile.username} <span>·</span> {accountLabel}
                {location && (
                  <>
                    {" "}
                    <span>·</span> {location}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              className="cancel-button"
              onClick={() => {
                resetProjectDraft();
                setEditError("");
                setAddingProject(false);
                setEditing(true);
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Pencil size={14} /> تعديل الملف الشخصي
            </button>
          </div>

          <div className="profile-section">
            <h3>نبذة عني</h3>
            {profile.bio ? (
              <BioTextWithLinks text={profile.bio} />
            ) : (
              <p>لم تُضف نبذة بعد.</p>
            )}
            {profile.portfolio_url && (
              <div style={{ marginTop: 10 }}>
                <a
                  href={profile.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cancel-button"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    textDecoration: "none",
                    color: "var(--green)",
                    fontWeight: 600,
                  }}
                >
                  <Link2 size={14} />
                  <span>رابط الأعمال / البورتفوليو</span>
                  <ExternalLink size={13} />
                </a>
              </div>
            )}
          </div>

          <div className="profile-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <h3 style={{ margin: 0 }}>
                أعمالي ومشاريعي ({formatArabicNumber(savedProjects.length)} / ٣)
              </h3>
              {savedProjects.length < 3 && !addingProject && (
                <button
                  type="button"
                  className="connect-button"
                  onClick={() => {
                    resetProjectDraft();
                    setAddingProject(true);
                  }}
                >
                  <Plus size={14} /> إضافة مشروع
                </button>
              )}
            </div>

            {savedProjects.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {savedProjects.map((proj) => (
                  <ProjectCard
                    key={proj.id}
                    project={proj}
                    onPreviewImage={onPreviewImage}
                    onDelete={() => void handleDeleteStandaloneProject(proj.id)}
                  />
                ))}
              </div>
            ) : !addingProject ? (
              <p>لم تُضف مشاريع بعد. يمكنك إضافة حتى ٣ مشاريع بصور أو فيديوهات Google Drive.</p>
            ) : null}

            {addingProject && savedProjects.length < 3 && (
              <div
                style={{
                  marginTop: savedProjects.length > 0 ? 14 : 0,
                  border: "1px dashed #d3dcd4",
                  borderRadius: 10,
                  padding: 14,
                  background: "#f9faf8",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div className="selection-grid" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className={`selection-chip ${projMediaType === "image" ? "selected" : ""}`}
                    onClick={() => {
                      setProjMediaType("image");
                      setProjVideoUrl("");
                      setProjError("");
                    }}
                  >
                    <ImagePlus size={14} /> صورة
                  </button>
                  <button
                    type="button"
                    className={`selection-chip ${projMediaType === "video" ? "selected" : ""}`}
                    onClick={() => {
                      setProjMediaType("video");
                      setProjImageUrl(null);
                      setProjError("");
                    }}
                  >
                    <Video size={14} /> فيديو
                  </button>
                </div>
                <div className="setup-fields" style={{ marginBottom: 0 }}>
                  <label style={projMediaType === "image" ? { gridColumn: "1 / -1" } : undefined}>
                    <span>عنوان المشروع</span>
                    <input
                      value={projTitle}
                      maxLength={80}
                      placeholder="مثال: موقع تعريفي لشركة"
                      onChange={(e) => setProjTitle(e.target.value)}
                    />
                  </label>
                  {projMediaType === "video" && (
                    <label>
                      <span>رابط فيديو من Google Drive</span>
                      <input
                        value={projVideoUrl}
                        maxLength={300}
                        dir="ltr"
                        placeholder="https://drive.google.com/file/d/..."
                        onChange={(e) => setProjVideoUrl(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <label className="setup-label" style={{ marginTop: 0 }}>
                  <span>وصف مختصر (اختياري)</span>
                  <textarea
                    value={projDesc}
                    maxLength={300}
                    rows={2}
                    placeholder="تفاصيل سريعة عن المشروع..."
                    onChange={(e) => setProjDesc(e.target.value)}
                  />
                </label>
                {projMediaType === "image" && (
                  <label className="avatar-upload" style={{ marginBottom: 0 }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleProjectImageChange(e)}
                    />
                    <span className="avatar-preview" style={{ borderRadius: 8 }}>
                      {projImageUrl ? <img src={projImageUrl} alt="" /> : <ImagePlus size={20} />}
                    </span>
                    <span>
                      <strong>{projImageUrl ? "تم اختيار صورة المشروع" : "اختر صورة للمشروع"}</strong>
                      <small>ارفع صورة واضحة من جهازك</small>
                    </span>
                  </label>
                )}
                {projError && (
                  <div className="auth-message error" role="alert" style={{ marginBottom: 0 }}>
                    {projError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={projBusy}
                    onClick={() => void handleAddStandaloneProject()}
                  >
                    {projBusy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                    حفظ المشروع
                  </button>
                  {projMediaType === "image" && projImageUrl && (
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={() => setProjImageUrl(null)}
                    >
                      إزالة الصورة
                    </button>
                  )}
                  <button
                    type="button"
                    className="cancel-button"
                    disabled={projBusy}
                    onClick={() => {
                      resetProjectDraft();
                      setAddingProject(false);
                    }}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="profile-section">
            <h3>المهارات</h3>
            <div className="skill-list">
              {profile.skills.length > 0 ? (
                profile.skills.map((skill) => <span key={skill}>{skill}</span>)
              ) : (
                <span>لم تُضف مهارات بعد</span>
              )}
            </div>
          </div>
          <div className="profile-section">
            <h3>الخبرة</h3>
            <p>{experienceLabel(profile.experience_level)}</p>
          </div>
          <div className="profile-section">
            <h3>الفرص التي تهمني</h3>
            <div className="skill-list">
              {profile.interests.map((interest) => (
                <span key={interest}>{interest}</span>
              ))}
            </div>
          </div>
          <div className="profile-section beginner-tip">
            <span>لا تحتاج إلى سيرة ذاتية أو خبرة سابقة للبدء — شارك ما تعرفه الآن.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function ProfilePreviewDialog({
  member,
  currentUserId,
  isSuperUser,
  outgoingStatus,
  onClose,
  onConnect,
  onOpenMessages,
  onPreviewImage,
}: {
  member: DakhlProfile;
  currentUserId: string;
  isSuperUser: boolean;
  outgoingStatus?: ConnectionRequestStatus;
  onClose: () => void;
  onConnect: (member: DakhlProfile) => void;
  onOpenMessages: () => void;
  onPreviewImage: (url: string, title: string) => void;
}) {
  const location = [member.city, member.governorate].filter(Boolean).join("، ") || "غير محدد";
  const isSelf = member.id === currentUserId;
  const [subcollectionProjects, setSubcollectionProjects] = useState<PortfolioProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSubcollectionProjects([]);
    void fetchProfileSubcollectionProjects(member.id, isSelf || isSuperUser)
      .then((items) => {
        if (!cancelled) setSubcollectionProjects(items);
      })
      .catch((error: unknown) => {
        console.error("Failed loading member subcollection projects:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [member.id, isSelf, isSuperUser]);

  const projects = useMemo(() => {
    const byId = new Map<string, PortfolioProject>();
    for (const item of member.projects ?? []) byId.set(item.id, item);
    for (const item of subcollectionProjects) byId.set(item.id, item);
    return Array.from(byId.values()).slice(0, 3);
  }, [member.projects, subcollectionProjects]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 620, maxHeight: "86vh", overflowY: "auto" }}
      >
        <button className="dialog-close" onClick={onClose} aria-label="إغلاق" style={{ zIndex: 2 }}>
          <X size={19} />
        </button>

        {member.cover_url && (
          <div
            style={{
              height: 112,
              margin: "-24px -24px 14px",
              borderRadius: "4px 16px 0 0",
              overflow: "hidden",
              background: "#dfe8cf",
            }}
          >
            <img
              src={member.cover_url}
              alt={`غلاف ${member.display_name}`}
              onClick={() => onPreviewImage(member.cover_url!, `غلاف ${member.display_name}`)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "pointer" }}
            />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div className="person-avatar blue" style={{ overflow: "hidden", width: 52, height: 52 }}>
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt={member.display_name}
                onClick={() => onPreviewImage(member.avatar_url!, member.display_name)}
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", cursor: "pointer" }}
              />
            ) : (
              getInitials(member.display_name)
            )}
          </div>
          <div>
            <h2 style={{ margin: 0 }}>{member.display_name}</h2>
            <p className="dialog-description" style={{ margin: "2px 0 0" }}>
              @{member.username} · {experienceLabel(member.experience_level)} · {location}
            </p>
          </div>
        </div>

        <div className="profile-section" style={{ paddingTop: 10 }}>
          <h3>نبذة</h3>
          {member.bio ? <BioTextWithLinks text={member.bio} /> : <p>لا توجد نبذة مضافة.</p>}
          {member.portfolio_url && (
            <div style={{ marginTop: 10 }}>
              <a
                href={member.portfolio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="cancel-button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                  color: "var(--green)",
                  fontWeight: 600,
                }}
              >
                <Link2 size={14} />
                <span>رابط الأعمال / البورتفوليو</span>
                <ExternalLink size={13} />
              </a>
            </div>
          )}
        </div>

        {member.skills.length > 0 && (
          <div className="profile-section">
            <h3>المهارات</h3>
            <div className="skill-list">
              {member.skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          </div>
        )}

        <div className="profile-section" style={{ borderBottom: 0 }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FolderKanban size={14} />
            أعمال ومشاريع ({formatArabicNumber(projects.length)})
          </h3>
          {projects.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                gap: 12,
                marginTop: 10,
              }}
            >
              {projects.map((proj) => (
                <ProjectCard key={proj.id} project={proj} onPreviewImage={onPreviewImage} />
              ))}
            </div>
          ) : (
            <p>لم يُضف مشاريع بعد.</p>
          )}
        </div>

        <div className="dialog-actions">
          {!isSuperUser && !isSelf && outgoingStatus === "accepted" && (
            <button type="button" className="primary-button" onClick={onOpenMessages}>
              تم القبول · فتح المحادثات <ArrowLeft size={15} />
            </button>
          )}
          {!isSuperUser && !isSelf && outgoingStatus === "pending" && (
            <span className="notif-status-tag pending" style={{ flex: 1, justifyContent: "center" }}>
              تم إرسال طلب التواصل — بانتظار الرد
            </span>
          )}
          {!isSuperUser && !isSelf && outgoingStatus !== "accepted" && outgoingStatus !== "pending" && (
            <button type="button" className="primary-button" onClick={() => onConnect(member)}>
              تواصل مع {member.display_name} <ArrowLeft size={15} />
            </button>
          )}
          <button type="button" className="cancel-button" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </section>
    </div>
  );
}

function mapTopupRequestDoc(id: string, data: Record<string, unknown>): TopupRequestRecord {
  return {
    id: typeof data.id === "string" ? data.id : id,
    userId: typeof data.userId === "string" ? data.userId : "",
    userDisplayName: typeof data.userDisplayName === "string" ? data.userDisplayName : "",
    username: typeof data.username === "string" ? data.username : "",
    userEmail: typeof data.userEmail === "string" ? data.userEmail : "",
    requested_transactions:
      typeof data.requested_transactions === "number" ? data.requested_transactions : 0,
    calculated_amount_egp:
      typeof data.calculated_amount_egp === "number" ? data.calculated_amount_egp : 0,
    transfer_reference: typeof data.transfer_reference === "string" ? data.transfer_reference : null,
    receipt_image_url: typeof data.receipt_image_url === "string" ? data.receipt_image_url : "",
    status: (data.status as TopupStatus) ?? "pending",
    approved_transactions:
      typeof data.approved_transactions === "number" ? data.approved_transactions : null,
    approved_amount_egp:
      typeof data.approved_amount_egp === "number" ? data.approved_amount_egp : null,
    admin_note: typeof data.admin_note === "string" ? data.admin_note : null,
    reviewed_by: typeof data.reviewed_by === "string" ? data.reviewed_by : null,
    createdAtMs: timestampToMillis(data.createdAt),
  };
}

function mapTransactionDoc(id: string, data: Record<string, unknown>): WalletTransactionRecord {
  return {
    id: typeof data.id === "string" ? data.id : id,
    userId: typeof data.userId === "string" ? data.userId : "",
    type: data.type === "debit" ? "debit" : "credit",
    title: typeof data.title === "string" ? data.title : "",
    amount_egp: typeof data.amount_egp === "number" ? data.amount_egp : 0,
    transactions_delta:
      typeof data.transactions_delta === "number" ? data.transactions_delta : 0,
    requestId: typeof data.requestId === "string" ? data.requestId : null,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAtMs: timestampToMillis(data.createdAt),
  };
}

function topupStatusLabel(status: TopupStatus) {
  switch (status) {
    case "approved":
      return "تمت الموافقة";
    case "rejected":
      return "مرفوض";
    default:
      return "قيد المراجعة";
  }
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "د"
  );
}

function formatArabicNumber(value: number) {
  return new Intl.NumberFormat("ar-EG").format(value);
}

function experienceLabel(level: DakhlProfile["experience_level"]) {
  switch (level) {
    case "beginner":
      return "مبتدئ";
    case "intermediate":
      return "متوسط الخبرة";
    case "professional":
      return "محترف";
    case "no_experience":
      return "لا أملك خبرة بعد";
    default:
      return "أكمل بيانات خبرتك";
  }
}

function ConnectRequestDialog({
  sender,
  target,
  unitPriceEgp,
  onClose,
  onSuccess,
  onFatalError,
}: {
  sender: DakhlProfile;
  target: DakhlProfile;
  unitPriceEgp: number;
  onClose: () => void;
  onSuccess: () => void;
  onFatalError: (err: Error) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async () => {
    setErrorMsg("");
    setBusy(true);
    try {
      await sendClientConnectionRequest({
        sender,
        target,
        message,
      });
      onSuccess();
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "CANNOT_CONTACT_SELF") {
        setErrorMsg("لا يمكنك إرسال طلب تواصل إلى نفسك.");
      } else if (error instanceof Error) {
        onFatalError(error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="connect-dialog-title">
        <button className="dialog-close" onClick={onClose} disabled={busy} aria-label="إغلاق">
          <X size={19} />
        </button>
        <div className="dialog-icon">
          <MessageCircle size={20} />
        </div>
        <h2 id="connect-dialog-title">ابدأ التواصل مع {target.display_name}</h2>
        <p className="dialog-description">
          سيصل إشعار فوري إلى @{target.username} بتفاصيل طلبك في قسم الإشعارات.
        </p>

        <label className="field-label" htmlFor="connect-request-message">
          تفاصيل الطلب أو المشروع (اختياري)
        </label>
        <textarea
          id="connect-request-message"
          className="dialog-input"
          rows={3}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="اكتب نبذة سريعة عن المطلوب، المدة المتوقعة، أو طريقة التواصل المفضلة..."
        />

        <div className="fee-breakdown">
          <div className="fee-total">
            <span>رسوم المعاملة عند القبول</span>
            <strong>{formatArabicNumber(unitPriceEgp)} ج.م</strong>
          </div>
          <small>إرسال الطلب مجاني تمامًا، ولن يُخصم شيء عند الإرسال.</small>
        </div>

        {errorMsg && (
          <div className="auth-message error" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
            {errorMsg}
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={15} /> جارٍ إرسال الطلب...
              </>
            ) : (
              <>
                إرسال طلب التواصل <ArrowLeft size={15} />
              </>
            )}
          </button>
          <button type="button" className="cancel-button" disabled={busy} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </section>
    </div>
  );
}

function Dialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <button className="dialog-close" onClick={onClose} aria-label="إغلاق">
          <X size={19} />
        </button>
        <div className="dialog-icon">
          <BriefcaseBusiness size={20} />
        </div>
        <h2 id="dialog-title">أضف فرصة جديدة</h2>
        <p className="dialog-description">ساعد المجتمع على اكتشاف فرصة عملك أو مشروعك.</p>
        <label className="field-label" htmlFor="opportunity-title">
          عنوان الفرصة
        </label>
        <input
          id="opportunity-title"
          className="dialog-input"
          placeholder="مثال: مصمم جرافيك لمشروع ناشئ"
        />
        <label className="field-label" htmlFor="opportunity-description">
          وصف مختصر
        </label>
        <textarea
          id="opportunity-description"
          className="dialog-input"
          placeholder="ما المهارات أو المهمة المطلوبة؟"
          rows={3}
        />
        <div className="payment-hint">
          <Check size={15} /> نشر الفرصة مجاني. سيظل المحتوى خاضعًا لإرشادات المجتمع.
        </div>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onConfirm}>
            حفظ كمسودة <ArrowLeft size={15} />
          </button>
          <button className="cancel-button" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
