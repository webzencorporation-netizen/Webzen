import { Suspense } from 'react';
import { Inbox } from '@/features/inbox/inbox';

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <Inbox conversationId={id} />
    </Suspense>
  );
}
