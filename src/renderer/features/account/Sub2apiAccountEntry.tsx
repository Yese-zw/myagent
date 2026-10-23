import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from '@/components/CustomSelect';
import { CloseIcon, LoaderIcon, UserIcon } from '@/components/icons';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import { isImeComposingEvent } from '@/utils/imeKeyboard';
import { sub2api, sub2apiErrorCode, type Sub2apiAccount, type Sub2apiAgreement, type Sub2apiSettings } from '@/api/sub2api';
import AgreementDocumentView from './AgreementDocumentView';
import { useSub2apiAccount } from './useSub2apiAccount';

const field = 'w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60';
const secondary = 'rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50';
const primary = 'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export default function Sub2apiAccountEntry({ expanded, onOpenAccount }: { expanded: boolean; onOpenAccount?: () => void }) {
  const { t } = useTranslation('app');
  const { account, accept, service } = useSub2apiAccount();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    const showLogin = () => setOpen(true);
    window.addEventListener('sub2api-account:open-login', showLogin);
    return () => window.removeEventListener('sub2api-account:open-login', showLogin);
  }, []);
  if (!expanded) return null;
  return <>
    <button ref={trigger} type="button" onClick={() => account.user && onOpenAccount ? onOpenAccount() : setOpen(true)} aria-haspopup={account.user && onOpenAccount ? undefined : 'dialog'} aria-expanded={account.user && onOpenAccount ? undefined : open}
      data-global-account-trigger
      className="global-sidebar-row relative flex h-8 min-w-0 items-center text-left text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      <span className="absolute left-3 flex h-4 w-4 items-center justify-center"><UserIcon className="h-4 w-4" /></span>
      <span className="global-sidebar-label min-w-0 flex-1 truncate pl-10 pr-3">{account.user ? (account.user.username || account.user.email.split('@')[0] || account.user.email) : t('sub2api.signIn')}</span>
    </button>
    {open && <Sub2apiAccountDialog account={account} settings={service.settings} onAccount={accept} onClose={close} />}
  </>;
}

