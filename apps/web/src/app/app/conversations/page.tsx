import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inbox } from '@/features/inbox/inbox';

export const metadata: Metadata = { title: 'Conversas' };

export default function ConversationsPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
