import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/app', '/platform', '/api', '/convite', '/confirmar-email', '/redefinir-senha'] },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
