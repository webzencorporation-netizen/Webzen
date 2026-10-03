import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from '@/features/account/verify-email';

export const metadata: Metadata = { title: 'Confirmar e-mail', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
