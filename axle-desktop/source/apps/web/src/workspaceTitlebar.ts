/**
 * Left padding for workspace headers while the main sidebar is collapsed, so
 * their content clears the floating sidebar toggle. The icon rail already
 * occupies the first stretch of that inset, so only the remainder is added.
 */
export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "[[data-sidebar-state=collapsed]_&]:pl-[var(--workspace-titlebar-content-inset)]";
