/**
 * wiki/[noteSlug]/page.tsx — wiki browser with a pre-selected note from URL param.
 *
 * Passes initialNoteSlug to WikiBrowserLayout so the center panel
 * loads immediately without waiting for a tree click.
 * Browser back/forward is handled by WikiBrowserLayout's useEffect sync.
 */

'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { WikiBrowserLayout } from '@/components/wiki/wiki-browser-layout';

export default function WikiNoteSlugPage() {
  const { slug, noteSlug } = useParams<{ slug: string; noteSlug: string }>();
  return <WikiBrowserLayout workspaceSlug={slug} initialNoteSlug={noteSlug} />;
}
