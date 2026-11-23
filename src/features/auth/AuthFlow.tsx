import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from "firebase/auth";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
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
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  storage,
} from "../../lib/firebase";
import { isSuperUserAccount } from "../../lib/wallet";
import type { AuthMeta, DakhlProfile, ExperienceLevel } from "../../types/profile";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 80;
const LOCATION_MAX = 80;
const BIO_MAX = 300;
const SKILL_MAX_COUNT = 20;
const SKILL_MAX_LENGTH = 60;
const INTEREST_MIN_COUNT = 1;
const INTEREST_MAX_COUNT = 20;
const AVATAR_URL_MAX = 1000;

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
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) {
    throw fatalError;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
        setAuthError("");
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
      setProfileLoading(false);
      setProfileError("");
      return;
    }

    const profilePath = `profiles/${user.uid}`;
    setProfileLoading(true);
    setProfileError("");

    const unsubscribe = onSnapshot(
      doc(db, "profiles", user.uid),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setProfile({
            id: typeof data.id === "string" ? data.id : snapshot.id,
            username: typeof data.username === "string" ? data.username : "",
            display_name: typeof data.display_name === "string" ? data.display_name : "",
            avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : null,
            governorate: typeof data.governorate === "string" ? data.governorate : null,
            city: typeof data.city === "string" ? data.city : null,
            bio: typeof data.bio === "string" ? data.bio : null,
            experience_level: (data.experience_level as ExperienceLevel | null) ?? null,
            profile_completed: Boolean(data.profile_completed),
            skills: Array.isArray(data.skills)
              ? data.skills.filter((item): item is string => typeof item === "string")
              : [],
            interests: Array.isArray(data.interests)
              ? data.interests.filter((item): item is string => typeof item === "string")
              : [],
          });
        } else {
          setProfile(null);
        }
        setProfileLoading(false);
      },
      (error) => {
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
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        console.error("Firebase Google sign-in failed.", error);
      }
      setAuthError(authErrorMessage(error));
    }
  }

  async function signOut() {
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

  if (profileLoading) return <LoadingPage label="جارٍ تحميل ملفك..." />;

  if (profileError) {
    return (
      <StatusPage
        message={profileError}
        onRetry={() => setProfileRefresh((value) => value + 1)}
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

  function continueToNextStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step === 0) {
      if (!USERNAME_PATTERN.test(username.trim().toLowerCase())) {
        setError("اسم المستخدم يجب أن يتكون من ٣ إلى ٢٤ حرفًا إنجليزيًا صغيرًا أو رقمًا أو _.");
        return;
      }
      const cleanName = displayName.trim();
      if (cleanName.length < DISPLAY_NAME_MIN || cleanName.length > DISPLAY_NAME_MAX) {
        setError("اكتب اسمًا كاملًا بين حرفين و٨٠ حرفًا.");
        return;
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
          const extension = avatarFile.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
          const storageRef = ref(storage, `avatars/${user.uid}/${crypto.randomUUID()}.${extension}`);
          await uploadBytes(storageRef, avatarFile, { contentType: avatarFile.type });
          const downloadedUrl = await getDownloadURL(storageRef);
          if (downloadedUrl.length <= AVATAR_URL_MAX) {
            finalAvatarUrl = downloadedUrl;
          }
        } catch (uploadError: unknown) {
          console.error("Avatar upload failed:", uploadError);
          setError("تعذر رفع الصورة الشخصية حاليًا. يمكنك المتابعة بدون صورة أو المحاولة مجددًا.");
          setAvatarFile(null);
          setSaving(false);
          return;
        }
      }

      const profilePath = `profiles/${user.uid}`;
      const profileRef = doc(db, "profiles", user.uid);
      const usernameRef = doc(db, "usernames", cleanUsername);

      try {
        await runTransaction(db, async (transaction) => {
          const [usernameSnap, profileSnap] = await Promise.all([
            transaction.get(usernameRef),
            transaction.get(profileRef),
          ]);

          if (usernameSnap.exists() && usernameSnap.data().userId !== user.uid) {
            throw new Error("USERNAME_TAKEN");
          }

          if (profileSnap.exists()) {
            const existingUsername = profileSnap.data().username;
            if (typeof existingUsername === "string" && existingUsername && existingUsername !== cleanUsername) {
              transaction.delete(doc(db, "usernames", existingUsername));
            }
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
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.update(profileRef, {
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
            });
          }
        });
      } catch (txError: unknown) {
        if (txError instanceof Error && txError.message === "USERNAME_TAKEN") {
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
              <p>أضف بيانات بسيطة تساعد الآخرين على معرفة من أنت.</p>
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
              <h1>ما المهارات التي تتقنها؟</h1>
              <p>اختر من القائمة أو أضف مهارة أخرى. يمكنك تعديلها لاحقًا.</p>
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
                <legend>مستوى الخبرة</legend>
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
                <legend>أنواع الفرص التي تهمك</legend>
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
            <button type="submit" className="auth-submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={18} /> : null}
              {step === 2 ? "إنهاء الإعداد" : "التالي"}
              {!saving && <ArrowLeft size={17} />}
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

function authErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "تم إغلاق نافذة تسجيل الدخول قبل إكمال العملية.";
  }
  if (code === "auth/popup-blocked") {
    return "حظر المتصفح نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.";
  }
  if (code === "auth/unauthorized-domain") {
    return "هذا النطاق غير مصرح به في إعدادات Firebase Authentication.";
  }
  if (code === "auth/network-request-failed") {
    return "تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بالإنترنت.";
  }
  return "تعذر إكمال تسجيل الدخول عبر Google. حاول مرة أخرى.";
}
