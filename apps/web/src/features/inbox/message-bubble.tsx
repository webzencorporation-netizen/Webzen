import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import type { ChatMessage } from '../types';

function StatusIcon({ status }: { status: string }) {
  if (status === 'QUEUED') return <Clock className="h-3 w-3" aria-label="Enviando" />;
  if (status === 'SENT') return <Check className="h-3 w-3" aria-label="Enviada" />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3 w-3" aria-label="Entregue" />;
  if (status === 'READ') return <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Lida" />;
  if (status === 'FAILED') return <AlertCircle className="h-3 w-3 text-red-300" aria-label="Falhou" />;
  return null;
}

function MediaContent({ message }: { message: ChatMessage }) {
  return (
    <>
      {message.media.map((media) => {
        const url = `/api/app/conversations/media/${media.id}`;
        if (!media.available) {
          return (
            <p key={media.id} className="text-xs italic opacity-70">
              {media.processingStatus === 'FAILED' ? 'Não foi possível baixar a mídia.' : 'Processando mídia…'}
            </p>
          );
        }
        if (media.kind === 'IMAGE' || media.kind === 'STICKER') {
          return <img key={media.id} src={url} alt={media.caption ?? 'Imagem enviada pelo cliente'} className="mb-1 max-h-64 rounded-lg object-cover" loading="lazy" />;
        }
        if (media.kind === 'AUDIO') {
          return (
            <div key={media.id} className="space-y-1">
              <audio controls src={url} className="h-9 max-w-full" preload="none" />
              {media.transcription ? <p className="text-xs italic opacity-80">“{media.transcription}”</p> : <p className="text-[11px] opacity-60">Sem transcrição</p>}
            </div>
          );
        }
        return (
          <a key={media.id} href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-xs underline-offset-2 hover:underline">
            <FileText className="h-4 w-4" /> {media.fileName ?? 'Arquivo'}
          </a>
        );
      })}
    </>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.sender === 'SYSTEM' && message.type === 'SYSTEM') {
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[85%] rounded-full bg-slate-200/70 px-3 py-1 text-center text-[11px] text-slate-600">
          {message.text} · {formatTime(message.createdAt)}
        </span>
      </div>
    );
  }
  const inbound = message.direction === 'INBOUND';
  const isAgent = message.sender === 'AGENT';
  const isAi = message.sender === 'AI' || message.sender === 'SYSTEM';
  const location = message.payload?.location as { latitude?: number; longitude?: number } | undefined;

  return (
    <div className={cn('my-1 flex', inbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%]',
          inbound && 'rounded-bl-md bg-surface text-slate-800',
          isAi && 'rounded-br-md bg-brand-50 text-slate-800 ring-1 ring-brand-100',
          isAgent && 'rounded-br-md bg-ink text-white',
          message.status === 'FAILED' && 'ring-2 ring-red-300',
        )}
      >
        {!inbound ? (
          <p className={cn('mb-0.5 flex items-center gap-1 text-[11px] font-semibold', isAgent ? 'text-slate-300' : 'text-brand-700')}>
            {isAi ? <Bot className="h-3 w-3" /> : null}
            {isAgent ? (message.senderUser?.name ?? 'Equipe') : message.sender === 'SYSTEM' ? 'Mensagem automática' : 'Atendente virtual'}
            {message.type === 'TEMPLATE' ? ' · template' : ''}
          </p>
        ) : null}
        <MediaContent message={message} />
        {location?.latitude !== undefined ? (
          <a
            href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="mb-1 flex items-center gap-1 text-xs underline"
          >
            <MapPin className="h-3.5 w-3.5" /> Ver localização
          </a>
        ) : null}
        {message.text && !(message.media.length > 0 && message.media[0]?.caption === message.text) ? <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p> : null}
        <div className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', isAgent ? 'text-slate-400' : 'text-slate-400')}>
          {formatTime(message.createdAt)}
          {!inbound ? <StatusIcon status={message.status} /> : null}
        </div>
        {message.status === 'FAILED' && message.errorMessage ? <p className="mt-1 text-[11px] font-medium text-red-500">{message.errorMessage}</p> : null}
      </div>
    </div>
  );
}
