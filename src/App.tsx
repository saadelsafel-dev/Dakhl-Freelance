import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import logo from "./logo.png";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  Compass,
  Eye,
  FileText,
  Heart,
  House,
  ImagePlus,
  LoaderCircle,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { db, handleFirestoreError, OperationType } from "./lib/firebase";
import {
  approveTopupRequest,
  formatArabicDate,
  manualCreditWallet,
  mapWalletDoc,
  mapWalletSettingsDoc,
  MAX_TOPUP_TRANSACTIONS,
  rejectTopupRequest,
  saveWalletSettings,
  submitTopupRequest,
  timestampToMillis,
} from "./lib/wallet";
import type {
  AuthMeta,
  DakhlProfile,
  TopupRequestRecord,
  TopupStatus,
  WalletRecord,
  WalletSettingsRecord,
  WalletTransactionRecord,
} from "./types/profile";

type Section = "home" | "discover" | "opportunities" | "messages" | "wallet" | "profile" | "admin";

type Person = {
  id: string;
  name: string;
  role: string;
  location: string;
  skills: string[];
  avatar: string;
  tone: string;
};

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
  name: string;
  last: string;
  time: string;
  avatar: string;
  tone: string;
};

const people: Person[] = [];
const opportunities: Opportunity[] = [];
const initialChats: ChatThread[] = [];

const baseNavItems: { id: Section; label: string; icon: typeof House }[] = [
  { id: "home", label: "الرئيسية", icon: House },
  { id: "discover", label: "اكتشف أشخاصًا", icon: Compass },
  { id: "opportunities", label: "الفرص", icon: BriefcaseBusiness },
  { id: "messages", label: "الرسائل", icon: MessageCircle },
  { id: "wallet", label: "المحفظة", icon: Wallet },
];

