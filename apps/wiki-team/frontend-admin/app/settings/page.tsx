/**
 * page.tsx — /settings admin page: multi-provider LLM/Embedding/Vision configuration.
 *
 * 3 tabs (LLM / Embedding / Vision), each with ProviderForm (radio + dropdown + key).
 * Loads existing settings from GET /api/workspaces/:id/settings/providers on mount.
 * Admin-only: redirects to / if session missing; 403 surfaces as toast.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/better-auth-client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { ProviderForm, type Capability, type ExistingSetting } from './components/provider-form';

// ---------------------------------------------------------------------------
// Types

interface SettingRow {
  id: string;
  capability: Capability;
  vendor: string;
  model: string;
  apiKeyMasked: string;
}

interface SettingsResponse {
  settings: SettingRow[];
}

// ---------------------------------------------------------------------------
// Helpers

const BASE_URL =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL']) ||
  'http://localhost:3333';

async function fetchSettings(workspaceId: string): Promise<SettingRow[]> {
  const res = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/settings/providers`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: `HTTP ${res.status}` }))) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as SettingsResponse;
  return data.settings;
}

// ---------------------------------------------------------------------------
// Page component

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  // Use first workspace from session; real app would derive from URL slug
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspaceId: string = (session as any)?.user?.activeWorkspaceId ?? '';

  const [settings, setSettings] = useState<Partial<Record<Capability, ExistingSetting>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isPending && !session) {
      router.replace('/signin');
    }
  }, [session, isPending, router]);

  useEffect(() => {
    if (!session || !workspaceId) return;
    setLoading(true);
    fetchSettings(workspaceId)
      .then((rows) => {
        const map: Partial<Record<Capability, ExistingSetting>> = {};
        for (const row of rows) {
          const cap = row.capability as Capability;
          map[cap] = {
            id: row.id,
            vendor: row.vendor as ExistingSetting['vendor'],
            model: row.model,
            apiKeyMasked: row.apiKeyMasked,
          };
        }
        setSettings(map);
      })
      .catch((err: Error) => {
        toast({ title: 'Failed to load provider settings', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [session, workspaceId]);

  if (isPending || !session) return null;

  const TABS: { value: Capability; label: string; description: string }[] = [
    {
      value: 'llm',
      label: 'LLM',
      description: 'Language model for wiki compilation and agent tasks. Required — missing config blocks compile jobs.',
    },
    {
      value: 'embedding',
      label: 'Embedding',
      description: 'Embedding model for semantic search. Optional — keyword search fallback activates if not configured.',
    },
    {
      value: 'vision',
      label: 'Vision',
      description: 'Vision model for image captioning. Optional — disabled by default per workspace.',
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Provider Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure AI providers for this workspace. API keys are encrypted at rest (AES-GCM-256).
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading provider settings…</p>
      ) : (
        <Tabs defaultValue="llm">
          <TabsList className="mb-6">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {settings[t.value] && (
                  <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-green-500" title="Configured" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value}>
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <ProviderForm
                  capability={t.value}
                  workspaceId={workspaceId}
                  existing={settings[t.value]}
                  onSaved={(saved) => {
                    setSettings((prev) => ({ ...prev, [t.value]: saved }));
                  }}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </main>
  );
}
