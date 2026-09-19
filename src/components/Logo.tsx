/**
 * Trizen Global logo.
 *
 * The real artwork, imported directly. Vite fingerprints and bundles each file,
 * so nothing here depends on a runtime path.
 *
 * To change a logo, replace the file in `src/assets/brand/` — every screen reads
 * from this module, so there is nothing else to update.
 */

import iconOnly from '@/assets/brand/icon-only.png';
import stackedLayout from '@/assets/brand/stacked_layout.png';
import primaryFullColour from '@/assets/brand/primary_full_color_logo.png';
import sidebarAppIcon from '@/assets/brand/sidebar_app_icon.png';

export const BRAND = {
  navy: '#0D1B3D',
  green: '#059669',
  grey: '#A6A8AB',
} as const;

export const LOGO_FILES = {
  /** TG mark, transparent background — sidebar and collapsed rail. */
  icon: iconOnly,
  /** Mark above the wordmark — login panel. */
  stacked: stackedLayout,
  /** Mark beside the wordmark with the tagline — login header. */
  primary: primaryFullColour,
  /**
   * Tight square mark for the browser tab. The older favicon source has wide
   * transparent padding, which makes the TG mark render far too small at the
   * browser's 16px favicon size.
   */
  appIcon: sidebarAppIcon,
  sidebarIcon: sidebarAppIcon,
} as const;

/** The app-icon mark used in the sidebar. Square, so width and height are the same. */
 export function LogoMark({ size = 32 }: { size?: number }) {
  return (
     <img
      src={LOGO_FILES.sidebarIcon}
      alt="Trizen Global"
      width={size}
       height={size}
     style={{ objectFit: 'contain', display: 'block' }}
    />
  );
}

/** Stacked lockup — mark above TRIZEN GLOBAL. */
export function LogoStacked({ width = 180 }: { width?: number }) {
  return (
    <img
      src={LOGO_FILES.stacked}
      alt="Trizen Global"
      style={{ width, height: 'auto', display: 'block' }}
    />
  );
}

/**
 * Horizontal lockup — mark beside the wordmark, tagline included.
 *
 * Sized by width, because the tagline is part of the artwork and stops being
 * readable if the lockup is scaled down much past ~180px.
 */
export function LogoHorizontal({ width = 300 }: { width?: number }) {
  return (
    <img
      src={LOGO_FILES.primary}
      alt="Trizen Global — Connecting Possibilities. Delivering Excellence."
      style={{ width, height: 'auto', display: 'block' }}
    />
  );
}

/**
 * Points the browser-tab icon at the app icon. Done here rather than as a static
 * <link> so the bundled, fingerprinted URL is used.
 */
export function applyFavicon(): void {
  const link =
    document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  link.type = 'image/png';
  link.href = LOGO_FILES.appIcon;
}
