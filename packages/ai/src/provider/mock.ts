import type { AIMessage, AIProvider, AIRequest, AIResponse, AIToolCall, AIUsage } from './types';

export type MockScriptStep =
  | { text: string }
  | { toolCalls: { name: string; input: unknown }[]; text?: string }
  | { error: Error }
  | { refusal: true };

function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(text.length / 4));
}

function lastUserBlocks(messages: AIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message.content;
  }
  return [];
}

/**
 * Provedor determinístico para desenvolvimento e testes (sem custo, sem rede).
 *
 * - Com `script`, devolve os passos na ordem (útil em testes).
 * - Sem script, aplica heurísticas simples para demonstrar o fluxo completo:
 *   pedido de atendente → `request_human_handoff`; preço/serviço → `search_services`;
 *   horário → `get_business_hours`; após resultado de tool, responde resumindo os dados.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock' as const;
  readonly requests: AIRequest[] = [];
  private script: MockScriptStep[] = [];
  private callCounter = 0;

  enqueue(...steps: MockScriptStep[]): this {
    this.script.push(...steps);
    return this;
  }

  reset(): void {
    this.script = [];
    this.requests.length = 0;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    const step = this.script.shift() ?? this.heuristic(request);
    if ('error' in step) throw step.error;

    const inputTokens =
      estimateTokens(request.system.map((block) => block.text).join('')) +
      estimateTokens(request.messages);
    const usage: AIUsage = {
      inputTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    if ('refusal' in step) {
      return {
        model: request.model,
        text: '',
        toolCalls: [],
        stopReason: 'refusal',
        usage,
        rawAssistantContent: [],
      };
    }
    if ('toolCalls' in step) {
      const toolCalls: AIToolCall[] = step.toolCalls
        .filter((call) => request.tools.some((tool) => tool.name === call.name))
        .map((call) => ({
          id: `toolu_mock_${(this.callCounter += 1)}`,
          name: call.name,
          input: call.input,
        }));
      if (toolCalls.length > 0) {
        usage.outputTokens = estimateTokens(toolCalls);
        const raw = [
          ...(step.text ? [{ type: 'text', text: step.text }] : []),
          ...toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.input,
          })),
        ];
        return {
          model: request.model,
          text: step.text ?? '',
          toolCalls,
          stopReason: 'tool_use',
          usage,
          rawAssistantContent: raw,
        };
      }
    }
    const text = 'text' in step && step.text ? step.text : 'Posso ajudar com mais alguma coisa?';
    usage.outputTokens = estimateTokens(text);
    return {
      model: request.model,
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage,
      rawAssistantContent: [{ type: 'text', text }],
    };
  }

  private heuristic(request: AIRequest): MockScriptStep {
    const blocks = lastUserBlocks(request.messages);
    const toolResults = blocks.filter((block) => block.type === 'tool_result');
    if (toolResults.length > 0) {
      const summary = toolResults
        .map((block) => (block.type === 'tool_result' ? block.content : ''))
        .join('\n');
      return { text: `[simulação] Consultei nossos dados: ${summary.slice(0, 400)}` };
    }
    const text = blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(' ')
      .toLowerCase();
    const has = (name: string) => request.tools.some((tool) => tool.name === name);

    if (
      /(atendente|humano|pessoa real|falar com alguém)/.test(text) &&
      has('request_human_handoff')
    ) {
      return {
        toolCalls: [
          { name: 'request_human_handoff', input: { reason: 'Cliente pediu atendimento humano' } },
        ],
      };
    }
    if (/(pre[çc]o|quanto custa|valor)/.test(text) && has('search_services')) {
      const query = text
        .replace(/.*(quanto custa|pre[çc]o d[aeo]|valor d[aeo])/, '')
        .replace(/[?!.]/g, '')
        .trim();
      return {
        toolCalls: [{ name: 'search_services', input: { query: query || text.slice(0, 60) } }],
      };
    }
    if (/(hor[aá]rio|abre|fecha|funciona)/.test(text) && has('get_business_hours')) {
      return { toolCalls: [{ name: 'get_business_hours', input: {} }] };
    }
    if (/(endere[çc]o|onde fica|localiza)/.test(text) && has('get_company_information')) {
      return { toolCalls: [{ name: 'get_company_information', input: {} }] };
    }
    const firstLine = text.split('\n')[0]?.slice(0, 80) ?? '';
    return {
      text: `Olá! [resposta simulada — modo de desenvolvimento] Recebi: "${firstLine}". Como posso ajudar?`,
    };
  }
}
