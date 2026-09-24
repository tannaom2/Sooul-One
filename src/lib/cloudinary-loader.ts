/**
 * next/image loader for Cloudinary.
 *
 * Without it, Next's built-in optimiser downloads each Cloudinary original to
 * our own server and resizes it there: slow on a cold cache and CPU we pay for
 * on a small instance. Instead the browser asks Cloudinary for exactly the
 * width it needs, in the best format it accepts (f_auto: AVIF/WebP) at an
 * automatic quality (q_auto). Any other URL passes through untouched.
 *
 * Runs in the browser as well as the server, so no server-only imports.
 */

const UPLOAD = "/image/upload/";

export default function cloudinaryLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  const at = url.pathname.indexOf(UPLOAD);
  if (url.hostname !== "res.cloudinary.com" || at === -1) return src;

  const transform = ["f_auto", quality ? `q_${quality}` : "q_auto", "c_limit", `w_${width}`].join(",");
  const head = url.pathname.slice(0, at + UPLOAD.length);
  const rest = url.pathname.slice(at + UPLOAD.length);
  url.pathname = `${head}${transform}/${rest}`;
  return url.toString();
}
