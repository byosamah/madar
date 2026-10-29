/** The browser build of mammoth has no type file of its own. It has the types of the package (lib/index.d.ts). */
declare module 'mammoth/mammoth.browser.min.js' {
  import type Mammoth from 'mammoth';
  const mammoth: typeof Mammoth;
  export default mammoth;
}
