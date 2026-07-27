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

// Recorta a N palabras como red de seguridad, por si el modelo se pasa del límite.
function limitWords(str, n) {
  if (!str) return str;
  const words = str.trim().split(/\s+/);
  if (words.length <= n) return str.trim();
  return words.slice(0, n).join(' ') + '…';
}

// Red de seguridad: saca markdown (**, *, #) por si el modelo lo devuelve pese a la instrucción.
function stripMarkdown(str) {
  if (!str) return str;
  return str.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s?/gm, '').trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
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
- If a row is labeled "EJECUCIÓN COMPLETA Y LOGÍSTICA" or similar (execution/logistics line with no per-unit quantity), set "cantidad":1 and "precioUnitario" equal to that row's TOTAL value directly (do not divide it)
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
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: `You are a JSON API for 212 Paisajismo, a landscaping company in Mar del Plata, Argentina.
RESPOND ONLY WITH VALID JSON. NO text before or after. NO markdown. NO explanation.
Format: {"descripcion":"text"}

Write in Spanish. Use this data as raw context (may be long, unordered, informal):
- Ubicación: ${datos.ubicacion || ''}
- Etapa / título del proyecto: ${datos.etapaProyecto || ''}
- Contexto completo (tipo de espacio, objetivo, propuesta técnica, especies, etapa, lo que aporte el usuario): ${datos.contexto || ''}

Style rules for "descripcion":
- ONE single persuasive paragraph (or a short paragraph plus a brief bulleted breakdown by sector if the context describes multiple distinct sectors/zones — mirror the tone of a landscaping proposal, not a marketing pitch).
- Start with something like "Tras el relevamiento del espacio..." or "Tras la visita..." + concrete context.
- Cover: what was found, the objective, the technical proposal (species, techniques), and close with what the service includes (provisión, preparación del espacio, colocación final).
- Tone: professional and close, no marketing language, no generic AI phrasing.
- PLAIN TEXT ONLY. Never use markdown formatting: no **bold**, no *italics*, no # headers, no "-" or "*" bullet lists. Write it as flowing prose a human would type directly into a document, with no formatting symbols at all.
- HARD LIMIT: máximo 160 palabras en total. Si el contexto es extenso, resumí y priorizá lo esencial — nunca superes 160 palabras.

ONLY JSON. START WITH {`
        }]
      });

      const contenido = parseJSON(extractText(r));
      contenido.descripcion = limitWords(stripMarkdown(contenido.descripcion), 160);
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
Format: {"intro":"text","trabajosEspecificosTexto":"Título: frase|||Título: frase","alertasTexto":"Título: frase|||Título: frase or empty string"}

Write in Spanish. Use this data:
- Cliente: ${datos.nombreCliente || ''}
- Fecha: ${datos.fechaVisita || ''}
- Ubicación: ${datos.ubicacion || ''}
- Intervenciones específicas realizadas (formato "Título: dato breve que anotó el operario"), una por línea:
${datos.trabajosEspecificos || '(ninguna)'}
- Alertas o detecciones (formato "Título: dato breve que anotó el operario"), una por línea:
${datos.novedades || '(ninguna)'}

Task for "trabajosEspecificosTexto": for each line in "Intervenciones específicas", write ONE short executive sentence that naturally combines the título and the dato into a finished phrase, same order, separated by |||. If there are no lines, use empty string "".
Task for "alertasTexto": for each line in "Alertas o detecciones", write ONE short sentence. If the título is "Oportunidad de expansión detectada", phrase it as a commercial opportunity (a possible new job), not as a problem. The rest (plaga/hongo, falla en infraestructura, estrés agudo) should be phrased as a protective/informative alert, calm and factual, no alarmism. Same order, separated by |||. If there are no lines, use empty string "".

Style rules (apply to intro, trabajosEspecificosTexto and alertasTexto):
- Tone: professional but close ("cercano"), moderate — no excesos técnicos, no exagerar en extensión.
- Each item in trabajosEspecificosTexto/alertasTexto: one sentence, roughly 12-25 words. Do not repeat the título verbatim as a label — weave it into the sentence.
- "intro": one short paragraph (2-3 sentences) summarizing the visit in general terms.
- PLAIN TEXT ONLY. Never use markdown: no **bold**, no *italics*, no # headers, no bullet symbols.

ONLY JSON. START WITH {`
        }]
      });

      const contenido = parseJSON(extractText(r));
      contenido.intro = stripMarkdown(contenido.intro);
      contenido.trabajosEspecificosTexto = stripMarkdown(contenido.trabajosEspecificosTexto);
      contenido.alertasTexto = stripMarkdown(contenido.alertasTexto);
      return res.status(200).json({ ok: true, contenido });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });
};
