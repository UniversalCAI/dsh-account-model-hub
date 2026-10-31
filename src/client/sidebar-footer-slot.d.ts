/**
 * Type-only declaration for the sidebar footer action slot.
 *
 * DSH's `@deepseek-ai/dsh-client-ui-sidebar` package owns this slot contract,
 * but this plugin does not depend on that package (folding it in would add a
 * whole UI package for one string literal). Declaring the slot here is the
 * same declaration-merging mechanism the owner uses; the runtime slot table
 * already exists in the shell, so no runtime code is implied.
 *
 * The owner share is the column display state: `wide === false` is the 56px
 * rail, where the footer cards hide instead of squeezing.
 */
export {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
  }
}
