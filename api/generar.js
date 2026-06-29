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

      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const prompt = `Analizá esta imagen de una tabla de precios (Excel, Google Sheets o similar).
Extraé todos los ítems con sus cantidades y precios unitarios.
Devolvé un JSON con este formato exacto:
{
  "items": [
    { "nombre": "Nombre del ítem", "cantidad": 1, "precioUnitario": 50000 }
  ]
}
Reglas:
- precioUnitario es un número entero sin símbolos (50000, no $50.000)
- Si ves precio total y cantidad, calculá precio unitario = total / cantidad
- Si no hay cantidad, usá 1
- Si no podés leer el precio, ponelo en 0
- Ignorá filas de TOTAL, subtotal o encabezados de columna
- Incluí mano de obra o logística si aparece`;

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

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Intento de rescate: buscar JSON dentro del texto
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch(e2) {
            return res.status(200).json({ ok: false, error: 'Respuesta de Gemini no es JSON válido: ' + text.substring(0, 150) });
          }
        } else {
          return res.status(200).json({ ok: false, error: 'Respuesta de Gemini no es JSON válido: ' + text.substring(0, 150) });
        }
      }

      const items = parsed.items || [];
      return res.status(200).json({ ok: true, items });

    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error Gemini Vision: ' + e.message });
    }
  }

  // ── GENERAR TEXTO PRESUPUESTO ────────────────────────────────
  if (tipo === 'presupuesto') {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

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

Devolvé un JSON con este formato:
{ "descripcion": "texto", "objetivos": "texto", "propuesta": "texto" }`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const contenido = JSON.parse(text);
      return res.status(200).json({ ok: true, contenido });

    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GENERAR TEXTO REPORTE ─────────────────────────────────────
  if (tipo === 'reporte') {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const prompt = `Sos el redactor de 212 Paisajismo, empresa de paisajismo en Mar del Plata, Argentina.
Redactá un reporte de mantenimiento profesional con estos datos:

- Cliente: ${datos.nombreCliente || ''}
- Fecha de visita: ${datos.fechaVisita || ''}
- Ubicación: ${datos.ubicacion || ''}
- Tareas de rutina: ${datos.tareasRutina || ''}
- Trabajos específicos: ${datos.trabajosEspecificos || ''}
- Novedades/alertas: ${datos.novedades || ''}

Estilo: profesional pero cercano. Párrafos cortos. Sin exagerar.

Devolvé un JSON con este formato:
{
  "intro": "frase introductoria de 1 oración resumiendo la visita",
  "tareasRutinaTexto": "Tarea 1: descripción|||Tarea 2: descripción",
  "trabajosEspecificosTexto": "Sucursal/Sector: trabajo realizado|||Otro sector: trabajo realizado",
  "notaFinal": "novedad o alerta importante, o cadena vacía si no hay"
}
Separar cada ítem con |||`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const contenido = JSON.parse(text);
      return res.status(200).json({ ok: true, contenido });

    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });
};
