/**
 * provider-form.tsx — ProviderForm: single capability tab (LLM/Embedding/Vision).
 *
 * Renders: vendor radio group → model dropdown → API key input (paste-once, masked).
 * On submit: POST or PATCH /api/workspaces/:slug/settings/providers.
 * API key field shows masked placeholder after first save; user must re-paste to rotate.
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

// ---------------------------------------------------------------------------
// Static capability → vendor → model map

export type Capability = 'llm' | 'embedding' | 'vision';
export type Vendor = 'openai' | 'google' | 'anthropic' | 'voyage';

interface VendorOption {
  value: Vendor;
  label: string;
  models: { value: string; label: string }[];
}

const CAPABILITY_VENDORS: Record<Capability, VendorOption[]> = {
  llm: [
    {
      value: 'anthropic',
      label: 'Anthropic',
      models: [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }],
    },
    {
      value: 'openai',
      label: 'OpenAI',
      models: [{ value: 'gpt-4o', label: 'GPT-4o' }],
    },
    {
      value: 'google',
      label: 'Google',
      models: [{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }],
    },
  ],
  embedding: [
    {
      value: 'openai',
      label: 'OpenAI',
      models: [{ value: 'text-embedding-3-small', label: 'text-embedding-3-small (1536d)' }],
    },
    {
      value: 'google',
      label: 'Google',
      models: [{ value: 'text-embedding-004', label: 'text-embedding-004 (768d)' }],
    },
    {
      value: 'voyage',
      label: 'Voyage AI',
      models: [{ value: 'voyage-3-large', label: 'voyage-3-large (1024d)' }],
    },
  ],
  vision: [
    {
      value: 'anthropic',
      label: 'Anthropic',
      models: [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (vision)' }],
    },
    {
      value: 'openai',
      label: 'OpenAI',
      models: [{ value: 'gpt-4o', label: 'GPT-4o (vision)' }],
    },
    {
      value: 'google',
      label: 'Google',
      models: [{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (vision)' }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Props

export interface ExistingSetting {
  id: string;
  vendor: Vendor;
  model: string;
  apiKeyMasked: string;
}

export interface ProviderFormProps {
  capability: Capability;
  workspaceId: string;
  existing?: ExistingSetting;
  onSaved: (setting: ExistingSetting) => void;
}

// ---------------------------------------------------------------------------
// Component

export function ProviderForm({ capability, workspaceId, existing, onSaved }: ProviderFormProps) {
  const vendors = CAPABILITY_VENDORS[capability];
  const [selectedVendor, setSelectedVendor] = useState<Vendor>(existing?.vendor ?? vendors[0].value);
  const vendorOption = vendors.find((v) => v.value === selectedVendor) ?? vendors[0];

  const [selectedModel, setSelectedModel] = useState<string>(
    existing?.model ?? vendorOption.models[0].value,
  );
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  // When vendor changes, reset model to first option for new vendor
  function handleVendorChange(v: Vendor) {
    setSelectedVendor(v);
    const newVendorModels = CAPABILITY_VENDORS[capability].find((x) => x.value === v)?.models ?? [];
    setSelectedModel(newVendorModels[0]?.value ?? '');
    setApiKey('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey && !existing) {
      toast({ title: 'API key required', description: 'Paste your API key to save.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3333';
      const url = `${BASE}/api/workspaces/${workspaceId}/settings/providers`;

      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability,
          vendor: selectedVendor,
          model: selectedModel,
          apiKey: apiKey || undefined,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { message?: string };
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }

      const saved = (await res.json()) as { id: string };
      toast({ title: 'Provider saved', description: `${capability} set to ${selectedVendor}` });
      onSaved({
        id: saved.id,
        vendor: selectedVendor,
        model: selectedModel,
        apiKeyMasked: apiKey ? `${apiKey.slice(0, 3)}...****` : (existing?.apiKeyMasked ?? '****'),
      });
      setApiKey(''); // clear after save — paste-once pattern
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  const models = CAPABILITY_VENDORS[capability].find((v) => v.value === selectedVendor)?.models ?? [];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Vendor radio group */}
      <fieldset>
        <legend className="text-sm font-medium mb-2">Provider</legend>
        <div className="flex flex-wrap gap-3">
          {vendors.map((v) => (
            <label
              key={v.value}
              className={[
                'flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors',
                selectedVendor === v.value
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'border-input hover:bg-muted',
              ].join(' ')}
            >
              <input
                type="radio"
                name={`vendor-${capability}`}
                value={v.value}
                checked={selectedVendor === v.value}
                onChange={() => handleVendorChange(v.value)}
                className="sr-only"
              />
              {v.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Model dropdown */}
      <div className="space-y-1">
        <Label htmlFor={`model-${capability}`}>Model</Label>
        <select
          id={`model-${capability}`}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* API key input — paste-once, masked after save */}
      <div className="space-y-1">
        <Label htmlFor={`apikey-${capability}`}>
          API Key
          {existing && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              (current: {existing.apiKeyMasked} — paste to rotate)
            </span>
          )}
        </Label>
        <Input
          id={`apikey-${capability}`}
          type="password"
          autoComplete="off"
          placeholder={existing ? 'Paste new key to rotate…' : 'Paste API key…'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : existing ? 'Update provider' : 'Save provider'}
      </Button>
    </form>
  );
}
