// api/generate.js
// Secure backend proxy for text/SVG generation
// Handles: Claude (primary), Gemini (fallback 1), OpenAI GPT-4o (fallback 2)
// Keys stored as Vercel environment variables — never exposed to frontend

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // CORS headers — must be set before anything else
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Wrap everything in try-catch so CORS headers are always sent
  try {

  const { system, user, maxTokens = 4000, provider = 'auto' } = req.body;

  if (!system || !user) {
    return res.status(400).json({ error: 'Missing system or user prompt' });
  }

  // Try providers in order based on available keys
  const providers = [];

  if (process.env.ANTHROPIC_API_KEY && provider !== 'gemini' && provider !== 'openai') {
    providers.push('claude');
  }
  if (process.env.GEMINI_API_KEY && provider !== 'claude' && provider !== 'openai') {
    providers.push('gemini');
  }
  if (process.env.OPENAI_API_KEY && provider !== 'claude' && provider !== 'gemini') {
    providers.push('openai');
  }

  if (providers.length === 0) {
    return res.status(503).json({ error: 'No AI providers configured. Add API keys in Vercel environment variables.' });
  }

  let lastError = null;

  for (const p of providers) {
    try {
      let text = null;

      if (p === 'claude') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }]
          })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const err = new Error(e?.error?.message || `Claude HTTP ${r.status}`);
          err.status = r.status;
          err.overloaded = r.status === 529 || r.status === 503 || r.status === 429;
          throw err;
        }
        const d = await r.json();
        text = d.content?.[0]?.text || '';
      }

      else if (p === 'gemini') {
        const prompt = system + '\n\n' + user;
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: Math.min(maxTokens, 8192), temperature: 0.7 }
            })
          }
        );
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const err = new Error(e?.error?.message || `Gemini HTTP ${r.status}`);
          err.status = r.status;
          err.overloaded = r.status === 503 || r.status === 429;
          throw err;
        }
        const d = await r.json();
        text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      else if (p === 'openai') {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: Math.min(maxTokens, 4096),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ]
          })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const err = new Error(e?.error?.message || `OpenAI HTTP ${r.status}`);
          err.status = r.status;
          err.overloaded = r.status === 503 || r.status === 429;
          throw err;
        }
        const d = await r.json();
        text = d.choices?.[0]?.message?.content || '';
      }

      if (text) {
        return res.status(200).json({ text, provider: p });
      }
      throw new Error('Empty response from ' + p);

    } catch (err) {
      console.error(`Provider ${p} failed:`, err.message);
      lastError = err;
      // Only fall through on overload errors
      if (!err.overloaded && err.status !== 529 && err.status !== 503 && err.status !== 502) {
        // Hard error (auth, billing) — report immediately
        return res.status(err.status || 500).json({ error: err.message, provider: p });
      }
      // Overloaded — try next provider
      continue;
    }
  }

  return res.status(503).json({
    error: 'All AI providers are currently unavailable. Please try again in a moment.',
    details: lastError?.message
  });

  } catch (fatalErr) {
    console.error('Fatal handler error:', fatalErr);
    return res.status(500).json({ error: 'Internal server error: ' + fatalErr.message });
  }
}
