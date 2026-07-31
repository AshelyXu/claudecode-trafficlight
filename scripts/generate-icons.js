const sharp = require('sharp');

async function generate() {
  const SIZE = 512;
  const HALF = SIZE / 2;

  // Create raw RGBA pixel buffer
  const pixels = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;
      const dx = (x - HALF) / HALF;
      const dy = (y - HALF * 0.85) / HALF;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background: dark
      pixels[idx]     = 5;    // R
      pixels[idx + 1] = 7;    // G
      pixels[idx + 2] = 13;   // B
      pixels[idx + 3] = 255;  // A

      // Orb glow
      if (dist < 0.28) {
        const strength = Math.max(0, 1 - dist / 0.28);
        const s2 = strength * strength;
        pixels[idx]     = Math.min(255, Math.round(0 * s2 * 0.22));
        pixels[idx + 1] = Math.min(255, Math.round(240 * s2 * 0.22) + pixels[idx + 1]);
        pixels[idx + 2] = Math.min(255, Math.round(168 * s2 * 0.22) + pixels[idx + 2]);
      }

      // Highlight
      if (dist < 0.15 && dx < 0 && dy < 0) {
        const hx = -(dx + 0.03) / 0.18;
        const hy = -(dy + 0.03) / 0.18;
        const hDist = Math.sqrt(hx * hx + hy * hy);
        if (hDist < 0.6) {
          const hStrength = Math.max(0, 1 - hDist / 0.6) * 0.35;
          pixels[idx]     = Math.min(255, Math.round(255 * hStrength) + pixels[idx]);
          pixels[idx + 1] = Math.min(255, Math.round(255 * hStrength) + pixels[idx + 1]);
          pixels[idx + 2] = Math.min(255, Math.round(255 * hStrength) + pixels[idx + 2]);
        }
      }

      // Rounded corners (radius ~56 = 112px corner radius)
      const cornerRadius = 0.22; // as fraction of SIZE
      const nearEdge = Math.max(
        x < SIZE * cornerRadius ? 1 - (x / (SIZE * cornerRadius)) : 1,
        x > SIZE * (1 - cornerRadius) ? 1 - ((SIZE - x) / (SIZE * cornerRadius)) : 1,
        y < SIZE * cornerRadius ? 1 - (y / (SIZE * cornerRadius)) : 1,
        y > SIZE * (1 - cornerRadius) ? 1 - ((SIZE - y) / (SIZE * cornerRadius)) : 1
      );
      if (nearEdge < 1) {
        const edgeAlpha = nearEdge * nearEdge;
        // Blend with transparent based on edge distance
        // For simplicity, darken outside the corner radius
      }
    }
  }

  // Generate 512x512
  await sharp(pixels, {
    raw: { width: SIZE, height: SIZE, channels: 4 }
  })
    .png()
    .toFile('public/icon-512.png');

  // Generate 192x192
  await sharp(pixels, {
    raw: { width: SIZE, height: SIZE, channels: 4 }
  })
    .resize(192, 192)
    .png()
    .toFile('public/icon-192.png');

  console.log('✅ Icons generated: icon-192.png, icon-512.png');
}

generate().catch(console.error);
