import { systemDb, type Prisma } from '@botsaas/database';
import { NotFoundError, type TicketPriority, type TicketStatus } from '@botsaas/shared';
import type { AppContainer } from '../../container';
import type { Actor } from '../../context';
import { auditPlatform } from '../../lib/audit';
import { paginated, toSkipTake, type PaginationQuery } from '../../lib/http';
import { queueEmail } from '../email/service';
import { emailTemplates } from '../email/templates';

/** Fila da equipe WebZen: prioritários primeiro, depois os parados há mais tempo. */
export async function listAllTickets(
  query: PaginationQuery & { status?: TicketStatus; companyId?: string; search?: string },
) {
  const where: Prisma.SupportTicketWhereInput = {
    ...(query.status ? { status: query.status } : { status: { notIn: ['CLOSED'] } }),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.search
      ? {
          OR: [
            { subject: { contains: query.search, mode: 'insensitive' } },
            ...(/^\d+$/.test(query.search) ? [{ number: Number(query.search) }] : []),
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    systemDb.supportTicket.findMany({
      where,
      orderBy: [{ prioritySupport: 'desc' }, { priority: 'desc' }, { lastMessageAt: 'asc' }],
      ...toSkipTake(query),
      include: { company: { select: { id: true, name: true } } },
    }),
    systemDb.supportTicket.count({ where }),
  ]);
  return paginated(items, total, query);
}

export async function getTicketForStaff(id: string) {
  const ticket = await systemDb.supportTicket.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  return ticket;
}

export async function staffReply(
  container: AppContainer,
  actor: Actor,
  id: string,
  input: { body: string; internal: boolean },
) {
  const ticket = await systemDb.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  const now = new Date();
  await systemDb.supportTicketMessage.create({
    data: {
      companyId: ticket.companyId,
      ticketId: id,
      authorUserId: actor.userId ?? null,
      authorName: input.internal ? (actor.label ?? 'Equipe WebZen') : 'Equipe WebZen',
      fromStaff: true,
      isInternal: input.internal,
      body: input.body.trim(),
    },
  });
  if (!input.internal) {
    await systemDb.supportTicket.update({
      where: { id },
      data: {
        lastMessageAt: now,
        status:
          ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS'
            ? 'WAITING_USER'
            : ticket.status,
        assignedToId: ticket.assignedToId ?? actor.userId ?? null,
      },
    });
    await systemDb.notification.create({
      data: {
        companyId: ticket.companyId,
        type: 'SYSTEM',
        title: `Resposta no chamado #${ticket.number}`,
        body: ticket.subject,
        link: `/app/support/${id}`,
      },
    });
    if (ticket.createdById) {
      const creator = await systemDb.user.findUnique({
        where: { id: ticket.createdById },
        select: { email: true, name: true, isActive: true },
      });
      if (creator?.isActive) {
        await queueEmail(container, {
          to: creator.email,
          template: 'ticketReply',
          email: emailTemplates.ticketReply({
            name: creator.name,
            number: ticket.number,
            subject: ticket.subject,
            url: `${container.env.APP_URL}/app/support/${id}`,
          }),
        });
      }
    }
  }
  await auditPlatform(actor, {
    companyId: ticket.companyId,
    action: input.internal ? 'support_ticket.internal_note' : 'support_ticket.replied',
    resourceType: 'SupportTicket',
    resourceId: id,
  });
  return getTicketForStaff(id);
}

export async function updateTicketForStaff(
  actor: Actor,
  id: string,
  input: { status?: TicketStatus; priority?: TicketPriority; assignedToMe?: boolean },
) {
  const ticket = await systemDb.supportTicket.findUnique({
    where: { id },
    select: { id: true, companyId: true },
  });
  if (!ticket) throw new NotFoundError('Chamado não encontrado.');
  const now = new Date();
  await systemDb.supportTicket.update({
    where: { id },
    data: {
      ...(input.status
        ? {
            status: input.status,
            resolvedAt: input.status === 'RESOLVED' ? now : null,
            closedAt: input.status === 'CLOSED' ? now : null,
          }
        : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.assignedToMe ? { assignedToId: actor.userId ?? null } : {}),
    },
  });
  await auditPlatform(actor, {
    companyId: ticket.companyId,
    action: 'support_ticket.updated',
    resourceType: 'SupportTicket',
    resourceId: id,
    metadata: input,
  });
  return getTicketForStaff(id);
}

export async function listFeedback(query: PaginationQuery) {
  const [items, total] = await Promise.all([
    systemDb.feedback.findMany({
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
      include: { company: { select: { id: true, name: true } } },
    }),
    systemDb.feedback.count(),
  ]);
  return paginated(items, total, query);
}
