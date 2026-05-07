/**
 * remark-gfm.d.ts — local type stub for remark-gfm@^4.
 *
 * Real package added to package.json; stub lets TSC resolve before install.
 * Remove once remark-gfm is installed and its own types are available.
 */

declare module 'remark-gfm' {
  import type { Plugin } from 'unified';
  const remarkGfm: Plugin;
  export default remarkGfm;
}
