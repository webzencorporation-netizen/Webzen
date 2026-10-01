/**
 * Templates de e-mail do WebZen. HTML com estilos inline (clientes de e-mail ignoram CSS
 * externo) e versão em texto puro. Todo valor dinâmico passa por `escapeHtml`; links são
 * montados pelo backend a partir de APP_URL, nunca recebidos do usuário.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = {
  ink: '#102A43',
  jade: '#0B8A6F',
  paper: '#F6F8FA',
  mist: '#DCE6EA',
  muted: '#52606D',
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface LayoutInput {
  preheader: string;
  heading: string;
  /** Parágrafos em texto puro (escapados aqui). */
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Observação em letra menor ao final (ex.: validade do link). */
  footnote?: string;
}

function layout(input: LayoutInput): { html: string; text: string } {
  const paragraphs = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${BRAND.ink}">${escapeHtml(paragraph)}</p>`,
    )
    .join('');
  const action = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:${BRAND.jade}"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(input.action.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${BRAND.muted}">Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all;color:${BRAND.ink}">${escapeHtml(input.action.url)}</span></p>`
    : '';
  const footnote = input.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${BRAND.muted}">${escapeHtml(input.footnote)}</p>`
    : '';
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px;font-size:18px;font-weight:700;color:${BRAND.ink};letter-spacing:-0.01em">
<span style="display:inline-block;width:14px;height:14px;border:3px solid ${BRAND.jade};border-right-color:transparent;border-radius:50%;vertical-align:-3px;margin-right:8px"></span>WebZen</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.mist};border-radius:12px;padding:32px 28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:${BRAND.ink}">${escapeHtml(input.heading)}</h1>
${paragraphs}${action}${footnote}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${BRAND.muted}">Você recebeu este e-mail porque tem uma conta no WebZen. Mensagem automática; respostas não são lidas.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    input.heading,
    '',
    ...input.paragraphs,
    ...(input.action ? ['', `${input.action.label}: ${input.action.url}`] : []),
    ...(input.footnote ? ['', input.footnote] : []),
    '',
    '— WebZen',
  ].join('\n');
  return { html, text };
}

function render(subject: string, input: LayoutInput): RenderedEmail {
  return { subject, ...layout(input) };
}

