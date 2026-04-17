// api/image.js
// Secure backend proxy for image generation
// Handles: GPT Image 1.5 (primary), Recraft V4 via fal.ai (secondary)
// Keys stored as Vercel environment variables — never exposed to frontend

export const config = { maxDuration: 60 }; // Image generation can take up to 60s

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt,
    size = '1024x1024',
    quality = 'standard',
    provider = 'auto',  // 'auto' | 'openai' | 'recraft'
    outputFormat = 'png' // 'png' | 'svg' (recraft only)
  } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // ── Try Recraft V4 for SVG or when explicitly requested ──────────────────────
  const useRecraft = (outputFormat === 'svg' || provider === 'recraft') && process.env.FAL_API_KEY;

  if (useRecraft) {
    try {
      const r = await fetch('https://fal.run/fal-ai/recraft-v3/text-to-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${process.env.FAL_API_KEY}`
        },
        body: JSON.stringify({
          prompt,
          image_size: 'square_hd',
          num_images: 1,
          style: 'vector_illustration',
          output_format: outputFormat === 'svg' ? 'svg' : 'png'
        })
      });

      if (r.ok) {
        const d = await r.json();
        const imageUrl = d.images?.[0]?.url;
        if (imageUrl) {
          return res.status(200).json({ url: imageUrl, provider: 'recraft', format: outputFormat });
        }
      } else {
        const e = await r.json().catch(() => ({}));
        console.warn('Recraft failed:', r.status, e?.detail);
        // Fall through to GPT Image
      }
    } catch (err) {
      console.warn('Recraft error:', err.message);
      // Fall through to GPT Image
    }
  }

  // ── GPT Image 1.5 ─────────────────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    try {
      // GPT Image 1.5 size mapping
      const sizeMap = {
        '1024x1024': '1024x1024',
        '1792x1024': '1536x1024',
        '1024x1792': '1024x1536',
        '800x600':   '1024x1024',
        '1200x630':  '1536x1024',
      };
      const mappedSize = sizeMap[size] || '1024x1024';
      const mappedQuality = quality === 'hd' ? 'high' : 'medium';

      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size: mappedSize,
          quality: mappedQuality
        })
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        const msg = e?.error?.message || `HTTP ${r.status}`;

        // Try DALL-E 3 as fallback if gpt-image-1 fails
        if (r.status === 404 || msg.includes('model')) {
          console.warn('GPT Image 1 not available, trying DALL-E 3');
          const r2 = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt,
              n: 1,
              size: size === '1024x1024' ? '1024x1024' : (size === '1792x1024' ? '1792x1024' : '1024x1024'),
              quality: quality === 'hd' ? 'hd' : 'standard',
              response_format: 'url'
            })
          });
          if (r2.ok) {
            const d2 = await r2.json();
            const url = d2.data?.[0]?.url;
            if (url) return res.status(200).json({ url, provider: 'dalle3', format: 'png' });
          }
        }

        return res.status(r.status).json({ error: msg, provider: 'openai' });
      }

      const d = await r.json();
      const item = d.data?.[0];
      if (!item) return res.status(500).json({ error: 'No image returned from GPT Image 1' });

      // GPT Image 1.5 returns base64
      if (item.b64_json) {
        return res.status(200).json({
          b64: item.b64_json,
          provider: 'gpt-image-1',
          format: 'png'
        });
      }
      if (item.url) {
        return res.status(200).json({ url: item.url, provider: 'gpt-image-1', format: 'png' });
      }

      return res.status(500).json({ error: 'No image data in response' });

    } catch (err) {
      console.error('GPT Image error:', err.message);
      return res.status(500).json({ error: err.message, provider: 'openai' });
    }
  }

  return res.status(503).json({
    error: 'No image generation provider configured. Add OPENAI_API_KEY or FAL_API_KEY to Vercel environment variables.'
  });
}
