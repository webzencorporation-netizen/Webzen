import { Suspense } from 'react';
import { Inbox } from '@/features/inbox/inbox';

export default function ConversationsPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
