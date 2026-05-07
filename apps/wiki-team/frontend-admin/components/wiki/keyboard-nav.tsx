/**
 * keyboard-nav.tsx — wiki browser keyboard shortcuts hook.
 *
 * Binds: j/k (prev/next note in tree), Esc (close edit modal), / (focus search → /notes?q=)
 * Input-guard: all shortcuts disabled when event.target is INPUT, TEXTAREA, or contentEditable.
 *
 * Usage: mount <KeyboardNav ... /> inside the wiki layout once.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { NoteSummary } from '@/lib/api-client';

/** Returns true when the keyboard event originates inside an editable element */
function isEditableTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName ?? '';
  const isContentEditable = (e.target as HTMLElement | null)?.isContentEditable ?? false;
  return tag === 'INPUT' || tag === 'TEXTAREA' || isContentEditable;
}

interface KeyboardNavProps {
  /** Flat ordered list of notes visible in the tree (respects group collapse) */
  flatNotes: NoteSummary[];
  selectedSlug: string | null;
  workspaceSlug: string;
  onSelect: (slug: string) => void;
  /** Toggles backlinks panel visibility (keyboard shortcut `b`) */
  onToggleBacklinks: () => void;
  /** Closes edit modal when open */
  onCloseEdit: () => void;
}

export function KeyboardNav({
  flatNotes,
  selectedSlug,
  workspaceSlug,
  onSelect,
  onToggleBacklinks,
  onCloseEdit,
}: KeyboardNavProps) {
  const router = useRouter();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Guard: skip when typing in an input/textarea/contentEditable
      if (isEditableTarget(e)) return;

      switch (e.key) {
        case 'j': {
          // Next note in tree
          e.preventDefault();
          if (flatNotes.length === 0) return;
          const idx = flatNotes.findIndex((n) => n.slug === selectedSlug);
          const next = idx === -1 ? 0 : Math.min(idx + 1, flatNotes.length - 1);
          onSelect(flatNotes[next]!.slug);
          break;
        }
        case 'k': {
          // Previous note in tree
          e.preventDefault();
          if (flatNotes.length === 0) return;
          const idx = flatNotes.findIndex((n) => n.slug === selectedSlug);
          const prev = idx <= 0 ? 0 : idx - 1;
          onSelect(flatNotes[prev]!.slug);
          break;
        }
        case 'b': {
          // Toggle backlinks panel
          e.preventDefault();
          onToggleBacklinks();
          break;
        }
        case 'Escape': {
          // Close edit modal (if open); input-guard already skips this inside modals
          onCloseEdit();
          break;
        }
        case '/': {
          // Jump to search page
          e.preventDefault();
          router.push(`/workspaces/${workspaceSlug}/notes`);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [flatNotes, selectedSlug, workspaceSlug, onSelect, onToggleBacklinks, onCloseEdit, router]);

  // Render nothing — pure side-effect component
  return null;
}
