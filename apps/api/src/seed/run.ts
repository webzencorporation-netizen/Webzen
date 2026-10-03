/**
 * Seed de DESENVOLVIMENTO: dados de referência + empresa "Clínica Demo" completa.
 *
 *   pnpm db:seed                 → referência + demo
 *   pnpm db:seed -- --reference  → apenas planos e preços de modelos (seguro em qualquer ambiente)
 *   pnpm db:seed -- --reference --sync-plans → também reaplica preços/limites/recursos do catálogo
 *
 * Nunca roda automaticamente e recusa dados de demonstração em produção.
 */
import { parseEnv } from '@botsaas/config';
import {
  createTenantClient,
  disconnectSystemDb,
  hashPassword,
  systemDb,
  type Prisma,
} from '@botsaas/database';
import pino from 'pino';
import { createContainer } from '../container';
import { createCompany } from '../modules/platform/companies.service';
import { InMemoryJobQueue } from '../queues/memory';
import { seedReferenceData } from './reference';

const DEV_PASSWORD = 'demo-senha-123';
const DEMO_SLUG = 'clinica-demo';
const log = (message: string) => console.log(`[seed] ${message}`);

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}

function daysFromNow(days: number, hourUtc: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

async function upsertUser(
  email: string,
  name: string,
  password: string,
  platformRole: 'PLATFORM_OWNER' | null = null,
) {
  const existing = await systemDb.user.findUnique({ where: { email } });
  if (existing) return existing;
  return systemDb.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      platformRole,
      emailVerifiedAt: new Date(),
    },
  });
}

