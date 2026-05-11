'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { useSiteLocale } from '@/components/site-locale-provider';
import { signIn, signUp } from '@/core/auth/client';

type AuthMode = 'sign-in' | 'sign-up';

export function AuthPageClient({
  callbackURL,
  error,
  googleEnabled,
  githubEnabled,
  initialMode = 'sign-in',
}: {
  callbackURL: string;
  error?: string;
  googleEnabled: boolean;
  githubEnabled: boolean;
  initialMode?: AuthMode;
}) {
  const router = useRouter();
  const { isZh, t } = useSiteLocale();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasAcceptedLegal, setHasAcceptedLegal] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'sign-in' | 'sign-up' | 'google' | 'github' | null
  >(null);
  const [message, setMessage] = useState(error ?? '');
  const legalConsentRef = useRef<HTMLInputElement | null>(null);

  const showSocial = googleEnabled || githubEnabled;

  const safeCallbackURL = useMemo(() => {
    return callbackURL.startsWith('/') ? callbackURL : '/my-agent';
  }, [callbackURL]);
  const primaryTermsHref = isZh ? '/TERMS.zh-CN.md' : '/TERMS.md';
  const primaryPrivacyHref = isZh ? '/PRIVACY.zh-CN.md' : '/PRIVACY.md';

  function requireLegalAcceptance() {
    if (hasAcceptedLegal) {
      return true;
    }

    setMessage(t((m) => m.auth.legalAcceptanceRequired));
    legalConsentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    legalConsentRef.current?.focus();
    return false;
  }

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    if (!email || !password || (mode === 'sign-up' && !name.trim())) {
      setMessage(
        mode === 'sign-up'
          ? t((m) => m.auth.nameRequired)
          : t((m) => m.auth.emailRequired)
      );
      return;
    }

    if (!requireLegalAcceptance()) {
      return;
    }

    setPendingAction(mode);

    try {
      if (mode === 'sign-up') {
        await signUp.email(
          {
            name: name.trim(),
            email: email.trim(),
            password,
          },
          {
            onSuccess: () => {
              window.location.href = safeCallbackURL;
            },
            onError: (context) => {
              setMessage(context.error.message || t((m) => m.auth.signUpFailed));
            },
          }
        );
        return;
      }

      await signIn.email(
        {
          email: email.trim(),
          password,
          callbackURL: safeCallbackURL,
        },
        {
          onSuccess: () => {
            window.location.href = safeCallbackURL;
          },
          onError: (context) => {
            setMessage(context.error.message || t((m) => m.auth.signInFailed));
          },
        }
      );
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : t((m) => m.auth.authFailed));
    } finally {
      setPendingAction(null);
      router.refresh();
    }
  }

  async function handleSocialSignIn(provider: 'google' | 'github') {
    setMessage('');

    if (!requireLegalAcceptance()) {
      return;
    }

    setPendingAction(provider);

    try {
      await signIn.social(
        {
          provider,
          callbackURL: safeCallbackURL,
        },
        {
          onError: (context) => {
            setMessage(context.error.message || t((m) => m.auth.signInFailed));
            setPendingAction(null);
          },
        }
      );
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : t((m) => m.auth.signInFailed));
      setPendingAction(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl pt-20 md:pt-24 px-6 py-10 sm:py-16">
      <div className="rounded-xl border border-black/10 bg-white p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-[-0.05em] text-[#171717] sm:text-4xl text-center">
            {t((m) => m.auth.welcomeTitle)}
          </h1>
        </div>

        {showSocial ? (
          <div className="mb-6">
            <div className="flex items-center justify-center gap-3">
              {googleEnabled ? (
                <SocialProviderButton
                  ariaLabel={
                    pendingAction === 'google'
                      ? t((m) => m.auth.connectingGoogle)
                      : t((m) => m.auth.continueGoogle)
                  }
                  disabled={pendingAction !== null}
                  onClick={() => handleSocialSignIn('google')}
                >
                  <GoogleIcon />
                </SocialProviderButton>
              ) : null}
              {githubEnabled ? (
                <SocialProviderButton
                  ariaLabel={
                    pendingAction === 'github'
                      ? t((m) => m.auth.connectingGithub)
                      : t((m) => m.auth.continueGithub)
                  }
                  disabled={pendingAction !== null}
                  onClick={() => handleSocialSignIn('github')}
                >
                  <GitHubIcon />
                </SocialProviderButton>
              ) : null}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-black/10" />
              <span className="text-xs font-medium tracking-[0.18em] uppercase text-black/35">
                {t((m) => m.auth.or)}
              </span>
              <div className="h-px flex-1 bg-black/10" />
            </div>
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={handleEmailAuth}>
          {mode === 'sign-up' ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#171717]">{t((m) => m.auth.displayName)}</label>
              <input
                name="name"
                className="w-full border border-black/12 bg-white px-4 py-3 outline-none"
                placeholder={t((m) => m.auth.displayNamePlaceholder)}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#171717]">{t((m) => m.auth.email)}</label>
            <input
              name="email"
              type="email"
              className="w-full border border-black/12 bg-white px-4 py-3 outline-none"
              placeholder={t((m) => m.auth.emailPlaceholder)}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#171717]">{t((m) => m.auth.password)}</label>
            <input
              name="password"
              type="password"
              className="w-full border border-black/12 bg-white px-4 py-3 outline-none"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {message ? (
            <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message}
            </div>
          ) : null}

          <div className="space-y-2 border border-black/10 bg-[#fafafa] px-4 py-3">
            <label className="flex items-start gap-3 text-sm leading-6 text-black/58">
              <input
                ref={legalConsentRef}
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 border border-black/18 accent-[#171717]"
                checked={hasAcceptedLegal}
                onChange={(event) => setHasAcceptedLegal(event.target.checked)}
              />
              <span>
                {t((m) => m.auth.legalAgreementPrefix)}
                <a
                  href={primaryTermsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#171717] underline underline-offset-4"
                >
                  {t((m) => m.auth.termsOfService)}
                </a>
                {t((m) => m.auth.legalAgreementMiddle)}
                <a
                  href={primaryPrivacyHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#171717] underline underline-offset-4"
                >
                  {t((m) => m.auth.privacyPolicy)}
                </a>
                {t((m) => m.auth.legalAgreementSuffix)}
              </span>
            </label>
          </div>

          <button
            type="submit"
            className="button-solid button-cta"
            disabled={pendingAction !== null}
          >
            {pendingAction === mode
              ? mode === 'sign-up'
                ? t((m) => m.auth.creatingAccount)
                : t((m) => m.auth.signingIn)
              : mode === 'sign-up'
                ? t((m) => m.auth.createAccount)
                : t((m) => m.auth.signInTab)}
          </button>
        </form>
          <div className="mt-5 text-sm text-black/58">
          {mode === 'sign-up' ? t((m) => m.auth.alreadyHaveAccount) : t((m) => m.auth.noAccount)}{' '}
          <button
            type="button"
            className="font-medium text-[#171717] underline underline-offset-4"
            onClick={() => {
              setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
              setMessage('');
            }}
          >
            {mode === 'sign-up' ? t((m) => m.auth.signInLower) : t((m) => m.auth.signUpLower)}
          </button>
        </div>

      </div>
    </div>
  );
}

function SocialProviderButton({
  ariaLabel,
  children,
  disabled,
  onClick,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      className="inline-flex h-12 w-12 items-center justify-center border border-black/12 bg-white text-[#171717] transition hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.68-.06-1.33-.17-1.95H12v3.69h5.39a4.61 4.61 0 0 1-2 3.03v2.52h3.23c1.89-1.74 2.98-4.3 2.98-7.29Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.52c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.58-4.12H3.08v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.42 13.89A5.98 5.98 0 0 1 6.1 12c0-.66.11-1.3.32-1.89V7.5H3.08A10 10 0 0 0 2 12c0 1.61.39 3.13 1.08 4.5l3.34-2.61Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.98c1.47 0 2.8.5 3.84 1.49l2.88-2.88C16.95 2.96 14.69 2 12 2A10 10 0 0 0 3.08 7.5l3.34 2.61C7.2 7.74 9.4 5.98 12 5.98Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.08-.74.08-.73.08-.73 1.2.09 1.83 1.22 1.83 1.22 1.06 1.81 2.79 1.29 3.47.99.11-.77.42-1.29.76-1.59-2.67-.3-5.48-1.31-5.48-5.86 0-1.3.47-2.37 1.23-3.21-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.22a11.6 11.6 0 0 1 6 0c2.29-1.54 3.3-1.22 3.3-1.22.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.21 0 4.56-2.82 5.56-5.5 5.85.43.37.82 1.1.82 2.23v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
