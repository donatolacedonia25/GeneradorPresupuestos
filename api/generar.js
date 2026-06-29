const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const { tipo, datos, imagen } = req.body;

  // ── IMPORTAR ÍTEMS DESDE IMAGEN ──────────────────────────────
  if (tipo === 'importar_items') {
    try {
      if (!imagen || !imagen.base64) {
        return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `Analizá esta imagen de una tabla de precios (puede ser una captura de Excel, Google Sheets, o similar).

Extraé todos los ítems con sus cantidades y precios unitarios.

Respondé ÚNICAMENTE con un JSON válido, sin markdown ni texto adicional, con este formato exacto:
{
  "items": [
    { "nombre": "Nombre del ítem", "cantidad": 1, "precioUnitario": 50000 },
    { "nombre": "Otro ítem", "cantidad": 5, "precioUnitario": 12000 }
  ]
}

Reglas:
- El precio unitario debe ser un número sin símbolos ni puntos (ej: 50000, no $50.000)
- Si el precio aparece como total y hay una cantidad, calculá el precio unitario dividiendo
- Si no podés determinar la cantidad, usá 1
- Si no podés leer un precio, ponelo en 0
- Ignorá filas de totales, subtotales o encabezados
- Incluí todos los ítems que veas, incluyendo mano de obra o logística si aparecen`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: imagen.mimeType || 'image/jpeg',
            data: imagen.base64
          }
        }
      ]);

      const text = result.response.text().trim();

      // Limpiar posibles backticks de markdown
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'No se pudo parsear la respuesta de Gemini: ' + clean.substring(0, 200) });
      }

      const items = parsed.items || [];
      if (!Array.isArray(items)) {
        return res.status(200).json({ ok: false, error: 'Formato inesperado en la respuesta' });
      }

      return res.status(200).json({ ok: true, items });

    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error Gemini Vision: ' + e.message });
    }
  }

  // ── GENERAR TEXTO PRESUPUESTO ────────────────────────────────
  if (tipo === 'presupuesto') {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `Sos el redactor de 212 Paisajismo, empresa de paisajismo profesional en Mar del Plata, Argentina.
Redactá el contenido de un presupuesto de paisajismo con estos datos:

- Tipo de espacio: ${datos.tipoEspacio || ''}
- Objetivo: ${datos.objetivo || ''}
- Propuesta técnica: ${datos.propuesta || ''}
- Etapa del proyecto: ${datos.etapaProyecto || ''}

Estilo de redacción:
- Descripción: arrancá con "Tras la visita..." + contexto concreto del espacio
- Objetivos: primero lo paisajístico (cubrir muros, estructurar canteros, impacto visual), luego el beneficio práctico
- Propuesta: específica, nombrá las especies, disposición, técnica. Cerrá con: "El servicio incluye provisión, preparación del espacio y colocación final."
- Tono profesional y cercano, sin lenguaje marketinero. Párrafos de 2-4 oraciones.

Respondé ÚNICAMENTE con JSON válido sin markdown:
{
  "descripcion": "texto",
  "objetivos": "texto",
  "propuesta": "texto"
}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let contenido;
      try {
        contenido = JSON.parse(clean);
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'Error parseando respuesta: ' + clean.substring(0, 200) });
      }

      return res.status(200).json({ ok: true, contenido });

    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GENERAR TEXTO REPORTE ─────────────────────────────────────
  if (tipo === 'reporte') {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `Sos el redactor de 212 Paisajismo, empresa de paisajismo en Mar del Plata, Argentina.
Redactá un reporte de mantenimiento profesional con estos datos:

- Cliente: ${datos.nombreCliente || ''}
- Fecha de visita: ${datos.fechaVisita || ''}
- Ubicación: ${datos.ubicacion || ''}
- Tareas de rutina: ${datos.tareasRutina || ''}
- Trabajos específicos: ${datos.trabajosEspecificos || ''}
- Novedades/alertas: ${datos.novedades || ''}

Estilo: profesional pero cercano. Párrafos cortos. Sin exagerar.

Respondé ÚNICAMENTE con JSON válido sin markdown:
{
  "intro": "frase introductoria de 1 oración resumiendo la visita",
  "tareasRutinaTexto": "Tarea 1: descripción|||Tarea 2: descripción",
  "trabajosEspecificosTexto": "Sucursal/Sector: trabajo realizado|||Otro sector: trabajo realizado",
  "notaFinal": "novedad o alerta importante, o cadena vacía si no hay"
}

Para tareasRutinaTexto y trabajosEspecificosTexto separar cada ítem con |||`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let contenido;
      try {
        contenido = JSON.parse(clean);
      } catch (e) {
        return res.status(200).json({ ok: false, error: 'Error parseando respuesta: ' + clean.substring(0, 200) });
      }

      return res.status(200).json({ ok: true, contenido });

    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });
};
