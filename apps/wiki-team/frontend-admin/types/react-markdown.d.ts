/**
 * react-markdown.d.ts — local type stub for react-markdown@^9.
 *
 * Real package added to package.json; this stub lets TSC resolve types
 * before `bun install` is run in CI or local setup.
 * Remove this file once react-markdown is installed and its own types ship.
 */

declare module 'react-markdown' {
  import type { ReactNode, ComponentType, HTMLAttributes } from 'react';
  import type { PluggableList } from 'unified';

  export type Components = Partial<{
    [TagName in keyof JSX.IntrinsicElements]: ComponentType<
      JSX.IntrinsicElements[TagName] & { node?: unknown }
    >;
  }>;

  export interface ReactMarkdownProps {
    children: string;
    remarkPlugins?: PluggableList;
    rehypePlugins?: PluggableList;
    components?: Components;
    className?: string;
  }

  export default function ReactMarkdown(props: ReactMarkdownProps): ReactNode;
}
