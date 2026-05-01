'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
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
  const { t } = useSiteLocale();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<
    'sign-in' | 'sign-up' | 'google' | 'github' | null
  >(null);
  const [message, setMessage] = useState(error ?? '');

  const showSocial = googleEnabled || githubEnabled;
  const pageTitle =
    mode === 'sign-up' ? t((m) => m.auth.signUpTitle) : t((m) => m.auth.signInTitle);
  const pageCopy =
    mode === 'sign-up'
      ? t((m) => m.auth.signUpCopy)
      : t((m) => m.auth.signInCopy);

  const safeCallbackURL = useMemo(() => {
    return callbackURL.startsWith('/') ? callbackURL : '/my-agent';
  }, [callbackURL]);

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
      <div className="mb-10">
        <p className="mb-3 text-sm font-medium tracking-widest uppercase text-black/48">
          {mode === 'sign-up' ? t((m) => m.auth.signUpEyebrow) : t((m) => m.auth.signInEyebrow)}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[#171717] sm:text-5xl">
          {pageTitle}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-black/58">{pageCopy}</p>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-6">
        <div className="mb-5 inline-flex border border-black/10 bg-[#fafafa] p-1">
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium transition ${
              mode === 'sign-in'
                ? 'bg-[#171717] text-white'
                : 'text-[#171717] hover:bg-white'
            }`}
            onClick={() => {
              setMode('sign-in');
              setMessage('');
            }}
          >
            {t((m) => m.auth.signInTab)}
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium transition ${
              mode === 'sign-up'
                ? 'bg-[#171717] text-white'
                : 'text-[#171717] hover:bg-white'
            }`}
            onClick={() => {
              setMode('sign-up');
              setMessage('');
            }}
          >
            {t((m) => m.auth.signUpTab)}
          </button>
        </div>

        {showSocial ? (
          <div className="space-y-3">
            {googleEnabled ? (
              <button
                type="button"
                className="flex w-full items-center justify-center border border-black/12 bg-white px-4 py-3 text-sm font-medium text-[#171717] transition hover:bg-[#fafafa]"
                disabled={pendingAction !== null}
                onClick={() => handleSocialSignIn('google')}
              >
                {pendingAction === 'google'
                  ? t((m) => m.auth.connectingGoogle)
                  : t((m) => m.auth.continueGoogle)}
              </button>
            ) : null}
            {githubEnabled ? (
              <button
                type="button"
                className="flex w-full items-center justify-center border border-black/12 bg-white px-4 py-3 text-sm font-medium text-[#171717] transition hover:bg-[#fafafa]"
                disabled={pendingAction !== null}
                onClick={() => handleSocialSignIn('github')}
              >
                {pendingAction === 'github'
                  ? t((m) => m.auth.connectingGithub)
                  : t((m) => m.auth.continueGithub)}
              </button>
            ) : null}
          </div>
        ) : null}

        {showSocial ? (
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-black/10" />
            <span className="text-xs font-medium tracking-[0.18em] uppercase text-black/35">
              {t((m) => m.auth.or)}
            </span>
            <div className="h-px flex-1 bg-black/10" />
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

        <div className="mt-4 text-sm text-black/48">
          <Link href={safeCallbackURL === '/my-agent' ? '/join' : safeCallbackURL}>
            {t((m) => m.auth.back)}
          </Link>
        </div>
      </div>
    </div>
  );
}
