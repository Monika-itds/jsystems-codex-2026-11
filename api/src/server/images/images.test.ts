import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareImage, ImageError } from "./index";

const dimensions = async (bytes: Buffer) => sharp(bytes).metadata();

describe("prepareImage", () => {
  it("re-encodes supported input, strips metadata, records dimensions and returns only prepared bytes", async () => {
    const input = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#336699" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "synthetic" } } })
      .toBuffer();
    const prepared = await prepareImage(input);

    expect(prepared).toMatchObject({
      mediaType: "image/jpeg",
      width: 120,
      height: 80,
      byteLength: prepared.bytes.length,
    });
    expect(prepared.bytes.length).toBeLessThanOrEqual(1024 ** 2);
    expect(prepared.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.warnings.length).toBeGreaterThan(0);
    expect((await dimensions(prepared.bytes)).exif).toBeUndefined();
    expect(Object.keys(prepared).sort()).toEqual(
      [
        "byteLength",
        "bytes",
        "hash",
        "height",
        "id",
        "mediaType",
        "warnings",
        "width",
      ].sort(),
    );
  });

  it("applies EXIF orientation and never upscales", async () => {
    const input = await sharp({
      create: { width: 320, height: 160, channels: 3, background: "#aaccee" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const prepared = await prepareImage(input);

    expect(prepared).toMatchObject({ width: 160, height: 320 });
    const small = await prepareImage(
      await sharp({
        create: { width: 80, height: 40, channels: 3, background: "#aaccee" },
      })
        .png()
        .toBuffer(),
    );
    expect(small).toMatchObject({
      width: 80,
      height: 40,
      mediaType: "image/png",
    });

    const large = await prepareImage(
      await sharp({
        create: {
          width: 2400,
          height: 1200,
          channels: 3,
          background: "#aaccee",
        },
      })
        .jpeg()
        .toBuffer(),
    );
    const decoded = await dimensions(large.bytes);
    expect(large).toMatchObject({ width: 1600, height: 800 });
    expect([large.width, large.height]).toEqual([
      decoded.width,
      decoded.height,
    ]);
    expect(Math.max(large.width, large.height)).toBeLessThanOrEqual(1600);
  });

  it("rejects corrupt, unsupported, mismatched, oversized and over-pixel inputs with sanitized errors", async () => {
    const mismatched = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const huge = await sharp({
      create: { width: 5001, height: 5001, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const tooManyBytes = Buffer.alloc(10 * 1024 ** 2 + 1, 1);
    for (const input of [
      Buffer.from("not an image"),
      Buffer.from("GIF89a"),
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), mismatched]),
      huge,
    ]) {
      await expect(prepareImage(input)).rejects.toBeInstanceOf(ImageError);
    }
    await expect(prepareImage(tooManyBytes)).rejects.toMatchObject({
      code: "capacity",
    });
    const sanitized = await prepareImage(
      Buffer.from("private user supplied text"),
    ).then(
      () => undefined,
      (error) => error as ImageError,
    );
    expect(sanitized).toBeInstanceOf(ImageError);
    if (!sanitized) throw new Error("Expected sanitized image error");
    expect(sanitized.message).not.toContain("private user supplied text");
  });

  it("rejects animated WebP and refuses output that cannot meet the compressed-byte limit", async () => {
    const frames = Buffer.alloc(16 * 16 * 4 * 2);
    frames.fill(255, 0, 16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) frames[i * 4 + 3] = 255;
    for (let i = 16 * 16 * 4; i < frames.length; i += 4) {
      frames[i + 1] = 255;
      frames[i + 3] = 255;
    }
    const animated = await sharp(frames, {
      raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
    })
      .webp({ delay: [50, 50], loop: 0 })
      .toBuffer();
    await expect(prepareImage(animated)).rejects.toMatchObject({
      code: "validation",
    });

    let seed = 17;
    const noise = Buffer.alloc(1500 * 1500 * 3);
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 48271) % 0x7fffffff;
      noise[i] = seed & 255;
    }
    const largePng = await sharp(noise, {
      raw: { width: 1500, height: 1500, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    await expect(prepareImage(largePng)).rejects.toMatchObject({
      code: "capacity",
    });
  });
});

it("rejects APNG animation controls even when the decoder exposes a single page", async () => {
  const { crc32 } = await import("node:zlib");
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  const chunk = (name: string, data: Buffer) => {
    const typeAndData = Buffer.concat([Buffer.from(name), data]);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(data.length);
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([prefix, typeAndData, suffix]);
  };
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(1);
  const control = Buffer.alloc(26);
  control.writeUInt32BE(2, 4);
  control.writeUInt32BE(2, 8);
  control.writeUInt16BE(1, 20);
  control.writeUInt16BE(10, 22);
  const apng = Buffer.concat([
    png.subarray(0, 33),
    chunk("acTL", animation),
    chunk("fcTL", control),
    png.subarray(33),
  ]);
  await expect(prepareImage(apng)).rejects.toBeInstanceOf(ImageError);
});

it("rejects single-page animated WebP controls while accepting static WebP", async () => {
  const webp = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#369" },
  })
    .webp()
    .toBuffer();
  await expect(prepareImage(webp)).resolves.toMatchObject({
    width: 2,
    height: 2,
    mediaType: "image/jpeg",
  });
  const chunk = (type: string, data: Buffer) => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(data.length);
    return Buffer.concat([
      Buffer.from(type),
      size,
      data,
      Buffer.alloc(data.length % 2),
    ]);
  };
  const extended = Buffer.alloc(10);
  extended[0] = 2;
  extended.writeUIntLE(1, 4, 3);
  extended.writeUIntLE(1, 7, 3);
  const frame = Buffer.alloc(16);
  frame.writeUIntLE(1, 6, 3);
  frame.writeUIntLE(1, 9, 3);
  frame.writeUIntLE(100, 12, 3);
  const body = Buffer.concat([
    Buffer.from("WEBP"),
    chunk("VP8X", extended),
    chunk("ANIM", Buffer.alloc(6)),
    chunk("ANMF", Buffer.concat([frame, webp.subarray(12)])),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  const animated = Buffer.concat([Buffer.from("RIFF"), length, body]);
  expect(
    (await sharp(animated, { animated: true }).metadata()).pages ?? 1,
  ).toBe(1);
  await expect(prepareImage(animated)).rejects.toMatchObject({
    code: "validation",
  });
});
