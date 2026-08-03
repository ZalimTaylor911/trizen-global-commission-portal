/**
 * Avatar handling.
 *
 * Images are resized in the browser and stored as a data URL on the user's
 * record. Cloud Storage would be the obvious home, but it requires billing to
 * be enabled on projects created recently — and a 128px JPEG is a few kilobytes,
 * comfortably inside Firestore's 1 MiB document limit.
 */

export const AVATAR_SIZE = 128;
/** Refuse anything that would be silly to load into memory before resizing. */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export class AvatarError extends Error {}

/** Centre-crops to a square, scales to 128px, returns a JPEG data URL. */
export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarError('That file isn’t an image. Pick a JPG or PNG.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarError('That image is over 8 MB. Pick a smaller one.');
  }

  const source = await loadImage(file);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const context = canvas.getContext('2d');
  if (!context) throw new AvatarError('Could not process the image.');

  // Take the largest centred square so faces don't get squashed by the resize.
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) / 2;

  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return canvas.toDataURL('image/jpeg', 0.82);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarError('That image couldn’t be read.'));
    };
    image.src = url;
  });
}

/** Initials fallback when someone hasn't set a picture. */
export function initialsOf(name: string, email = ''): string {
  const source = name.trim() || email.trim();
  if (!source) return '?';

  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}
