import {
  NotFoundError,
  ValidationError,
  type FeedbackCategory,
  type TicketCategory,
  type TicketStatus,
} from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { paginated, toSkipTake, type PaginationQuery } from '../../../lib/http';
import { notifyPlatform } from '../../../lib/notifications';
import { getEnabledFeatures } from '../../features/service';

/** Cliente pode reabrir um chamado resolvido por até 7 dias. */
const REOPEN_WINDOW_MS = 7 * 24 * 3600_000;

export async function listTickets(
  scope: CompanyScope,
  query: PaginationQuery & { status?: TicketStatus },
) {
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    scope.db.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      ...toSkipTake(query),
      select: {
        id: true,
        number: true,
        subject: true,
        category: true,
        status: true,
        priority: true,
        lastMessageAt: true,
        createdAt: true,
      },
    }),
    scope.db.supportTicket.count({ where }),
  ]);
  return paginated(items, total, query);
}

/** Chamado com a conversa, sem as notas internas da equipe WebZen. */
export async function getTicket(scope: CompanyScope, id: string) {
  const ticket = await scope.db.supportTicket.findUnique({
    where: { id },
    include: {
      messages: {
        where: { isInternal: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true, authorName: true, fromStaff: true, body: true, createdAt: true },
      },
    },
  });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  const { assignedToId: _assignedTo, ...visible } = ticket;
  return visible;
}

export async function createTicket(
  scope: CompanyScope,
  input: { subject: string; category: TicketCategory; body: string },
) {
  const features = await getEnabledFeatures(scope);
  const prioritySupport = features.has('PRIORITY_SUPPORT');
  const ticket = await scope.db.supportTicket.create({
    data: {
      companyId: scope.companyId,
      subject: input.subject.trim(),
      category: input.category,
      // Plano com suporte prioritário entra na fila com prioridade alta.
      priority: prioritySupport ? 'HIGH' : 'MEDIUM',
      prioritySupport,
      createdById: scope.actor.userId ?? null,
    },
  });
  await scope.db.supportTicketMessage.create({
    data: {
      companyId: scope.companyId,
      ticketId: ticket.id,
      authorUserId: scope.actor.userId ?? null,
      authorName: scope.actor.label ?? 'Cliente',
      body: input.body.trim(),
    },
  });
  await notifyPlatform({
    type: 'SYSTEM',
    severity: prioritySupport ? 'WARNING' : 'INFO',
    title: `Novo chamado #${ticket.number}${prioritySupport ? ' (prioritário)' : ''}`,
    body: input.subject.trim(),
    link: `/platform/support/${ticket.id}`,
  });
  await audit(scope, {
    action: 'support_ticket.created',
    resourceType: 'SupportTicket',
    resourceId: ticket.id,
    metadata: { category: input.category, number: ticket.number },
  });
  return getTicket(scope, ticket.id);
}

export async function replyTicket(scope: CompanyScope, id: string, body: string) {
  const ticket = await scope.db.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  if (ticket.status === 'CLOSED')
    throw new ValidationError('Chamado encerrado. Abra um novo chamado.');
  const now = new Date();
  await scope.db.supportTicketMessage.create({
    data: {
      companyId: scope.companyId,
      ticketId: id,
      authorUserId: scope.actor.userId ?? null,
      authorName: scope.actor.label ?? 'Cliente',
      body: body.trim(),
    },
  });
  await scope.db.supportTicket.update({
    where: { id },
    data: {
      lastMessageAt: now,
      // Resposta do cliente devolve o chamado para a fila da equipe.
      ...(ticket.status === 'WAITING_USER' || ticket.status === 'RESOLVED'
        ? { status: 'OPEN', resolvedAt: null }
        : {}),
    },
  });
  await notifyPlatform({
    type: 'SYSTEM',
    title: `Cliente respondeu o chamado #${ticket.number}`,
    body: ticket.subject,
    link: `/platform/support/${id}`,
  });
  return getTicket(scope, id);
}

export async function closeTicket(scope: CompanyScope, id: string) {
  const ticket = await scope.db.supportTicket.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  if (ticket.status === 'CLOSED') return getTicket(scope, id);
  await scope.db.supportTicket.update({
    where: { id },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
  return getTicket(scope, id);
}

export async function reopenTicket(scope: CompanyScope, id: string, now: Date = new Date()) {
  const ticket = await scope.db.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  const since = ticket.closedAt ?? ticket.resolvedAt;
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') {
    throw new ValidationError('O chamado já está aberto.');
  }
  if (!since || now.getTime() - since.getTime() > REOPEN_WINDOW_MS) {
    throw new ValidationError(
      'Este chamado foi encerrado há mais de 7 dias. Abra um novo chamado.',
    );
  }
  await scope.db.supportTicket.update({
    where: { id },
    data: { status: 'OPEN', resolvedAt: null, closedAt: null, lastMessageAt: now },
  });
  return getTicket(scope, id);
}

export async function sendFeedback(
  scope: CompanyScope,
  input: { category: FeedbackCategory; message: string; page?: string | null },
) {
  await scope.db.feedback.create({
    data: {
      companyId: scope.companyId,
      userId: scope.actor.userId ?? null,
      category: input.category,
      message: input.message.trim(),
      // Só o caminho: query strings podem carregar dados (ex.: tokens) que não queremos guardar.
      page: input.page ? input.page.split('?')[0]!.slice(0, 200) : null,
    },
  });
}
