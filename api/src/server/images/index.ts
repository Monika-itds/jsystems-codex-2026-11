import { createHash, randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { limits, type ImageMetadata } from "../contracts";

export type PreparedImage = ImageMetadata & { bytes: Buffer };

export class ImageError extends Error {
  constructor(
    readonly code: "validation" | "capacity",
    message: string,
  ) {
    super(message);
    this.name = "ImageError";
  }
}

const validationError = () =>
  new ImageError("validation", "The image is invalid or unsupported.");
const capacityError = () =>
  new ImageError("capacity", "The image exceeds the supported size limits.");

function detectedFormat(input: Buffer): "jpeg" | "png" | "webp" | undefined {
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff)
    return "jpeg";
  if (
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    input.toString("ascii", 0, 4) === "RIFF" &&
    input.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return undefined;
}

function hasAnimationControl(
  input: Buffer,
  format: "jpeg" | "png" | "webp",
): boolean {
  if (format === "jpeg") return false;
  const png = format === "png";
  for (let offset = png ? 8 : 12; offset + (png ? 12 : 8) <= input.length;) {
    const length = png
      ? input.readUInt32BE(offset)
      : input.readUInt32LE(offset + 4);
    const type = input.toString(
      "ascii",
      offset + (png ? 4 : 0),
      offset + (png ? 8 : 4),
    );
    if (
      png
        ? ["acTL", "fcTL", "fdAT"].includes(type)
        : ["ANIM", "ANMF"].includes(type)
    )
      return true;
    if (!png && type === "VP8X" && length > 0 && (input[offset + 8] & 2) !== 0)
      return true;
    const next = offset + length + (png ? 12 : 8 + (length % 2));
    if (next > input.length) break;
    offset = next;
  }
  return false;
}

export async function prepareImage(input: Buffer): Promise<PreparedImage> {
  if (!Buffer.isBuffer(input) || input.length === 0) throw validationError();
  if (input.length > limits.uploadBytes) throw capacityError();

  const signature = detectedFormat(input);
  if (!signature) throw validationError();
  // Decoders can expose only the default frame of APNG; reject animation containers explicitly.
  if (hasAnimationControl(input, signature)) throw validationError();

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      animated: true,
      limitInputPixels: limits.pixels,
      failOn: "error",
    }).metadata();
  } catch {
    throw validationError();
  }
  if (metadata.format !== signature || !metadata.width || !metadata.height)
    throw validationError();
  if ((metadata.pages ?? 1) > 1) throw validationError();
  if (metadata.width * metadata.height > limits.pixels) throw capacityError();

  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  const outputType = signature === "png" ? "png" : "jpeg";
  const transform = () =>
    sharp(input, { limitInputPixels: limits.pixels, failOn: "error" })
      .autoOrient()
      .resize({
        width: limits.imageEdge,
        height: limits.imageEdge,
        fit: "inside",
        withoutEnlargement: true,
      });

  let bytes: Buffer | undefined;
  let outputWidth = width;
  let outputHeight = height;
  if (outputType === "png") {
    try {
      const output = await transform()
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer({ resolveWithObject: true });
      bytes = output.data;
      outputWidth = output.info.width;
      outputHeight = output.info.height;
    } catch {
      throw validationError();
    }
  } else {
    for (const quality of [85, 75, 65, 55, 45, 35]) {
      try {
        const candidate = await transform()
          .jpeg({ quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        if (candidate.data.length <= limits.imageBytes) {
          bytes = candidate.data;
          outputWidth = candidate.info.width;
          outputHeight = candidate.info.height;
          break;
        }
      } catch {
        throw validationError();
      }
    }
  }
  if (!bytes) throw capacityError();
  if (bytes.length > limits.imageBytes) throw capacityError();
  if (outputWidth > limits.imageEdge || outputHeight > limits.imageEdge)
    throw capacityError();

  return {
    id: randomUUID(),
    mediaType: outputType === "png" ? "image/png" : "image/jpeg",
    width: outputWidth,
    height: outputHeight,
    byteLength: bytes.length,
    hash: createHash("sha256").update(bytes).digest("hex"),
    warnings: [
      "A single image cannot establish hidden damage or functionality.",
      "Re-encoding may reduce subtle visual detail.",
    ],
    bytes,
  };
}
