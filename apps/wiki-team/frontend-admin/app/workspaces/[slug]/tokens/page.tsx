// tokens/page.tsx — MCP token management: list, issue (plaintext once), rotate, revoke, revoke-all.
'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  api,
  type McpTokenMetadata,
  type McpTokenIssued,
  WikiTeamApiError,
  StepUpRequiredError,
  RateLimitError,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';

export default function TokensPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [tokens, setTokens] = useState<McpTokenMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  // Issued token shown ONCE in modal — cleared on dismiss.
  const [issuedToken, setIssuedToken] = useState<McpTokenIssued | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  function loadTokens() {
    setLoading(true);
    api.tokens
      .list()
      .then((all) => setTokens(all.filter((t) => t.workspaceId === slug || !t.workspaceId)))
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load tokens', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTokens(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleIssue() {
    setIssuing(true);
    try {
      const issued = await api.tokens.issue(slug);
      setIssuedToken(issued);
      loadTokens();
    } catch (err) {
      if (err instanceof StepUpRequiredError) {
        router.push('/signin?reason=fresh-required');
      } else if (err instanceof RateLimitError) {
        toast({
          title: '10 token limit reached',
          description: `Resets at midnight UTC.`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Failed to issue token', description: (err as WikiTeamApiError).message, variant: 'destructive' });
      }
    } finally {
      setIssuing(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    try {
      await api.tokens.revoke(tokenId);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
      toast({ title: 'Token revoked' });
    } catch (err) {
      toast({ title: 'Revoke failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    }
  }

  async function handleRotate(tokenId: string) {
    try {
      setIssuedToken(await api.tokens.rotate(tokenId));
      loadTokens();
    } catch (err) {
      if (err instanceof StepUpRequiredError) router.push('/signin?reason=fresh-required');
      else toast({ title: 'Rotate failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    }
  }

  async function handleRevokeAll() {
    if (!window.confirm('Revoke ALL tokens? This cannot be undone.')) return;
    try {
      await api.tokens.revokeAll();
      setTokens([]);
      toast({ title: 'All tokens revoked' });
    } catch (err) {
      toast({ title: 'Revoke-all failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    }
  }

  function handleCopy() {
    if (!issuedToken) return;
    navigator.clipboard.writeText(issuedToken.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleModalClose() {
    // Clear plaintext from state — never re-displayable after dismiss.
    setIssuedToken(null);
    setCopied(false);
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">MCP Tokens</h3>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={handleRevokeAll}>
            Revoke all
          </Button>
          <Button size="sm" onClick={handleIssue} disabled={issuing}>
            {issuing ? 'Issuing…' : 'New token'}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active tokens. Issue one to connect an MCP client.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono text-muted-foreground">{t.prefixLookup}…</p>
                <p className="text-xs text-muted-foreground">Created {formatDate(t.createdAt)}</p>
              </div>
              <Badge variant={t.revokedAt ? 'destructive' : 'success'}>
                {t.revokedAt ? 'revoked' : 'active'}
              </Badge>
              {!t.revokedAt && (
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => handleRotate(t.id)}>
                    Rotate
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleRevoke(t.id)}>
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* One-time plaintext token display modal */}
      <Dialog open={issuedToken !== null} onOpenChange={(open) => { if (!open) handleModalClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New MCP token issued</DialogTitle>
            <DialogDescription>
              This token will not be shown again. Save it now.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div
              role="region"
              aria-label="Token value"
              className="rounded-md bg-muted px-4 py-3 font-mono text-sm break-all select-all border"
            >
              {issuedToken?.token}
            </div>
            <p className="text-xs text-destructive font-medium">
              Copy and store this token securely. It cannot be retrieved after closing this dialog.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy token'}
            </Button>
            <DialogClose asChild>
              <Button onClick={handleModalClose}>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
