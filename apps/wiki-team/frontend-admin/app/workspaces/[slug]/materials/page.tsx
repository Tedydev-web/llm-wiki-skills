/**
 * workspaces/[slug]/materials/page.tsx — materials upload + compile + job poll tab.
 */

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api, type Material, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';

const STATUS_VARIANT: Record<Material['status'], 'default' | 'secondary' | 'destructive' | 'success'> = {
  pending: 'secondary',
  processing: 'default',
  done: 'success',
  failed: 'destructive',
};

type JobMap = Record<string, { jobId: string; state: string; progress: number }>;

export default function MaterialsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<JobMap>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function loadMaterials() {
    return api.materials
      .list(slug)
      .then(setMaterials)
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load materials', description: err.message, variant: 'destructive' });
      });
  }

  useEffect(() => {
    setLoading(true);
    loadMaterials().finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll active jobs every 2s
  useEffect(() => {
    const activeJobs = Object.values(jobs).filter((j) => j.state === 'waiting' || j.state === 'active');
    if (activeJobs.length === 0) return;
    pollRef.current = setInterval(async () => {
      const updates: JobMap = { ...jobs };
      for (const j of activeJobs) {
        try {
          const status = await api.materials.pollJob(j.jobId);
          updates[j.jobId] = { jobId: j.jobId, state: status.state, progress: status.progress };
          if (status.state === 'completed' || status.state === 'failed') {
            await loadMaterials();
          }
        } catch { /* swallow — next poll will retry */ }
      }
      setJobs(updates);
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Client-side size guard (100 MB)
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum 100 MB', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      await api.materials.upload(slug, file);
      toast({ title: 'Uploaded', description: file.name });
      await loadMaterials();
    } catch (err) {
      toast({ title: 'Upload failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleCompile(materialId: string) {
    try {
      const { jobId } = await api.materials.compile(slug, materialId);
      setJobs((prev) => ({ ...prev, [jobId]: { jobId, state: 'waiting', progress: 0 } }));
      toast({ title: 'Compile job queued', description: `Job ${jobId}` });
    } catch (err) {
      toast({ title: 'Compile failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    }
  }

  async function handleDelete(materialId: string) {
    try {
      await api.materials.delete(slug, materialId);
      setMaterials((prev) => prev.filter((m) => m.id !== materialId));
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Materials</h3>
        <label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.md,.txt,.html"
            className="sr-only"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button asChild disabled={uploading}>
            <span>{uploading ? 'Uploading…' : 'Upload file'}</span>
          </Button>
        </label>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : materials.length === 0 ? (
        <p className="text-muted-foreground text-sm">No materials yet. Upload a PDF, DOCX, or Markdown file.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {materials.map((m) => {
            const activeJob = Object.values(jobs).find((j) => j.state === 'waiting' || j.state === 'active');
            return (
              <li key={m.id} className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(m.createdAt)} · {Math.round(m.sizeBytes / 1024)} KB</p>
                </div>
                <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                {activeJob && <span className="text-xs text-muted-foreground">{activeJob.progress}%</span>}
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => handleCompile(m.id)}>
                    Compile
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(m.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
