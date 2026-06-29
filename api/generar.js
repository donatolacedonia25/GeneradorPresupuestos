const https = require('https');

function claudeRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('Respuesta inválida: ' + raw.substring(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractText(r) {
  try { return r.content[0].text.trim(); }
  catch(e) { throw new Error(JSON.stringify(r).substring(0, 300)); }
}

function parseJSON(text) {
  const clean = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  try { return JSON.parse(clean); }
  catch(e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch(e2) {} }
    const m2 = clean.match(/\[[\s\S]*\]/);
    if (m2) { try { return JSON.parse(m2[0]); } catch(e3) {} }
    throw new Error('JSON inválido: ' + clean.substring(0, 150));
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' });

  const { tipo, datos, imagen } = req.body;

  if (tipo === 'importar_items') {
    try {
      if (!imagen || !imagen.base64) return res.status(400).json({ ok: false, error: 'No se recibió imagen' });

      const r = await claudeRequest(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imagen.mimeType || 'image/jpeg',
                data: imagen.base64
              }
            },
            {
              type: 'text',
              text: `You are a JSON API. Analyze this price table image and extract all items.
RESPOND ONLY WITH VALID JSON. NO text before or after. NO markdown. NO explanation.
Format: {"items":[{"nombre":"Item name","cantidad":1,"precioUnitario":50000}]}
Rules:
- precioUnitario must be integer number only, no symbols
- If you see total price and quantity, calculate unit price = total / quantity
- If no quantity, use 1. If price unreadable, use 0
- Skip rows that are TOTAL, subtotal or column headers
ONLY JSON. START WITH {`
            }
          ]
        }]
      });

      const items = parseJSON(extractText(r)).items || [];
      return res.status(200).json({ ok: true, items });

    } catch(e) {
      return res.status(500).json({ ok: false, error: 'Error Vision: ' + e.message });
    }
  }

  if (tipo === 'presupuesto') {
    try {
      const r = await claudeRequest(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are a JSON API for 212 Paisajismo, a landscaping company in Mar del Plata, Argentina.
RESPOND ONLY WITH VALID JSON. NO text before or after. NO markdown. NO explanation.
Format: {"descripcion":"text","objetivos":"text","propuesta":"text"}

Write in Spanish. Use this data:
- Tipo de espacio: ${datos.tipoEspacio || ''}
- Objetivo: ${datos.objetivo || ''}
- Propuesta técnica: ${datos.propuesta || ''}
- Etapa: ${datos.etapaProyecto || ''}

Style rules:
- descripcion: start with "Tras la visita..." + concrete context
- objetivos: first landscaping goals, then practical benefit
- propuesta: specific with species and technique, end with "El servicio incluye provisión, preparación del espacio y colocación final."
- Tone: professional and close, no marketing language

ONLY JSON. START WITH {`
        }]
      });

      const contenido = parseJSON(extractText(r));
      return res.status(200).json({ ok: true, contenido });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (tipo === 'reporte') {
    try {
      const r = await claudeRequest(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are a JSON API for 212 Paisajismo, a landscaping company in Mar del Plata, Argentina.
RESPOND ONLY WITH VALID JSON. NO text before or after. NO markdown. NO explanation.
Format: {"intro":"text","tareasRutinaTexto":"Task 1: desc|||Task 2: desc","trabajosEspecificosTexto":"Sector: work|||Sector: work","notaFinal":"text or empty string"}

Write in Spanish. Use this data:
- Cliente: ${datos.nombreCliente || ''}
- Fecha: ${datos.fechaVisita || ''}
- Ubicación: ${datos.ubicacion || ''}
- Tareas de rutina: ${datos.tareasRutina || ''}
- Trabajos específicos: ${datos.trabajosEspecificos || ''}
- Novedades: ${datos.novedades || ''}

Style: professional but close. Short paragraphs. Separate items with |||
ONLY JSON. START WITH {`
        }]
      });

      const contenido = parseJSON(extractText(r));
      return res.status(200).json({ ok: true, contenido });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });
};
