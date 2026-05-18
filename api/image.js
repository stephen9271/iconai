// api/image.js — DALL-E 3 image generation
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, size = '1024x1024', quality = 'standard' } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    }

    // DALL-E 3 valid sizes: 1024x1024, 1792x1024, 1024x1792
    const validSizes = ['1024x1024', '1792x1024', '1024x1792'];
    const mappedSize = validSizes.includes(size) ? size : '1024x1024';

    // DALL-E 3 quality: 'standard' or 'hd'
    const mappedQuality = quality === 'hd' ? 'hd' : 'standard';

    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: mappedSize,
        quality: mappedQuality
        // No response_format — defaults to url which is what we want
      })
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const msg = e?.error?.message || `HTTP ${r.status}`;
      console.error('DALL-E 3 error:', r.status, msg);
      return res.status(r.status).json({ error: msg });
    }

    const d = await r.json();
    const url = d.data?.[0]?.url;
    const revised = d.data?.[0]?.revised_prompt;

    if (!url) return res.status(500).json({ error: 'No image URL in response' });

    return res.status(200).json({ url, provider: 'dall-e-3', revised_prompt: revised });

  } catch (err) {
    console.error('Image generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
