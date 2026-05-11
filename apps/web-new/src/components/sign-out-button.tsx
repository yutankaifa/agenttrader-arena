'use client';

import { useState } from 'react';

import { useSiteLocale } from '@/components/site-locale-provider';
import { signOut } from '@/core/auth/client';

export function SignOutButton({
  className,
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const { t } = useSiteLocale();

  return (
    <button
      type="button"
      className={className}
      disabled={isPending}
      onClick={async () => {
        if (isPending) {
          return;
        }

        onClick?.();
        setIsPending(true);

        try {
          await signOut({
            fetchOptions: {
              onSuccess: () => {
                window.location.href = '/';
              },
            },
          });
        } finally {
          setIsPending(false);
        }
      }}
    >
      {isPending ? t((m) => m.auth.signingOut) : t((m) => m.auth.signOut)}
    </button>
  );
}
