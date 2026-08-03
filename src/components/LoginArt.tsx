/**
 * The illustration on the right of the login screen.
 *
 * Drop the artwork into `src/assets/brand/` as `login-art.png` (or .jpg/.webp)
 * and it fills the panel edge to edge. Until then, a plain brand-coloured
 * gradient stands in — deliberately simple, because a hand-coded imitation of a
 * 3D render only ever looks like an imitation.
 */

import { LogoMark } from './Logo';

const art = import.meta.glob('../assets/brand/login-art.{png,jpg,jpeg,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const artUrl = Object.values(art)[0] ?? null;

export const hasLoginArt = artUrl !== null;

export default function LoginArt() {
  if (artUrl) {
    // Just the image. Supplied artwork is the finished panel — typically with
    // its own headline set into the design — so nothing is drawn over it.
    return <img className="login-art-image" src={artUrl} alt="" />;
  }

  return (
    <>
      <div className="login-art-glow one" />
      <div className="login-art-glow two" />
      <div className="login-art-grid" />
      <div className="login-art-emblem">
        <LogoMark size={150} />
      </div>
      <div className="login-art-scrim" />
    </>
  );
}
