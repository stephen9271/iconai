// api/image.js — GPT Image 1 (OpenAI's latest image model)
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

    // GPT Image 1 uses the responses endpoint, not images/generations
    // It returns base64 encoded image
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        input: prompt,
        tools: [{ type: 'image_generation', quality: quality === 'hd' ? 'high' : 'medium', size: '1024x1024' }]
      })
    });

    if (r.ok) {
      const d = await r.json();
      // Extract image from output
      const imageData = d.output?.find(o => o.type === 'image_generation_call');
      const b64 = imageData?.result;
      if (b64) {
        return res.status(200).json({ b64, provider: 'gpt-image-1' });
      }
    }

    const e1 = await r.json().catch(() => ({}));
    console.warn('GPT Image 1 responses endpoint failed:', r.status, e1?.error?.message);

    // Fallback: try images/generations with gpt-image-1
    const r2 = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: quality === 'hd' ? 'high' : 'medium'
      })
    });

    if (r2.ok) {
      const d2 = await r2.json();
      const item = d2.data?.[0];
      if (item?.b64_json) return res.status(200).json({ b64: item.b64_json, provider: 'gpt-image-1' });
      if (item?.url)      return res.status(200).json({ url: item.url, provider: 'gpt-image-1' });
    }

    const e2 = await r2.json().catch(() => ({}));
    console.warn('GPT Image 1 generations endpoint failed:', r2.status, e2?.error?.message);

    // Final fallback: dall-e-2 (available on all accounts)
    const r3 = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-2',
        prompt: prompt.slice(0, 1000),
        n: 1,
        size: '1024x1024'
      })
    });

    if (r3.ok) {
      const d3 = await r3.json();
      const url = d3.data?.[0]?.url;
      if (url) return res.status(200).json({ url, provider: 'dall-e-2' });
    }

    const e3 = await r3.json().catch(() => ({}));
    return res.status(503).json({ 
      error: e3?.error?.message || 'All image models failed. Check your OpenAI API key has image generation access.',
      tried: ['gpt-image-1 (responses)', 'gpt-image-1 (generations)', 'dall-e-2']
    });

  } catch (err) {
    console.error('Image error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
