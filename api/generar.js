export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY no configurada en Vercel' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Body inválido' });
  }

  const { tipo, datos } = body || {};
  if (!tipo || !datos) return res.status(400).json({ ok: false, error: 'Faltan campos tipo o datos' });

  let prompt = '';

  if (tipo === 'presupuesto') {
    prompt = `Sos redactor de presupuestos de paisajismo para 212 Paisajismo, empresa profesional de Mar del Plata, Argentina, con 18 años de trayectoria.

Datos del proyecto:
- Cliente: ${datos.nombreCliente || ''}
- Ubicación: ${datos.ubicacion || ''}
- Tipo de espacio: ${datos.tipoEspacio || ''}
- Objetivo principal del cliente: ${datos.objetivo || ''}
- Propuesta técnica (especies, disposición, técnica): ${datos.propuesta || ''}
- Etapa o título del proyecto: ${datos.etapaProyecto || 'Propuesta de Paisajismo'}

Generá exactamente 3 secciones en JSON con este formato. Respondé SOLO con el JSON, sin markdown, sin bloques de código, sin explicaciones:
{
  "descripcion": "párrafo de descripción del proyecto (2-4 oraciones). Empezar con 'Tras la visita,' + contexto concreto del espacio. Mencionar el objetivo visual o funcional.",
  "objetivos": "párrafo de objetivos paisajísticos (2-3 oraciones). Primero lo paisajístico, luego el beneficio práctico.",
  "propuesta": "párrafo de propuesta técnica (3-5 oraciones). Nombrar especies, disposición, técnica. Cerrar con: 'El servicio incluye provisión, preparación del espacio y colocación final.'"
}

Tono: profesional y cercano, directo, sin relleno. En español rioplatense.`;
  }

  if (tipo === 'reporte') {
    prompt = `Sos redactor de reportes de mantenimiento para 212 Paisajismo, empresa de Mar del Plata, Argentina.

Datos de la visita:
- Cliente: ${datos.nombreCliente || ''}
- Fecha: ${datos.fechaVisita || ''}
- Ubicación: ${datos.ubicacion || ''}
- Tareas de rutina: ${datos.tareasRutina || ''}
- Trabajos específicos: ${datos.trabajosEspecificos || ''}
- Novedades o alertas: ${datos.novedades || 'Ninguna'}

Respondé SOLO con JSON, sin markdown ni bloques de código:
{
  "intro": "Una oración que resume la visita.",
  "tareasRutinaTexto": "Items separados por ||| . Cada item: 'Nombre: descripción.'",
  "trabajosEspecificosTexto": "Items separados por ||| . Cada item: 'Nombre: descripción.'",
  "notaFinal": "Si hay novedades importantes, una oración. Si no, string vacío."
}

Tono: profesional, directo. En español.`;
  }

  if (!prompt) return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      const errMsg = geminiData?.error?.message || JSON.stringify(geminiData);
      return res.status(500).json({ ok: false, error: 'Gemini: ' + errMsg });
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json({ ok: true, contenido: parsed });
    } catch {
      // Si no parsea como JSON, devolver el texto crudo igual
      return res.status(200).json({ ok: true, contenido: { descripcion: clean, objetivos: '', propuesta: '' } });
    }

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Error de red: ' + err.message });
  }
}