export function Sub2apiAccountDialog({ account, settings, onAccount, onClose }: {
  account: Sub2apiAccount; settings: Sub2apiSettings | null;
  onAccount: (next: Sub2apiAccount) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('app');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const [email, setEmail] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [document, setDocument] = useState<Sub2apiAgreement | null>(null);
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState(0);
  const emailInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  useCloseLayer(() => {
    if (document) setDocument(null);
    else if (!submitting.current) onClose();
    return true;
  }, 260);

  const errorMessage = (error: unknown) => t(`sub2api.errors.${sub2apiErrorCode(error)}`, { defaultValue: t('sub2api.errors.UNKNOWN') });
  async function perform(operation: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(null); setNotice('');
    try { await operation(); }
    catch (error) { if (mounted.current) setError(error); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  const domains = (settings?.registration_email_suffix_whitelist ?? [])
    .map(item => item.trim().toLowerCase().replace(/^@+/, ''))
    .filter((item, index, list) => item && !item.includes('*') && item.includes('.') && list.indexOf(item) === index);
  const splitEmail = mode === 'register' && domains.length > 0;
  const resolvedDomain = emailDomain || domains[0] || '';
  const resolvedEmail = splitEmail ? (emailLocal.trim() && resolvedDomain ? `${emailLocal.trim()}@${resolvedDomain}` : '') : email;
  function switchMode(next: 'login' | 'register') {
    setMode(next); setPassword(''); setConfirmation(''); setVerifyCode(''); setError(null); setNotice('');
    if (next === 'register' && domains[0] && !emailDomain) setEmailDomain(domains[0]);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'register' && password !== confirmation) { setNotice(t('sub2api.passwordMismatch')); return; }
    await perform(async () => {
      const requiredInvitation = settings?.invitation_code_enabled === true;
      const code = invitationCode.trim();
      const next = await sub2api.authenticate({
        email: resolvedEmail, password, verifyCode, agreed,
        invitationCode: requiredInvitation ? code : '',
        affCode: requiredInvitation ? '' : code,
      }, mode === 'register');
      if (mounted.current) { setPassword(''); setConfirmation(''); onAccount(next); onClose(); }
    });
  }
  const invitationRequired = settings?.invitation_code_enabled === true;
  const allowSubmit = !busy
    && (!settings?.login_agreement_enabled || agreed)
    && (mode === 'login' || settings?.registration_enabled !== false)
    && (!splitEmail || !!resolvedEmail)
    && (mode === 'login' || !invitationRequired || invitationCode.trim().length > 0);

  return <OverlayBackdrop portal className="z-[260] px-4 py-6" onClose={busy || document ? undefined : onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="sub2api-account-title"
      className="relative z-10 max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-6 shadow-xl"
      onKeyDown={event => {
        if (event.key === 'Escape' && !isImeComposingEvent(event) && !document) {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onClose();
        }
      }}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><h2 id="sub2api-account-title" className="text-lg font-semibold text-[var(--ink)]">{t('sub2api.title')}</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{account.user ? t('sub2api.signedIn') : t('sub2api.subtitle')}</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('sub2api.close')} className={secondary}><CloseIcon className="h-4 w-4" /></button>
        </div>

        {account.user ? <div className="space-y-4">
          <div className="rounded-lg bg-[var(--paper-inset)] p-4"><p className="font-medium text-[var(--ink)]">{account.user.username || account.user.email}</p>
            <p className="mt-1 break-all text-sm text-[var(--ink-muted)]">{account.user.email}</p></div>
          <button type="button" disabled={busy} className={`${secondary} w-full`} onClick={() => void perform(async () => {
            const next = await sub2api.logout(); if (mounted.current) { onAccount(next); setNotice(t('sub2api.signedOut')); }
          })}>{t('sub2api.signOut')}</button>
        </div> : <>
          <div role="tablist" aria-label={t('sub2api.authMode')} className="mb-5 grid grid-cols-2 rounded-lg bg-[var(--paper-inset)] p-1">
            {(['login', 'register'] as const).map(value => <button type="button" role="tab" key={value} aria-selected={mode === value}
              disabled={busy || (value === 'register' && !!settings && !settings.registration_enabled)} onClick={() => switchMode(value)}
              className={`${secondary} ${mode === value ? 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-sm' : ''}`}>{t(`sub2api.${value}`)}</button>)}
          </div>
          <form onSubmit={event => void submit(event)} className="space-y-4">
            <div>
              <label htmlFor="sub2api-email" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('sub2api.email')}</label>
              {splitEmail ? (
                <div className="flex rounded-lg border border-[var(--line)] bg-[var(--paper)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
                  <input ref={emailInput} id="sub2api-email" name="email" type="text" autoComplete="username" autoFocus required maxLength={64} value={emailLocal}
                    disabled={busy} placeholder={t('sub2api.emailLocalPlaceholder')} onChange={event => setEmailLocal(event.target.value.replace(/@.*$/, ''))}
                    className="min-w-0 flex-1 select-text rounded-l-lg bg-transparent px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] disabled:opacity-60" />
                  <CustomSelect
                    value={emailDomain || domains[0]}
                    options={domains.map(item => ({ value: item, label: `@${item}` }))}
                    onChange={setEmailDomain}
                    ariaLabel={t('sub2api.emailDomain')}
                    disabled={busy}
                    compact
                    popoverMinWidth={180}
                    className="max-w-[40%] shrink-0 [&_button]:h-full [&_button]:w-auto [&_button]:max-w-full [&_button]:gap-1 [&_button]:rounded-none [&_button]:rounded-r-[7px] [&_button]:border-0 [&_button]:border-l [&_button]:border-[var(--line)] [&_button]:bg-[var(--paper-inset)] [&_button]:px-2 [&_button]:py-2 [&_button]:text-sm [&_button]:hover:border-[var(--line)] [&_button>span]:min-w-0 [&_button>span]:flex-none"
                  />
                </div>
              ) : (
                <input ref={emailInput} id="sub2api-email" name="email" type="email" autoComplete="email" autoFocus required maxLength={320} value={email}
                  disabled={busy} placeholder={t(mode === 'register' ? 'sub2api.emailRegisterPlaceholder' : 'sub2api.emailPlaceholder')}
                  onChange={event => setEmail(event.target.value)} className={`${field} select-text`} />
              )}
            </div>
            <div><label htmlFor="sub2api-password" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('sub2api.password')}</label>
              <input id="sub2api-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
                minLength={mode === 'register' ? 6 : undefined} maxLength={1024} value={password} disabled={busy}
                placeholder={t(mode === 'register' ? 'sub2api.passwordRegisterPlaceholder' : 'sub2api.passwordPlaceholder')}
                onChange={event => setPassword(event.target.value)} className={`${field} select-text`} /></div>
            {mode === 'register' && <>
              <div><label htmlFor="sub2api-confirmation" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('sub2api.confirmPassword')}</label>
                <input id="sub2api-confirmation" type="password" autoComplete="new-password" required value={confirmation} disabled={busy}
                  placeholder={t('sub2api.confirmPasswordPlaceholder')}
                  onChange={event => setConfirmation(event.target.value)} className={`${field} select-text`} /></div>
              {settings?.email_verify_enabled && <div>
                <label htmlFor="sub2api-code" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('sub2api.verifyCode')}</label>
                <div className="flex gap-2"><input id="sub2api-code" type="text" autoComplete="one-time-code" inputMode="numeric" required maxLength={12} value={verifyCode}
                  disabled={busy} placeholder={t('sub2api.verifyCodePlaceholder')} onChange={event => setVerifyCode(event.target.value)} className={`${field} min-w-0 flex-1 select-text`} />
                  <button type="button" disabled={busy || remaining > 0 || !resolvedEmail.includes('@')} className={`${secondary} shrink-0 border border-[var(--line)]`}
                    onClick={() => void perform(async () => {
                      const seconds = await sub2api.sendCode(resolvedEmail); if (mounted.current) { setRemaining(seconds); setNotice(t('sub2api.codeSent')); }
                    })}>{remaining > 0 ? `${remaining}s` : t('sub2api.sendCode')}</button></div>
              </div>}
              <div>
                <label htmlFor="sub2api-invitation" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                  {t('sub2api.invitation')}
                  {!invitationRequired && <span className="rounded-full bg-[var(--paper-inset)] px-2 py-0.5 text-[11px] font-normal text-[var(--ink-muted)]">{t('sub2api.optional')}</span>}
                </label>
                <input id="sub2api-invitation" type="text" autoComplete="off" maxLength={64} required={invitationRequired}
                  value={invitationCode} disabled={busy} placeholder={t('sub2api.invitationPlaceholder')}
                  onChange={event => setInvitationCode(event.target.value)} className={`${field} select-text`} />
                <p className="mt-1.5 text-xs text-[var(--ink-muted)]">{invitationRequired ? t('sub2api.invitationRequiredHint') : t('sub2api.invitationOptionalHint')}</p>
              </div>
            </>}
            {settings?.login_agreement_enabled && <div className="flex items-start gap-2 text-[13px] leading-5 text-[var(--ink-muted)]">
              <input id="sub2api-agreed" type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} className="mt-1 accent-[var(--accent)]" />
              <p className="min-w-0">
                <label htmlFor="sub2api-agreed" className="cursor-pointer">{t('sub2api.agree')} </label>
                {settings.login_agreement_documents.map((item, index) => (
                  <span key={item.id}>
                    {index > 0 && t('sub2api.documentSeparator')}
                    <button type="button" onClick={() => setDocument(item)} className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">{item.title}</button>
                  </span>
                ))}
              </p>
            </div>}
            <button type="submit" disabled={!allowSubmit} className={`${primary} flex w-full items-center justify-center gap-2`}>
              {busy && <LoaderIcon className="h-4 w-4 animate-spin" />}{busy ? t('sub2api.processing') : t(`sub2api.${mode}`)}
            </button>
          </form>
        </>}
        {error != null && <div role="alert" className="mt-4 rounded-lg bg-[var(--paper-inset)] p-3 text-sm text-[var(--error)]">{errorMessage(error)}</div>}
        {!!notice && <p role="status" className="mt-3 text-sm text-[var(--ink-muted)]">{notice}</p>}
      </section>
    {document && <AgreementDocumentView documents={settings?.login_agreement_documents ?? [document]} current={document} onSelect={setDocument} onClose={() => setDocument(null)} />}
  </OverlayBackdrop>;
}
