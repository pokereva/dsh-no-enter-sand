/**
 * dsh-no-enter-send — host half.
 *
 * Everything this plugin does happens in the browser, so the host half has
 * nothing to run. It exists because a DSH bundle must export `apply` to be a
 * valid plugin entry; keeping it empty makes the split explicit rather than
 * accidental.
 */
export function apply() {}
