/** The fixed header's height in pixels. styles/base.css defines it once, as --header-height. */
export function headerHeight() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
}
