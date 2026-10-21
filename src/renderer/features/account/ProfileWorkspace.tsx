import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { sub2api, sub2apiErrorCode, type Sub2apiAccount, type Sub2apiSettings, type Sub2apiUser } from '@/api/sub2api';

type RecordValue = Record<string, unknown>;
type NotifyEmail = { email: string; disabled: boolean; verified: boolean };

const field = 'w-full rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--focus-border)] focus:outline-none';
const primary = 'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--hover-bg)] disabled:opacity-50';

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}
function display(value: unknown, fallback = '—') {
  return typeof value === 'string' && value ? value : value == null ? fallback : String(value);
}
function parseEmails(value: unknown): NotifyEmail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item === 'string') return item.includes('@') ? [{ email: item, disabled: false, verified: true }] : [];
    const source = record(item);
    const email = display(source.email, '');
    if (!email.includes('@')) return [];
    return [{ email, disabled: source.disabled === true, verified: source.verified !== false }];
  });
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
      <div className="mb-5">
        <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
        {hint && <p className="mt-1 text-sm text-[var(--ink-muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function errorMessage(reason: unknown, t: (key: string, options?: { defaultValue: string }) => string) {
  return t(`sub2api.errors.${sub2apiErrorCode(reason)}`, { defaultValue: t('sub2api.errors.UNKNOWN') });
}

export default function ProfileWorkspace({
  profile,
  account,
  settings,
  onAccount,
}: {
  profile: RecordValue;
  account: Sub2apiAccount;
  settings: Sub2apiSettings | null;
  onAccount: (next: Sub2apiAccount) => void;
}) {
  const data = { ...profile, ...(Object.keys(profile).length ? {} : record(account.user)) };
  const showNotify = settings?.balance_low_notify_enabled !== false;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="space-y-5">
        <BasicsCard data={data} account={account} onAccount={onAccount} />
        <PasswordCard />
      </div>
      {showNotify && <BalanceNotifyCard data={data} settings={settings} />}
    </div>
  );
}

