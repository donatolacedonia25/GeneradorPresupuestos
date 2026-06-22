export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada' });

  const { tipo, datos } = req.body;

  let prompt = '';

  if (tipo === 'presupuesto') {
    prompt = `Sos redactor de presupuestos de paisajismo para 212 Paisajismo, empresa profesional de Mar del Plata, Argentina, con 18 años de trayectoria.

Datos del proyecto:
- Cliente: ${datos.nombreCliente}
- Ubicación: ${datos.ubicacion}
- Tipo de espacio: ${datos.tipoEspacio}
- Descripción del espacio y situación: ${datos.descripcionEspacio}
- Objetivo principal del cliente: ${datos.objetivo}
- Propuesta técnica (especies, disposición, técnica): ${datos.propuesta}
- Etapa o título del proyecto: ${datos.etapaProyecto || 'Propuesta de Paisajismo'}

Generá exactamente 3 secciones en JSON con este formato (sin markdown, sin explicaciones, solo JSON):
{
  "descripcion": "párrafo de descripción del proyecto (2-4 oraciones). Empezar con 'Tras la visita,' + contexto concreto del espacio. Mencionar el objetivo visual o funcional del espacio.",
  "objetivos": "párrafo de objetivos paisajísticos (2-3 oraciones). Primero lo paisajístico (cubrir, estructurar, generar impacto), luego el beneficio práctico (bajo mantenimiento, imagen, experiencia del usuario).",
  "propuesta": "párrafo de propuesta técnica (3-5 oraciones). Específico: nombrar las especies, disposición, técnica. Cerrar siempre con: 'El servicio incluye provisión, preparación del espacio y colocación final.'"
}

Tono: profesional y cercano, directo, sin lenguaje marketinero ni relleno. Comunicación humana y genuina. En español rioplatense, tratamiento de 'vos' si es necesario dirigirse al cliente.`;
  }

  if (tipo === 'reporte') {
    prompt = `Sos redactor de reportes de mantenimiento para 212 Paisajismo, empresa de Mar del Plata, Argentina.

Datos de la visita:
- Cliente: ${datos.nombreCliente}
- Fecha: ${datos.fechaVisita}
- Ubicación/sucursales: ${datos.ubicacion}
- Tareas de rutina realizadas: ${datos.tareasRutina}
- Trabajos específicos realizados: ${datos.trabajosEspecificos}
- Novedades o alertas detectadas: ${datos.novedades || 'Ninguna'}

Generá el contenido del reporte en JSON (sin markdown, sin explicaciones, solo JSON):
{
  "intro": "Una oración introductoria que resume la visita (ej: 'Resumen de los trabajos realizados en nuestra última visita...')",
  "tareasRutinaTexto": "Descripción breve de las tareas de rutina realizadas. Formato: lista de items como string separados por ||| (triple pipe). Cada item: 'Nombre tarea: descripción concisa.'",
  "trabajosEspecificosTexto": "Trabajos específicos. Mismo formato: items separados por ||| con 'Nombre trabajo: descripción.'",
  "notaFinal": "Si hay novedades importantes, una oración de cierre sobre ello. Si no hay novedades, devolver string vacío."
}

Tono: profesional y claro. Directo. En español.`;
  }

  try {
    const response = await fetch(
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

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Error Gemini' });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json({ ok: true, contenido: parsed });
    } catch {
      return res.status(200).json({ ok: true, contenido: { raw: text } });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