async function seedDemoCompany() {
  const env = parseEnv(process.env);
  const container = createContainer({
    env,
    logger: pino({ level: 'silent' }),
    queue: new InMemoryJobQueue(),
  });
  const existing = await systemDb.company.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    log('Clínica Demo já existe — nada a fazer (apague a empresa para recriar).');
    return;
  }

  const { company } = await createCompany(
    container,
    { type: 'SYSTEM', label: 'seed' },
    {
      name: 'Clínica Demo',
      templateKey: 'CLINIC',
      timezone: 'America/Sao_Paulo',
      phone: '(11) 4000-1234',
      email: 'contato@clinicademo.local',
      planKey: 'PRO',
      owner: { email: 'dono@clinicademo.local', name: 'Dra. Helena Souza', password: DEV_PASSWORD },
    },
  );
  const companyId = company.id;
  const db = createTenantClient(companyId);

  await systemDb.company.update({
    where: { id: companyId },
    data: {
      slug: DEMO_SLUG,
      status: 'ACTIVE',
      activatedAt: new Date(),
      onboardingDoneAt: new Date(),
      description: 'Clínica de estética facial e corporal com atendimento humanizado.',
      website: 'https://clinicademo.local',
      address: {
        street: 'Rua das Flores',
        number: '123',
        district: 'Jardins',
        city: 'São Paulo',
        state: 'SP',
        zip: '01400-000',
      },
      businessHours: [1, 2, 3, 4, 5]
        .map((weekday) => ({
          weekday,
          open: '09:00',
          close: '19:00',
          breaks: [{ start: '12:00', end: '13:00' }],
        }))
        .concat([{ weekday: 6, open: '09:00', close: '13:00', breaks: [] }]),
      onboardingState: {
        completed: [
          'company',
          'hours',
          'catalog',
          'faq',
          'ai',
          'whatsapp',
          'integrations',
          'test',
          'activation',
        ],
        skipped: [],
      },
    },
  });
  await db.holiday.create({
    data: { companyId, date: `${new Date().getFullYear()}-12-25`, name: 'Natal', closed: true },
  });

  // Equipe
  const team = [
    { email: 'gerente@clinicademo.local', name: 'Marcos Lima', role: 'MANAGER' as const },
    { email: 'atendente@clinicademo.local', name: 'Ana Paula', role: 'ATTENDANT' as const },
    { email: 'leitura@clinicademo.local', name: 'Carla Auditoria', role: 'VIEWER' as const },
  ];
  const users: Record<string, string> = {};
  for (const member of team) {
    const user = await upsertUser(member.email, member.name, DEV_PASSWORD);
    users[member.role] = user.id;
    await db.companyMember.create({ data: { companyId, userId: user.id, role: member.role } });
  }

  // Agente
  await db.aIConfiguration.update({
    where: { companyId },
    data: {
      enabled: true,
      agentName: 'Bia',
      personality: 'Acolhedora, simpática e objetiva. Trata todos pelo nome quando souber.',
      customRules: [
        'Não informe valor de botox e preenchimento sem avaliação presencial.',
        'Sempre ofereça a avaliação gratuita para clientes novos.',
      ],
      outOfHoursMessage:
        'Estamos fora do horário agora, mas já anotei sua mensagem e retornamos no próximo horário de atendimento.',
      handoffMessage: 'Vou chamar alguém da nossa equipe para continuar com você. 😊',
      messageBufferSeconds: 4,
      version: 3,
    },
  });

  // Catálogo
  const services = await Promise.all(
    [
      {
        name: 'Limpeza de pele',
        priceCents: 18000,
        durationMinutes: 60,
        category: 'Facial',
        description: 'Limpeza profunda com extração e hidratação.',
      },
      {
        name: 'Peeling químico',
        priceCents: 25000,
        durationMinutes: 45,
        category: 'Facial',
        description: 'Renovação celular para manchas e textura.',
      },
      {
        name: 'Drenagem linfática',
        priceCents: 15000,
        durationMinutes: 50,
        category: 'Corporal',
        description: 'Redução de inchaço e retenção de líquidos.',
      },
      {
        name: 'Botox',
        priceCents: null,
        priceNote: 'sob avaliação',
        priceVisibleToAi: false,
        durationMinutes: 30,
        category: 'Injetáveis',
        description: 'Aplicação de toxina botulínica.',
      },
      {
        name: 'Avaliação estética',
        priceCents: 0,
        priceNote: 'gratuita',
        durationMinutes: 30,
        category: 'Avaliação',
        description: 'Consulta inicial para montar o plano de tratamento.',
      },
    ].map((service) => db.service.create({ data: { companyId, ...service } })),
  );

  // Base de conhecimento
  const faqs = [
    [
      'Quais formas de pagamento vocês aceitam?',
      'Aceitamos Pix, cartões de débito e crédito (em até 6x sem juros acima de R$ 300) e dinheiro.',
    ],
    [
      'Vocês atendem convênio?',
      'Não atendemos convênios. Emitimos recibo para reembolso quando aplicável.',
    ],
    [
      'Qual a política de cancelamento?',
      'Cancelamentos e remarcações devem ser feitos com pelo menos 24 horas de antecedência.',
    ],
    [
      'Tem estacionamento?',
      'Temos convênio com o estacionamento ao lado (Rua das Flores, 130) com 1 hora grátis.',
    ],
    [
      'Preciso de preparo para a limpeza de pele?',
      'Evite esfoliantes e ácidos nos 3 dias anteriores e venha sem maquiagem, se possível.',
    ],
    [
      'Quanto tempo dura o efeito do botox?',
      'Em média de 4 a 6 meses, variando de pessoa para pessoa. A avaliação define a indicação.',
    ],
  ];
  for (const [title, content] of faqs) {
    await db.knowledgeEntry.create({
      data: { companyId, type: 'FAQ', title: title as string, content: content as string },
    });
  }
  await db.knowledgeEntry.create({
    data: {
      companyId,
      type: 'POLICY',
      title: 'Atrasos',
      content:
        'Toleramos até 15 minutos de atraso. Após isso, o atendimento pode precisar ser remarcado.',
    },
  });

  // WhatsApp sandbox (provider mock)
  const account = await db.whatsAppAccount.create({
    data: {
      companyId,
      phoneNumberId: `sandbox-${companyId}`,
      displayPhoneNumber: '+55 11 4000-1234',
      verifiedName: 'Clínica Demo',
      status: 'CONNECTED',
      isDefault: true,
      connectedAt: new Date(),
    },
  });

  // Etiquetas
  const tagNames: [string, string][] = [
    ['VIP', '#a855f7'],
    ['URGENTE', '#dc2626'],
    ['INTERESSADO_BOTOX', '#0ea5e9'],
    ['VISITA_AGENDADA', '#16a34a'],
  ];
  const tags: Record<string, string> = {};
  for (const [name, color] of tagNames)
    tags[name] = (await db.tag.create({ data: { companyId, name, color } })).id;

  const stages = Object.fromEntries(
    (await db.leadStage.findMany()).map((stage) => [stage.key, stage.id]),
  );

  // Contatos + conversas
  type Line = [sender: 'CONTACT' | 'AI' | 'AGENT' | 'SYSTEM', text: string, hoursAgo: number];
  const scenarios: {
    name: string;
    phone: string;
    stage: string;
    tags?: string[];
    mode?: 'AI' | 'HUMAN';
    status?: 'OPEN' | 'WAITING_HUMAN' | 'CLOSED';
    qualification?: Record<string, string>;
    memories?: [string, string][];
    lines: Line[];
  }[] = [
    {
      name: 'João Pereira',
      phone: '5511987650001',
      stage: 'QUALIFICADO',
      tags: ['INTERESSADO_BOTOX'],
      qualification: { procedimento: 'Botox', tipo_consulta: 'Primeira consulta' },
      memories: [['service_interest', 'botox na testa']],
      lines: [
        ['CONTACT', 'oi\nqueria saber quanto custa botox', 3],
        [
          'AI',
          'Olá, João! O valor do botox é definido na avaliação presencial, que é gratuita. Quer que eu veja um horário para você?',
          2.99,
        ],
        ['CONTACT', 'pode ser sábado de manhã?', 2.5],
        ['AI', 'Tenho sábado às 10h ou 11h. Qual prefere?', 2.49],
      ],
    },
    {
      name: 'Mariana Costa',
      phone: '5511987650002',
      stage: 'EM_ATENDIMENTO',
      tags: ['URGENTE'],
      mode: 'HUMAN',
      status: 'WAITING_HUMAN',
      lines: [
        ['CONTACT', 'Fiz um peeling ontem e minha pele está muito vermelha e ardendo', 0.6],
        [
          'AI',
          'Sinto muito, Mariana. Vou chamar agora alguém da nossa equipe para te orientar.',
          0.59,
        ],
        [
          'SYSTEM',
          'Atendimento encaminhado para a equipe. Motivo: Relato de reação após procedimento',
          0.59,
        ],
      ],
    },
    {
      name: 'Carlos Mendes',
      phone: '5511987650003',
      stage: 'FECHADO',
      tags: ['VIP'],
      lines: [
        ['CONTACT', 'Bom dia! Quero agendar uma drenagem', 26],
        ['AI', 'Bom dia, Carlos! Tenho quinta às 15h ou sexta às 10h. Qual fica melhor?', 25.99],
        ['CONTACT', 'quinta 15h', 25.9],
        ['AI', 'Perfeito! Confirmado: drenagem linfática na quinta às 15h. Até lá!', 25.89],
      ],
    },
    {
      name: 'Fernanda Alves',
      phone: '5511987650004',
      stage: 'NOVO',
      lines: [
        ['CONTACT', 'Vocês aceitam cartão?', 5],
        ['AI', 'Aceitamos sim! Débito, crédito (até 6x sem juros acima de R$ 300) e Pix.', 4.99],
      ],
    },
    {
      name: 'Rafael Souza',
      phone: '5511987650005',
      stage: 'PROPOSTA',
      mode: 'HUMAN',
      lines: [
        ['CONTACT', 'Queria um pacote de 5 limpezas de pele, tem desconto?', 8],
        [
          'AI',
          'Ótima pergunta! Pacotes especiais são montados pela nossa equipe — vou te passar para a Ana.',
          7.99,
        ],
        [
          'AGENT',
          'Oi Rafael, aqui é a Ana! Para 5 sessões conseguimos 15% de desconto. Posso reservar?',
          7,
        ],
      ],
    },
    {
      name: null as unknown as string,
      phone: '5511987650006',
      stage: 'NOVO',
      lines: [['CONTACT', 'Olá, qual o endereço?', 0.2]],
    },
  ];

  for (const scenario of scenarios) {
    const contact = await db.contact.create({
      data: {
        companyId,
        phone: scenario.phone,
        waId: scenario.phone,
        name: scenario.name ?? null,
        source: 'whatsapp',
        lastInteractionAt: hoursAgo(Math.min(...scenario.lines.map((line) => line[2]))),
        assigneeId: scenario.mode === 'HUMAN' ? users.ATTENDANT : null,
      },
    });
    for (const tag of scenario.tags ?? []) {
      await db.contactTag.create({
        data: { companyId, contactId: contact.id, tagId: tags[tag] as string },
      });
    }
    for (const [key, value] of scenario.memories ?? []) {
      await db.contactMemory.create({ data: { companyId, contactId: contact.id, key, value } });
    }
    await db.lead.create({
      data: {
        companyId,
        contactId: contact.id,
        stageId: stages[scenario.stage] as string,
        source: 'whatsapp',
        position: Date.now(),
        qualification: (scenario.qualification ?? undefined) as Prisma.InputJsonValue | undefined,
        closedAt: scenario.stage === 'FECHADO' ? hoursAgo(25) : null,
        valueCents: scenario.stage === 'PROPOSTA' ? 76500 : null,
      },
    });
    const lastInbound = scenario.lines.filter((line) => line[0] === 'CONTACT').at(-1);
    const last = scenario.lines.at(-1) as Line;
    const conversation = await db.conversation.create({
      data: {
        companyId,
        contactId: contact.id,
        whatsappAccountId: account.id,
        mode: scenario.mode ?? 'AI',
        status: scenario.status ?? 'OPEN',
        assigneeId: scenario.mode === 'HUMAN' ? users.ATTENDANT : null,
        lastInboundAt: lastInbound ? hoursAgo(lastInbound[2]) : null,
        lastMessageAt: hoursAgo(last[2]),
        lastMessagePreview: last[1].slice(0, 140),
        firstResponseAt: hoursAgo(scenario.lines[0]![2] - 0.01),
        unreadCount: last[0] === 'CONTACT' ? 1 : 0,
        needsAttention: scenario.status === 'WAITING_HUMAN',
        attentionReason:
          scenario.status === 'WAITING_HUMAN' ? 'Relato de reação após procedimento' : null,
        createdAt: hoursAgo(scenario.lines[0]![2]),
      },
    });
    for (const [index, [sender, text, ago]] of scenario.lines.entries()) {
      await db.message.create({
        data: {
          companyId,
          conversationId: conversation.id,
          direction: sender === 'CONTACT' ? 'INBOUND' : 'OUTBOUND',
          sender,
          senderUserId: sender === 'AGENT' ? users.ATTENDANT : null,
          type: sender === 'SYSTEM' ? 'SYSTEM' : 'TEXT',
          text,
          status: sender === 'CONTACT' ? 'RECEIVED' : 'READ',
          externalId: sender === 'SYSTEM' ? null : `wamid.seed.${conversation.id}.${index}`,
          agentHandledAt:
            sender === 'CONTACT' && !scenario.phone.endsWith('06') ? hoursAgo(ago - 0.01) : null,
          createdAt: hoursAgo(ago),
          sentAt: sender === 'CONTACT' ? null : hoursAgo(ago),
          readAt: sender === 'CONTACT' ? null : hoursAgo(ago - 0.01),
        },
      });
    }
    if (scenario.status === 'WAITING_HUMAN') {
      await db.handoff.create({
        data: {
          companyId,
          conversationId: conversation.id,
          requestedBy: 'AI',
          reason: 'Relato de reação após procedimento',
          createdAt: hoursAgo(0.59),
        },
      });
      await db.notification.create({
        data: {
          companyId,
          type: 'HANDOFF_REQUESTED',
          severity: 'WARNING',
          title: 'Atendimento humano solicitado — Mariana Costa',
          body: 'Relato de reação após procedimento',
          link: `/app/conversations/${conversation.id}`,
        },
      });
    }
  }

  const joao = await db.contact.findFirstOrThrow({ where: { phone: '5511987650001' } });
  const carlos = await db.contact.findFirstOrThrow({ where: { phone: '5511987650003' } });
  await db.contactNote.create({
    data: {
      companyId,
      contactId: joao.id,
      body: 'Prefere horários aos sábados.',
      authorType: 'USER',
      authorId: users.ATTENDANT,
    },
  });
  await db.appointment.createMany({
    data: [
      {
        companyId,
        contactId: carlos.id,
        serviceId: services[2]!.id,
        startAt: daysFromNow(2, 18),
        endAt: new Date(daysFromNow(2, 18).getTime() + 50 * 60_000),
        timezone: 'America/Sao_Paulo',
        status: 'CONFIRMED',
        createdByType: 'AI',
      },
      {
        companyId,
        contactId: joao.id,
        serviceId: services[4]!.id,
        startAt: daysFromNow(4, 13),
        endAt: new Date(daysFromNow(4, 13).getTime() + 30 * 60_000),
        timezone: 'America/Sao_Paulo',
        status: 'PENDING',
        createdByType: 'AI',
      },
    ],
  });

  // Histórico de consumo (últimos 20 dias) para os painéis.
  const conversations = await db.conversation.findMany({ select: { id: true } });
  for (let day = 0; day < 20; day += 1) {
    for (let call = 0; call < 3 + (day % 4); call += 1) {
      const conversation = conversations[(day + call) % conversations.length]!;
      const inputTokens = 2800 + ((day * 37 + call * 11) % 900);
      const outputTokens = 90 + ((day * 13 + call * 7) % 120);
      const cacheReadTokens = 2200;
      const cost = (inputTokens * 5 + outputTokens * 25 + cacheReadTokens * 0.5) / 1_000_000;
      const occurredAt = new Date(Date.now() - day * 24 * 3600_000 - call * 3600_000);
      const run = await db.agentRun.create({
        data: {
          companyId,
          conversationId: conversation.id,
          trigger: 'INBOUND_MESSAGE',
          status: day === 3 && call === 0 ? 'FAILED' : 'SUCCEEDED',
          errorCode: day === 3 && call === 0 ? 'AI_PROVIDER_ERROR' : null,
          model: 'claude-opus-5',
          provider: 'anthropic',
          inputTokens,
          outputTokens,
          cacheReadTokens,
          iterations: call % 2 === 0 ? 1 : 2,
          toolCalls: call % 2 === 0 ? [] : [{ name: 'search_services', ok: true, durationMs: 42 }],
          durationMs: 2100 + call * 300,
          estimatedCostUsd: cost,
          startedAt: occurredAt,
          finishedAt: new Date(occurredAt.getTime() + 2000),
        },
      });
      await db.usageRecord.create({
        data: {
          companyId,
          kind: 'AI_CALL',
          model: 'claude-opus-5',
          inputTokens,
          outputTokens,
          cacheReadTokens,
          costUsd: cost,
          agentRunId: run.id,
          conversationId: conversation.id,
          occurredAt,
        },
      });
    }
  }

  await db.automation.create({
    data: {
      companyId,
      name: 'Lembrete de consulta (24h antes)',
      trigger: 'appointment.reminder_due',
      actions: [
        {
          type: 'send_template',
          templateName: 'lembrete_consulta',
          languageCode: 'pt_BR',
          bodyParameters: ['{{contact.name}}', '{{payload.startLabel}}'],
        },
      ],
      isActive: false,
    },
  });
  log(`Clínica Demo criada (id ${companyId}).`);
}

