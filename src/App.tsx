import { useMemo, useState } from "react";
import logo from "./logo.png";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  Clock3,
  Compass,
  FileText,
  Heart,
  House,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Wallet,
  LogOut,
  X,
} from "lucide-react";
import type { DakhlProfile } from "./types/profile";

type Section = "home" | "discover" | "opportunities" | "messages" | "wallet" | "profile";
type Person = {
  name: string;
  role: string;
  location: string;
  skills: string[];
  avatar: string;
  tone: string;
};

const people: Person[] = [
  {
    name: "سارة محمود",
    role: "مصممة واجهات وتجربة مستخدم",
    location: "السادس من أكتوبر",
    skills: ["تصميم UI/UX", "Figma", "تصميم تطبيقات"],
    avatar: "سم",
    tone: "rose",
  },
  {
    name: "عمر خالد",
    role: "مطور واجهات أمامية",
    location: "الجيزة · عن بُعد",
    skills: ["React", "TypeScript", "واجهات ويب"],
    avatar: "عخ",
    tone: "blue",
  },
  {
    name: "ندى إبراهيم",
    role: "كاتبة محتوى وصانعة أفكار",
    location: "القاهرة",
    skills: ["كتابة محتوى", "SEO", "سوشيال ميديا"],
    avatar: "نإ",
    tone: "lavender",
  },
];

const opportunities = [
  {
    title: "مطلوب مصمم هوية بصرية لمشروع ناشئ",
    company: "مساحة · مشروع ناشئ",
    location: "عن بُعد",
    type: "عمل حر",
    skills: ["تصميم هوية", "Illustrator", "Figma"],
    time: "منذ ساعتين",
    avatar: "م",
    tone: "mint",
  },
  {
    title: "كتابة محتوى لصفحات متجر إلكتروني",
    company: "بيت الحرفة",
    location: "السادس من أكتوبر",
    type: "دوام جزئي",
    skills: ["كتابة محتوى", "عربي", "تسويق"],
    time: "منذ ٥ ساعات",
    avatar: "ب",
    tone: "peach",
  },
  {
    title: "مطور واجهات لموقع تعريفي",
    company: "فريق نقطة",
    location: "عن بُعد",
    type: "مشروع قصير",
    skills: ["React", "CSS", "JavaScript"],
    time: "أمس",
    avatar: "ن",
    tone: "blue",
  },
];

const navItems: { id: Section; label: string; icon: typeof House }[] = [
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
};

