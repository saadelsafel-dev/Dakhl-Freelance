import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  getRedirectResult,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  LoaderCircle,
  LogOut,
  UserRound,
} from "lucide-react";
import logo from "../../logo.png";
import {
  auth,
  authPersistenceReady,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from "../../lib/firebase";
import { AVATAR_WEBP_MAX_LENGTH, convertImageToWebpDataUrl } from "../../lib/media";
import { isSuperUserAccount, mapProfileDoc } from "../../lib/wallet";
import type { AccountType, AuthMeta, DakhlProfile, ExperienceLevel } from "../../types/profile";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 80;
const LOCATION_MAX = 80;
const BIO_MAX = 500;
const SKILL_MAX_COUNT = 20;
const SKILL_MAX_LENGTH = 60;
const INTEREST_MIN_COUNT = 1;
const INTEREST_MAX_COUNT = 20;
const AVATAR_URL_MAX = 50000;

const suggestedSkills = [
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

const interestOptions = [
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

const experienceOptions: { value: ExperienceLevel; label: string; description: string }[] = [
  { value: "beginner", label: "مبتدئ", description: "أبدأ في اكتساب الخبرة" },
  { value: "intermediate", label: "متوسط", description: "لدي خبرة في بعض المشاريع" },
  { value: "professional", label: "محترف", description: "أعمل في مجالي باحتراف" },
  { value: "no_experience", label: "لا أملك خبرة بعد", description: "اختيار طبيعي ومناسب تمامًا" },
];

const accountTypeOptions: { value: AccountType; label: string; description: string }[] = [
  {
    value: "freelancer",
    label: "مستقل (فريلانسر)",
    description: "أقدّم مهاراتي وخدماتي — يتطلب شحن المحفظة لفتح الحساب والظهور في «تعيين».",
  },
  {
    value: "client",
    label: "صاحب مشروع (عميل)",
    description: "أبحث عن مستقلين للتعاون معهم — الحساب مفتوح مباشرة ولا يظهر في «تعيين».",
  },
];

interface AuthFlowProps {
  children: (profile: DakhlProfile, onSignOut: () => Promise<void>, authMeta: AuthMeta) => ReactNode;
}

interface ProfileDraft extends Omit<DakhlProfile, "profile_completed"> {
  profile_completed?: boolean;
}

export default function AuthFlow({ children }: AuthFlowProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [profile, setProfile] = useState<DakhlProfile | null>(null);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [, setAuthTick] = useState(0);
  const [fatalError, setFatalError] = useState<Error | null>(null);
  const backfilledAccountTypeRef = useRef<string | null>(null);
  const lastUidRef = useRef<string | null>(null);
  const signingInRef = useRef(false);

  if (fatalError) {
    throw fatalError;
  }

  useEffect(() => {
    void authPersistenceReady.then(() => getRedirectResult(auth)).catch((error: unknown) => {
      const code = getFirebaseAuthCode(error);
      if (code && code !== "auth/no-auth-event") {
        setAuthError(authErrorMessage(error));
      }
    });

    const unsubscribe = onIdTokenChanged(
      auth,
      (nextUser) => {
        const nextUid = nextUser?.uid ?? null;
        if (nextUid !== lastUidRef.current) {
          lastUidRef.current = nextUid;
          setProfile(null);
          setProfileUid(null);
          setProfileError("");
          setProfileLoading(Boolean(nextUser));
          backfilledAccountTypeRef.current = null;
        }
        setUser(nextUser);
        setAuthReady(true);
        if (nextUser) {
          setAuthError("");
        }
      },
      (error) => {
        console.error("Could not restore Firebase Auth state.", error);
        setAuthError("تعذر استعادة جلسة الدخول. حدّث الصفحة وحاول مرة أخرى.");
        setAuthReady(true);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady || !user) {
      setProfile(null);
      setProfileUid(null);
      setProfileLoading(false);
      setProfileError("");
      return;
    }

    const activeUid = user.uid;
    const profilePath = `profiles/${activeUid}`;
    setProfileLoading(true);
    setProfileError("");

    const unsubscribe = onSnapshot(
      doc(db, "profiles", activeUid),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();

          if (
            typeof data.account_type !== "string" &&
            data.profile_completed &&
            user.emailVerified &&
            backfilledAccountTypeRef.current !== activeUid
          ) {
            backfilledAccountTypeRef.current = activeUid;
            void updateDoc(doc(db, "profiles", activeUid), {
              account_type: "freelancer",
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }

          setProfile(mapProfileDoc(snapshot.id, data));
        } else {
          setProfile(null);
        }
        setProfileUid(activeUid);
        setProfileLoading(false);
      },
      (error) => {
        if (!auth.currentUser) {
          setProfileLoading(false);
          return;
        }
        try {
          handleFirestoreError(error, OperationType.GET, profilePath);
        } catch (wrappedError: unknown) {
          if (
            wrappedError instanceof Error &&
            wrappedError.message.includes("Missing or insufficient permissions")
          ) {
            setFatalError(wrappedError);
          } else {
            setProfileError("تعذر تحميل ملفك من قاعدة البيانات. حاول مرة أخرى.");
            setProfileLoading(false);
          }
        }
      },
    );

    return () => unsubscribe();
  }, [authReady, user?.uid, profileRefresh]);

  async function signInWithGoogle() {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setAuthError("");
    try {
      await authPersistenceReady;
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      const code = getFirebaseAuthCode(error);
      if (code === "auth/cancelled-popup-request") {
        return;
      }
      if (code !== "auth/popup-closed-by-user") {
        console.error("Firebase Google sign-in failed.", error);
      }
      setAuthError(authErrorMessage(error));
    } finally {
      signingInRef.current = false;
    }
  }

  async function signOut() {
    setAuthError("");
    setProfileError("");
    try {
      await firebaseSignOut(auth);
    } catch (error: unknown) {
      console.error("Firebase sign-out failed.", error);
      setProfileError("تعذر تسجيل الخروج. حاول مرة أخرى.");
    }
  }

  if (!authReady) return <LoadingPage label="جارٍ التحقق من جلسة الدخول..." />;

  if (!user) {
    return (
      <AuthPage
        error={authError}
        onGoogle={signInWithGoogle}
        onError={setAuthError}
      />
    );
  }

  if (profileLoading || profileUid !== user.uid) {
    return <LoadingPage label="جارٍ تحميل ملفك..." />;
  }

  if (profileError) {
    return (
      <StatusPage
        message={profileError}
        onRetry={() => setProfileRefresh((value) => value + 1)}
        onSignOut={signOut}
      />
    );
  }

  if (!user.emailVerified) {
    return (
      <VerifyEmailPage
        email={user.email ?? ""}
        onSendVerification={async () => {
          const current = auth.currentUser ?? user;
          await sendEmailVerification(current);
        }}
        onRefresh={async () => {
          const current = auth.currentUser ?? user;
          await current.reload();
          await current.getIdToken(true);
          const refreshed = auth.currentUser ?? current;
          setUser(refreshed);
          setAuthTick((value) => value + 1);
          setProfileRefresh((value) => value + 1);
          return Boolean(refreshed.emailVerified);
        }}
        onSignOut={signOut}
      />
    );
  }

  if (!profile?.profile_completed) {
    return (
      <Onboarding
        key={user.uid}
        user={user}
        initialProfile={profile}
        onComplete={() => setProfileRefresh((value) => value + 1)}
        onFatalError={setFatalError}
        onSignOut={signOut}
      />
    );
  }

  const authMeta: AuthMeta = {
    email: user.email ?? "",
    emailVerified: Boolean(user.emailVerified),
    isSuperUser: isSuperUserAccount(user.email, Boolean(user.emailVerified)),
  };

  return <>{children(profile, signOut, authMeta)}</>;
}

function AuthPage({
  error,
  onGoogle,
  onError,
}: {
  error: string;
  onGoogle: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function startGoogleSignIn() {
    setBusy(true);
    try {
      await onGoogle();
    } catch (googleError: unknown) {
      console.error("Google authentication request failed unexpectedly.", googleError);
      onError("تعذر بدء الدخول عبر Google. تحقق من اتصالك وحاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card">
        <img className="auth-logo" src={logo} alt="دخل" />
        <div className="auth-heading">
          <span className="auth-kicker">فرصتك تبدأ من هنا</span>
          <h1>أهلًا بك في دخل</h1>
          <p>سجّل دخولك باستخدام حساب Google واكتشف فرصًا تناسب مهاراتك.</p>
        </div>

        {error && (
          <div className="auth-message error" role="alert">
            {error}
          </div>
        )}

        <button className="google-button" type="button" disabled={busy} onClick={startGoogleSignIn}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <GoogleMark />}
          <span>المتابعة باستخدام Google</span>
        </button>

        <p className="auth-privacy">بيانات حسابك محفوظة بأمان، ولا نعرض بريدك الإلكتروني على ملفك العام.</p>
      </section>
    </main>
  );
}

function Onboarding({
  user,
  initialProfile,
  onComplete,
  onFatalError,
  onSignOut,
}: {
  user: User;
  initialProfile: ProfileDraft | null;
  onComplete: () => void;
  onFatalError: (error: Error) => void;
  onSignOut: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [accountType, setAccountType] = useState<AccountType | "">(
    initialProfile?.account_type ?? "",
  );
  const [username, setUsername] = useState(
    initialProfile?.username ?? `user_${user.uid.slice(0, 8).toLowerCase().replace(/[^a-z0-9_]/g, "")}`,
  );
  const [displayName, setDisplayName] = useState(
    initialProfile?.display_name ?? getUserDisplayName(user),
  );
  const [governorate, setGovernorate] = useState(initialProfile?.governorate ?? "");
  const [city, setCity] = useState(initialProfile?.city ?? "");
  const [bio, setBio] = useState(initialProfile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(
    initialProfile?.avatar_url ?? (user.photoURL && user.photoURL.length <= AVATAR_URL_MAX ? user.photoURL : ""),
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [skills, setSkills] = useState<string[]>(initialProfile?.skills ?? []);
  const [customSkill, setCustomSkill] = useState("");
  const [experience, setExperience] = useState<ExperienceLevel | "">(
    initialProfile?.experience_level ?? "",
  );
  const [interests, setInterests] = useState<string[]>(initialProfile?.interests ?? []);
  const [saving, setSaving] = useState(false);
  const [checkingStep, setCheckingStep] = useState(false);
  const [error, setError] = useState("");
  const previewUrl = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : avatarUrl),
    [avatarFile, avatarUrl],
  );

  useEffect(() => {
    return () => {
      if (avatarFile && previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [avatarFile, previewUrl]);

  function toggleSelection(value: string, selected: string[], update: (next: string[]) => void) {
    update(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  function addCustomSkill() {
    const value = customSkill.trim();
    if (
      !value ||
      value.length > SKILL_MAX_LENGTH ||
      skills.some((skill) => skill.toLowerCase() === value.toLowerCase())
    ) {
      return;
    }
    if (skills.length >= SKILL_MAX_COUNT) {
      setError("يمكنك اختيار ٢٠ مهارة بحد أقصى.");
      return;
    }
    setSkills((current) => [...current, value]);
    setCustomSkill("");
    setError("");
  }

  async function continueToNextStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step === 0) {
      if (!accountType) {
        setError("اختر نوع الحساب (مستقل أم صاحب مشروع) للمتابعة.");
        return;
      }
      const cleanUsername = username.trim().toLowerCase();
      if (!USERNAME_PATTERN.test(cleanUsername)) {
        setError("اسم المستخدم يجب أن يتكون من ٣ إلى ٢٤ حرفًا إنجليزيًا صغيرًا أو رقمًا أو _.");
        return;
      }
      const cleanName = displayName.trim();
      if (cleanName.length < DISPLAY_NAME_MIN || cleanName.length > DISPLAY_NAME_MAX) {
        setError("اكتب اسمًا كاملًا بين حرفين و٨٠ حرفًا.");
        return;
      }
      setCheckingStep(true);
      try {
        const usernameSnap = await getDoc(doc(db, "usernames", cleanUsername));
        if (usernameSnap.exists() && usernameSnap.data().userId !== user.uid) {
          setError("اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.");
          return;
        }
      } catch {
        // Proceed if offline check cannot run; transaction will validate availability
      } finally {
        setCheckingStep(false);
      }
    }
    if (step === 2) {
      if (!experience) {
        setError("اختر مستوى خبرتك، ويمكنك اختيار «لا أملك خبرة بعد».");
        return;
      }
      if (interests.length < INTEREST_MIN_COUNT || interests.length > INTEREST_MAX_COUNT) {
        setError("اختر نوع فرصة واحدًا على الأقل وبحد أقصى ٢٠.");
        return;
      }
      void saveProfile();
      return;
    }
    setStep((current) => current + 1);
  }

  async function saveProfile() {
    setSaving(true);
    setError("");
    const cleanUsername = username.trim().toLowerCase();
    const cleanDisplayName = displayName.trim().slice(0, DISPLAY_NAME_MAX);
    const cleanGovernorate = governorate.trim().slice(0, LOCATION_MAX) || null;
    const cleanCity = city.trim().slice(0, LOCATION_MAX) || null;
    const cleanBio = bio.trim().slice(0, BIO_MAX) || null;
    const cleanSkills = skills
      .map((item) => item.trim())
      .filter((item) => item.length >= 1 && item.length <= SKILL_MAX_LENGTH)
      .slice(0, SKILL_MAX_COUNT);
    const cleanInterests = interests
      .map((item) => item.trim())
      .filter((item) => item.length >= 1 && item.length <= SKILL_MAX_LENGTH)
      .slice(0, INTEREST_MAX_COUNT);

    if (!accountType) {
      setStep(0);
      setError("اختر نوع الحساب (مستقل أم صاحب مشروع).");
      setSaving(false);
      return;
    }
    if (!USERNAME_PATTERN.test(cleanUsername)) {
      setError("اسم المستخدم يجب أن يتكون من ٣ إلى ٢٤ حرفًا إنجليزيًا صغيرًا أو رقمًا أو _.");
      setSaving(false);
      return;
    }
    if (cleanDisplayName.length < DISPLAY_NAME_MIN) {
      setError("اكتب اسمًا كاملًا مكوّنًا من حرفين على الأقل.");
      setSaving(false);
      return;
    }
    if (!experience || cleanInterests.length < INTEREST_MIN_COUNT) {
      setError("أكمل اختيار الخبرة والفرص التي تهمك.");
      setSaving(false);
      return;
    }

    try {
      let finalAvatarUrl: string | null =
        avatarUrl && avatarUrl.length <= AVATAR_URL_MAX ? avatarUrl : null;

      if (avatarFile) {
        try {
          finalAvatarUrl = await uploadAvatarImage(avatarFile);
        } catch (uploadError: unknown) {
          console.error("Avatar upload failed:", uploadError);
          setError("تعذر معالجة الصورة الشخصية. يمكنك المتابعة بدون صورة أو اختيار صورة أخرى.");
          setAvatarFile(null);
          setSaving(false);
          return;
        }
      }

      const profilePath = `profiles/${user.uid}`;
      const profileRef = doc(db, "profiles", user.uid);
      const usernameRef = doc(db, "usernames", cleanUsername);

      try {
        await user.getIdToken(true);
        await runTransaction(db, async (transaction) => {
          const [usernameSnap, profileSnap] = await Promise.all([
            transaction.get(usernameRef),
            transaction.get(profileRef),
          ]);

          if (usernameSnap.exists() && usernameSnap.data().userId !== user.uid) {
            throw new Error("USERNAME_TAKEN");
          }

          let oldUsernameRefToDelete: ReturnType<typeof doc> | null = null;
          if (profileSnap.exists()) {
            const existingUsername = profileSnap.data().username;
            if (typeof existingUsername === "string" && existingUsername && existingUsername !== cleanUsername) {
              const oldRef = doc(db, "usernames", existingUsername);
              const oldUsernameSnap = await transaction.get(oldRef);
              if (oldUsernameSnap.exists() && oldUsernameSnap.data().userId === user.uid) {
                oldUsernameRefToDelete = oldRef;
              }
            }
          }

          if (oldUsernameRefToDelete) {
            transaction.delete(oldUsernameRefToDelete);
          }

          if (!usernameSnap.exists()) {
            transaction.set(usernameRef, {
              userId: user.uid,
              createdAt: serverTimestamp(),
            });
          }

          if (!profileSnap.exists()) {
            transaction.set(profileRef, {
              id: user.uid,
              username: cleanUsername,
              display_name: cleanDisplayName,
              avatar_url: finalAvatarUrl,
              governorate: cleanGovernorate,
              city: cleanCity,
              bio: cleanBio,
              experience_level: experience,
              profile_completed: true,
              skills: cleanSkills,
              interests: cleanInterests,
              has_balance: false,
              account_type: accountType,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            const updatePayload: Record<string, unknown> = {
              username: cleanUsername,
              display_name: cleanDisplayName,
              avatar_url: finalAvatarUrl,
              governorate: cleanGovernorate,
              city: cleanCity,
              bio: cleanBio,
              experience_level: experience,
              profile_completed: true,
              skills: cleanSkills,
              interests: cleanInterests,
              updatedAt: serverTimestamp(),
            };
            if (!profileSnap.data().account_type) {
              updatePayload.account_type = accountType;
            }
            transaction.update(profileRef, updatePayload);
          }
        });
      } catch (txError: unknown) {
        if (txError instanceof Error && txError.message === "USERNAME_TAKEN") {
          setStep(0);
          setError("اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.");
          setSaving(false);
          return;
        }
        try {
          handleFirestoreError(txError, OperationType.WRITE, profilePath);
        } catch (wrappedError: unknown) {
          if (
            wrappedError instanceof Error &&
            (wrappedError.message.includes("Missing or insufficient permissions") ||
              wrappedError.message.includes("Quota exceeded"))
          ) {
            onFatalError(wrappedError);
            return;
          }
          setError("تعذر حفظ بياناتك. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.");
          setSaving(false);
          return;
        }
      }

      onComplete();
    } catch (saveError: unknown) {
      console.error("Profile setup failed unexpectedly.", saveError);
      setError("تعذر حفظ بياناتك بسبب مشكلة اتصال. تحقق من الإنترنت ثم حاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز ٥ ميجابايت.");
      event.target.value = "";
      return;
    }
    setAvatarFile(file);
    setAvatarUrl("");
    setError("");
  }

  return (
    <main className="setup-page" dir="rtl">
      <header className="setup-header">
        <img src={logo} alt="دخل" />
        <button type="button" className="setup-signout" onClick={() => void onSignOut()}>
          <LogOut size={16} /> تسجيل الخروج
        </button>
      </header>
      <section className="setup-card">
        <div className="setup-progress">
          {["ملفك الأساسي", "مهاراتك", "خبرتك واهتماماتك"].map((label, index) => (
            <div className={`setup-progress-step ${index <= step ? "active" : ""}`} key={label}>
              <span>{index < step ? <Check size={14} /> : index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>

        <form onSubmit={continueToNextStep}>
          {step === 0 && (
            <div className="setup-step">
              <span className="auth-kicker">خطوة ١ من ٣</span>
              <h1>خلّينا نتعرّف عليك</h1>
              <p>حدّد نوع حسابك وأضف بيانات بسيطة تساعدنا على تجهيز تجربتك.</p>
              <fieldset className="experience-options" style={{ marginBottom: 18 }}>
                <legend>نوع الحساب</legend>
                {accountTypeOptions.map((option) => (
                  <label
                    className={`experience-option ${accountType === option.value ? "selected" : ""}`}
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name="account_type"
                      value={option.value}
                      checked={accountType === option.value}
                      onChange={() => {
                        setAccountType(option.value);
                        setError("");
                      }}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <i>{accountType === option.value && <Check size={13} />}</i>
                  </label>
                ))}
              </fieldset>
              <label className="avatar-upload">
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} />
                <span className="avatar-preview">
                  {previewUrl ? <img src={previewUrl} alt="معاينة الصورة الشخصية" /> : <UserRound size={28} />}
                  <i>
                    <ImagePlus size={14} />
                  </i>
                </span>
                <span>
                  <strong>صورة شخصية</strong>
                  <small>اختيارية · حتى ٥ ميجابايت</small>
                </span>
              </label>
              <div className="setup-fields">
                <label>
                  <span>الاسم الكامل</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    minLength={DISPLAY_NAME_MIN}
                    maxLength={DISPLAY_NAME_MAX}
                  />
                </label>
                <label>
                  <span>اسم المستخدم الفريد</span>
                  <input
                    value={username}
                    onChange={(event) =>
                      setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                    }
                    required
                    minLength={3}
                    maxLength={24}
                    dir="ltr"
                  />
                </label>
                <label>
                  <span>المحافظة</span>
                  <input
                    value={governorate}
                    onChange={(event) => setGovernorate(event.target.value)}
                    maxLength={LOCATION_MAX}
                    placeholder="مثال: الجيزة"
                  />
                </label>
                <label>
                  <span>المدينة</span>
                  <input
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    maxLength={LOCATION_MAX}
                    placeholder="مثال: السادس من أكتوبر"
                  />
                </label>
              </div>
              <label className="setup-label">
                <span>
                  نبذة قصيرة عنك <small>اختياري</small>
                </span>
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  maxLength={BIO_MAX}
                  rows={3}
                  placeholder="ما الذي تحب أن يعرفه الآخرون عنك؟"
                />
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="setup-step">
              <span className="auth-kicker">خطوة ٢ من ٣</span>
              <h1>
                {accountType === "client"
                  ? "ما التخصصات التي تهم مشاريعك؟"
                  : "ما المهارات التي تتقنها؟"}
              </h1>
              <p>
                {accountType === "client"
                  ? "اختر التخصصات التي تبحث عنها عند تعيين المستقلين، أو أضف تخصصًا آخر (اختياري)."
                  : "اختر من القائمة أو أضف مهارة أخرى. يمكنك تعديلها لاحقًا."}
              </p>
              <div className="selection-grid">
                {suggestedSkills.map((skill) => (
                  <button
                    className={`selection-chip ${skills.includes(skill) ? "selected" : ""}`}
                    type="button"
                    key={skill}
                    onClick={() => {
                      if (!skills.includes(skill) && skills.length >= SKILL_MAX_COUNT) {
                        setError("يمكنك اختيار ٢٠ مهارة بحد أقصى.");
                        return;
                      }
                      toggleSelection(skill, skills, setSkills);
                      setError("");
                    }}
                  >
                    {skills.includes(skill) && <Check size={15} />}
                    {skill}
                  </button>
                ))}
              </div>
              <div className="custom-skill-form">
                <input
                  value={customSkill}
                  onChange={(event) => setCustomSkill(event.target.value)}
                  maxLength={SKILL_MAX_LENGTH}
                  placeholder="أضف مهارة أخرى"
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
                      onClick={() => setSkills((current) => current.filter((value) => value !== skill))}
                    >
                      {skill}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="setup-step">
              <span className="auth-kicker">خطوة ٣ من ٣</span>
              <h1>اختر ما يناسبك</h1>
              <p>كل البدايات مرحّب بها، والاختيار قابل للتعديل لاحقًا.</p>
              <fieldset className="experience-options">
                <legend>
                  {accountType === "client" ? "خبرتك في إدارة المشاريع" : "مستوى الخبرة"}
                </legend>
                {experienceOptions.map((option) => (
                  <label
                    className={`experience-option ${experience === option.value ? "selected" : ""}`}
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name="experience"
                      value={option.value}
                      checked={experience === option.value}
                      onChange={() => setExperience(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <i>{experience === option.value && <Check size={13} />}</i>
                  </label>
                ))}
              </fieldset>
              <fieldset className="interest-options">
                <legend>
                  {accountType === "client" ? "أنواع المشاريع التي تبحث عنها" : "أنواع الفرص التي تهمك"}
                </legend>
                <div className="selection-grid">
                  {interestOptions.map((interest) => (
                    <button
                      className={`selection-chip ${interests.includes(interest) ? "selected" : ""}`}
                      type="button"
                      key={interest}
                      onClick={() => toggleSelection(interest, interests, setInterests)}
                    >
                      {interests.includes(interest) && <Check size={15} />}
                      {interest}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {error && (
            <div className="auth-message error" role="alert">
              {error}
            </div>
          )}
          <div className="setup-actions">
            {step > 0 && (
              <button
                type="button"
                className="setup-back"
                disabled={saving}
                onClick={() => {
                  setError("");
                  setStep((current) => current - 1);
                }}
              >
                <ArrowRight size={17} /> السابق
              </button>
            )}
            <button type="submit" className="auth-submit" disabled={saving || checkingStep}>
              {saving || checkingStep ? <LoaderCircle className="spin" size={18} /> : null}
              {step === 2 ? "إنهاء الإعداد" : "التالي"}
              {!saving && !checkingStep && <ArrowLeft size={17} />}
            </button>
          </div>
        </form>
        <p className="auth-privacy">لا تحتاج إلى خبرة سابقة أو سيرة ذاتية لتبدأ.</p>
      </section>
    </main>
  );
}

function LoadingPage({ label }: { label: string }) {
  return (
    <main className="auth-page" dir="rtl">
      <div className="auth-loading">
        <LoaderCircle className="spin" size={23} />
        {label}
      </div>
    </main>
  );
}

function StatusPage({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card status-card">
        <img className="auth-logo" src={logo} alt="دخل" />
        <div className="auth-message error" role="alert">
          {message}
        </div>
        <div className="setup-actions">
          <button className="setup-back" type="button" onClick={() => void onSignOut()}>
            <LogOut size={16} /> تسجيل الخروج
          </button>
          <button className="auth-submit" type="button" onClick={onRetry}>
            إعادة المحاولة <ArrowLeft size={17} />
          </button>
        </div>
      </section>
    </main>
  );
}

function VerifyEmailPage({
  email,
  onSendVerification,
  onRefresh,
  onSignOut,
}: {
  email: string;
  onSendVerification: () => Promise<void>;
  onRefresh: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  async function handleSend() {
    setBusy(true);
    setNotice("");
    setErr("");
    try {
      await onSendVerification();
      setNotice("تم إرسال رابط التفعيل إلى بريدك الإلكتروني. افتح الرابط ثم اضغط «تحققت من البريد».");
    } catch (error: unknown) {
      const code = getFirebaseAuthCode(error);
      if (code === "auth/too-many-requests") {
        setErr("تم إرسال عدة طلبات متتالية. انتظر دقيقة واحدة ثم أعد المحاولة.");
      } else {
        setErr("تعذر إرسال رابط التفعيل حاليًا. حاول بعد قليل أو سجّل الدخول بحساب Google موثق.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    setNotice("");
    setErr("");
    try {
      const verified = await onRefresh();
      if (!verified) {
        setErr("لم يتم تأكيد البريد الإلكتروني بعد. افتح رسالة التفعيل في بريدك ثم اضغط مرة أخرى.");
      }
    } catch {
      setErr("تعذر التحقق من الحالة الآن. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card status-card">
        <img className="auth-logo" src={logo} alt="دخل" />
        <div className="auth-heading">
          <span className="auth-kicker">تأكيد البريد الإلكتروني</span>
          <h1>فعّل بريدك للمتابعة</h1>
          <p>
            لإنشاء حسابك وحفظ بياناتك بأمان، يجب أن يكون البريد الإلكتروني ({email || "الحالي"})
            مؤكدًا.
          </p>
        </div>
        {notice && (
          <div className="auth-message success" role="status">
            {notice}
          </div>
        )}
        {err && (
          <div className="auth-message error" role="alert">
            {err}
          </div>
        )}
        <div className="setup-actions" style={{ flexWrap: "wrap" }}>
          <button className="setup-back" type="button" disabled={busy} onClick={() => void onSignOut()}>
            <LogOut size={16} /> تسجيل الخروج
          </button>
          <button className="setup-back" type="button" disabled={busy} onClick={() => void handleSend()}>
            إرسال رابط التفعيل
          </button>
          <button className="auth-submit" type="button" disabled={busy} onClick={() => void handleRefresh()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            تحققت من البريد · متابعة <ArrowLeft size={17} />
          </button>
        </div>
      </section>
    </main>
  );
}

async function uploadAvatarImage(file: File): Promise<string> {
  return convertImageToWebpDataUrl(file, {
    maxSide: 220,
    maxLength: AVATAR_WEBP_MAX_LENGTH,
  });
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="19" height="19">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.27 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

function getUserDisplayName(user: User) {
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim().slice(0, DISPLAY_NAME_MAX);
  }
  return user.email?.split("@")[0]?.slice(0, DISPLAY_NAME_MAX) ?? "";
}

function getFirebaseAuthCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

function authErrorMessage(error: unknown) {
  const code = getFirebaseAuthCode(error);

  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "تم إغلاق نافذة تسجيل الدخول قبل إكمال العملية.";
  }
  if (code === "auth/popup-blocked") {
    return "حظر المتصفح نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.";
  }
  if (code === "auth/unauthorized-domain") {
    return "هذا النطاق غير مضاف في النطاقات المصرح بها داخل Firebase Authentication.";
  }
  if (code === "auth/operation-not-allowed") {
    return "تسجيل الدخول عبر Google غير مفعّل حاليًا في إعدادات Firebase Authentication.";
  }
  if (code === "auth/operation-not-supported-in-this-environment") {
    return "هذا المتصفح يمنع نوافذ تسجيل الدخول هنا. افتح التطبيق في نافذة متصفح عادية وأعد المحاولة.";
  }
  if (code === "auth/web-storage-unsupported") {
    return "المتصفح يمنع حفظ بيانات الجلسة (Cookies / Storage). فعّل ملفات تعريف الارتباط ثم أعد المحاولة.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "هذا البريد مرتبط بطريقة دخول أخرى. سجّل الدخول بالطريقة السابقة نفسها.";
  }
  if (code === "auth/user-disabled") {
    return "تم تعطيل هذا الحساب مؤقتًا. تواصل مع الإدارة للمساعدة.";
  }
  if (code === "auth/too-many-requests") {
    return "تم إرسال محاولات دخول كثيرة متتالية. انتظر قليلًا ثم أعد المحاولة.";
  }
  if (code === "auth/user-token-expired" || code === "auth/invalid-credential") {
    return "انتهت صلاحية جلسة الدخول. أعد تسجيل الدخول عبر Google.";
  }
  if (code === "auth/network-request-failed") {
    return "تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بالإنترنت.";
  }
  if (code === "auth/internal-error") {
    return "حدث خطأ مؤقت في خدمة المصادقة. حدّث الصفحة وحاول مرة أخرى.";
  }
  return "تعذر إكمال تسجيل الدخول عبر Google. حاول مرة أخرى.";
}
