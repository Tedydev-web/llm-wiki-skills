/**
 * wiki/page.tsx — wiki browser landing (no pre-selected note).
 *
 * Renders the three-panel WikiBrowserLayout. User selects a note from the tree
 * to load it in the center panel. URL updates via router.replace on selection.
 */

'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { WikiBrowserLayout } from '@/components/wiki/wiki-browser-layout';

export default function WikiPage() {
  const { slug } = useParams<{ slug: string }>();
  return <WikiBrowserLayout workspaceSlug={slug} />;
}
