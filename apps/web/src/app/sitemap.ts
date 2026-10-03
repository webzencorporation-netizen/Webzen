import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

const PAGES: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }[] = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/precos', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/cadastro', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/login', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/docs/api', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/novidades', priority: 0.4, changeFrequency: 'weekly' },
  { path: '/status', priority: 0.3, changeFrequency: 'weekly' },
  { path: '/termos', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/privacidade', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/cookies', priority: 0.1, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((page) => ({ url: `${SITE.url}${page.path}`, priority: page.priority, changeFrequency: page.changeFrequency }));
}