export const emailTemplates = {
  verifyEmail(input: { name: string; url: string; expiresInHours: number }) {
    return render('Confirme seu e-mail no WebZen', {
      preheader: 'Falta um passo para ativar sua conta.',
      heading: 'Confirme seu e-mail',
      paragraphs: [
        `Olá, ${input.name}.`,
        'Confirme este endereço para ativar sua conta e contratar um plano.',
      ],
      action: { label: 'Confirmar e-mail', url: input.url },
      footnote: `O link vale por ${input.expiresInHours} horas. Se você não criou uma conta, ignore este e-mail.`,
    });
  },

  resetPassword(input: { name: string; url: string; expiresInMinutes: number }) {
    return render('Redefinição de senha do WebZen', {
      preheader: 'Use o link para criar uma nova senha.',
      heading: 'Redefina sua senha',
      paragraphs: [
        `Olá, ${input.name}.`,
        'Recebemos um pedido para redefinir a senha da sua conta. Ao criar a nova senha, as outras sessões abertas serão encerradas.',
      ],
      action: { label: 'Criar nova senha', url: input.url },
      footnote: `O link vale por ${input.expiresInMinutes} minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.`,
    });
  },

  accountExists(input: { name: string; url: string; loginUrl: string; expiresInMinutes: number }) {
    return render('Você já tem uma conta no WebZen', {
      preheader: 'Alguém tentou criar uma conta com este e-mail.',
      heading: 'Você já tem uma conta',
      paragraphs: [
        `Olá, ${input.name}.`,
        `Recebemos um cadastro com este e-mail, mas ele já tem conta no WebZen. Entre em ${input.loginUrl} ou, se esqueceu a senha, crie uma nova pelo botão abaixo.`,
      ],
      action: { label: 'Criar nova senha', url: input.url },
      footnote: `O link vale por ${input.expiresInMinutes} minutos. Se não foi você, ignore este e-mail: nada foi alterado.`,
    });
  },

  passwordChanged(input: { name: string }) {
    return render('Sua senha do WebZen foi alterada', {
      preheader: 'Aviso de segurança da sua conta.',
      heading: 'Sua senha foi alterada',
      paragraphs: [
        `Olá, ${input.name}.`,
        'A senha da sua conta acabou de ser alterada e as outras sessões foram encerradas.',
        'Se não foi você, redefina a senha agora pela tela de login e avise o administrador da sua empresa.',
      ],
    });
  },

  welcome(input: { name: string; companyName: string; url: string }) {
    return render('Boas-vindas ao WebZen', {
      preheader: 'Seu painel está pronto para a configuração.',
      heading: `Boas-vindas, ${input.name}`,
      paragraphs: [
        `A conta da ${input.companyName} está criada.`,
        'No painel, um passo a passo ajuda a cadastrar os dados da empresa, configurar o atendente, conectar o WhatsApp e testar a primeira conversa.',
      ],
      action: { label: 'Abrir o painel', url: input.url },
    });
  },

  teamInvite(input: {
    inviterName: string;
    companyName: string;
    roleLabel: string;
    url: string;
    expiresInDays: number;
  }) {
    return render(`Convite para a equipe da ${input.companyName} no WebZen`, {
      preheader: `${input.inviterName} convidou você para a equipe.`,
      heading: 'Você foi convidado para uma equipe',
      paragraphs: [
        `${input.inviterName} convidou você para acessar o painel da ${input.companyName} como ${input.roleLabel}.`,
      ],
      action: { label: 'Aceitar convite', url: input.url },
      footnote: `O convite vale por ${input.expiresInDays} dias e só pode ser usado uma vez.`,
    });
  },

  paymentSucceeded(input: { companyName: string; amount: string; planName: string; url: string }) {
    return render('Pagamento confirmado — WebZen', {
      preheader: `Recebemos ${input.amount}.`,
      heading: 'Pagamento confirmado',
      paragraphs: [
        `Recebemos o pagamento de ${input.amount} referente ao plano ${input.planName} da ${input.companyName}.`,
        'O comprovante está disponível em Configurações → Assinatura.',
      ],
      action: { label: 'Ver faturas', url: input.url },
    });
  },

  paymentFailed(input: { companyName: string; amount: string; url: string }) {
    return render('Não conseguimos cobrar sua assinatura do WebZen', {
      preheader: 'Atualize a forma de pagamento para evitar a interrupção da IA.',
      heading: 'O pagamento não foi aprovado',
      paragraphs: [
        `A cobrança de ${input.amount} da ${input.companyName} foi recusada.`,
        'Vamos tentar de novo nos próximos dias. Para evitar a pausa do atendimento automático, atualize a forma de pagamento.',
      ],
      action: { label: 'Atualizar pagamento', url: input.url },
    });
  },

  subscriptionCancelled(input: { companyName: string; endsAt: string; url: string }) {
    return render('Assinatura cancelada — WebZen', {
      preheader: `O plano vale até ${input.endsAt}.`,
      heading: 'Assinatura cancelada',
      paragraphs: [
        `A assinatura da ${input.companyName} foi cancelada. O atendimento automático funciona até ${input.endsAt}.`,
        'Seus dados continuam no painel. Você pode reativar a assinatura a qualquer momento.',
      ],
      action: { label: 'Reativar assinatura', url: input.url },
    });
  },

  usageLimit(input: {
    companyName: string;
    metricLabel: string;
    usage: string;
    percent: number;
    url: string;
  }) {
    const reached = input.percent >= 100;
    return render(
      reached
        ? `Limite do plano atingido — ${input.metricLabel}`
        : `Você usou ${input.percent}% do plano — ${input.metricLabel}`,
      {
        preheader: `Uso atual: ${input.usage}.`,
        heading: reached ? 'Limite do plano atingido' : `${input.percent}% do limite usado`,
        paragraphs: [
          `${input.companyName}: ${input.metricLabel} em ${input.usage}.`,
          reached
            ? 'O que depende deste limite fica bloqueado até a renovação do plano. Faça upgrade para continuar agora.'
            : 'Se o ritmo continuar, o limite será atingido antes da renovação. Compare os planos para evitar a pausa.',
        ],
        action: { label: 'Ver planos', url: input.url },
      },
    );
  },
} satisfies Record<string, (input: never) => RenderedEmail>;

export type EmailTemplateName = keyof typeof emailTemplates;