function App({ profile, onSignOut }: { profile: DakhlProfile; onSignOut: () => Promise<void> }) {
  const [section, setSection] = useState<Section>("home");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("الكل");
  const [dialog, setDialog] = useState<"connect" | "topup" | "publish" | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person>(people[0]);
  const [saved, setSaved] = useState<string[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [activeChat, setActiveChat] = useState("سارة محمود");
  const [toast, setToast] = useState("");
  const [topupAmount, setTopupAmount] = useState("200");

  const filteredPeople = useMemo(() => {
    const query = search.trim().toLowerCase();
    return people.filter((person) => {
      const matchesSearch =
        !query ||
        `${person.name} ${person.role} ${person.location} ${person.skills.join(" ")}`
          .toLowerCase()
          .includes(query);
      const matchesFilter = activeFilter === "الكل" || person.skills.some((skill) => skill.includes(activeFilter));
      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, search]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const openConnection = (person: Person) => {
    setSelectedPerson(person);
    setDialog("connect");
  };

  const sendMessage = () => {
    const text = messageText.trim();
    if (!text) return;
    setSentMessages((current) => [...current, text]);
    setMessageText("");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setSection("home")} aria-label="العودة للرئيسية">
          <span className="brand-logo-window">
            <img className="brand-logo" src={logo} alt="DAKHL" />
          </span>
        </button>
        <label className="global-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث عن مهارة، فرصة، أو شخص..."
          />
        </label>
        <div className="top-actions">
          <button className="create-button" onClick={() => setDialog("publish")}>
            <Plus size={17} />
            <span>أضف فرصة</span>
          </button>
          <button className="top-avatar" onClick={() => setSection("profile")} aria-label="ملفي الشخصي">
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : getInitials(profile.display_name)}
          </button>
          <button className="logout-button" onClick={() => void onSignOut()} aria-label="تسجيل الخروج" title="تسجيل الخروج">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="prototype-notice">
        <ShieldCheck size={15} />
        <span>بيئة تجريبية — لن تُنفّذ مدفوعات أو طلبات تواصل حقيقية.</span>
      </div>

      <div className="page-layout">
        <aside className="right-sidebar">
          <div className="sidebar-profile">
            <div className="profile-avatar">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : getInitials(profile.display_name)}</div>
            <div className="sidebar-profile-copy">
              <strong>{profile.display_name}</strong>
              <span>{[profile.city, profile.governorate].filter(Boolean).join("، ") || experienceLabel(profile.experience_level)}</span>
            </div>
          </div>
          <div className="side-label">القائمة</div>
          <nav className="side-nav" aria-label="التنقل الرئيسي">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`nav-link ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}>
                  <Icon size={19} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-divider" />
          <button className={`nav-link ${section === "profile" ? "active" : ""}`} onClick={() => setSection("profile")}>
            <FileText size={19} strokeWidth={1.8} />
            <span>ملفي الشخصي</span>
          </button>
        </aside>

        <main className="main-content">
          <div className="mobile-greeting"><h1>أهلًا، {profile.display_name}</h1></div>
          {section !== "home" && (
            <div className="content-heading">
              <div>
                <h1>{sectionTitles[section]}</h1>
              </div>
            </div>
          )}

          {section === "home" && (
            <HomeContent
              search={search}
              setSearch={setSearch}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              filteredPeople={filteredPeople}
              setSection={setSection}
              onConnect={openConnection}
              saved={saved}
              setSaved={setSaved}
              onPublish={() => setDialog("publish")}
              onOpenOpportunity={() => setSection("opportunities")}
            />
          )}
          {section === "discover" && (
            <DiscoverContent
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              people={filteredPeople}
              onConnect={openConnection}
              saved={saved}
              setSaved={setSaved}
            />
          )}
          {section === "opportunities" && <OpportunitiesContent onSave={(title) => showToast(`تم حفظ «${title}» للمراجعة`)}/>}
          {section === "messages" && (
            <MessagesContent
              activeChat={activeChat}
              setActiveChat={setActiveChat}
              messageText={messageText}
              setMessageText={setMessageText}
              sentMessages={sentMessages}
              onSend={sendMessage}
            />
          )}
          {section === "wallet" && <WalletContent onTopup={() => setDialog("topup")} />}
          {section === "profile" && <ProfileContent profile={profile} />}
        </main>

        <aside className="left-sidebar">
          <div className="balance-card">
            <div className="balance-card-top">
              <span>رصيد المحفظة</span>
              <span className="wallet-icon"><Wallet size={17} /></span>
            </div>
            <strong>١٬٢٨٠ <small>ج.م</small></strong>
            <button onClick={() => setDialog("topup")}>إضافة رصيد <Plus size={15} /></button>
          </div>
          <div className="fee-note">
            <h3>رسوم التواصل</h3>
            <p>إرسال الطلب مجاني. عند القبول، يدفع كل طرف ٢٠ ج.م.</p>
          </div>
          <div className="trust-note"><ShieldCheck size={17} /><span>بياناتك الخاصة، مثل رقم هاتفك، لا تظهر على ملفك العام.</span></div>
        </aside>
      </div>

      <nav className="mobile-nav" aria-label="التنقل">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon size={20} /><span>{item.label === "اكتشف أشخاصًا" ? "اكتشف" : item.label === "فرص مناسبة لك" ? "الفرص" : item.label}</span></button>;
        })}
      </nav>

      {dialog && (
        <Dialog
          type={dialog}
          person={selectedPerson}
          amount={topupAmount}
          setAmount={setTopupAmount}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (dialog === "topup" && Number(topupAmount) < 200) {
              showToast("الحد الأدنى لشحن المحفظة هو ٢٠٠ جنيه.");
              return;
            }
            showToast(dialog === "connect" ? "تم تجهيز طلب التواصل — لن يُرسل من هذا النموذج." : dialog === "topup" ? "هذا نموذج توضيحي؛ لا يتم تحويل أموال." : "هذا نموذج توضيحي؛ لم يتم نشر فرصة.");
            setDialog(null);
          }}
        />
      )}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}

function HomeContent(props: {
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
  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <h2>من مهارتك، يبدأ دخلُك.</h2>
          <p>فرص عمل ومشاريع تناسب مهاراتك.</p>
          <div className="welcome-actions">
            <button className="banner-primary" onClick={() => props.setSection("opportunities")}>شاهدي الفرص <ArrowLeft size={16} /></button>
            <button className="banner-link" onClick={props.onPublish}><Plus size={15} /> انشري فرصة</button>
          </div>
        </div>
        <div className="banner-art" aria-label="مثال على فرصة منشورة">
          <div className="opportunity-ticket">
            <div className="ticket-top"><span className="ticket-mark">م</span><span className="ticket-status">فرصة مفتوحة</span></div>
            <span className="ticket-caption">مشروع جديد · عن بُعد</span>
            <strong>هوية بصرية<br />لمشروع محلي</strong>
            <div className="ticket-skills"><span>تصميم</span><span>هوية بصرية</span><span>عمل حر</span></div>
            <div className="ticket-bottom"><span>التقديم مجاني</span><ArrowLeft size={15} /></div>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-title-row">
          <h2>أشخاص قد يهمّك التعرف عليهم</h2>
          <button className="text-link" onClick={() => props.setSection("discover")}>اكتشفي الجميع <ArrowLeft size={15} /></button>
        </div>
        <div className="filter-row">
          <label className="inline-search"><Search size={16}/><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="ابحثي بالاسم أو المهارة" /></label>
          {filters.map((filter) => <button key={filter} className={`filter-chip ${props.activeFilter === filter ? "selected" : ""}`} onClick={() => props.setActiveFilter(filter)}>{filter}</button>)}
        </div>
        <div className="people-grid">
          {props.filteredPeople.slice(0, 3).map((person) => (
            <PersonCard key={person.name} person={person} onConnect={props.onConnect} saved={props.saved.includes(person.name)} onSave={() => props.setSaved((current) => current.includes(person.name) ? current.filter((name) => name !== person.name) : [...current, person.name])}/>
          ))}
          {props.filteredPeople.length === 0 && <div className="empty-state">لا توجد نتائج مطابقة. جربي كلمة بحث أخرى.</div>}
        </div>
      </section>

      <section className="section-block opportunity-preview">
        <div className="section-title-row">
          <h2>فرص بدأت للتو</h2>
          <button className="text-link" onClick={() => props.setSection("opportunities")}>كل الفرص <ArrowLeft size={15} /></button>
        </div>
        {opportunities.slice(0, 2).map((opportunity) => <OpportunityRow key={opportunity.title} opportunity={opportunity} onOpen={props.onOpenOpportunity} />)}
      </section>
    </>
  );
}

function DiscoverContent(props: {
  activeFilter: string;
  setActiveFilter: (value: string) => void;
  people: Person[];
  onConnect: (person: Person) => void;
  saved: string[];
  setSaved: (value: string[] | ((current: string[]) => string[])) => void;
}) {
  return (
    <section className="section-block discover-page">
      <div className="discover-toolbar">
      <div className="filter-row">
          {["الكل", "تصميم", "كتابة", "تطوير"].map((filter) => <button key={filter} className={`filter-chip ${props.activeFilter === filter ? "selected" : ""}`} onClick={() => props.setActiveFilter(filter)}>{filter}</button>)}
        </div>
      </div>
      <div className="people-grid">
        {props.people.map((person) => <PersonCard key={person.name} person={person} onConnect={props.onConnect} saved={props.saved.includes(person.name)} onSave={() => props.setSaved((current) => current.includes(person.name) ? current.filter((name) => name !== person.name) : [...current, person.name])}/>)}
        {props.people.length === 0 && <div className="empty-state">لا توجد نتائج مطابقة لهذا التصنيف.</div>}
      </div>
    </section>
  );
}

function PersonCard({ person, onConnect, saved, onSave }: { person: Person; onConnect: (person: Person) => void; saved: boolean; onSave: () => void }) {
  return (
    <article className="person-card">
      <div className="person-card-top">
        <div className={`person-avatar ${person.tone}`}>{person.avatar}</div>
        <button className={`save-button ${saved ? "saved" : ""}`} aria-label={saved ? "إزالة من المحفوظات" : "حفظ الملف"} onClick={onSave}><Heart size={17} fill={saved ? "currentColor" : "none"} /></button>
      </div>
      <div className="person-name-row"><h3>{person.name}</h3></div>
      <p className="person-role">{person.role}</p>
      <div className="person-location"><MapPin size={14}/>{person.location}</div>
      <div className="skill-list">{person.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
      <div className="person-card-footer">
        <button className="connect-button" onClick={() => onConnect(person)}>تواصل <ArrowLeft size={14}/></button>
      </div>
    </article>
  );
}

function OpportunitiesContent({ onSave }: { onSave: (title: string) => void }) {
  return (
    <section className="section-block opportunity-list-page">
      <div className="opportunity-page-intro"><div><strong>فرص المجتمع</strong><span>التصفح والنشر مجانيان.</span></div></div>
      {opportunities.map((opportunity) => <OpportunityRow key={opportunity.title} opportunity={opportunity} onSave={() => onSave(opportunity.title)} expanded />)}
    </section>
  );
}

function OpportunityRow({ opportunity, onSave, onOpen, expanded = false }: { opportunity: (typeof opportunities)[number]; onSave?: () => void; onOpen?: () => void; expanded?: boolean }) {
  return (
    <article className={`opportunity-row ${expanded ? "expanded" : ""}`}>
      <div className={`company-avatar ${opportunity.tone}`}>{opportunity.avatar}</div>
      <div className="opportunity-main">
        <div className="opportunity-meta"><span>{opportunity.company}</span><time>{opportunity.time}</time></div>
        <h3>{opportunity.title}</h3>
        <div className="opportunity-tags"><span><MapPin size={13}/>{opportunity.location}</span><span><BriefcaseBusiness size={13}/>{opportunity.type}</span></div>
        {expanded && <div className="skill-list opportunity-skills">{opportunity.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
      </div>
      <button className="row-action" aria-label={expanded ? "احفظي الفرصة" : "عرض كل الفرص"} onClick={expanded ? onSave : onOpen}>{expanded ? "احفظيها" : <ArrowLeft size={17}/>}</button>
    </article>
  );
}

function MessagesContent(props: {
  activeChat: string;
  setActiveChat: (name: string) => void;
  messageText: string;
  setMessageText: (value: string) => void;
  sentMessages: string[];
  onSend: () => void;
}) {
  const chats = [
    { name: "سارة محمود", last: "شكرًا لكِ! أرسل لك التفاصيل اليوم.", time: "١٠:٤٢", avatar: "سم", tone: "rose" },
    { name: "عمر خالد", last: "هل يناسبك اجتماع قصير؟", time: "أمس", avatar: "عخ", tone: "blue" },
    { name: "فريق مساحة", last: "وصلتنا نماذجك، شكرًا.", time: "الأربعاء", avatar: "م", tone: "mint" },
  ];
  return (
    <section className="messages-panel">
      <div className="chat-list">
        <div className="chat-list-title"><h3>المحادثات</h3></div>
        {chats.map((chat) => <button key={chat.name} onClick={() => props.setActiveChat(chat.name)} className={`chat-preview ${props.activeChat === chat.name ? "current" : ""}`}><div className={`person-avatar small ${chat.tone}`}>{chat.avatar}</div><div className="chat-preview-copy"><div><strong>{chat.name}</strong><time>{chat.time}</time></div><p>{chat.last}</p></div></button>)}
      </div>
      <div className="chat-window">
        <div className="chat-header"><div className="person-avatar small rose">سم</div><div><strong>{props.activeChat}</strong></div></div>
        <div className="chat-notice"><Clock3 size={15}/> تظهر معلومات التواصل الخاصة بعد قبول طلب التواصل. المحادثة تُغلق بعد ٧ أيام من عدم النشاط.</div>
        <div className="chat-date">اليوم، ١٠:٣٤ ص</div>
        <div className="chat-bubble received">أهلًا مريم! شفت ملفك وعجبني شغلك في التصميم. 😊<time>١٠:٣٤</time></div>
        <div className="chat-bubble sent">أهلًا سارة، شكرًا لكِ! يسعدني أعرف أكثر عن المشروع.<time>١٠:٣٧ <Check size={12}/></time></div>
        <div className="chat-bubble received">شكرًا لكِ! أرسل لك التفاصيل اليوم.<time>١٠:٤٢</time></div>
        {props.sentMessages.map((message, index) => <div key={`${message}-${index}`} className="chat-bubble sent">{message}<time>الآن <Check size={12}/></time></div>)}
        <div className="chat-compose"><input value={props.messageText} onChange={(event) => props.setMessageText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onSend(); }} placeholder="اكتبي رسالة..." /><button className="send-button" onClick={props.onSend} aria-label="إرسال"><Send size={17}/></button></div>
      </div>
    </section>
  );
}

function WalletContent({ onTopup }: { onTopup: () => void }) {
  return (
    <section className="wallet-page">
      <div className="wallet-summary">
        <div><span>رصيدك المتاح</span><strong>١٬٢٨٠ <small>جنيه مصري</small></strong><p><ShieldCheck size={15}/> كل العمليات المالية موضحة في سجلّك</p></div>
        <button className="primary-button" onClick={onTopup}><Plus size={17}/> شحن المحفظة</button>
      </div>
      <div className="wallet-info"><div className="info-icon"><CircleHelp size={18}/></div><div><strong>الشحن يبدأ من ٢٠٠ جنيه</strong><p>رصيدك بالكامل قابل للاستخدام. تتم مراجعة التحويلات يدويًا قبل إضافة الرصيد.</p></div></div>
      <div className="transaction-card"><div className="section-title-row"><div><h2>آخر العمليات</h2></div></div>
        {[
          { title: "شحن المحفظة", date: "١٨ نوفمبر ٢٠٢٦ · ١٢:٤٠ م", value: "+ ١٬٠٠٠ ج.م", icon: ArrowDownLeft, kind: "credit" },
          { title: "طلب تواصل · سارة محمود", date: "١٤ نوفمبر ٢٠٢٦ · ٠٩:١٥ ص", value: "− ٢٠ ج.م", icon: ArrowUpLeft, kind: "debit" },
          { title: "شحن المحفظة", date: "٠٢ نوفمبر ٢٠٢٦ · ٠٤:٢٠ م", value: "+ ٣٠٠ ج.م", icon: ArrowDownLeft, kind: "credit" },
        ].map((item) => { const Icon = item.icon; return <div className="transaction-row" key={item.title + item.date}><span className={`transaction-icon ${item.kind}`}><Icon size={17}/></span><div className="transaction-copy"><strong>{item.title}</strong><span>{item.date}</span></div><strong className={item.kind}>{item.value}</strong></div>; })}
      </div>
      <div className="legal-footnote">المبالغ المعروضة تجريبية. قبل أي استخدام مالي حقيقي، تُطبّق سياسة الاسترداد والرسوم المنشورة وتُستكمل المراجعة القانونية والمحاسبية.</div>
    </section>
  );
}

function ProfileContent({ profile }: { profile: DakhlProfile }) {
  const location = [profile.city, profile.governorate].filter(Boolean).join("، ");
  return (
    <section className="profile-page">
      <div className="profile-cover"><div className="profile-avatar large">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : getInitials(profile.display_name)}</div></div>
      <div className="profile-details"><div className="profile-details-head"><div><div className="person-name-row"><h2>{profile.display_name}</h2></div><p>@{profile.username}{location && <> <span>·</span> {location}</>}</p></div></div>
        <div className="profile-section"><h3>نبذة عني</h3><p>{profile.bio || "لم تُضف نبذة بعد."}</p></div>
        <div className="profile-section"><h3>المهارات</h3><div className="skill-list">{profile.skills.length > 0 ? profile.skills.map((skill) => <span key={skill}>{skill}</span>) : <span>لم تُضف مهارات بعد</span>}</div></div>
        <div className="profile-section"><h3>الخبرة</h3><p>{experienceLabel(profile.experience_level)}</p></div>
        <div className="profile-section"><h3>الفرص التي تهمني</h3><div className="skill-list">{profile.interests.map((interest) => <span key={interest}>{interest}</span>)}</div></div>
        <div className="profile-section beginner-tip"><span>لا تحتاج إلى سيرة ذاتية أو خبرة سابقة للبدء — شارك ما تعرفه الآن.</span></div>
      </div>
    </section>
  );
}

function getInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "د";
}

function experienceLabel(level: DakhlProfile["experience_level"]) {
  switch (level) {
    case "beginner": return "مبتدئ";
    case "intermediate": return "متوسط الخبرة";
    case "professional": return "محترف";
    case "no_experience": return "لا أملك خبرة بعد";
    default: return "أكمل بيانات خبرتك";
  }
}

function Dialog({ type, person, amount, setAmount, onClose, onConfirm }: {
  type: "connect" | "topup" | "publish";
  person: Person;
  amount: string;
  setAmount: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isConnect = type === "connect";
  const isTopup = type === "topup";
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <button className="dialog-close" onClick={onClose} aria-label="إغلاق"><X size={19}/></button>
        <div className="dialog-icon">{isConnect ? <MessageCircle size={20}/> : isTopup ? <Wallet size={20}/> : <BriefcaseBusiness size={20}/>}</div>
        <h2 id="dialog-title">{isConnect ? `ابدئي التواصل مع ${person.name}` : isTopup ? "شحن المحفظة" : "أضيفي فرصة جديدة"}</h2>
        <p className="dialog-description">{isConnect ? "طلب التواصل مجاني. عند القبول، تُخصم رسوم واضحة من الطرفين." : isTopup ? "اختاري قيمة الشحن. الحد الأدنى ٢٠٠ جنيه مصري." : "ساعدي المجتمع على اكتشاف فرصة عملك أو مشروعك."}</p>
        {isConnect && <div className="fee-breakdown"><div><span>رسوم عليكِ عند القبول</span><strong>٢٠ ج.م</strong></div><div><span>رسوم على الطرف الآخر عند القبول</span><strong>٢٠ ج.م</strong></div><div className="fee-total"><span>إجمالي رسوم المنصة</span><strong>٤٠ ج.م</strong></div><small>لن يُخصم شيء عند إرسال الطلب. يحتاج الطرفان إلى رصيد كافٍ قبل القبول.</small></div>}
        {isTopup && <><label className="field-label" htmlFor="topup-amount">مبلغ الشحن (جنيه مصري)</label><div className="amount-input"><input id="topup-amount" type="number" min="200" value={amount} onChange={(event) => setAmount(event.target.value)} /><span>ج.م</span></div><div className="payment-hint"><ShieldCheck size={15}/> التحويل عبر فودافون كاش يُراجع يدويًا قبل إضافة الرصيد.</div></>}
        {type === "publish" && <><label className="field-label" htmlFor="opportunity-title">عنوان الفرصة</label><input id="opportunity-title" className="dialog-input" placeholder="مثال: مصمم جرافيك لمشروع ناشئ" /><label className="field-label" htmlFor="opportunity-description">وصف مختصر</label><textarea id="opportunity-description" className="dialog-input" placeholder="ما المهارات أو المهمة المطلوبة؟" rows={3}/><div className="payment-hint"><Check size={15}/> نشر الفرصة مجاني. سيظل المحتوى خاضعًا لإرشادات المجتمع.</div></>}
        <div className="dialog-actions"><button className="primary-button" onClick={onConfirm}>{isConnect ? "متابعة الطلب" : isTopup ? "متابعة الشحن" : "حفظ كمسودة"} <ArrowLeft size={15}/></button><button className="cancel-button" onClick={onClose}>إلغاء</button></div>
        <div className="dialog-demo"><ShieldCheck size={13}/> نموذج توضيحي — لا يتم تنفيذ أي إجراء حقيقي.</div>
      </section>
    </div>
  );
}

export default App;
