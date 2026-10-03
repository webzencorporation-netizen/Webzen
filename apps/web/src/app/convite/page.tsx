import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AcceptInvite } from '@/features/account/accept-invite';

export const metadata: Metadata = { title: 'Convite para equipe', robots: { index: false } };

export default function InvitePage() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
