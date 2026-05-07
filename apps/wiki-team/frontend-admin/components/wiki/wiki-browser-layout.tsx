/**
 * wiki-browser-layout.tsx — shared three-panel layout shell for wiki browser.
 *
 * Used by both wiki/page.tsx (no preselected note) and wiki/[noteSlug]/page.tsx.
 * Handles: resizable panels, localStorage width persistence, keyboard nav mount,
 * mobile stacked fallback (tab switcher deferred v2.2).
 *
 * Panel widths persisted in localStorage:
 *   wiki_tree_width   (px, default 240, range 160–480)
 *   wiki_right_width  (px, default 280, range 160–480)
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageTree } from '@/components/wiki/page-tree';
import { NoteContent } from '@/components/wiki/note-content';
import { BacklinksPanel } from '@/components/wiki/backlinks-panel';
import { OutlinksPanel } from '@/components/wiki/outlinks-panel';
import { KeyboardNav } from '@/components/wiki/keyboard-nav';
import type { NoteSummary } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// localStorage helpers

const LS_TREE_KEY  = 'wiki_tree_width';
const LS_RIGHT_KEY = 'wiki_right_width';
const DEFAULT_TREE  = 240;
const DEFAULT_RIGHT = 280;

function readWidth(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const n = parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isFinite(n) && n >= 160 && n <= 480 ? n : fallback;
}

function persistWidth(key: string, value: number): void {
  if (typeof window !== 'undefined') localStorage.setItem(key, String(value));
}

// ---------------------------------------------------------------------------
// Resize handle — drag to resize adjacent panels

interface ResizeHandleProps {
  onDrag: (delta: number) => void;
  'aria-label': string;
}

export function ResizeHandle({ onDrag, 'aria-label': ariaLabel }: ResizeHandleProps) {
  const startX = useRef<number>(0);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    startX.current = e.clientX;
    function onMove(ev: MouseEvent) { onDrag(ev.clientX - startX.current); startX.current = ev.clientX; }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="w-1 cursor-col-resize bg-border hover:bg-primary/40 transition-colors shrink-0 select-none"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onDrag(-8); if (e.key === 'ArrowRight') onDrag(8); }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main layout

interface WikiBrowserLayoutProps {
  workspaceSlug: string;
  initialNoteSlug?: string | null;
}

export function WikiBrowserLayout({ workspaceSlug, initialNoteSlug = null }: WikiBrowserLayoutProps) {
  const router = useRouter();

  const [selectedSlug, setSelectedSlug]   = useState<string | null>(initialNoteSlug);
  const [flatNotes, setFlatNotes]         = useState<NoteSummary[]>([]);
  const [backlinksOpen, setBacklinksOpen] = useState(true);
  const [treeWidth, setTreeWidth]         = useState(DEFAULT_TREE);
  const [rightWidth, setRightWidth]       = useState(DEFAULT_RIGHT);

  // Sync if parent provides a new initialNoteSlug (browser back/forward)
  useEffect(() => {
    if (initialNoteSlug && initialNoteSlug !== selectedSlug) {
      setSelectedSlug(initialNoteSlug);
    }
  }, [initialNoteSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate persisted widths after mount (avoid SSR mismatch)
  useEffect(() => {
    setTreeWidth(readWidth(LS_TREE_KEY, DEFAULT_TREE));
    setRightWidth(readWidth(LS_RIGHT_KEY, DEFAULT_RIGHT));
  }, []);

  const handleTreeWidth = useCallback((delta: number) => {
    setTreeWidth((w) => { const next = Math.max(160, Math.min(480, w + delta)); persistWidth(LS_TREE_KEY, next); return next; });
  }, []);

  const handleRightWidth = useCallback((delta: number) => {
    setRightWidth((w) => { const next = Math.max(160, Math.min(480, w - delta)); persistWidth(LS_RIGHT_KEY, next); return next; });
  }, []);

  const handleSelect = useCallback((noteSlug: string) => {
    setSelectedSlug(noteSlug);
    router.replace(`/workspaces/${workspaceSlug}/wiki/${noteSlug}`, { scroll: false });
  }, [router, workspaceSlug]);

  const currentNote = flatNotes.find((n) => n.slug === selectedSlug) ?? null;

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-md border bg-background">
      <KeyboardNav
        flatNotes={flatNotes}
        selectedSlug={selectedSlug}
        workspaceSlug={workspaceSlug}
        onSelect={handleSelect}
        onToggleBacklinks={() => setBacklinksOpen((v) => !v)}
        onCloseEdit={() => { /* edit modal state is local to NoteContent */ }}
      />

      {/* Left panel — Page Tree (desktop only) */}
      <div className="hidden lg:flex flex-col shrink-0 overflow-hidden" style={{ width: treeWidth }} aria-label="Page tree panel">
        <PageTree
          workspaceSlug={workspaceSlug}
          selectedSlug={selectedSlug}
          onSelect={handleSelect}
          onTreeReady={setFlatNotes}
        />
      </div>

      <ResizeHandle onDrag={handleTreeWidth} aria-label="Resize tree panel" />

      {/* Center panel — Note Content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <NoteContent
          workspaceSlug={workspaceSlug}
          noteSlug={selectedSlug}
          onWikilinkNavigate={handleSelect}
        />
      </div>

      {/* Right panel — Backlinks + Outlinks (desktop only) */}
      {backlinksOpen && (
        <>
          <ResizeHandle onDrag={handleRightWidth} aria-label="Resize backlinks panel" />
          <div className="hidden lg:flex flex-col shrink-0 overflow-hidden" style={{ width: rightWidth }} aria-label="Backlinks panel">
            <BacklinksPanel
              workspaceSlug={workspaceSlug}
              noteSlug={selectedSlug}
              onNavigate={handleSelect}
            />
            <OutlinksPanel
              noteLinks={currentNote ? [] : []}
              allNotes={flatNotes}
              onNavigate={handleSelect}
            />
          </div>
        </>
      )}

      {/* Mobile stacked layout — tab switcher deferred v2.2 */}
      <div className="lg:hidden flex flex-col w-full overflow-hidden">
        <div className="border-b">
          <PageTree
            workspaceSlug={workspaceSlug}
            selectedSlug={selectedSlug}
            onSelect={handleSelect}
            onTreeReady={setFlatNotes}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <NoteContent
            workspaceSlug={workspaceSlug}
            noteSlug={selectedSlug}
            onWikilinkNavigate={handleSelect}
          />
        </div>
      </div>
    </div>
  );
}
