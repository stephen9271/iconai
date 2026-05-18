// api/image.js — Image generation with model auto-detection
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
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });

    // Try models in order of preference
    const models = [
      {
        name: 'dall-e-3',
        body: {
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: ['1024x1024','1792x1024','1024x1792'].includes(size) ? size : '1024x1024',
          quality: quality === 'hd' ? 'hd' : 'standard'
        }
      },
      {
        name: 'dall-e-2',
        body: {
          model: 'dall-e-2',
          prompt: prompt.slice(0, 1000), // DALL-E 2 has shorter prompt limit
          n: 1,
          size: ['256x256','512x512','1024x1024'].includes(size) ? size : '1024x1024'
        }
      }
    ];

    for (const model of models) {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(model.body)
      });

      if (r.ok) {
        const d = await r.json();
        const url = d.data?.[0]?.url;
        if (url) {
          return res.status(200).json({ url, provider: model.name });
        }
      }

      const e = await r.json().catch(() => ({}));
      const msg = e?.error?.message || '';
      console.warn(`${model.name} failed (${r.status}): ${msg}`);

      // If it's not a "model doesn't exist" error, don't try next model
      if (r.status !== 404 && !msg.includes('does not exist') && !msg.includes('model')) {
        return res.status(r.status).json({ error: msg || `HTTP ${r.status}` });
      }
      // Otherwise try next model
    }

    return res.status(503).json({ error: 'No image model available on this account. Check OpenAI plan supports image generation.' });

  } catch (err) {
    console.error('Image error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