const sectionTitles: Record<Section, string> = {
  home: "الرئيسية",
  discover: "اكتشف أشخاصًا",
  opportunities: "فرص مناسبة لك",
  messages: "رسائلك",
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
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const [wallet, setWallet] = useState<WalletRecord>(() => mapWalletDoc(profile.id, undefined));
  const [walletSettings, setWalletSettings] = useState<WalletSettingsRecord>(() =>
    mapWalletSettingsDoc(undefined),
  );
  const [walletReady, setWalletReady] = useState(false);
  const [myRequests, setMyRequests] = useState<TopupRequestRecord[]>([]);
  const [myTransactions, setMyTransactions] = useState<WalletTransactionRecord[]>([]);

  const [adminRequests, setAdminRequests] = useState<TopupRequestRecord[]>([]);
  const [adminWallets, setAdminWallets] = useState<Record<string, WalletRecord>>({});
  const [adminProfiles, setAdminProfiles] = useState<DakhlProfile[]>([]);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [manualCreditTarget, setManualCreditTarget] = useState<DakhlProfile | null>(null);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) {
    throw fatalError;
  }

  const isSuperUser = authMeta.isSuperUser;
  const isLocked = !isSuperUser && (!wallet.is_unlocked || wallet.remaining_transactions <= 0);

  const navItems = useMemo(() => {
    if (isSuperUser) {
      return [...baseNavItems, { id: "admin" as Section, label: "إدارة المحافظ", icon: ShieldCheck }];
    }
    return baseNavItems;
  }, [isSuperUser]);

  useEffect(() => {
    const walletPath = `wallets/${profile.id}`;
    const unsubWallet = onSnapshot(
      doc(db, "wallets", profile.id),
      (snapshot) => {
        setWallet(mapWalletDoc(profile.id, snapshot.exists() ? snapshot.data() : undefined));
        setWalletReady(true);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, walletPath);
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    const reqQuery = query(collection(db, "topup_requests"), where("userId", "==", profile.id));
    const unsubRequests = onSnapshot(
      reqQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapTopupRequestDoc(d.id, d.data()));
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setMyRequests(items);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, "topup_requests");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    const txQuery = query(collection(db, "wallet_transactions"), where("userId", "==", profile.id));
    const unsubTx = onSnapshot(
      txQuery,
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapTransactionDoc(d.id, d.data()));
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setMyTransactions(items);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, "wallet_transactions");
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    const settingsPath = "app_settings/wallet";
    const unsubSettings = onSnapshot(
      doc(db, "app_settings", "wallet"),
      (snapshot) => {
        setWalletSettings(mapWalletSettingsDoc(snapshot.exists() ? snapshot.data() : undefined));
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, settingsPath);
        } catch (wrapped: unknown) {
          if (wrapped instanceof Error) setFatalError(wrapped);
        }
      },
    );

    return () => {
      unsubWallet();
      unsubRequests();
      unsubTx();
      unsubSettings();
    };
  }, [profile.id]);

  useEffect(() => {
    if (!isSuperUser) return;

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
      },
      (error) => {
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
        const list: DakhlProfile[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: typeof data.id === "string" ? data.id : d.id,
            username: typeof data.username === "string" ? data.username : "",
            display_name: typeof data.display_name === "string" ? data.display_name : "",
            avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : null,
            governorate: typeof data.governorate === "string" ? data.governorate : null,
            city: typeof data.city === "string" ? data.city : null,
            bio: typeof data.bio === "string" ? data.bio : null,
            experience_level: (data.experience_level as DakhlProfile["experience_level"]) ?? null,
            profile_completed: Boolean(data.profile_completed),
            skills: Array.isArray(data.skills) ? data.skills.filter((s): s is string => typeof s === "string") : [],
            interests: Array.isArray(data.interests)
              ? data.interests.filter((s): s is string => typeof s === "string")
              : [],
          };
        });
        setAdminProfiles(list);
      },
      (error) => {
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
  }, [isSuperUser]);

  const filteredPeople = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return people.filter((person) => {
      const matchesSearch =
        !queryText ||
        `${person.name} ${person.role} ${person.location} ${person.skills.join(" ")}`
          .toLowerCase()
          .includes(queryText);
      const matchesFilter =
        activeFilter === "الكل" || person.skills.some((skill) => skill.includes(activeFilter));
      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, search]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const unitPriceEgp = walletSettings.transaction_price_egp;
  const minTransactions = walletSettings.min_transactions;

  const navigateTo = (target: Section) => {
    if (isLocked && target !== "wallet") {
      setSection("wallet");
      showToast(
        `كل الأقسام مقفولة حاليًا — اشحن رصيدك (${formatArabicNumber(minTransactions)} معاملات على الأقل) لفتح الحساب.`,
      );
      return;
    }
    setSection(target);
  };

  const openConnection = (person: Person) => {
    if (isLocked) {
      setSection("wallet");
      showToast("يرجى شحن المحفظة أولًا لفتح التواصل.");
      return;
    }
    setSelectedPerson(person);
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

  const sendMessage = () => {
    const text = messageText.trim();
    if (!text || !activeChat) return;
    setSentMessages((current) => [...current, text]);
    setMessageText("");
  };

  const pendingAdminCount = adminRequests.filter((req) => req.status === "pending").length;
  const effectiveSection: Section = isLocked ? "wallet" : section;

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
                  : [profile.city, profile.governorate].filter(Boolean).join("، ") ||
                    experienceLabel(profile.experience_level)}
              </span>
            </div>
          </div>
          <div className="side-label">القائمة</div>
          <nav className="side-nav" aria-label="التنقل الرئيسي">
            {navItems.map((item) => {
              const Icon = item.icon;
              const itemLocked = isLocked && item.id !== "wallet";
              return (
                <button
                  key={item.id}
                  className={`nav-link ${effectiveSection === item.id ? "active" : ""}`}
                  onClick={() => navigateTo(item.id)}
                >
                  <Icon size={19} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {itemLocked && <Lock size={14} style={{ marginRight: "auto", opacity: 0.65 }} />}
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
                  {isLocked ? "تفعيل الحساب والمحفظة" : sectionTitles[effectiveSection]}
                </h1>
              </div>
            </div>
          )}

          {!walletReady && !isSuperUser ? (
            <div className="empty-state">جارٍ التحقق من حالة المحفظة...</div>
          ) : isLocked ? (
            <WalletContent
              isLocked
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
                  filteredPeople={filteredPeople}
                  setSection={navigateTo}
                  onConnect={openConnection}
                  saved={saved}
                  setSaved={setSaved}
                  onPublish={openPublish}
                  onOpenOpportunity={() => navigateTo("opportunities")}
                />
              )}
              {effectiveSection === "discover" && (
                <DiscoverContent
                  activeFilter={activeFilter}
                  setActiveFilter={setActiveFilter}
                  people={filteredPeople}
                  search={search}
                  onConnect={openConnection}
                  saved={saved}
                  setSaved={setSaved}
                />
              )}
              {effectiveSection === "opportunities" && (
                <OpportunitiesContent onSave={(title) => showToast(`تم حفظ «${title}» للمراجعة`)} />
              )}
              {effectiveSection === "messages" && (
                <MessagesContent
                  chats={initialChats}
                  activeChat={activeChat}
                  setActiveChat={setActiveChat}
                  messageText={messageText}
                  setMessageText={setMessageText}
                  sentMessages={sentMessages}
                  onSend={sendMessage}
                />
              )}
              {effectiveSection === "wallet" && (
                <WalletContent
                  isLocked={false}
                  wallet={wallet}
                  unitPriceEgp={unitPriceEgp}
                  minTransactions={minTransactions}
                  requests={myRequests}
                  transactions={myTransactions}
                  onTopup={() => setDialog("topup")}
                  onPreviewReceipt={setReceiptPreviewUrl}
                />
              )}
              {effectiveSection === "profile" && <ProfileContent profile={profile} />}
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
              <span>{isSuperUser ? "حساب الإدارة" : "رصيد المحفظة"}</span>
              <span className="wallet-icon">
                <Wallet size={17} />
              </span>
            </div>
            <strong>
              {isSuperUser ? (
                <>
                  مفعل <small>Superuser</small>
                </>
              ) : (
                <>
                  {formatArabicNumber(wallet.balance_egp)} <small>ج.م</small>
                </>
              )}
            </strong>
            {!isSuperUser && (
              <div style={{ fontSize: 11, color: "#c7d7cd", marginTop: 4 }}>
                المعاملات المتاحة: {formatArabicNumber(wallet.remaining_transactions)}
              </div>
            )}
            <button onClick={() => (isSuperUser ? navigateTo("admin") : setDialog("topup"))}>
              {isSuperUser ? (
                <>
                  إدارة الطلبات ({formatArabicNumber(pendingAdminCount)})
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
            <p>
              أقل عدد معاملات للشحن هو {formatArabicNumber(minTransactions)} معاملات (
              {formatArabicNumber(unitPriceEgp)} ج.م للمعاملة)، ويتم اعتماد الرصيد يدويًا من الإدارة.
            </p>
          </div>
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>بياناتك الخاصة، مثل رقم هاتفك، لا تظهر على ملفك العام.</span>
          </div>
        </aside>
      </div>

      <nav className="mobile-nav" aria-label="التنقل">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const itemLocked = isLocked && item.id !== "wallet";
          return (
            <button
              key={item.id}
              className={effectiveSection === item.id ? "active" : ""}
              onClick={() => navigateTo(item.id)}
            >
              {itemLocked ? <Lock size={18} /> : <Icon size={20} />}
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

      {dialog && dialog !== "topup" && (
        <Dialog
          type={dialog}
          person={selectedPerson}
          unitPriceEgp={unitPriceEgp}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            showToast(dialog === "connect" ? "تم إغلاق النافذة." : "نشر الفرص قيد التفعيل.");
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
  filteredPeople: Person[];
  setSection: (section: Section) => void;
  onConnect: (person: Person) => void;
  saved: string[];
  setSaved: (value: string[] | ((current: string[]) => string[])) => void;
  onPublish: () => void;
  onOpenOpportunity: () => void;
}) {
  const filters = ["الكل", "تصميم", "كتابة", "تطوير"];
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
        <div className="filter-row">
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
          {props.filteredPeople.slice(0, 3).map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              onConnect={props.onConnect}
              saved={props.saved.includes(person.id)}
              onSave={() =>
                props.setSaved((current) =>
                  current.includes(person.id)
                    ? current.filter((id) => id !== person.id)
                    : [...current, person.id],
                )
              }
            />
          ))}
          {props.filteredPeople.length === 0 && (
            <div className="empty-state">
              {props.search.trim() || props.activeFilter !== "الكل"
                ? "لا توجد نتائج مطابقة. جرّب كلمة بحث أخرى."
                : "لا يوجد أعضاء مسجلون للعرض حاليًا."}
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
  activeFilter: string;
  setActiveFilter: (value: string) => void;
  people: Person[];
  search: string;
  onConnect: (person: Person) => void;
  saved: string[];
  setSaved: (value: string[] | ((current: string[]) => string[])) => void;
}) {
  return (
    <section className="section-block discover-page">
      <div className="discover-toolbar">
        <div className="filter-row">
          {["الكل", "تصميم", "كتابة", "تطوير"].map((filter) => (
            <button
              key={filter}
              className={`filter-chip ${props.activeFilter === filter ? "selected" : ""}`}
              onClick={() => props.setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>
      <div className="people-grid">
        {props.people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            onConnect={props.onConnect}
            saved={props.saved.includes(person.id)}
            onSave={() =>
              props.setSaved((current) =>
                current.includes(person.id)
                  ? current.filter((id) => id !== person.id)
                  : [...current, person.id],
              )
            }
          />
        ))}
        {props.people.length === 0 && (
          <div className="empty-state">
            {props.search.trim() || props.activeFilter !== "الكل"
              ? "لا توجد نتائج مطابقة لهذا التصنيف."
              : "لا يوجد أعضاء متاحون للاكتشاف حاليًا."}
          </div>
        )}
      </div>
    </section>
  );
}

function PersonCard({
  person,
  onConnect,
  saved,
  onSave,
}: {
  person: Person;
  onConnect: (person: Person) => void;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <article className="person-card">
      <div className="person-card-top">
        <div className={`person-avatar ${person.tone}`}>{person.avatar}</div>
        <button
          className={`save-button ${saved ? "saved" : ""}`}
          aria-label={saved ? "إزالة من المحفوظات" : "حفظ الملف"}
          onClick={onSave}
        >
          <Heart size={17} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="person-name-row">
        <h3>{person.name}</h3>
      </div>
      <p className="person-role">{person.role}</p>
      <div className="person-location">
        <MapPin size={14} />
        {person.location}
      </div>
      <div className="skill-list">
        {person.skills.map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>
      <div className="person-card-footer">
        <button className="connect-button" onClick={() => onConnect(person)}>
          تواصل <ArrowLeft size={14} />
        </button>
      </div>
    </article>
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

function MessagesContent(props: {
  chats: ChatThread[];
  activeChat: string | null;
  setActiveChat: (id: string) => void;
  messageText: string;
  setMessageText: (value: string) => void;
  sentMessages: string[];
  onSend: () => void;
}) {
  const currentThread = props.chats.find((chat) => chat.id === props.activeChat) ?? null;

  return (
    <section className="messages-panel">
      <div className="chat-list">
        <div className="chat-list-title">
          <h3>المحادثات</h3>
        </div>
        {props.chats.length > 0 ? (
          props.chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => props.setActiveChat(chat.id)}
              className={`chat-preview ${props.activeChat === chat.id ? "current" : ""}`}
            >
              <div className={`person-avatar small ${chat.tone}`}>{chat.avatar}</div>
              <div className="chat-preview-copy">
                <div>
                  <strong>{chat.name}</strong>
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
              <div className={`person-avatar small ${currentThread.tone}`}>{currentThread.avatar}</div>
              <div>
                <strong>{currentThread.name}</strong>
              </div>
            </div>
            {props.sentMessages.map((message, index) => (
              <div key={`${message}-${index}`} className="chat-bubble sent">
                {message}
                <time>
                  الآن <Check size={12} />
                </time>
              </div>
            ))}
            <div className="chat-compose">
              <input
                value={props.messageText}
                onChange={(event) => props.setMessageText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onSend();
                }}
                placeholder="اكتب رسالة..."
              />
              <button className="send-button" onClick={props.onSend} aria-label="إرسال">
                <Send size={17} />
              </button>
            </div>
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

function WalletContent({
  isLocked,
  wallet,
  unitPriceEgp,
  minTransactions,
  requests,
  transactions,
  onTopup,
  onPreviewReceipt,
}: {
  isLocked: boolean;
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
            {isLocked ? "الحساب مقفول — يتطلب شحن المحفظة" : "رصيدك المتاح"}
          </span>
          <strong>
            {formatArabicNumber(wallet.balance_egp)} <small>جنيه مصري</small>
          </strong>
          <p>
            {isLocked ? <Lock size={15} /> : <ShieldCheck size={15} />}
            {" "}
            المعاملات المتاحة: {formatArabicNumber(wallet.remaining_transactions)} معاملة
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
              : `أقل عدد معاملات للشحن هو ${formatArabicNumber(minTransactions)} معاملات (${formatArabicNumber(unitPriceEgp)} ج.م للمعاملة)`}
          </strong>
          <p>
            {isLocked
              ? hasPending
                ? "طلبك قيد المراجعة الآن. بمجرد تأكيد التحويل وإضافة الرصيد يدويًا من الإدارة ستُفتح جميع أقسام المنصة تلقائيًا."
                : `قدّم طلب شحن بعدد المحاولات المطلوبة (${formatArabicNumber(minTransactions)} معاملات على الأقل · ${formatArabicNumber(unitPriceEgp)} ج.م للمعاملة) وأرفق صورة التحويل، وستقوم الإدارة بمراجعة الطلب وإضافة الرصيد يدويًا لفتح الحساب.`
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
            return (
              <div className="transaction-row" key={userProfile.id}>
                <div className="transaction-copy">
                  <strong>
                    {userProfile.display_name} (@{userProfile.username})
                  </strong>
                  <span>
                    الحالة: {unlocked ? "مفعل" : "مقفول"} · الرصيد:{" "}
                    {formatArabicNumber(balance)} ج.م · المعاملات المتاحة:{" "}
                    {formatArabicNumber(remaining)}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onOpenManualCredit(userProfile)}
                >
                  <Plus size={14} /> إضافة رصيد
                </button>
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
        <div className="dialog-icon">
          <Wallet size={20} />
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

function ProfileContent({ profile }: { profile: DakhlProfile }) {
  const location = [profile.city, profile.governorate].filter(Boolean).join("، ");
  return (
    <section className="profile-page">
      <div className="profile-cover">
        <div className="profile-avatar large">
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : getInitials(profile.display_name)}
        </div>
      </div>
      <div className="profile-details">
        <div className="profile-details-head">
          <div>
            <div className="person-name-row">
              <h2>{profile.display_name}</h2>
            </div>
            <p>
              @{profile.username}
              {location && (
                <>
                  {" "}
                  <span>·</span> {location}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="profile-section">
          <h3>نبذة عني</h3>
          <p>{profile.bio || "لم تُضف نبذة بعد."}</p>
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
    </section>
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

function Dialog({
  type,
  person,
  unitPriceEgp,
  onClose,
  onConfirm,
}: {
  type: "connect" | "publish";
  person: Person | null;
  unitPriceEgp: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isConnect = type === "connect";
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
          {isConnect ? <MessageCircle size={20} /> : <BriefcaseBusiness size={20} />}
        </div>
        <h2 id="dialog-title">
          {isConnect ? `ابدأ التواصل مع ${person?.name ?? ""}` : "أضف فرصة جديدة"}
        </h2>
        <p className="dialog-description">
          {isConnect
            ? "طلب التواصل مجاني. عند القبول، تُخصم رسوم واضحة من الطرفين."
            : "ساعد المجتمع على اكتشاف فرصة عملك أو مشروعك."}
        </p>
        {isConnect && (
          <div className="fee-breakdown">
            <div>
              <span>رسوم عليك عند القبول</span>
              <strong>{formatArabicNumber(unitPriceEgp)} ج.م</strong>
            </div>
            <div>
              <span>رسوم على الطرف الآخر عند القبول</span>
              <strong>{formatArabicNumber(unitPriceEgp)} ج.م</strong>
            </div>
            <div className="fee-total">
              <span>إجمالي رسوم المنصة</span>
              <strong>{formatArabicNumber(unitPriceEgp * 2)} ج.م</strong>
            </div>
            <small>لن يُخصم شيء عند إرسال الطلب. يحتاج الطرفان إلى رصيد كافٍ قبل القبول.</small>
          </div>
        )}
        {type === "publish" && (
          <>
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
          </>
        )}
        <div className="dialog-actions">
          <button className="primary-button" onClick={onConfirm}>
            {isConnect ? "متابعة الطلب" : "حفظ كمسودة"} <ArrowLeft size={15} />
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
