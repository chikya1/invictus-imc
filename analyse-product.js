export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mimeType } = req.body;
  if (!image || !mimeType) return res.status(400).json({ error: 'Missing image data' });

  const prompt = `You are an expert manufacturing consultant for Invictus IMC, an India-based managed manufacturing company. Analyse the product in this image and return a complete manufacturing breakdown.

Return ONLY valid JSON — no markdown, no explanation, no code fences. The JSON must exactly match this structure:

{
  "product_name": "Full product name and model if visible",
  "product_description": "One sentence describing the product and its primary use",
  "hsn_code": "4-digit HSN code for this product category",
  "made_in_india_potential": "High / Medium / Low",
  "primary_cluster": "Primary Indian industrial cluster for this product",
  "raw_materials": [
    {
      "material": "Material name",
      "used_for": "What part or component it becomes",
      "india_availability": "Available / Partially Available / Needs Import"
    }
  ],
  "manufacturing_stages": [
    {
      "process": "Name of the manufacturing process at this stage",
      "machine_required": "Primary machine or equipment needed",
      "india_cluster": "Best Indian city or cluster for this stage"
    }
  ],
  "localisation_entry_point": "Stage N onwards — e.g. Stage 3 onwards",
  "localisation_headline": "One line summary of localisation opportunity",
  "localisation_detail": "2-3 sentences explaining which stages can be done in India today, which clusters to target, and the estimated cost saving vs importing the finished product",
  "imc_recommendation": "A 3-4 sentence recommendation from Invictus IMC perspective — what we would do for a buyer who brings this product, which manufacturers we would match them with, and what the process would look like"
}

Be specific and accurate. Use real Indian industrial clusters (Pune-PCMC, Bengaluru-Hosur, Coimbatore, Delhi-NCR, Mumbai-Thane, Ahmedabad-Gujarat, Chennai, Ludhiana, Jamnagar, Aligarh, Noida etc.). Include 4-8 raw materials and 6-14 manufacturing stages depending on product complexity.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: image
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Anthropic API error');
    }

    const anthropicData = await response.json();
    const rawText = anthropicData.content[0].text.trim();

    const clean = rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Analysis error:', err);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'Could not parse analysis. Please try again with a clearer product image.' });
    }
    return res.status(500).json({ error: err.message || 'Analysis failed. Please try again.' });
  }
}
