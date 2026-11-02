import { isObject, type CocosNamespace, type EngineTexture } from "./contracts";
import { fail, imageLike } from "./properties";
const MAX_SIDE = 8192;
const MAX_PIXELS = 16 * 1024 * 1024;
export interface ImagePreview {
  url: string;
  width: number;
  height: number;
  assetUuid?: string;
}
interface ImageTarget {
  texture: EngineTexture;
  frame: EngineTexture | null;
  rect: { x: number; y: number; width: number; height: number };
  rotated: boolean;
}
function isCanvasImageSource(value: unknown): value is CanvasImageSource {
  return (
    value instanceof HTMLImageElement ||
    value instanceof HTMLCanvasElement ||
    value instanceof ImageBitmap ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}
function target(value: EngineTexture): ImageTarget {
  if (!imageLike(value))
    fail("NOT_IMAGE", "The selected property is not an image or texture.");
  const frame =
    typeof value.getTexture === "function" ||
    (value.texture && (value.rect || value._rect))
      ? value
      : null;
  const texture = frame
    ? frame.getTexture?.() || frame.texture || frame._texture
    : value;
  if (!texture) fail("IMAGE_UNAVAILABLE", "The image texture is not loaded.");
  const region = frame?.getRect?.() || frame?.rect || frame?._rect;
  const rect = region
    ? { x: region.x, y: region.y, width: region.width, height: region.height }
    : {
        x: 0,
        y: 0,
        width: Number(texture.width ?? texture._width ?? 0),
        height: Number(texture.height ?? texture._height ?? 0),
      };
  if (
    !Object.values(rect).every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    fail("IMAGE_UNAVAILABLE", "The image dimensions are unavailable.");
  return {
    texture,
    frame,
    rect,
    rotated: !!(frame?.isRotated?.() || frame?.rotated || frame?._rotated),
  };
}
function nativeImage(texture: EngineTexture): CanvasImageSource | null {
  const rawImage = isObject(texture._image) ? texture._image.data : undefined;
  const candidate =
    texture.getHtmlElementObj?.() ||
    texture.image?.data ||
    texture.image?._data ||
    rawImage ||
    texture._image ||
    null;
  return isCanvasImageSource(candidate) ? candidate : null;
}
export function imagePreview(value: EngineTexture): ImagePreview {
  const { texture, frame, rect, rotated } = target(value);
  const source = nativeImage(texture);
  const width = rect.width,
    height = rect.height;
  if (source) {
    const scale = Math.min(1, 256 / width, 256 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      fail("PREVIEW_UNAVAILABLE", "Canvas image preview is unavailable.");
    try {
      if (rotated) {
        context.translate(0, canvas.height);
        context.rotate(-Math.PI / 2);
        context.drawImage(
          source,
          rect.x,
          rect.y,
          height,
          width,
          0,
          0,
          canvas.height,
          canvas.width,
        );
      } else
        context.drawImage(
          source,
          rect.x,
          rect.y,
          width,
          height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      return {
        url: canvas.toDataURL("image/png"),
        width,
        height,
        assetUuid: frame?._uuid || texture._uuid,
      };
    } catch {
      fail(
        "PREVIEW_UNAVAILABLE",
        "The texture source cannot be read, possibly because its origin does not allow canvas access.",
      );
    }
  }
  const url = texture.nativeUrl || texture.image?.nativeUrl;
  if (
    typeof url === "string" &&
    /^(https?:|blob:)/i.test(url) &&
    url.length < 8192
  )
    return { url, width, height, assetUuid: frame?._uuid || texture._uuid };
  fail(
    "PREVIEW_UNAVAILABLE",
    "This engine does not retain a readable image source or native image URL.",
  );
}
async function decode(dataUrl: unknown): Promise<HTMLImageElement> {
  if (
    typeof dataUrl !== "string" ||
    dataUrl.length > 8 * 1024 * 1024 ||
    !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(dataUrl)
  )
    fail(
      "INVALID_IMAGE",
      "Only base64 PNG, JPEG, or WebP images up to 8 MiB encoded are accepted.",
    );
  let signature: string;
  try {
    signature = atob(
      dataUrl
        .slice(dataUrl.indexOf(",") + 1, dataUrl.indexOf(",") + 129)
        .replace(/[\r\n]/g, "")
        .slice(0, 64),
    );
  } catch {
    fail("INVALID_IMAGE", "The image base64 header is invalid.");
  }
  const png = signature.startsWith("\u0089PNG\r\n\u001a\n");
  const jpeg = signature.startsWith("\u00ff\u00d8\u00ff");
  const webp =
    signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP";
  if (
    !(dataUrl.startsWith("data:image/png;") && png) &&
    !(dataUrl.startsWith("data:image/jpeg;") && jpeg) &&
    !(dataUrl.startsWith("data:image/webp;") && webp)
  )
    fail(
      "INVALID_IMAGE",
      "The image file signature does not match its PNG, JPEG, or WebP type.",
    );
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Image decode failed."));
    image.src = dataUrl;
  }).catch(() =>
    fail("INVALID_IMAGE", "The local image could not be decoded."),
  );
  if (
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_SIDE ||
    image.height > MAX_SIDE ||
    image.width * image.height > MAX_PIXELS
  )
    fail(
      "IMAGE_TOO_LARGE",
      "Image dimensions exceed 8192 pixels per side or 16 million pixels.",
    );
  return image;
}
export async function replaceImage(
  value: EngineTexture,
  dataUrl: unknown,
  cc: CocosNamespace,
  assertCurrent: () => void,
): Promise<{
  width: number;
  height: number;
  sharedTexture: boolean;
  previewUrl: string;
}> {
  const { texture, frame, rect, rotated } = target(value);
  if (!Object.values(rect).every(Number.isInteger) || rect.x < 0 || rect.y < 0)
    fail(
      "IMAGE_WRITE_UNAVAILABLE",
      "Texture replacement requires a nonnegative integer-pixel atlas region.",
    );
  const textureWidth = Number(texture.width ?? texture._width ?? 0),
    textureHeight = Number(texture.height ?? texture._height ?? 0);
  if (
    rect.x + (rotated ? rect.height : rect.width) > textureWidth ||
    rect.y + (rotated ? rect.width : rect.height) > textureHeight
  )
    fail(
      "IMAGE_WRITE_UNAVAILABLE",
      "The atlas region exceeds the texture allocation.",
    );
  if (
    rect.width > MAX_SIDE ||
    rect.height > MAX_SIDE ||
    rect.width * rect.height > MAX_PIXELS
  )
    fail(
      "IMAGE_TOO_LARGE",
      "The destination image region exceeds the pixel limit.",
    );
  const image = await decode(dataUrl);
  assertCurrent();
  if (
    value.isValid === false ||
    texture.isValid === false ||
    (typeof cc.isValid === "function" &&
      (!cc.isValid(value, true) || !cc.isValid(texture, true)))
  )
    fail("INVALID_ASSET", "The image asset was destroyed before replacement.");
  const current = target(value);
  if (
    current.texture !== texture ||
    current.rotated !== rotated ||
    Object.keys(rect).some(
      (key) =>
        current.rect[key as keyof typeof rect] !==
        rect[key as keyof typeof rect],
    )
  )
    fail(
      "STALE_ASSET",
      "The image texture or atlas region changed before replacement.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = rotated ? rect.height : rect.width;
  canvas.height = rotated ? rect.width : rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    fail("IMAGE_WRITE_UNAVAILABLE", "Canvas image replacement is unavailable.");
  if (rotated) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, 0, rect.width, rect.height);
  } else ctx.drawImage(image, 0, 0, rect.width, rect.height);
  const gfxTexture = texture.getGFXTexture?.();
  const format =
    gfxTexture?.format ?? texture.getPixelFormat?.() ?? texture._format;
  const formats = cc.gfx?.Format || cc.Texture2D?.PixelFormat;
  const formatName = formats
    ? Object.keys(formats).find((key) => formats[key] === format) || ""
    : "";
  if (
    /PVRTC|ETC|ASTC|S3TC|DXT|BC[1-7]/i.test(formatName) ||
    (gfxTexture?.levelCount ?? 0) > 1 ||
    texture._genMipmaps === true
  )
    fail(
      "IMAGE_WRITE_UNAVAILABLE",
      "Compressed or mipmapped textures require a format-aware full mip-chain upload, which this runtime does not expose.",
    );
  const device = cc.director?.root?.device || cc.game?.device;
  if (gfxTexture && device?.copyTexImagesToTexture) {
    const width = canvas.width,
      height = canvas.height;
    const region = cc.gfx?.BufferTextureCopy
      ? new cc.gfx.BufferTextureCopy()
      : {
          buffOffset: 0,
          buffStride: 0,
          buffTexHeight: 0,
          texOffset: { x: 0, y: 0, z: 0 },
          texExtent: { width: 0, height: 0, depth: 1 },
          texSubres: { mipLevel: 0, baseArrayLayer: 0, layerCount: 1 },
        };
    region.texOffset.x = rect.x;
    region.texOffset.y = rect.y;
    region.texExtent.width = width;
    region.texExtent.height = height;
    region.texExtent.depth = 1;
    device.copyTexImagesToTexture([canvas], gfxTexture, [region]);
  } else if (String(cc.ENGINE_VERSION).startsWith("2")) {
    const implementation = texture.getImpl?.();
    if (typeof implementation?.updateSubImage === "function") {
      implementation.updateSubImage({
        image: canvas,
        x: rect.x,
        y: rect.y,
        width: canvas.width,
        height: canvas.height,
        level: 0,
        flipY: !!texture._flipY,
        premultiplyAlpha: !!texture._premultiplyAlpha,
      });
    } else if (!frame && typeof texture.update === "function") {
      texture.update({ image: canvas });
    } else
      fail(
        "IMAGE_WRITE_UNAVAILABLE",
        "This Cocos 2 renderer does not expose an atlas-safe texture subregion update.",
      );
  } else
    fail(
      "IMAGE_WRITE_UNAVAILABLE",
      "Texture subregion upload is unavailable; replacing a shared atlas with an independent texture is not allowed.",
    );
  // Keep retained CPU image pixels consistent when a writable canvas backs the shared texture.
  const source = nativeImage(texture);
  if (source instanceof HTMLCanvasElement) {
    source.getContext("2d")?.drawImage(canvas, rect.x, rect.y);
  }
  const preview = document.createElement("canvas"),
    scale = Math.min(1, 256 / rect.width, 256 / rect.height);
  preview.width = Math.max(1, Math.round(rect.width * scale));
  preview.height = Math.max(1, Math.round(rect.height * scale));
  const previewContext = preview.getContext("2d");
  if (!previewContext)
    fail(
      "PREVIEW_UNAVAILABLE",
      "Canvas image preview is unavailable after replacement.",
    );
  previewContext.drawImage(image, 0, 0, preview.width, preview.height);
  return {
    width: rect.width,
    height: rect.height,
    sharedTexture: !!frame,
    previewUrl: preview.toDataURL("image/png"),
  };
}
