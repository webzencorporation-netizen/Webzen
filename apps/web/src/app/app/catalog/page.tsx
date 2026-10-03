import type { Metadata } from 'next';
import { CatalogPage } from '@/features/catalog/catalog-page';

export const metadata: Metadata = { title: 'Produtos e serviços' };

export default function Page() {
  return <CatalogPage />;
}
