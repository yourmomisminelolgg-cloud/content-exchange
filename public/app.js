/* Content Exchange — Full SPA */
const { useState, useEffect, useRef, useCallback } = React;

// ─── API HELPER ───────────────────────────────────────────────────────────────
const api = {
  base: '/api',
  token: () => localStorage.getItem('cx_token'),
  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const t = this.token();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  },
  async get(path) {
    const r = await fetch(this.base + path, { headers: this.headers() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  },
  async post(path, body) {
    const r = await fetch(this.base + path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  },
  async patch(path, body) {
    const r = await fetch(this.base + path, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  },
  async del(path) {
    const r = await fetch(this.base + path, { method: 'DELETE', headers: this.headers() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  },
  async upload(path, formData) {
    const h = {};
    const t = this.token();
    if (t) h['Authorization'] = `Bearer ${t}`;
    const r = await fetch(this.base + path, { method: 'POST', headers: h, body: formData });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Upload failed');
    return d;
  }
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const fmt = {
  num: n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0),
  date: d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  time: d => {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  },
  platform: p => ({ youtube: '🔴 YouTube', tiktok: '⚫ TikTok', instagram: '📸 Instagram', twitter: '🐦 Twitter', twitch: '💜 Twitch', other: '🌐 Other' }[p] || p),
  platformClass: p => `platform-badge platform-${p}`
};
const P_ICONS = { youtube: '🔴', tiktok: '⚫', instagram: '📸', twitter: '🐦', twitch: '💜', other: '🌐' };

// ─── TOAST ────────────────────────────────────────────────────────────────────
let _addToast = null;
function Toasts() {
  const [toasts, setToasts] = useState([]);
  _addToast = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p.slice(-4), { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  };
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{icons[t.type]}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
const toast = {
  success: m => _addToast(m, 'success'),
  error: m => _addToast(m, 'error'),
  warning: m => _addToast(m, 'warning'),
  info: m => _addToast(m, 'info')
};

// ─── AVATAR ───────────────────────────────────────────────────────────────────
function Avatar({ user, size = 32, radius = 8 }) {
  if (user?.avatar) return <img src={`/uploads/avatars/${user.avatar}`} style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0 }} alt="" />;
  const init = (user?.username || '?')[0].toUpperCase();
  return <div className="avatar-fallback" style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.38, flexShrink: 0 }}>{init}</div>;
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, large }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${large ? 'modal-lg' : ''}`}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ email: '', password: '', username: '', referralCode: '' });
  const [needsVerif, setNeedsVerif] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('verified')) { setSuccess('✅ Email verified! You can now log in.'); setMode('login'); }
    if (p.get('reset')) setMode('reset');
    if (p.get('payment') === 'success') toast.success('💳 Payment successful! Credits added.');
    window.history.replaceState({}, '', '/');
  }, []);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const clear = () => { setError(''); setSuccess(''); setNeedsVerif(false); };

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      if (mode === 'login') {
        const d = await api.post('/auth/login', { email: form.email, password: form.password });
        localStorage.setItem('cx_token', d.token);
        onLogin(d.user);
      } else if (mode === 'register') {
        await api.post('/auth/register', { email: form.email, password: form.password, username: form.username, referralCode: form.referralCode });
        setSuccess('🎉 Account created! Check your email to verify. Check spam folder too!');
        setMode('login');
      } else if (mode === 'forgot') {
        await api.post('/auth/forgot-password', { email: form.email });
        setSuccess('📧 Reset link sent! Check your email.');
      }
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes('verify')) setNeedsVerif(true);
    }
    setLoading(false);
  }

  async function resend() {
    setLoading(true);
    try { await api.post('/auth/resend-verification', { email: form.email }); setSuccess('Verification email resent!'); setNeedsVerif(false); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="auth-layout">
      <div className="auth-left">
        <div className="auth-left-logo"><span>⚡</span><span className="logo-text">Content Exchange</span></div>
        <div className="auth-left-content">
          <h1>Grow Together,<br />Create Together.</h1>
          <p>The creator platform where you help each other grow. Watch content, earn credits, and promote your own work to real audiences.</p>
          <div style={{ marginTop: 32 }} className="auth-feature-list">
            {[['🎬','Watch videos & earn credits instantly'],['🚀','Promote your content to real creators'],['🏆','Climb the leaderboard & get noticed'],['💬','Network in our creator community'],['🔒','Verified proof system — no fake views']].map(([icon, text]) => (
              <div key={text} className="auth-feature">
                <span className="auth-feature-icon">{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="auth-stats">
          {[['10k+','Creators'],['250k+','Credits Given'],['99%','Real Views']].map(([n, l]) => (
            <div key={l} className="auth-stat"><div className="auth-stat-num">{n}</div><div className="auth-stat-label">{l}</div></div>
          ))}
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-form-container">
          <div className="auth-form-title">
            {mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create account' : 'Reset password'}
          </div>
          <div className="auth-form-subtitle">
            {mode === 'login' ? 'Sign in to your account' : mode === 'register' ? 'Join free — get 50 welcome credits' : 'We\'ll send you a reset link'}
          </div>

          {error && (
            <div className="alert alert-error animate-fade">
              <span className="alert-icon">⚠️</span>
              <div>
                {error}
                {needsVerif && <><br /><button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={resend}>Resend verification email</button></>}
              </div>
            </div>
          )}
          {success && <div className="alert alert-success animate-fade"><span className="alert-icon">✅</span><span>{success}</span></div>}

          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="form-input" placeholder="coolcreator99" value={form.username} onChange={set('username')} required minLength={3} maxLength={20} pattern="[a-zA-Z0-9_]+" />
                <div className="form-hint">3–20 chars, letters/numbers/underscores</div>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required />
            </div>
            {mode !== 'forgot' && (
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" placeholder={mode === 'register' ? 'Min 8 characters' : '••••••••'} value={form.password} onChange={set('password')} required minLength={8} />
              </div>
            )}
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Referral code <span className="text-muted">(optional)</span></label>
                <input className="form-input" placeholder="ABCD12" value={form.referralCode} onChange={set('referralCode')} maxLength={6} />
                <div className="form-hint">Both you and the referrer get +100 bonus credits!</div>
              </div>
            )}
            <button type="submit" className={`btn btn-primary btn-full btn-lg ${loading ? 'btn-loading' : ''}`} disabled={loading}>
              {!loading && (mode === 'login' ? 'Sign In →' : mode === 'register' ? 'Create Free Account →' : 'Send Reset Link')}
            </button>
          </form>

          <div className="divider-text" style={{ margin: '20px 0' }}><span>or</span></div>

          {mode === 'login' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-secondary btn-full" onClick={() => { setMode('register'); clear(); }}>Create a free account</button>
              <button className="btn btn-ghost btn-full" style={{ fontSize: 13, color: 'var(--text-3)' }} onClick={() => { setMode('forgot'); clear(); }}>Forgot password?</button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-full" onClick={() => { setMode('login'); clear(); }}>← Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS PANEL ─────────────────────────────────────────────────────
function NotifPanel({ onClose, user }) {
  const [notifs, setNotifs] = useState([]);
  useEffect(() => {
    api.get('/users/notifications/all').then(setNotifs).catch(() => {});
    api.post('/users/notifications/read', {}).catch(() => {});
  }, []);
  return (
    <div className="notif-panel">
      <div className="notif-header">
        <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>
      <div className="notif-list">
        {notifs.length === 0 ? <div className="notif-empty">All caught up! 🎉</div> :
          notifs.map(n => (
            <div key={n.id} className={`notif-item ${!n.is_read ? 'unread' : ''}`}>
              <div className="notif-title">{n.title}</div>
              <div className="notif-msg">{n.message}</div>
              <div className="notif-time">{fmt.time(n.created_at)}</div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'dashboard', icon: '🏠', label: 'Home' },
  { id: 'announcements', icon: '📢', label: 'Announcements' },
  { id: 'submit', icon: '🚀', label: 'Submit Content' },
  { id: 'watch', icon: '👁️', label: 'Watch to Earn' },
  { id: 'tickets', icon: '🎫', label: 'Tickets' },
  { id: 'leaderboard', icon: '🏆', label: 'Leaderboard' },
  { id: 'chat', icon: '💬', label: 'Community Chat' },
  { id: 'support', icon: '🎧', label: 'Support' },
  { id: 'profile', icon: '👤', label: 'My Profile' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

function Sidebar({ page, setPage, user, ticketCount, open, onClose }) {
  const adminNav = user?.isAdmin ? [{ id: 'admin', icon: '🛡️', label: 'Admin Panel' }] : [];
  const allNav = [...NAV, ...adminNav];
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <div className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">⚡</span>
          <span className="sidebar-logo-text">Content Exchange</span>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Navigation</div>
          {allNav.map(item => (
            <div
              key={item.id}
              className={`sidebar-item ${page === item.id ? 'active' : ''}`}
              onClick={() => { setPage(item.id); onClose(); }}
            >
              <span className="sidebar-item-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'tickets' && ticketCount > 0 && <span className="sidebar-badge">{ticketCount}</span>}
            </div>
          ))}
        </div>
        <div className="sidebar-credits">
          <div className="sidebar-credits-card">
            <div className="sidebar-credits-label">Credit Balance</div>
            <div className="sidebar-credits-amount">{fmt.num(user?.credits || 0)}</div>
            <div className="sidebar-credits-sub">credits available</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
function Topbar({ user, page, onMenuOpen, onThemeToggle, theme, onLogout, setPage, unreadCount, onNotifToggle }) {
  const titles = { dashboard: 'Dashboard', announcements: 'Announcements', submit: 'Submit Content', watch: 'Watch to Earn', tickets: 'My Tickets', leaderboard: 'Leaderboard', chat: 'Community Chat', profile: 'Profile', settings: 'Settings', admin: 'Admin Panel', support: 'Support' };
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="topbar">
      <button className="icon-btn" onClick={onMenuOpen} style={{ display: 'none' }} id="menu-btn" aria-label="Menu">☰</button>
      <style>{`@media(max-width:768px){#menu-btn{display:flex!important}}`}</style>
      <div className="topbar-title">{titles[page] || page}</div>
      <div className="topbar-actions">
        <button className="icon-btn" title="Referral" onClick={() => {
          const code = user?.referral_code;
          if (code) { navigator.clipboard.writeText(`${window.location.origin}/?ref=${code}`).then(() => toast.success('Referral link copied!')); }
        }}>🎁</button>
        <button className="icon-btn" onClick={onNotifToggle} title="Notifications">
          🔔
          {unreadCount > 0 && <span className="notif-dot" />}
        </button>
        <button className="icon-btn" onClick={onThemeToggle} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <div style={{ position: 'relative' }}>
          <div className="avatar-btn" onClick={() => setProfileOpen(p => !p)}>
            <Avatar user={user} size={34} />
          </div>
          {profileOpen && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', minWidth: 180, zIndex: 300, animation: 'slideUp 0.15s ease' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{user?.username}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{user?.credits} credits</div>
              </div>
              {[['👤','My Profile','profile'],['⚙️','Settings','settings'],['💳','Buy Credits','premium']].map(([icon, label, pg]) => (
                <div key={pg} style={{ padding: '10px 16px', fontSize: 14, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-2)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                  onClick={() => { setPage(pg); setProfileOpen(false); }}>
                  {icon} {label}
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', fontSize: 14, cursor: 'pointer', color: 'var(--danger)', display: 'flex', gap: 10, alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-bg)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
                onClick={onLogout}>
                🚪 Sign out
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MOBILE NAV ───────────────────────────────────────────────────────────────
function MobileNav({ page, setPage }) {
  const items = [
    { id: 'dashboard', icon: '🏠', label: 'Home' },
    { id: 'watch', icon: '👁️', label: 'Watch' },
    { id: 'submit', icon: '🚀', label: 'Submit' },
    { id: 'leaderboard', icon: '🏆', label: 'Ranks' },
    { id: 'profile', icon: '👤', label: 'Profile' },
  ];
  return (
    <nav className="mobile-nav">
      {items.map(item => (
        <div key={item.id} className={`mobile-nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
          <span className="mobile-nav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </nav>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ user, setPage }) {
  const [anns, setAnns] = useState([]);
  const [stats, setStats] = useState({});
  useEffect(() => {
    api.get('/users/announcements/all').then(setAnns).catch(() => {});
    api.get('/content/stats/overview').then(setStats).catch(() => {});
  }, []);

  return (
    <div className="page-enter">
      <div className="page-header">
        <div className="page-title">Welcome back, {user.username} 👋</div>
        <div className="page-desc">Here's an overview of your account</div>
      </div>

      {user.streak > 1 && (
        <div className="alert alert-warning" style={{ marginBottom: 20 }}>
          <span className="alert-icon">🔥</span>
          <span><strong>{user.streak}-day streak!</strong> Keep watching daily to maintain your streak.</span>
        </div>
      )}

      <div className="stat-grid">
        {[
          { label: 'Credits', value: fmt.num(user.credits || 0), sub: 'available to spend', color: user.credits > 50 ? 'var(--success)' : 'var(--warning)' },
          { label: 'Videos Watched', value: user.videos_watched || 0, sub: 'total', color: 'var(--primary)' },
          { label: '🔥 Streak', value: user.streak || 0, sub: 'days in a row', color: 'var(--warning)' },
          { label: 'Active Queue', value: stats.activeContent || 0, sub: 'videos waiting', color: 'var(--text)' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
        {[
          { icon: '👁️', title: 'Watch & Earn', desc: `${stats.total || 0} videos in queue`, page: 'watch', color: 'var(--primary-light)' },
          { icon: '🚀', title: 'Submit Content', desc: 'Use credits to promote', page: 'submit', color: 'var(--success-bg)' },
          { icon: '💳', title: 'Buy Credits', desc: 'Top up via PayPal', page: 'premium', color: 'var(--warning-bg)' },
          { icon: '💬', title: 'Community Chat', desc: 'Connect with creators', page: 'chat', color: 'rgba(139,92,246,0.1)' },
        ].map(c => (
          <div key={c.page} className="card card-hover" style={{ cursor: 'pointer' }} onClick={() => setPage(c.page)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, background: c.color, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{c.icon}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{c.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card-header" style={{ marginBottom: 12 }}>
        <div className="card-title">📢 Latest Announcements</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setPage('announcements')}>See all →</button>
      </div>
      {anns.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 14 }}>No announcements yet.</div> :
        anns.slice(0, 3).map(a => (
          <div key={a.id} className={`announcement-card ${a.is_pinned ? 'announcement-pinned' : ''} ann-type-${a.type}`}>
            <div className="ann-header">
              {a.is_pinned && <span style={{ fontSize: 11 }}>📌 Pinned</span>}
              <span className={`badge ${a.type === 'success' ? 'badge-success' : a.type === 'warning' ? 'badge-warning' : a.type === 'danger' ? 'badge-danger' : 'badge-primary'}`}>{a.type}</span>
            </div>
            <div className="ann-title">{a.title}</div>
            <div className="ann-body" style={{ marginTop: 6 }}>{a.content}</div>
            <div className="ann-meta">— {a.author_username} · {fmt.date(a.created_at)}</div>
          </div>
        ))
      }
    </div>
  );
}

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────
function Announcements() {
  const [anns, setAnns] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/users/announcements/all').then(setAnns).finally(() => setLoading(false));
  }, []);
  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">📢 Announcements</div><div className="page-desc">Platform updates and important news</div></div>
      {loading ? <div className="skeleton skeleton-card" /> :
        anns.length === 0 ? <div className="empty-state"><div className="empty-icon">📭</div><div className="empty-title">No announcements</div></div> :
          anns.map(a => (
            <div key={a.id} className={`announcement-card ${a.is_pinned ? 'announcement-pinned' : ''} ann-type-${a.type}`} style={{ marginBottom: 12 }}>
              <div className="ann-header">
                {a.is_pinned && <span style={{ fontSize: 11 }}>📌</span>}
                <span className={`badge ${a.type === 'success' ? 'badge-success' : a.type === 'warning' ? 'badge-warning' : a.type === 'danger' ? 'badge-danger' : 'badge-primary'}`}>{a.type}</span>
                <span className="ann-title">{a.title}</span>
              </div>
              <div className="ann-body">{a.content}</div>
              <div className="ann-meta">Posted by {a.author_username} · {fmt.date(a.created_at)}</div>
            </div>
          ))
      }
    </div>
  );
}

// ─── SUBMIT CONTENT ───────────────────────────────────────────────────────────
function SubmitContent({ user, onUserUpdate }) {
  const [tab, setTab] = useState('submit');
  const [form, setForm] = useState({ url: '', platform: 'youtube', title: '', description: '', category: 'general', tags: '', requestedViews: 20, creditsPerView: 5 });
  const [loading, setLoading] = useState(false);
  const [myContent, setMyContent] = useState([]);

  useEffect(() => { loadMy(); }, []);
  const loadMy = () => api.get('/content/my').then(setMyContent).catch(() => {});

  const totalCost = (parseInt(form.requestedViews) || 0) * (parseInt(form.creditsPerView) || 0);
  const canAfford = user.credits >= totalCost;

  const set = k => e => {
    const v = e.target ? e.target.value : e;
    if (k === 'url') {
      let plat = form.platform;
      if (v.includes('youtu')) plat = 'youtube';
      else if (v.includes('tiktok')) plat = 'tiktok';
      else if (v.includes('instagram')) plat = 'instagram';
      else if (v.includes('twitter.com') || v.includes('x.com')) plat = 'twitter';
      else if (v.includes('twitch')) plat = 'twitch';
      setForm(p => ({ ...p, url: v, platform: plat }));
    } else {
      setForm(p => ({ ...p, [k]: v }));
    }
  };

  async function submit(e) {
    e.preventDefault();
    if (!canAfford) return toast.error(`Not enough credits! Need ${totalCost}, have ${user.credits}.`);
    setLoading(true);
    try {
      await api.post('/content', form);
      toast.success('🚀 Content submitted and added to the watch queue!');
      onUserUpdate({ ...user, credits: user.credits - totalCost });
      setForm(p => ({ ...p, url: '', title: '', description: '', tags: '' }));
      setTab('my');
      loadMy();
    } catch (err) { toast.error(err.message); }
    setLoading(false);
  }

  async function deleteContent(uuid, refund) {
    if (!confirm('Delete? Remaining credits will be refunded.')) return;
    try {
      const d = await api.del(`/content/${uuid}`);
      toast.success(d.refund > 0 ? `Deleted! +${d.refund} credits refunded.` : 'Deleted.');
      onUserUpdate({ ...user, credits: user.credits + (d.refund || 0) });
      loadMy();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">Submit Content</div><div className="page-desc">Pay credits now to add your video to the queue. Other creators watch and you get real views.</div></div>
      <div className="tabs">
        <div className={`tab ${tab === 'submit' ? 'active' : ''}`} onClick={() => setTab('submit')}>➕ Submit New</div>
        <div className={`tab ${tab === 'my' ? 'active' : ''}`} onClick={() => setTab('my')}>📋 My Content ({myContent.length})</div>
      </div>

      {tab === 'submit' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
          <form onSubmit={submit}>
            <div className="card">
              <div className="form-group">
                <label className="form-label">Video URL *</label>
                <input className="form-input" placeholder="https://youtube.com/watch?v=..." value={form.url} onChange={set('url')} required />
                <div className="form-hint">Platform is auto-detected from your link</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Platform</label>
                  <select className="form-select" value={form.platform} onChange={set('platform')}>
                    {['youtube','tiktok','instagram','twitter','twitch','other'].map(p => <option key={p} value={p}>{fmt.platform(p)}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={form.category} onChange={set('category')}>
                    {['general','music','gaming','education','lifestyle','tech','comedy','sports','other'].map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Title <span className="text-muted">(optional)</span></label>
                <input className="form-input" placeholder="My awesome video..." value={form.title} onChange={set('title')} maxLength={120} />
              </div>
              <div className="form-group">
                <label className="form-label">Description <span className="text-muted">(optional)</span></label>
                <textarea className="form-textarea" placeholder="Tell viewers what your content is about..." value={form.description} onChange={set('description')} rows={3} />
              </div>
              <div className="form-group">
                <label className="form-label">Tags <span className="text-muted">(comma separated)</span></label>
                <input className="form-input" placeholder="gaming, tutorial, funny" value={form.tags} onChange={set('tags')} />
              </div>
              <button type="submit" className={`btn btn-primary btn-full btn-lg ${loading ? 'btn-loading' : ''}`} disabled={loading || totalCost === 0} style={!canAfford && totalCost > 0 ? { background: 'var(--danger)' } : {}}>
                {!loading && (!canAfford && totalCost > 0 ? `⚠️ Need ${totalCost - user.credits} more credits` : `🚀 Submit for ${totalCost} credits`)}
              </button>
            </div>
          </form>

          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title" style={{ marginBottom: 16 }}>💰 Budget</div>
              <div className="form-group">
                <label className="form-label">Requested views: <strong>{form.requestedViews}</strong></label>
                <input type="range" min="1" max="1000" value={form.requestedViews} onChange={set('requestedViews')} style={{ width: '100%', accentColor: 'var(--primary)' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Credits per view: <strong>{form.creditsPerView}</strong></label>
                <input type="range" min="1" max="50" value={form.creditsPerView} onChange={set('creditsPerView')} style={{ width: '100%', accentColor: 'var(--primary)' }} />
                <div className="form-hint">Higher credits = more visible in queue</div>
              </div>
              <hr className="divider" />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-2)', fontSize: 14 }}>Total cost</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: canAfford ? 'var(--primary)' : 'var(--danger)' }}>{totalCost} cr</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-3)', fontSize: 13 }}>Your balance</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{user.credits} cr</span>
              </div>
            </div>
            <div className="alert alert-info">
              <span className="alert-icon">ℹ️</span>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>Credits are deducted immediately. Each approved view costs {form.creditsPerView} credits. Any remaining credits are refunded if you delete.</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'my' && (
        myContent.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div className="empty-title">No submissions yet</div>
            <div className="empty-desc">Submit your content to start getting real engagement from creators.</div>
            <button className="btn btn-primary" onClick={() => setTab('submit')}>Submit Content →</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Content</th><th>Platform</th><th>Progress</th><th>Pool Left</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {myContent.map(c => (
                  <tr key={c.id}>
                    <td><div style={{ maxWidth: 260 }}><div style={{ fontWeight: 500, fontSize: 13 }} className="truncate">{c.title || c.url}</div><div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{fmt.date(c.created_at)}</div></div></td>
                    <td><span className={fmt.platformClass(c.platform)}>{P_ICONS[c.platform]} {c.platform}</span></td>
                    <td>
                      <div style={{ minWidth: 100 }}>
                        <div className="progress-bar"><div className="progress-fill" style={{ width: `${c.requested_views > 0 ? Math.min(100, (c.current_views / c.requested_views) * 100) : 0}%` }} /></div>
                        <div className="progress-text">{c.current_views}/{c.requested_views}</div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{c.total_credits_pool} cr</td>
                    <td><span className={`badge ${c.status === 'active' ? 'badge-success' : c.status === 'completed' ? 'badge-primary' : 'badge-muted'}`}>{c.status}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">↗</a>
                        {c.status === 'active' && <button className="btn btn-danger btn-sm" onClick={() => deleteContent(c.uuid)}>Del</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ─── WATCH TO EARN ────────────────────────────────────────────────────────────
function WatchToEarn({ user, onUserUpdate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('all');
  const [proofItem, setProofItem] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = platform !== 'all' ? `?platform=${platform}` : '';
      const d = await api.get(`/content${q}`);
      setItems(d.items || []);
    } catch {}
    setLoading(false);
  }, [platform]);

  useEffect(() => { load(); }, [load]);

  function openProof(item) { setProofItem(item); setFile(null); setPreview(null); setMsg(''); }
  function handleFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setFile(f);
    const r = new FileReader(); r.onload = ev => setPreview(ev.target.result); r.readAsDataURL(f);
  }

  async function submitProof() {
    if (!file) return toast.error('Upload a screenshot first');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('contentId', proofItem.id);
      fd.append('message', msg);
      fd.append('screenshot', file);
      const d = await api.upload('/tickets', fd);
      toast.success(`✅ Proof submitted! ${d.streak > 1 ? `🔥 ${d.streak}-day streak!` : ''} Credits added after review.`);
      setProofItem(null);
      setItems(p => p.filter(i => i.id !== proofItem.id));
      if (d.streak) onUserUpdate({ ...user, streak: d.streak });
    } catch (err) { toast.error(err.message); }
    setSubmitting(false);
  }

  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">Watch to Earn</div><div className="page-desc">Watch creator content, submit a screenshot as proof, and earn credits after admin approval</div></div>

      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        <span className="alert-icon">💡</span>
        <span><strong>How it works:</strong> 1. Click <em>Watch</em> to open video. 2. Watch it fully. 3. Click <em>Submit Proof</em>, upload screenshot. 4. Admin approves and credits you!</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {['all','youtube','tiktok','instagram','twitter','twitch'].map(p => (
          <button key={p} className={`btn btn-sm ${platform === p ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPlatform(p)}>
            {p === 'all' ? '🌐 All' : fmt.platform(p)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="content-grid">{[1,2,3,4,5,6].map(i => <div key={i} className="skeleton skeleton-card" />)}</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <div className="empty-title">No content available right now</div>
          <div className="empty-desc">You've watched everything! Come back later or try another platform.</div>
          <button className="btn btn-secondary" onClick={load}>🔄 Refresh</button>
        </div>
      ) : (
        <div className="content-grid">
          {items.map(item => (
            <div key={item.id} className="content-card">
              <div className="content-thumb">
                {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <div className="content-thumb-placeholder">{P_ICONS[item.platform]}</div>}
                <div className="content-credits-badge">+{item.credits_per_view} cr</div>
                <div className="content-thumb-overlay"><span style={{ color: 'white', fontSize: 40 }}>▶</span></div>
              </div>
              <div className="content-body">
                <div className="content-meta">
                  <span className={fmt.platformClass(item.platform)}>{P_ICONS[item.platform]} {item.platform}</span>
                  {item.is_premium ? <span className="badge badge-premium">⭐ Pro</span> : null}
                </div>
                <div className="content-title">{item.title || item.url}</div>
                <div className="content-progress">
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, (item.current_views / item.requested_views) * 100)}%` }} /></div>
                  <div className="progress-text">{item.current_views}/{item.requested_views} · @{item.username}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ flex: 1 }}>▶ Watch</a>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => openProof(item)}>📸 Proof</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!proofItem} onClose={() => setProofItem(null)} title="📸 Submit Proof">
        {proofItem && <>
          <div className="alert alert-info"><span className="alert-icon">ℹ️</span><span>Upload a screenshot showing you watched <strong>"{proofItem.title || proofItem.url}"</strong>. Credits awarded after admin review.</span></div>
          <div className="form-group">
            <label className="form-label">Screenshot *</label>
            {!preview ? (
              <label className="upload-zone" style={{ cursor: 'pointer', display: 'block' }}>
                <div className="upload-icon">📸</div>
                <div className="upload-text">Click to upload screenshot</div>
                <div className="upload-sub">PNG, JPG, WEBP — max 10MB</div>
                <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
              </label>
            ) : (
              <div>
                <div className="file-preview"><img src={preview} alt="proof" /></div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { setFile(null); setPreview(null); }}>Remove ✕</button>
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Note for moderator <span className="text-muted">(optional)</span></label>
            <textarea className="form-textarea" placeholder="Any additional info..." value={msg} onChange={e => setMsg(e.target.value)} rows={2} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => setProofItem(null)}>Cancel</button>
            <button className={`btn btn-primary ${submitting ? 'btn-loading' : ''}`} style={{ flex: 1 }} onClick={submitProof} disabled={submitting}>
              {!submitting && '📤 Submit Proof'}
            </button>
          </div>
        </>}
      </Modal>
    </div>
  );
}

// ─── TICKETS ──────────────────────────────────────────────────────────────────
function Tickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter !== 'all' ? `?status=${filter}` : '';
      const d = await api.get(`/tickets${q}`);
      setTickets(d.items || []);
    } catch {}
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const sIcon = { pending: '⏳', approved: '✅', rejected: '❌' };
  const sBadge = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };

  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">My Tickets</div><div className="page-desc">Proof submissions you've made — track credit approvals</div></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all','pending','approved','rejected'].map(s => (
          <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(s)}>
            {sIcon[s] || ''} {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading...</div> :
        tickets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎫</div>
            <div className="empty-title">No tickets yet</div>
            <div className="empty-desc">Watch content and submit proof to create a ticket.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Content</th><th>Submitted</th><th>Status</th><th>Credits</th><th>Admin Note</th><th>Screenshot</th></tr></thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{P_ICONS[t.content_platform]}</span>
                        <a href={t.content_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontSize: 13, textDecoration: 'none' }} className="truncate" title={t.content_title}>{t.content_title || t.content_url}</a>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{fmt.date(t.created_at)}</td>
                    <td><span className={`badge ${sBadge[t.status] || 'badge-muted'}`}>{sIcon[t.status]} {t.status}</span></td>
                    <td style={{ fontWeight: 700, color: t.credits_awarded > 0 ? 'var(--success)' : 'var(--text-3)' }}>{t.credits_awarded > 0 ? `+${t.credits_awarded}` : '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 200 }} className="truncate">{t.admin_note || '—'}</td>
                    <td>
                      {t.screenshot_path && (
                        <a href={`/uploads/tickets/${t.screenshot_path}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">View 🖼️</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard({ user }) {
  const [leaders, setLeaders] = useState([]);
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/users/leaderboard?period=${period}`).then(setLeaders).finally(() => setLoading(false));
  }, [period]);

  const medals = { 0: '🥇', 1: '🥈', 2: '🥉' };

  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">🏆 Leaderboard</div><div className="page-desc">Top creators ranked by credits earned</div></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[['all','All Time'],['month','This Month'],['week','This Week']].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${period === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPeriod(v)}>{l}</button>
        ))}
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading...</div> :
        <div className="leaderboard-list">
          {leaders.map((u, i) => (
            <div key={u.id} className={`leaderboard-item ${u.id === user.id ? 'lb-you' : ''}`}>
              <div className={`leaderboard-rank ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>
                {medals[i] || `#${i + 1}`}
              </div>
              <div className="lb-avatar"><Avatar user={u} size={40} radius={10} /></div>
              <div className="lb-info">
                <div className="lb-name">
                  {u.username}
                  {u.is_premium ? <span className="badge badge-premium" style={{ fontSize: 10 }}>⭐ Pro</span> : null}
                  {u.id === user.id ? <span className="badge badge-primary" style={{ fontSize: 10 }}>You</span> : null}
                </div>
                <div className="lb-sub">{u.videos_watched} watched · {u.total_approved} approved · 🔥{u.streak} streak</div>
              </div>
              <div className="lb-credits">{fmt.num(u.period_earned)}<span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400, marginLeft: 2 }}>cr</span></div>
            </div>
          ))}
          {leaders.length === 0 && <div className="empty-state"><div className="empty-icon">🏆</div><div className="empty-title">No data yet</div></div>}
        </div>
      }
    </div>
  );
}

// ─── COMMUNITY CHAT ───────────────────────────────────────────────────────────
function Chat({ user, socket }) {
  const [room, setRoom] = useState('general');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [typing, setTyping] = useState('');
  const [rooms, setRooms] = useState([]);
  const [reactions, setReactions] = useState({});
  const msgEnd = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    api.get('/chat/rooms').then(setRooms).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.emit('join_room', room);
    api.get(`/chat/history/${room}`).then(msgs => {
      setMessages(msgs);
      const r = {};
      msgs.forEach(m => { if (m.reactions) try { r[m.id] = JSON.parse(m.reactions); } catch {} });
      setReactions(r);
    }).catch(() => {});
  }, [room, socket]);

  useEffect(() => {
    if (!socket) return;
    const onMsg = m => { if (m.room === room) { setMessages(p => [...p, m]); } };
    const onCount = c => setOnlineCount(c);
    const onTyp = d => { setTyping(`${d.username} is typing...`); clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(''), 2000); };
    const onDel = d => setMessages(p => p.filter(m => m.id !== d.id));
    const onReact = d => setReactions(p => ({ ...p, [d.messageId]: d.reactions }));
    socket.on('chat_message', onMsg);
    socket.on('online_count', onCount);
    socket.on('typing', onTyp);
    socket.on('message_deleted', onDel);
    socket.on('reaction_update', onReact);
    return () => { socket.off('chat_message', onMsg); socket.off('online_count', onCount); socket.off('typing', onTyp); socket.off('message_deleted', onDel); socket.off('reaction_update', onReact); };
  }, [socket, room]);

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function send() {
    if (!input.trim() || !socket) return;
    socket.emit('chat_message', { message: input.trim(), room });
    setInput('');
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else { socket?.emit('typing', { room }); }
  }

  function react(msgId, emoji) {
    socket?.emit('reaction', { messageId: msgId, emoji });
  }

  const EMOJIS = ['👍','❤️','😂','🔥','🎉'];

  return (
    <div className="page-enter" style={{ height: 'calc(100vh - 60px - 56px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: 'var(--surface)' }}>
        <div className="chat-sidebar">
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', padding: '8px 10px', marginBottom: 4 }}>Rooms</div>
          {rooms.map(r => (
            <button key={r.id} className={`chat-room-btn ${room === r.id ? 'active' : ''}`} onClick={() => setRoom(r.id)}>
              <span>{r.icon}</span><span>{r.name}</span>
            </button>
          ))}
        </div>
        <div className="chat-main">
          <div className="chat-online"><span className="online-dot" /><span>{onlineCount} online in {room}</span></div>
          <div className="chat-messages">
            {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 32, fontSize: 14 }}>No messages yet. Say hello! 👋</div>}
            {messages.map(m => (
              <div key={m.id} className="chat-msg">
                <div className="chat-msg-avatar"><Avatar user={{ username: m.username, avatar: m.avatar }} size={32} radius={8} /></div>
                <div className="chat-msg-content">
                  <div className="chat-msg-header">
                    <span className="chat-msg-name">{m.username}</span>
                    <span className="chat-msg-time">{fmt.time(m.createdAt || m.created_at)}</span>
                  </div>
                  <div className="chat-msg-text">{m.message}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {EMOJIS.map(emoji => {
                      const r = reactions[m.id];
                      const count = r && r[emoji] ? r[emoji].length : 0;
                      return (
                        <button key={emoji} onClick={() => react(m.id, emoji)} style={{ background: count > 0 ? 'var(--primary-light)' : 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 7px', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)', transition: 'all 0.15s' }}>
                          {emoji}{count > 0 ? ` ${count}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={msgEnd} />
          </div>
          <div className="typing-indicator">{typing}</div>
          <div className="chat-input-area">
            <input className="chat-input" placeholder={`Message #${room}...`} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} maxLength={500} />
            <button className="btn btn-primary" onClick={send} disabled={!input.trim()}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SUPPORT ──────────────────────────────────────────────────────────────────
function Support({ user, socket }) {
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [newSubject, setNewSubject] = useState('');
  const [newCat, setNewCat] = useState('general');
  const [newMsg, setNewMsg] = useState('');
  const [reply, setReply] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const msgEnd = useRef(null);

  const load = () => api.get('/chat/support/tickets').then(setTickets).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [detail?.messages]);

  async function openTicket(t) {
    setSelected(t.uuid);
    const d = await api.get(`/chat/support/${t.uuid}`).catch(() => null);
    if (d) { setDetail(d); socket?.emit('join_support', d.ticket.id); }
  }

  useEffect(() => {
    if (!socket) return;
    const onMsg = m => setDetail(p => p ? { ...p, messages: [...p.messages, m] } : p);
    socket.on('support_message', onMsg);
    return () => socket.off('support_message', onMsg);
  }, [socket]);

  async function createTicket(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api.post('/chat/support', { subject: newSubject, category: newCat, message: newMsg });
      toast.success('🎫 Support ticket created!');
      setCreating(false); setNewSubject(''); setNewMsg('');
      load();
      openTicket({ uuid: d.uuid });
    } catch (err) { toast.error(err.message); }
    setLoading(false);
  }

  async function sendReply() {
    if (!reply.trim() || !selected) return;
    try {
      await api.post(`/chat/support/${selected}/message`, { message: reply });
      setReply('');
      const d = await api.get(`/chat/support/${selected}`).catch(() => null);
      if (d) setDetail(d);
    } catch (err) { toast.error(err.message); }
  }

  const statusBadge = s => ({ open: 'badge-warning', replied: 'badge-success', closed: 'badge-muted' }[s] || 'badge-muted');

  return (
    <div className="page-enter">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="page-title">🎧 Support</div>
            <div className="page-desc">Get help from our team</div>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New Ticket</button>
        </div>
      </div>

      <div className="support-grid">
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10 }}>YOUR TICKETS</div>
          <div className="support-ticket-list">
            {tickets.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 16 }}>No tickets yet.</div>}
            {tickets.map(t => (
              <div key={t.uuid} className={`support-ticket-item ${selected === t.uuid ? 'active' : ''}`} onClick={() => openTicket(t)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }} className="truncate">{t.subject}</span>
                  <span className={`badge ${statusBadge(t.status)}`}>{t.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.category} · {fmt.date(t.created_at)}</div>
                {t.last_message && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }} className="truncate">{t.last_message}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="support-chat">
          {!detail ? (
            <div className="empty-state"><div className="empty-icon">🎧</div><div className="empty-title">Select a ticket</div><div className="empty-desc">Or create a new one to get help from our team.</div></div>
          ) : <>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{detail.ticket.subject}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{detail.ticket.category} · <span className={`badge ${statusBadge(detail.ticket.status)}`}>{detail.ticket.status}</span></div>
            </div>
            <div className="support-msgs" ref={msgEnd}>
              {detail.messages.map((m, i) => (
                <div key={i}>
                  {m.is_admin ? (
                    <div className="support-msg support-msg-admin">
                      <div className="support-msg-sender">🛡️ Support Team</div>
                      {m.message}
                    </div>
                  ) : (
                    <div className="support-msg support-msg-user">{m.message}</div>
                  )}
                </div>
              ))}
            </div>
            {detail.ticket.status !== 'closed' && (
              <div className="support-input-row">
                <input className="chat-input" placeholder="Type your message..." value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendReply()} />
                <button className="btn btn-primary" onClick={sendReply}>Send</button>
              </div>
            )}
          </>}
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="🎫 New Support Ticket">
        <form onSubmit={createTicket}>
          <div className="form-group">
            <label className="form-label">Subject *</label>
            <input className="form-input" placeholder="What do you need help with?" value={newSubject} onChange={e => setNewSubject(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-select" value={newCat} onChange={e => setNewCat(e.target.value)}>
              {['general','billing','technical','account','other'].map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Message *</label>
            <textarea className="form-textarea" placeholder="Describe your issue in detail..." value={newMsg} onChange={e => setNewMsg(e.target.value)} required rows={4} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className={`btn btn-primary ${loading ? 'btn-loading' : ''}`} style={{ flex: 1 }} disabled={loading}>{!loading && 'Create Ticket'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function ProfilePage({ user, onUserUpdate }) {
  const [profile, setProfile] = useState(null);
  const [vouchModal, setVouchModal] = useState(false);
  const [vouchMsg, setVouchMsg] = useState('');
  const [vouchRating, setVouchRating] = useState(5);
  const [targetUser, setTargetUser] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.get(`/users/${user.username}`).then(setProfile).catch(() => {});
  }, [user.username]);

  async function uploadAvatar(e) {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('avatar', f);
      const d = await api.upload('/users/avatar', fd);
      onUserUpdate({ ...user, avatar: d.avatar });
      toast.success('Avatar updated!');
      setProfile(p => ({ ...p, avatar: d.avatar }));
    } catch (err) { toast.error(err.message); }
    setUploading(false);
  }

  async function submitVouch() {
    if (!targetUser) return toast.error('Enter a username to vouch for');
    try {
      await api.post(`/users/vouch/${targetUser}`, { message: vouchMsg, rating: vouchRating });
      toast.success('⭐ Vouch submitted!');
      setVouchModal(false);
    } catch (err) { toast.error(err.message); }
  }

  const p = profile || user;

  return (
    <div className="page-enter">
      <div className="profile-header">
        <div className="profile-banner" />
        <div className="profile-info">
          <div className="profile-avatar-wrap">
            <label style={{ cursor: 'pointer', display: 'inline-block' }}>
              <div className="profile-avatar">
                {p.avatar ? <img src={`/uploads/avatars/${p.avatar}`} alt="" /> : (p.username || '?')[0].toUpperCase()}
              </div>
              <input type="file" accept="image/*" onChange={uploadAvatar} style={{ display: 'none' }} />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, textAlign: 'center' }}>Click to change</div>
            </label>
          </div>
          <div className="profile-name">
            {p.username}
            {p.is_premium ? <span className="badge badge-premium">⭐ Premium</span> : null}
            {user.isAdmin ? <span className="badge badge-danger">🛡️ Admin</span> : null}
          </div>
          {p.bio && <div className="profile-bio">{p.bio}</div>}
          <div className="profile-stats">
            {[
              [p.credits || 0, 'Credits'],
              [p.videos_watched || 0, 'Watched'],
              [p.videos_submitted || 0, 'Submitted'],
              [p.reputation || 0, 'Rep'],
              [p.streak || 0, '🔥 Streak'],
              [p.vouch_count || 0, '⭐ Vouches'],
            ].map(([n, l]) => (
              <div key={l} className="profile-stat">
                <div className="profile-stat-num">{fmt.num(n)}</div>
                <div className="profile-stat-label">{l}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Referral code: <span style={{ fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>{p.referral_code}</span></div>
            <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?ref=${p.referral_code}`); toast.success('Referral link copied!'); }}>📋 Copy link</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="card-title">⭐ Vouches ({profile?.vouches?.length || 0})</div>
        <button className="btn btn-primary btn-sm" onClick={() => setVouchModal(true)}>Give a Vouch ⭐</button>
      </div>

      {profile?.vouches?.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 14, marginBottom: 20 }}>No vouches yet. Ask creators to vouch for you!</div>}
      <div className="vouch-grid" style={{ marginBottom: 24 }}>
        {(profile?.vouches || []).map(v => (
          <div key={v.id} className="vouch-card">
            <div className="vouch-header">
              <div className="vouch-avatar"><Avatar user={{ username: v.from_username, avatar: v.from_avatar }} size={32} radius={8} /></div>
              <div>
                <div className="vouch-name">@{v.from_username}</div>
                <div className="vouch-stars">{'★'.repeat(v.rating)}{'☆'.repeat(5 - v.rating)}</div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{fmt.date(v.created_at)}</div>
            </div>
            {v.message && <div className="vouch-message">"{v.message}"</div>}
          </div>
        ))}
      </div>

      <Modal open={vouchModal} onClose={() => setVouchModal(false)} title="Give a Vouch ⭐">
        <div className="form-group">
          <label className="form-label">Username to vouch for</label>
          <input className="form-input" placeholder="@username" value={targetUser} onChange={e => setTargetUser(e.target.value.replace('@', ''))} />
        </div>
        <div className="form-group">
          <label className="form-label">Rating: {vouchRating}/5</label>
          <input type="range" min="1" max="5" value={vouchRating} onChange={e => setVouchRating(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#F59E0B' }} />
          <div style={{ fontSize: 20, marginTop: 4 }}>{'★'.repeat(vouchRating)}{'☆'.repeat(5 - vouchRating)}</div>
        </div>
        <div className="form-group">
          <label className="form-label">Message <span className="text-muted">(optional)</span></label>
          <textarea className="form-textarea" placeholder="Say something nice..." value={vouchMsg} onChange={e => setVouchMsg(e.target.value)} rows={3} />
        </div>
        <button className="btn btn-primary btn-full" onClick={submitVouch}>Submit Vouch ⭐</button>
      </Modal>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function Settings({ user, onUserUpdate }) {
  const [bio, setBio] = useState(user.bio || '');
  const [location, setLocation] = useState(user.location || '');
  const [website, setWebsite] = useState(user.website || '');
  const [twitter, setTwitter] = useState(user.twitter || '');
  const [youtube, setYoutube] = useState(user.youtube || '');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  async function saveProfile(e) {
    e.preventDefault(); setSaving(true);
    try { await api.patch('/users/profile', { bio, location, website, twitter, youtube }); toast.success('Profile updated!'); }
    catch (err) { toast.error(err.message); }
    setSaving(false);
  }

  async function changePassword(e) {
    e.preventDefault(); setSavingPw(true);
    try { await api.patch('/users/password', { currentPassword: curPw, newPassword: newPw }); toast.success('Password changed!'); setCurPw(''); setNewPw(''); }
    catch (err) { toast.error(err.message); }
    setSavingPw(false);
  }

  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">⚙️ Settings</div></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>Profile Info</div>
          <form onSubmit={saveProfile}>
            <div className="form-group"><label className="form-label">Bio</label><textarea className="form-textarea" value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={300} /></div>
            <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={location} onChange={e => setLocation(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Website</label><input className="form-input" type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." /></div>
            <div className="form-group"><label className="form-label">Twitter handle</label><input className="form-input" value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="@username" /></div>
            <div className="form-group"><label className="form-label">YouTube channel</label><input className="form-input" value={youtube} onChange={e => setYoutube(e.target.value)} placeholder="@channel" /></div>
            <button type="submit" className={`btn btn-primary ${saving ? 'btn-loading' : ''}`} disabled={saving}>{!saving && 'Save Changes'}</button>
          </form>
        </div>
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 16 }}>Change Password</div>
            <form onSubmit={changePassword}>
              <div className="form-group"><label className="form-label">Current password</label><input className="form-input" type="password" value={curPw} onChange={e => setCurPw(e.target.value)} required /></div>
              <div className="form-group"><label className="form-label">New password</label><input className="form-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8} /></div>
              <button type="submit" className={`btn btn-primary ${savingPw ? 'btn-loading' : ''}`} disabled={savingPw}>{!savingPw && 'Change Password'}</button>
            </form>
          </div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>Account Info</div>
            <div style={{ fontSize: 14, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>Email: <strong style={{ color: 'var(--text-2)' }}>{user.email}</strong></div>
              <div>Username: <strong style={{ color: 'var(--text-2)' }}>@{user.username}</strong></div>
              <div>Member since: <strong style={{ color: 'var(--text-2)' }}>{fmt.date(user.created_at)}</strong></div>
              <div>Referrals: <strong style={{ color: 'var(--primary)' }}>{user.total_referrals || 0}</strong> users joined</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BUY CREDITS (PAYPAL) ────────────────────────────────────────────────────
function PremiumPage({ user, onUserUpdate }) {
  const [packages, setPackages] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('buy');
  const [ppReady, setPpReady] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [processingPkg, setProcessingPkg] = useState(null);
  const ppBtnRef = useRef(null);

  useEffect(() => {
    api.get('/payments/packages').then(setPackages).catch(() => {});
    api.get('/payments/history').then(setHistory).catch(() => {});

    // Load PayPal SDK
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${window.PAYPAL_CLIENT_ID || 'sb'}&currency=USD`;
    script.onload = () => setPpReady(true);
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!ppReady || !selectedPkg || !ppBtnRef.current) return;
    ppBtnRef.current.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
      createOrder: async () => {
        const d = await api.post('/payments/create-order', { packageId: selectedPkg.id });
        return d.orderId;
      },
      onApprove: async (data) => {
        setProcessingPkg(selectedPkg);
        try {
          const d = await api.post('/payments/capture-order', { orderId: data.orderID });
          toast.success(`🎉 +${d.credits} credits added! New balance: ${d.newBalance}`);
          onUserUpdate({ ...user, credits: d.newBalance });
          setSelectedPkg(null);
          api.get('/payments/history').then(setHistory).catch(() => {});
        } catch (err) {
          toast.error('Payment failed: ' + err.message);
        }
        setProcessingPkg(null);
      },
      onError: () => toast.error('PayPal error. Try again.')
    }).render(ppBtnRef.current);
  }, [ppReady, selectedPkg]);

  const txIcon = { purchase: '💳', watch_reward: '👁️', content_submit: '🚀', referral_bonus: '🎁', admin_adjustment: '🛡️', refund: '↩️' };

  return (
    <div className="page-enter">
      <div className="page-header"><div className="page-title">💳 Buy Credits</div><div className="page-desc">Purchase credits via PayPal to promote your content</div></div>
      <div className="tabs">
        <div className={`tab ${tab === 'buy' ? 'active' : ''}`} onClick={() => setTab('buy')}>Buy Credits</div>
        <div className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Transaction History</div>
      </div>

      {tab === 'buy' && (
        <>
          <div className="alert alert-info" style={{ marginBottom: 20 }}>
            <span className="alert-icon">ℹ️</span>
            <span>Credits are used to submit content. You can also earn credits for free by watching other creators' videos!</span>
          </div>
          <div className="pricing-grid" style={{ marginBottom: 24 }}>
            {packages.map(pkg => {
              const total = pkg.credits + pkg.bonus_credits;
              return (
                <div key={pkg.id} className={`pricing-card ${pkg.is_popular ? 'popular' : ''}`} onClick={() => setSelectedPkg(pkg)} style={{ cursor: 'pointer', borderColor: selectedPkg?.id === pkg.id ? 'var(--primary)' : undefined }}>
                  {pkg.is_popular && <div className="pricing-popular-badge">⭐ Most Popular</div>}
                  <div className="pricing-name">{pkg.name}</div>
                  <div className="pricing-price">${pkg.price_usd.toFixed(2)}<span> USD</span></div>
                  <div className="pricing-credits"><strong style={{ color: 'var(--primary)', fontSize: 18 }}>{pkg.credits}</strong> credits{pkg.bonus_credits > 0 && <span className="pricing-bonus"> + {pkg.bonus_credits} bonus!</span>}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>${(pkg.price_usd / total * 100).toFixed(2)} per 100 credits</div>
                  {selectedPkg?.id === pkg.id && (
                    <div style={{ marginTop: 12 }}>
                      {ppReady ? <div ref={ppBtnRef} /> : <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading PayPal...</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="alert alert-warning">
            <span className="alert-icon">🔒</span>
            <span>Payments are processed securely by PayPal. We never store your payment info. All purchases are final.</span>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Amount</th><th>Description</th><th>Balance After</th><th>Date</th></tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 32 }}>No transactions yet.</td></tr>}
              {history.map(t => (
                <tr key={t.id}>
                  <td>{txIcon[t.type] || '💱'} <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.type}</span></td>
                  <td style={{ fontWeight: 700, color: t.amount > 0 ? 'var(--success)' : 'var(--danger)' }}>{t.amount > 0 ? '+' : ''}{t.amount}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 250 }} className="truncate">{t.description}</td>
                  <td style={{ fontWeight: 600 }}>{t.balance_after}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{fmt.date(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
function AdminPanel({ user }) {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [content, setContent] = useState([]);
  const [reports, setReports] = useState([]);
  const [support, setSupport] = useState([]);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annType, setAnnType] = useState('info');
  const [annPinned, setAnnPinned] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [creditModal, setCreditModal] = useState(null);
  const [creditAmt, setCreditAmt] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [ticketFilter, setTicketFilter] = useState('pending');

  useEffect(() => {
    api.get('/admin/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'users') api.get(`/admin/users?search=${userSearch}`).then(d => setUsers(d.users)).catch(() => {});
    if (tab === 'tickets') api.get(`/tickets/admin/pending?status=${ticketFilter}`).then(d => setTickets(d.items)).catch(() => {});
    if (tab === 'content') api.get('/admin/content').then(d => setContent(d.items)).catch(() => {});
    if (tab === 'reports') api.get('/admin/reports').then(setReports).catch(() => {});
    if (tab === 'support') api.get('/admin/support').then(setSupport).catch(() => {});
  }, [tab, userSearch, ticketFilter]);

  async function approveTicket(uuid) {
    const note = prompt('Admin note (optional):') || '';
    try { await api.post(`/tickets/${uuid}/approve`, { note }); toast.success('✅ Ticket approved, credits awarded!'); api.get(`/tickets/admin/pending?status=${ticketFilter}`).then(d => setTickets(d.items)); }
    catch (err) { toast.error(err.message); }
  }

  async function rejectTicket(uuid) {
    const reason = prompt('Rejection reason:') || 'Insufficient proof';
    try { await api.post(`/tickets/${uuid}/reject`, { reason }); toast.success('Ticket rejected.'); api.get(`/tickets/admin/pending?status=${ticketFilter}`).then(d => setTickets(d.items)); }
    catch (err) { toast.error(err.message); }
  }

  async function adjustCredits(userId) {
    if (!creditAmt) return;
    try { await api.post(`/admin/users/${userId}/credits`, { amount: parseInt(creditAmt), reason: creditReason }); toast.success('Credits adjusted!'); setCreditModal(null); setCreditAmt(''); setCreditReason(''); api.get(`/admin/users`).then(d => setUsers(d.users)); }
    catch (err) { toast.error(err.message); }
  }

  async function banUser(id, ban) {
    const reason = ban ? (prompt('Ban reason:') || 'TOS violation') : undefined;
    try {
      await api.post(`/admin/users/${id}/${ban ? 'ban' : 'unban'}`, { reason });
      toast.success(ban ? 'User banned.' : 'User unbanned.');
      api.get('/admin/users').then(d => setUsers(d.users));
    } catch (err) { toast.error(err.message); }
  }

  async function postAnnouncement(e) {
    e.preventDefault();
    try { await api.post('/admin/announcements', { title: annTitle, content: annBody, type: annType, isPinned: annPinned }); toast.success('Announcement posted!'); setAnnTitle(''); setAnnBody(''); }
    catch (err) { toast.error(err.message); }
  }

  async function makePremium(id) {
    const days = parseInt(prompt('Premium days:') || '30');
    try { await api.post(`/admin/users/${id}/make-premium`, { days }); toast.success(`Premium granted for ${days} days!`); api.get('/admin/users').then(d => setUsers(d.users)); }
    catch (err) { toast.error(err.message); }
  }

  async function deleteContent(id) {
    if (!confirm('Delete this content?')) return;
    try { await api.del(`/admin/content/${id}`); toast.success('Content deleted.'); api.get('/admin/content').then(d => setContent(d.items)); }
    catch (err) { toast.error(err.message); }
  }

  async function featureContent(id) {
    try { await api.post(`/admin/content/${id}/feature`); toast.success('Content featured!'); api.get('/admin/content').then(d => setContent(d.items)); }
    catch (err) { toast.error(err.message); }
  }

  async function closeSupport(id) {
    try { await api.post(`/admin/support/${id}/close`); toast.success('Ticket closed.'); api.get('/admin/support').then(setSupport); }
    catch (err) { toast.error(err.message); }
  }

  const ADMIN_TABS = ['overview','tickets','users','content','announcements','reports','support'];

  return (
    <div className="page-enter">
      <div className="page-header">
        <div className="page-title">🛡️ Admin Panel</div>
        <div className="page-desc">Manage the platform</div>
      </div>

      <div className="admin-tabs">
        {ADMIN_TABS.map(t => (
          <div key={t} className={`admin-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'overview' ? '📊' : t === 'tickets' ? '🎫' : t === 'users' ? '👥' : t === 'content' ? '🎬' : t === 'announcements' ? '📢' : t === 'reports' ? '🚨' : '🎧'} {t[0].toUpperCase() + t.slice(1)}
            {t === 'tickets' && stats.pendingTickets > 0 && <span className="sidebar-badge" style={{ marginLeft: 6 }}>{stats.pendingTickets}</span>}
            {t === 'reports' && stats.pendingReports > 0 && <span className="sidebar-badge" style={{ marginLeft: 6 }}>{stats.pendingReports}</span>}
          </div>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="stat-grid">
            {[
              ['Total Users', stats.totalUsers, 'var(--primary)'],
              ['Verified', stats.verifiedUsers, 'var(--success)'],
              ['Active Content', stats.activeContent, 'var(--warning)'],
              ['Pending Tickets', stats.pendingTickets, 'var(--danger)'],
              ['Credits Distributed', fmt.num(stats.totalCreditsDistributed || 0), 'var(--primary)'],
              ['Open Support', stats.openSupportTickets, 'var(--warning)'],
              ['Pending Reports', stats.pendingReports, 'var(--danger)'],
              ['Revenue', `$${(stats.revenueTotal || 0).toFixed(2)}`, 'var(--success)'],
            ].map(([l, v, c]) => (
              <div key={l} className="stat-card"><div className="stat-label">{l}</div><div className="stat-value" style={{ color: c }}>{v || 0}</div></div>
            ))}
          </div>
        </div>
      )}

      {tab === 'tickets' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['pending','approved','rejected'].map(s => (
              <button key={s} className={`btn btn-sm ${ticketFilter === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTicketFilter(s)}>{s}</button>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Content</th><th>Submitted</th><th>Screenshot</th><th>Actions</th></tr></thead>
              <tbody>
                {tickets.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-3)' }}>No {ticketFilter} tickets.</td></tr>}
                {tickets.map(t => (
                  <tr key={t.id}>
                    <td><div className="td-username"><div className="td-avatar">{t.username[0]}</div>{t.username}<div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.user_email}</div></div></td>
                    <td><a href={t.content_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontSize: 13 }} className="truncate">{t.content_title || t.content_url}</a></td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmt.date(t.created_at)}</td>
                    <td>{t.screenshot_path && <a href={`/uploads/tickets/${t.screenshot_path}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">View 🖼️</a>}</td>
                    <td>
                      {t.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => approveTicket(t.uuid)}>✅ Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => rejectTicket(t.uuid)}>❌ Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div>
          <div className="search-wrap" style={{ marginBottom: 16 }}>
            <span className="search-icon">🔍</span>
            <input className="form-input search-input" placeholder="Search username or email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Email</th><th>Credits</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><div className="td-username"><div className="td-avatar">{u.username[0]}</div><div><div style={{ fontWeight: 600, fontSize: 13 }}>{u.username}</div>{u.is_premium ? <span className="badge badge-premium" style={{ fontSize: 9 }}>⭐ Pro</span> : null}</div></div></td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{u.email}</td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{u.credits}</td>
                    <td>
                      {u.is_banned ? <span className="badge badge-danger">Banned</span> : u.is_verified ? <span className="badge badge-success">Active</span> : <span className="badge badge-warning">Unverified</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmt.date(u.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setCreditModal(u); setCreditAmt(''); setCreditReason(''); }}>💰</button>
                        {u.is_banned ? <button className="btn btn-success btn-sm" onClick={() => banUser(u.id, false)}>Unban</button> : <button className="btn btn-danger btn-sm" onClick={() => banUser(u.id, true)}>Ban</button>}
                        {!u.is_premium && <button className="btn btn-secondary btn-sm" onClick={() => makePremium(u.id)}>⭐ Pro</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'content' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Content</th><th>User</th><th>Platform</th><th>Views</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {content.map(c => (
                <tr key={c.id}>
                  <td><a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontSize: 13 }} className="truncate">{c.title || c.url}</a></td>
                  <td style={{ fontSize: 13 }}>{c.username}</td>
                  <td><span className={fmt.platformClass(c.platform)}>{P_ICONS[c.platform]} {c.platform}</span></td>
                  <td>{c.current_views}/{c.requested_views}</td>
                  <td><span className={`badge ${c.status === 'active' ? 'badge-success' : 'badge-muted'}`}>{c.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!c.is_featured && <button className="btn btn-secondary btn-sm" onClick={() => featureContent(c.id)}>⭐ Feature</button>}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteContent(c.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'announcements' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-title" style={{ marginBottom: 16 }}>Post Announcement</div>
          <form onSubmit={postAnnouncement}>
            <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={annTitle} onChange={e => setAnnTitle(e.target.value)} required /></div>
            <div className="form-group"><label className="form-label">Content *</label><textarea className="form-textarea" value={annBody} onChange={e => setAnnBody(e.target.value)} required rows={4} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={annType} onChange={e => setAnnType(e.target.value)}>{['info','success','warning','danger'].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 24 }}>
                <label className="toggle"><input type="checkbox" checked={annPinned} onChange={e => setAnnPinned(e.target.checked)} /><span className="toggle-slider" /></label>
                <span style={{ fontSize: 14 }}>Pin announcement</span>
              </div>
            </div>
            <button type="submit" className="btn btn-primary">📢 Post Announcement</button>
          </form>
        </div>
      )}

      {tab === 'reports' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Reporter</th><th>Type</th><th>Reason</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>
              {reports.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-3)' }}>No pending reports.</td></tr>}
              {reports.map(r => (
                <tr key={r.id}>
                  <td>{r.reporter_username}</td>
                  <td>{r.content_id ? '📹 Content' : '👤 User'}</td>
                  <td>{r.reason} — {r.description}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmt.date(r.created_at)}</td>
                  <td><button className="btn btn-success btn-sm" onClick={async () => { await api.post(`/admin/reports/${r.id}/resolve`); toast.success('Resolved'); api.get('/admin/reports').then(setReports); }}>Resolve</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'support' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ticket</th><th>User</th><th>Category</th><th>Status</th><th>Messages</th><th>Actions</th></tr></thead>
            <tbody>
              {support.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 500, fontSize: 13 }}>{t.subject}</td>
                  <td>{t.username}</td>
                  <td><span className="badge badge-muted">{t.category}</span></td>
                  <td><span className={`badge ${t.status === 'open' ? 'badge-warning' : t.status === 'replied' ? 'badge-success' : 'badge-muted'}`}>{t.status}</span></td>
                  <td>{t.message_count}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const reply = prompt('Reply to user:');
                        if (!reply) return;
                        await api.post(`/chat/support/${t.uuid}/message`, { message: reply }).catch(e => toast.error(e.message));
                        toast.success('Reply sent!');
                      }}>Reply</button>
                      {t.status !== 'closed' && <button className="btn btn-danger btn-sm" onClick={() => closeSupport(t.id)}>Close</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!creditModal} onClose={() => setCreditModal(null)} title={`Adjust Credits — @${creditModal?.username}`}>
        <div className="form-group">
          <label className="form-label">Amount (use negative to remove)</label>
          <input className="form-input" type="number" value={creditAmt} onChange={e => setCreditAmt(e.target.value)} placeholder="+100 or -50" />
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <input className="form-input" value={creditReason} onChange={e => setCreditReason(e.target.value)} placeholder="Admin manual adjustment" />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setCreditModal(null)}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => adjustCredits(creditModal.id)}>Apply</button>
        </div>
      </Modal>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('cx_theme') || 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [socket, setSocket] = useState(null);
  const [pendingTickets, setPendingTickets] = useState(0);
  const [booting, setBooting] = useState(true);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cx_theme', theme);
  }, [theme]);

  // Check URL params for page routing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') || params.get('reset')) return; // handled in auth
  }, []);

  // Auto-login from token
  useEffect(() => {
    const token = localStorage.getItem('cx_token');
    if (!token) { setBooting(false); return; }
    api.get('/auth/me').then(u => {
      setUser(u);
      initSocket(token, u);
    }).catch(() => {
      localStorage.removeItem('cx_token');
    }).finally(() => setBooting(false));
  }, []);

  function initSocket(token, u) {
    const s = io({ auth: { token } });
    s.on('connect', () => setSocket(s));
    s.on('connect_error', () => {});
    if (u?.isAdmin) s.emit('join_admin');
    setSocket(s);

    // Poll unread notifications
    const pollNotifs = () => api.get('/users/notifications/unread-count').then(d => setUnreadCount(d.count)).catch(() => {});
    pollNotifs();
    const interval = setInterval(pollNotifs, 30000);
    return () => { clearInterval(interval); s.disconnect(); };
  }

  function handleLogin(u) {
    setUser(u);
    const token = localStorage.getItem('cx_token');
    if (token) initSocket(token, u);
    setPage('dashboard');
  }

  function logout() {
    localStorage.removeItem('cx_token');
    socket?.disconnect();
    setSocket(null);
    setUser(null);
    setPage('dashboard');
  }

  function updateUser(u) { setUser(u); }

  if (booting) {
    return (
      <div className="boot-screen">
        <div className="boot-logo"><span className="boot-icon">⚡</span><span className="boot-text">Content Exchange</span></div>
        <div className="boot-spinner" />
      </div>
    );
  }

  if (!user) return (
    <>
      <AuthPage onLogin={handleLogin} />
      <Toasts />
    </>
  );

  const pageProps = { user, onUserUpdate: updateUser, setPage, socket };

  const pages = {
    dashboard: <Dashboard {...pageProps} />,
    announcements: <Announcements />,
    submit: <SubmitContent {...pageProps} />,
    watch: <WatchToEarn {...pageProps} />,
    tickets: <Tickets {...pageProps} />,
    leaderboard: <Leaderboard {...pageProps} />,
    chat: <Chat {...pageProps} />,
    support: <Support {...pageProps} />,
    profile: <ProfilePage {...pageProps} />,
    settings: <Settings {...pageProps} />,
    premium: <PremiumPage {...pageProps} />,
    admin: user.isAdmin ? <AdminPanel {...pageProps} /> : <Dashboard {...pageProps} />,
  };

  return (
    <>
      <div className="app-layout">
        <Sidebar
          page={page}
          setPage={setPage}
          user={user}
          ticketCount={pendingTickets}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="main-wrapper">
          <Topbar
            user={user}
            page={page}
            onMenuOpen={() => setSidebarOpen(true)}
            onThemeToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            theme={theme}
            onLogout={logout}
            setPage={setPage}
            unreadCount={unreadCount}
            onNotifToggle={() => { setNotifOpen(p => !p); setUnreadCount(0); }}
          />
          <div className="main-content">
            {pages[page] || <Dashboard {...pageProps} />}
          </div>
        </div>
      </div>
      <MobileNav page={page} setPage={setPage} />
      {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} user={user} />}
      {notifOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setNotifOpen(false)} />}
      <Toasts />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