function BasicsCard({ data, account, onAccount }: { data: RecordValue; account: Sub2apiAccount; onAccount: (next: Sub2apiAccount) => void }) {
  const { t } = useTranslation('app');
  const [username, setUsername] = useState(display(data.username ?? account.user?.username, ''));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setUsername(display(data.username ?? account.user?.username, '')), [data.username, account.user?.username]);
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const raw = record(await sub2api.accountApi('update-profile', { username: username.trim() }));
      const user = record(raw.user ?? raw);
      onAccount({ ...account, user: { ...account.user!, ...user } as Sub2apiUser });
      setMessage(t('sub2api.profileSaved'));
    } catch (reason) {
      setMessage(errorMessage(reason, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title={t('sub2api.profileBasics')} hint={t('sub2api.profileBasicsHint')}>
      <div className="space-y-4">
        <label className="block text-sm font-medium">{t('sub2api.email')}<input value={display(data.email ?? account.user?.email)} readOnly className={`${field} mt-1.5 opacity-70`} /></label>
        <label className="block text-sm font-medium">{t('sub2api.username')}<input value={username} onChange={event => setUsername(event.target.value)} maxLength={100} className={`${field} mt-1.5`} /></label>
        <button type="button" disabled={saving} onClick={() => void save()} className={primary}>{saving ? t('sub2api.processing') : t('sub2api.save')}</button>
        {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation('app');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const submit = async () => {
    setFailed(false);
    if (newPassword.length < 8) {
      setFailed(true);
      setMessage(t('sub2api.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFailed(true);
      setMessage(t('sub2api.newPasswordMismatch'));
      return;
    }
    setSaving(true); setMessage('');
    try {
      await sub2api.accountApi('change-password', { old_password: oldPassword, new_password: newPassword });
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
      setMessage(t('sub2api.passwordChangeSuccess'));
    } catch (reason) {
      setFailed(true);
      setMessage(errorMessage(reason, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title={t('sub2api.changePassword')} hint={t('sub2api.changePasswordHint')}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="block text-sm font-medium">{t('sub2api.currentPassword')}<input type="password" autoComplete="current-password" value={oldPassword} onChange={event => setOldPassword(event.target.value)} required className={`${field} mt-1.5`} /></label>
        <label className="block text-sm font-medium">{t('sub2api.newPassword')}<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength={8} className={`${field} mt-1.5`} /></label>
        <p className="text-xs text-[var(--ink-muted)]">{t('sub2api.passwordHint')}</p>
        <label className="block text-sm font-medium">{t('sub2api.confirmNewPassword')}<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required className={`${field} mt-1.5`} /></label>
        <div className="flex justify-end pt-1"><button type="submit" disabled={saving || !oldPassword || !newPassword || !confirmPassword} className={primary}>{saving ? t('sub2api.changingPassword') : t('sub2api.changePasswordButton')}</button></div>
        {message && <p role="status" className={`text-sm ${failed ? 'text-[var(--error)]' : 'text-[var(--ink-muted)]'}`}>{message}</p>}
      </form>
    </Card>
  );
}

function BalanceNotifyCard({ data, settings }: { data: RecordValue; settings: Sub2apiSettings | null }) {
  const { t } = useTranslation('app');
  const [enabled, setEnabled] = useState(data.balance_notify_enabled !== false);
  const [threshold, setThreshold] = useState(data.balance_notify_threshold == null ? '' : String(data.balance_notify_threshold));
  const [emails, setEmails] = useState(() => parseEmails(data.balance_notify_extra_emails));
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingCode, setPendingCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const systemDefault = Number(settings?.balance_low_notify_threshold ?? 0);
  useEffect(() => {
    setEnabled(data.balance_notify_enabled !== false);
    setThreshold(data.balance_notify_threshold == null ? '' : String(data.balance_notify_threshold));
    setEmails(parseEmails(data.balance_notify_extra_emails));
  }, [data.balance_notify_enabled, data.balance_notify_extra_emails, data.balance_notify_threshold]);
  const saveNotify = async (nextEnabled = enabled, nextThreshold = threshold) => {
    setBusy(true); setMessage('');
    try {
      const parsed = nextThreshold.trim() === '' ? null : Number(nextThreshold);
      if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) throw new Error('INVALID_INPUT');
      await sub2api.accountApi('update-profile', { balance_notify_enabled: nextEnabled, balance_notify_threshold: parsed });
      setMessage(t('sub2api.profileSaved'));
    } catch (reason) {
      setMessage(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };
  const sendCode = async () => {
    const email = pendingEmail.trim();
    if (!email.includes('@')) return;
    if (emails.some(item => item.email === email)) {
      setMessage(t('sub2api.balanceNotify.duplicate'));
      return;
    }
    if (emails.length >= 3) {
      setMessage(t('sub2api.balanceNotify.maxEmails'));
      return;
    }
    setBusy(true); setMessage('');
    try {
      await sub2api.accountApi('send-notify-email-code', { email });
      setCodeSent(true);
      setMessage(t('sub2api.balanceNotify.codeSent'));
    } catch (reason) {
      setMessage(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true); setMessage('');
    try {
      await sub2api.accountApi('verify-notify-email', { email: pendingEmail.trim(), code: pendingCode.trim() });
      setEmails(value => [...value, { email: pendingEmail.trim(), disabled: false, verified: true }]);
      setPendingEmail(''); setPendingCode(''); setCodeSent(false);
      setMessage(t('sub2api.balanceNotify.verifySuccess'));
    } catch (reason) {
      setMessage(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (email: string) => {
    setBusy(true); setMessage('');
    try {
      await sub2api.accountApi('remove-notify-email', { email });
      setEmails(value => value.filter(item => item.email !== email));
    } catch (reason) {
      setMessage(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (entry: NotifyEmail) => {
    setBusy(true); setMessage('');
    try {
      await sub2api.accountApi('toggle-notify-email', { email: entry.email, disabled: !entry.disabled });
      setEmails(value => value.map(item => item.email === entry.email ? { ...item, disabled: !item.disabled } : item));
    } catch (reason) {
      setMessage(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('sub2api.balanceNotify.title')} hint={t('sub2api.balanceNotify.description')}>
      <div className="space-y-5">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>{t('sub2api.balanceNotify.enabled')}</span>
          <input type="checkbox" checked={enabled} disabled={busy} onChange={event => { const next = event.target.checked; setEnabled(next); void saveNotify(next); }} />
        </label>
        {enabled && <>
          <div>
            <label className="block text-sm font-medium">{t('sub2api.balanceNotify.threshold')}<span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">{t('sub2api.balanceNotify.thresholdHint')}</span>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-sm text-[var(--ink-muted)]">$</span>
                <input aria-label={t('sub2api.balanceNotify.threshold')} type="number" min="0" step="0.01" value={threshold} onChange={event => setThreshold(event.target.value)} placeholder={systemDefault > 0 ? t('sub2api.balanceNotify.systemDefault', { amount: systemDefault }) : t('sub2api.balanceNotify.thresholdPlaceholder')} className={`${field} min-w-0 flex-1`} />
                <button type="button" disabled={busy} onClick={() => void saveNotify()} className={primary}>{t('sub2api.save')}</button>
              </div>
            </label>
          </div>
          <div>
            <p className="text-sm font-medium">{t('sub2api.balanceNotify.extraEmails')}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('sub2api.balanceNotify.extraEmailsHint')}</p>
            <div className="mt-3 space-y-2">
              {emails.map(entry => (
                <div key={entry.email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--paper-inset)] px-3 py-2">
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <input type="checkbox" checked={!entry.disabled} disabled={busy} onChange={() => void toggle(entry)} />
                    <span className="truncate">{entry.email}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--ink-muted)]">{entry.verified ? t('sub2api.balanceNotify.verified') : t('sub2api.balanceNotify.unverified')}</span>
                    <button type="button" disabled={busy} className={secondary} onClick={() => void remove(entry.email)}>{t('sub2api.balanceNotify.remove')}</button>
                  </div>
                </div>
              ))}
            </div>
            {emails.length < 3 && <div className="mt-3 flex flex-wrap gap-2">
              <input type="email" value={pendingEmail} onChange={event => { setPendingEmail(event.target.value); setCodeSent(false); }} placeholder={t('sub2api.balanceNotify.emailPlaceholder')} className={`${field} min-w-0 flex-1`} />
              {!codeSent
                ? <button type="button" disabled={busy || !pendingEmail.includes('@')} className={secondary} onClick={() => void sendCode()}>{t('sub2api.balanceNotify.sendCode')}</button>
                : <>
                  <input value={pendingCode} onChange={event => setPendingCode(event.target.value)} maxLength={6} placeholder={t('sub2api.balanceNotify.codePlaceholder')} className={`${field} w-28`} />
                  <button type="button" disabled={busy || pendingCode.trim().length !== 6} className={primary} onClick={() => void verify()}>{t('sub2api.balanceNotify.verify')}</button>
                </>}
            </div>}
          </div>
        </>}
        {message && <p role="status" className="text-sm text-[var(--ink-muted)]">{message}</p>}
      </div>
    </Card>
  );
}
