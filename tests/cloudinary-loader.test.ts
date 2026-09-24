import { describe, expect, it } from "vitest";
import cloudinaryLoader from "../src/lib/cloudinary-loader";

const SRC = "https://res.cloudinary.com/soulone/image/upload/v1790000000/products/abc/front.jpg";

describe("cloudinaryLoader", () => {
  it("asks Cloudinary for the requested width in the best format and quality", () => {
    expect(cloudinaryLoader({ src: SRC, width: 640 })).toBe(
      "https://res.cloudinary.com/soulone/image/upload/f_auto,q_auto,c_limit,w_640/v1790000000/products/abc/front.jpg",
    );
  });

  it("uses an explicit quality when next/image passes one", () => {
    expect(cloudinaryLoader({ src: SRC, width: 320, quality: 60 })).toContain("/upload/f_auto,q_60,c_limit,w_320/");
  });

  it("gives each width its own URL, so srcset actually varies", () => {
    expect(cloudinaryLoader({ src: SRC, width: 384 })).not.toBe(cloudinaryLoader({ src: SRC, width: 828 }));
  });

  it("leaves anything that isn't a Cloudinary upload URL alone", () => {
    expect(cloudinaryLoader({ src: "/placeholder.png", width: 640 })).toBe("/placeholder.png");
    expect(cloudinaryLoader({ src: "https://example.com/a.jpg", width: 640 })).toBe("https://example.com/a.jpg");
    expect(cloudinaryLoader({ src: "https://res.cloudinary.com/soulone/video/upload/x.mp4", width: 640 })).toBe(
      "https://res.cloudinary.com/soulone/video/upload/x.mp4",
    );
  });
});
