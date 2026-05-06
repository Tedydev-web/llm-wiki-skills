/**
 * workspaces/[slug]/layout.tsx — workspace section shell with nav tabs.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const tabs = [
  { label: 'Overview', href: '' },
  { label: 'Members', href: '/members' },
  { label: 'Materials', href: '/materials' },
  { label: 'Notes', href: '/notes' },
  { label: 'Tokens', href: '/tokens' },
];

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const base = `/workspaces/${slug}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-6 flex gap-1 border-b pb-0">
        {tabs.map((tab) => {
          const href = `${base}${tab.href}`;
          const active = tab.href === '' ? pathname === base : pathname.startsWith(`${base}${tab.href}`);
          return (
            <Link
              key={tab.label}
              href={href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
