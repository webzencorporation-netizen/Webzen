import {
  TOOL_INPUT_SCHEMAS,
  TOOL_METADATA,
  toJsonSchema,
  type ToolInput,
  type ToolName,
} from './catalog';
import type { ToolDefinition, ToolExecutionMeta, ToolResult } from './types';
import type { AIToolSpec } from '../provider/types';

export type ToolHandlers<Ctx> = {
  [N in ToolName]: {
    authorize?: (ctx: Ctx) => boolean | Promise<boolean>;
    handler: (input: ToolInput<N>, ctx: Ctx, meta: ToolExecutionMeta) => Promise<ToolResult>;
  };
};

/**
 * Registro de tools: une o contrato (catálogo) aos handlers do backend.
 * Tools não registradas NÃO existem para o modelo — nenhuma tool arbitrária pode ser chamada.
 */
export class ToolRegistry<Ctx> {
  private readonly tools = new Map<string, ToolDefinition<Ctx>>();

  register<Input>(definition: ToolDefinition<Ctx, Input>): this {
    if (this.tools.has(definition.name)) throw new Error(`Tool duplicada: ${definition.name}`);
    this.tools.set(definition.name, definition as ToolDefinition<Ctx>);
    return this;
  }

  static fromHandlers<Ctx>(handlers: ToolHandlers<Ctx>): ToolRegistry<Ctx> {
    const registry = new ToolRegistry<Ctx>();
    for (const name of Object.keys(handlers) as ToolName[]) {
      const binding = handlers[name] as ToolHandlers<Ctx>[ToolName];
      registry.register({
        name,
        description: TOOL_METADATA[name].description,
        inputSchema: TOOL_INPUT_SCHEMAS[name],
        mutating: TOOL_METADATA[name].mutating,
        authorize: binding.authorize,
        handler: binding.handler as ToolDefinition<Ctx>['handler'],
      });
    }
    return registry;
  }

  get(name: string): ToolDefinition<Ctx> | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Tools habilitadas, em ordem determinística (estável para o cache de prompt). */
  resolve(enabled: Iterable<string>): ToolDefinition<Ctx>[] {
    const wanted = new Set(enabled);
    return [...this.tools.values()]
      .filter((tool) => wanted.has(tool.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static toSpecs<C>(tools: ToolDefinition<C>[]): AIToolSpec[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema),
    }));
  }
}
