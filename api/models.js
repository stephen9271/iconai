// api/models.js — Check available OpenAI models
export const config = { maxDuration: 10 };
 
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ error: 'No API key', image_models: [] });
  }
 
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    const d = await r.json();
    const imageModels = (d.data || [])
      .filter(m => m.id.includes('dall') || m.id.includes('image'))
      .map(m => m.id);
    return res.status(200).json({ image_models: imageModels });
  } catch (e) {
    return res.status(200).json({ error: e.message, image_models: [] });
  }
}