async function main() {
  const env = parseEnv(process.env);
  const referenceOnly = process.argv.includes('--reference');
  const syncPlans = process.argv.includes('--sync-plans');
  await seedReferenceData({ syncPlans });
  log(
    syncPlans
      ? 'Planos sincronizados com o catálogo e preços de modelos atualizados.'
      : 'Planos e preços de modelos atualizados.',
  );
  if (referenceOnly) return;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Seed de demonstração bloqueado em produção. Use --reference para dados de referência.',
    );
  }
  const adminPassword = env.SEED_ADMIN_PASSWORD ?? DEV_PASSWORD;
  await upsertUser(
    env.SEED_ADMIN_EMAIL,
    'Administrador da Plataforma',
    adminPassword,
    'PLATFORM_OWNER',
  );
  await seedDemoCompany();
  log('');
  log('Acessos de desenvolvimento:');
  log(
    `  Plataforma: ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD ? '(SEED_ADMIN_PASSWORD)' : DEV_PASSWORD}`,
  );
  log(`  Clínica Demo (dono): dono@clinicademo.local / ${DEV_PASSWORD}`);
  log(
    `  Gerente / Atendente / Leitura: gerente@ | atendente@ | leitura@clinicademo.local / ${DEV_PASSWORD}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectSystemDb());
