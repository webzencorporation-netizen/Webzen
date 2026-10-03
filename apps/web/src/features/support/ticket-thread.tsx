'use client';

import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';

export interface ThreadMessage {
  id: string;
  authorName: string;
  fromStaff: boolean;
  isInternal?: boolean;
  body: string;
  createdAt: string;
}

/** Conversa de um chamado. `perspective` define de que lado ficam as mensagens próprias. */
export function TicketThread({ messages, perspective }: { messages: ThreadMessage[]; perspective: 'customer' | 'staff' }) {
  return (
    <ol className="space-y-4">
      {messages.map((message) => {
        const own = perspective === 'staff' ? message.fromStaff : !message.fromStaff;
        return (
          <li key={message.id} className={cn('flex', own && 'justify-end')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                message.isInternal
                  ? 'border border-dashed border-amber-300 bg-amber-50 text-amber-900'
                  : own
                    ? 'bg-brand-600 text-white'
                    : 'border border-border bg-surface text-foreground',
              )}
            >
              <p className={cn('mb-1 text-xs font-medium', own && !message.isInternal ? 'text-white/75' : 'text-muted')}>
                {message.isInternal ? 'Nota interna · ' : ''}
                {message.authorName} · {formatDateTime(message.createdAt)}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
