const https = require('https');

const GEMINI_MODEL = 'gemini-1.5-flash';

function geminiRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('Respuesta inválida de Gemini: ' + raw.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractText(geminiResponse) {
  try {
    return geminiResponse.candidates[0].content.parts[0].text.trim();
  } catch(e) {
    throw new Error('No se pudo extraer texto de Gemini: ' + JSON.stringify(geminiResponse).substring(0, 200));
  }
}

function parseJSON(text) {
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(clean); }
  catch(e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('JSON inválido: ' + clean.substring(0, 150));
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY no configurada' });

  const { tipo, datos, imagen } = req.body;

  // ── IMPORTAR ÍTEMS DESDE IMAGEN ──────────────────────────
  if (tipo === 'importar_items') {
    try {
      if (!imagen || !imagen.base64) {
        return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
      }

      const prompt = `Analizá esta imagen de una tabla de precios (Excel, Google Sheets o similar).
Extraé todos los ítems con sus cantidades y precios unitarios.
Devolvé SOLO un JSON válido con este formato exacto, sin texto adicional:
{"items":[{"nombre":"Nombre del ítem","cantidad":1,"precioUnitario":50000}]}
Reglas:
- precioUnitario es número entero sin símbolos (50000 no $50.000)
- Si ves precio total y cantidad, calculá precio unitario = total / cantidad
- Si no hay cantidad usá 1. Si no podés leer el precio ponelo en 0
- Ignorá filas de TOTAL, subtotal o encabezados de columna`;

      const body = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: imagen.mimeType || 'image/jpeg', data: imagen.base64 } }
          ]
        }],
      };

      const geminiRes = await geminiRequest(apiKey, body);
      const text = extractText(geminiRes);
      const parsed = parseJSON(text);
      const items = parsed.items || [];
      return res.status(200).json({ ok: true, items });

    } catch(e) {
      return res.status(500).json({ ok: false, error: 'Error Vision: ' + e.message });
    }
  }

  // ── PRESUPUESTO ───────────────────────────────────────────
  if (tipo === 'presupuesto') {
    try {
      const prompt = `Sos el redactor de 212 Paisajismo, empresa de paisajismo en Mar del Plata, Argentina.
Redactá contenido para un presupuesto con estos datos:
- Tipo de espacio: ${datos.tipoEspacio || ''}
- Objetivo: ${datos.objetivo || ''}
- Propuesta técnica: ${datos.propuesta || ''}
- Etapa: ${datos.etapaProyecto || ''}

Estilo: profesional y cercano, sin lenguaje marketinero.
- Descripción: arrancá con "Tras la visita..." + contexto concreto
- Objetivos: primero lo paisajístico, luego el beneficio práctico
- Propuesta: específica con especies y técnica. Cerrá con "El servicio incluye provisión, preparación del espacio y colocación final."

Devolvé SOLO JSON válido:
{"descripcion":"texto","objetivos":"texto","propuesta":"texto"}`;

      const body = {
        contents: [{ parts: [{ text: prompt }] }],
      };

      const geminiRes = await geminiRequest(apiKey, body);
      const text = extractText(geminiRes);
      const contenido = parseJSON(text);
      return res.status(200).json({ ok: true, contenido });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── REPORTE ───────────────────────────────────────────────
  if (tipo === 'reporte') {
    try {
      const prompt = `Sos el redactor de 212 Paisajismo, empresa de paisajismo en Mar del Plata, Argentina.
Redactá un reporte de mantenimiento con estos datos:
- Cliente: ${datos.nombreCliente || ''}
- Fecha: ${datos.fechaVisita || ''}
- Ubicación: ${datos.ubicacion || ''}
- Tareas de rutina: ${datos.tareasRutina || ''}
- Trabajos específicos: ${datos.trabajosEspecificos || ''}
- Novedades: ${datos.novedades || ''}

Estilo: profesional pero cercano. Párrafos cortos.

Devolvé SOLO JSON válido:
{"intro":"frase de 1 oración resumiendo la visita","tareasRutinaTexto":"Tarea 1: descripción|||Tarea 2: descripción","trabajosEspecificosTexto":"Sector: trabajo|||Sector: trabajo","notaFinal":"novedad importante o cadena vacía"}
Separar ítems con |||`;

      const body = {
        contents: [{ parts: [{ text: prompt }] }],
      };

      const geminiRes = await geminiRequest(apiKey, body);
      const text = extractText(geminiRes);
      const contenido = parseJSON(text);
      return res.status(200).json({ ok: true, contenido });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });
};
