import type { CompanyPermission } from '@botsaas/shared';
import {
  BarChart3,
  Bot,
  BookOpen,
  CalendarDays,
  Contact,
  KanbanSquare,
  LifeBuoy,
  LayoutDashboard,
  MessagesSquare,
  Package,
  Plug,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: CompanyPermission;
  feature?: string;
}

export const COMPANY_NAV: NavItem[] = [
  { href: '/app', label: 'Visão geral', icon: LayoutDashboard, permission: 'company:read' },
  { href: '/app/conversations', label: 'Conversas', icon: MessagesSquare, permission: 'conversations:read' },
  { href: '/app/contacts', label: 'Contatos', icon: Contact, permission: 'contacts:read' },
  { href: '/app/crm', label: 'CRM', icon: KanbanSquare, permission: 'crm:read', feature: 'CRM' },
  { href: '/app/calendar', label: 'Agenda', icon: CalendarDays, permission: 'calendar:read', feature: 'CALENDAR' },
  { href: '/app/catalog', label: 'Produtos e serviços', icon: Package, permission: 'catalog:read' },
  { href: '/app/knowledge', label: 'Conhecimento', icon: BookOpen, permission: 'knowledge:read' },
  { href: '/app/agent', label: 'Agente de IA', icon: Bot, permission: 'ai:read' },
  { href: '/app/automations', label: 'Automações', icon: Workflow, permission: 'automations:read', feature: 'AUTOMATIONS' },
  { href: '/app/integrations', label: 'Integrações', icon: Plug, permission: 'integrations:read' },
  { href: '/app/team', label: 'Equipe', icon: Users, permission: 'team:read' },
  { href: '/app/metrics', label: 'Métricas', icon: BarChart3, permission: 'reports:read' },
  { href: '/app/support', label: 'Suporte', icon: LifeBuoy, permission: 'support:read' },
  { href: '/app/settings', label: 'Configurações', icon: Settings, permission: 'company:read' },
];
