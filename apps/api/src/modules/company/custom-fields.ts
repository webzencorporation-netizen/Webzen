import type { CustomFieldDefinition } from '@botsaas/database';
import { ValidationError } from '@botsaas/shared';

export type CustomFieldValue = string | number | boolean | null;

/**
 * Valida valores de campos personalizados contra as definições da empresa.
 * Chaves desconhecidas são rejeitadas (nada de gravar JSON arbitrário).
 */
export function sanitizeCustomFields(
  definitions: Pick<CustomFieldDefinition, 'key' | 'type' | 'options' | 'label'>[],
  values: Record<string, unknown>,
  { ignoreUnknown = false } = {},
): Record<string, CustomFieldValue> {
  const result: Record<string, CustomFieldValue> = {};
  for (const [key, raw] of Object.entries(values)) {
    const definition = definitions.find((item) => item.key === key);
    if (!definition) {
      if (ignoreUnknown) continue;
      throw new ValidationError(`Campo personalizado desconhecido: ${key}`);
    }
    if (raw === null || raw === '') {
      result[key] = null;
      continue;
    }
    switch (definition.type) {
      case 'NUMBER': {
        const value =
          typeof raw === 'number'
            ? raw
            : Number(
                String(raw)
                  .replace(/[^\d.,-]/g, '')
                  .replace(',', '.'),
              );
        if (!Number.isFinite(value))
          throw new ValidationError(`${definition.label}: número inválido`);
        result[key] = value;
        break;
      }
      case 'BOOLEAN':
        result[key] = raw === true || raw === 'true' || raw === 'sim' || raw === 1;
        break;
      case 'SELECT': {
        const value = String(raw);
        const match = definition.options.find(
          (option: string) => option.toLowerCase() === value.toLowerCase(),
        );
        if (!match) throw new ValidationError(`${definition.label}: opção inválida`);
        result[key] = match;
        break;
      }
      case 'DATE': {
        const value = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
          throw new ValidationError(`${definition.label}: use YYYY-MM-DD`);
        result[key] = value;
        break;
      }
      default:
        result[key] = String(raw).slice(0, 500);
    }
  }
  return result;
}
