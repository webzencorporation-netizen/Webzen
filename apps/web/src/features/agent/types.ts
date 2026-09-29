export interface AiConfig {
  id: string;
  enabled: boolean;
  agentName: string;
  personality: string | null;
  tone: string;
  responseLength: string;
  emojiUsage: string;
  additionalInstructions: string | null;
  customRules: string[];
  greetingMessage: string | null;
  outOfHoursMessage: string | null;
  handoffMessage: string | null;
  fallbackMessage: string | null;
  messageBufferSeconds: number;
  model: string | null;
  effectiveModel: string;
  maxOutputTokens: number;
  effort: string;
  maxToolIterations: number;
  historyMessageLimit: number;
  summaryThreshold: number;
  fallbackBehavior: string;
  respondOutsideHours: boolean;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  version: number;
  updatedAt: string;
}

export interface AiSettings {
  config: AiConfig;
  tools: {
    name: string;
    label: string;
    category: string;
    mutating: boolean;
    enabled: boolean;
    recommended: boolean;
  }[];
  models: { id: string; name: string }[];
  defaultModel: string;
  provider: 'anthropic' | 'meta' | 'mock';
}
