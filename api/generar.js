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

function countWords(s) {
  return s ? s.trim().split(/\s+/).filter(Boolean).length : 0;
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

  // ============================================================
  //  IMPORTAR ÍTEMS DESDE UNA FOTO DEL EXCEL
  // ============================================================
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
Format: {"items":[{"nombre":"Item name","cantidad":1,"precioUnitario":50000,"grupo":""}]}
Rules:
- precioUnitario must be integer number only, no symbols
- If you see total price and quantity, calculate unit price = total / quantity
- If no quantity, use 1. If price unreadable, use 0
- Skip rows that are TOTAL, subtotal or column headers
- If the table groups rows under a section or sector heading, put that heading in "grupo" for each row under it. If there are no groupings, use "" for every row.
- If a row is labeled "EJECUCIÓN COMPLETA Y LOGÍSTICA" or similar (execution/logistics line with no per-unit quantity), set "cantidad":1, "grupo":"" and "precioUnitario" equal to that row's TOTAL value directly (do not divide it)
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

  // ============================================================
  //  PRESUPUESTO v2 — devuelve los campos de la plantilla nueva
  // ============================================================
  if (tipo === 'presupuesto_v2') {
    try {
      const r = await claudeRequest(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `You are a JSON API for Paisajismo 212, a landscaping company in Mar del Plata, Argentina.
RESPOND ONLY WITH VALID JSON. NO text before or after. NO markdown. NO explanation.

Format:
{"portada_titulo":"","diag_titulo":"","observaciones":["","",""],"prop_titulo":"","sectores":[{"nombre":"","accion":"","especies":""}],"foto_epigrafe":"","alcance_linea":"","cierre_titulo":"","siguiente_paso":"","agradecimiento":""}

Write everything in Argentine Spanish, using "vos" (not "tú"), addressing the client directly.

RAW CONTEXT from the site visit (may be informal and unordered):
${datos && datos.contexto ? datos.contexto : ''}

Client first name (for the closing line only): ${datos && datos.cliente ? datos.cliente : ''}
Project title hint (optional): ${datos && datos.etapaProyecto ? datos.etapaProyecto : ''}

FIELD RULES — each one is a hard constraint, not a suggestion:

"portada_titulo": MAXIMUM 8 WORDS. Affirms a benefit the client will get, in their own terms. Never the name of the service. Ends with a period. Examples of the right register: "El frente que se ve cuidado todo el año." / "Un patio que se usa, no que se mira."

"diag_titulo": ONE line, max 8 words, states that the space was read and understood before proposing. Not a complaint about the space.

"observaciones": EXACTLY 3 strings, or fewer if the context does not support 3. Each one is ONE sentence, maximum 18 words, stating a concrete fact observed on site: light, soil, drainage, existing condition, the view the client has. Factual, no adjectives of value, no proposed solution. All three combined must stay under 45 words.

"prop_titulo": max 8 words, affirms the shape of the solution.

"sectores": 1 to 3 objects, ONLY for sectors clearly present in the context.
  - "nombre": 2-4 words naming the physical area the client would recognize.
  - "accion": ONE sentence, MAXIMUM 12 WORDS, active voice, first person plural, present tense. Starts with the verb of what WE do. Correct: "Alineamos el frente con dos Lagerstroemia y cerramos el borde." Wrong: "Se propone incorporar Lagerstroemia" / "El frente será alineado".
  - "especies": species names only, separated by " · ", no quantities, no sentences. Empty string if the context names none.

"foto_epigrafe": ONE line describing what the reference image shows, max 14 words.

"alcance_linea": 3 to 6 words separated by " · " describing scope. Example: "Proyecto integral · 1 jornada · llave en mano". Infer the number of workdays only if the context states it; otherwise omit that part.

"cierre_titulo": max 8 words, leaves the decision open and easy. Not a question.

"siguiente_paso": ONE sentence with a verb, describing the single action the client takes next. Example: "Confirmás por WhatsApp y agendamos la jornada."

"agradecimiento": ONE line, uses the client's first name if provided, no flattery.

GLOBAL BANS — violating any of these invalidates the response:
- FORBIDDEN WORDS anywhere: "se propone", "se sugiere", "se realizará", "apasionado", "sueño", "mágico", "oasis", "rincón", "espacios que inspiran", "soluciones a medida", "aproximadamente".
- NEVER invent a number. No square metres, no counts of plants, no prices, no years. If the context gives no number, use none.
- NEVER repeat the client's name or address except in "agradecimiento".
- PLAIN TEXT ONLY: no markdown, no bold, no bullets, no emojis, no colons used as labels.
- No sentence may exceed 20 words anywhere in the response.

ONLY JSON. START WITH {`
        }]
      });

      const c = parseJSON(extractText(r));

      const PROHIBIDAS = /\b(se propone|se sugiere|se realizará|apasionad\w*|sueño|mágico|oasis|espacios que inspiran|aproximadamente)\b/gi;
      const limpiar = (s, maxPal) => {
        let t = stripMarkdown(String(s || '')).replace(PROHIBIDAS, '').replace(/\s{2,}/g, ' ').trim();
        return maxPal ? limitWords(t, maxPal) : t;
      };

      const salida = {
        portada_titulo: limpiar(c.portada_titulo, 8),
        diag_titulo:    limpiar(c.diag_titulo, 8),
        observaciones:  (Array.isArray(c.observaciones) ? c.observaciones : [])
                          .map(o => limpiar(o, 18)).filter(Boolean).slice(0, 3),
        prop_titulo:    limpiar(c.prop_titulo, 8),
        sectores:       (Array.isArray(c.sectores) ? c.sectores : [])
                          .filter(x => x && (x.nombre || x.accion))
                          .slice(0, 3)
                          .map(x => ({
                            nombre:   limpiar(x.nombre, 4),
                            accion:   limpiar(x.accion, 12),
                            especies: limpiar(x.especies)
                          })),
        foto_epigrafe:   limpiar(c.foto_epigrafe, 14),
        alcance_linea:   limpiar(c.alcance_linea),
        cierre_titulo:   limpiar(c.cierre_titulo, 8),
        siguiente_paso:  limpiar(c.siguiente_paso, 16),
        agradecimiento:  limpiar(c.agradecimiento, 20)
      };

      const avisos = [];
      if (countWords(salida.observaciones.join(' ')) > 45) avisos.push('Las observaciones superan 45 palabras: acortalas antes de enviar.');
      if (!salida.sectores.length) avisos.push('No se identificaron sectores en las notas. Cargalos a mano.');

      return res.status(200).json({ ok: true, contenido: salida, avisos });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ============================================================
  //  PRESUPUESTO (versión vieja — se conserva funcionando)
  // ============================================================
  if (tipo === 'presupuesto') {
    try {
      const r = await claudeRequest(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `You are a JSON API for 212 Paisajismo, a landscaping company in Mar del Plata, Argentina.
RESPOND ONLY WITH VALID JSON. NO text before or after. NO markdown. NO explanation.
Format: {"intro":"text","items":[{"titulo":"Zona o tarea","texto":"text"}],"cierre":"text"}

Write in Spanish. Use this data as raw context (may be long, unordered, informal):
- Etapa / título del proyecto: ${datos && datos.etapaProyecto ? datos.etapaProyecto : ''}
- Contexto completo (tipo de espacio, objetivo, propuesta técnica, especies, etapa, lo que aporte el usuario): ${datos && datos.contexto ? datos.contexto : ''}
(Ubicación y nombre del cliente ya aparecen en otra parte del documento: NUNCA los repitas ni los menciones en el texto.)

This is a structured proposal document, not a single wall of text. Break the content into three clearly separate parts:

1. "intro": ONE short paragraph (2-4 sentences) that opens with a variation of "Tras acercarnos y realizar la visita al espacio..." or "Tras la visita al espacio..." (never naming the address or the project title again) and states what was found and the general objective of the project. Do not go into technical detail here — that goes in "items" or "cierre".

2. "items": an array used ONLY when the context clearly describes multiple distinct sectors, zones, or separate tasks (e.g. "sector de pileta", "frente de la casa", "trasplantes", "cerco vivo"). Each entry = {"titulo": short 2-4 word label for that zone/task, "texto": 1-3 sentences describing the technical proposal for that zone specifically — species, techniques, materials}. If the context describes a single unified space with no clearly separate zones, return items as an empty array [] and instead put all technical detail (species, techniques) inside "cierre".

3. "cierre": ONE short closing paragraph. If "items" was used, this paragraph should NOT repeat the species/technique detail already given per zone. If "items" was empty, this paragraph carries the technical proposal (species, techniques) first. Either way, this paragraph MUST end by stating the scope of the service in these exact terms (paraphrased naturally, not verbatim): that the budget includes labor, transport logistics, and the technical preparation of the terrain, in addition to the plant/material supply already detailed in the proposal. This replaces a separate "Alcance del servicio" section — it must always be present here, briefly, as the closing sentence(s).

Style rules (apply to intro, items[].texto and cierre):
- Tone: professional and close ("cercano"), like a landscaping proposal — never marketing language, never generic AI phrasing.
- Each paragraph must read like something a person typed directly, with clear sentence breaks — never one long unbroken sentence.
- PLAIN TEXT ONLY. Never use markdown formatting: no **bold**, no *italics*, no # headers, no "-" or "*" bullet lists, no colons used as list markers.
- HARD LIMIT: entre los tres campos combinados ("intro" + todos los "items" + "cierre"), nunca superes 170 palabras en total. Resumí y priorizá lo esencial.

ONLY JSON. START WITH {`
        }]
      });

      const contenido = parseJSON(extractText(r));
      contenido.intro = stripMarkdown(contenido.intro || '');
      contenido.cierre = stripMarkdown(contenido.cierre || '');
      contenido.items = Array.isArray(contenido.items)
        ? contenido.items
            .filter(it => it && (it.titulo || it.texto))
            .map(it => ({ titulo: stripMarkdown(it.titulo || ''), texto: stripMarkdown(it.texto || '') }))
        : [];

      // Red de seguridad de longitud total (intro + items + cierre) a 170 palabras,
      // recortando primero el cierre, luego los items, y por último la intro.
      const totalPalabras = () =>
        countWords(contenido.intro) +
        contenido.items.reduce((s, it) => s + countWords(it.texto), 0) +
        countWords(contenido.cierre);

      let sobra = totalPalabras() - 170;
      if (sobra > 0) {
        contenido.cierre = limitWords(contenido.cierre, Math.max(0, countWords(contenido.cierre) - sobra));
        sobra = totalPalabras() - 170;
      }
      if (sobra > 0 && contenido.items.length) {
        contenido.items = contenido.items.map(it => {
          if (sobra <= 0) return it;
          const nuevoLen = Math.max(0, countWords(it.texto) - sobra);
          const recortado = limitWords(it.texto, nuevoLen);
          sobra -= (countWords(it.texto) - countWords(recortado));
          return { ...it, texto: recortado };
        });
      }
      if (sobra > 0) {
        contenido.intro = limitWords(contenido.intro, Math.max(0, countWords(contenido.intro) - sobra));
      }

      return res.status(200).json({ ok: true, contenido });

    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ============================================================
  //  REPORTE DE MANTENIMIENTO
  // ============================================================
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
- Cliente: ${datos && datos.nombreCliente ? datos.nombreCliente : ''}
- Fecha: ${datos && datos.fechaVisita ? datos.fechaVisita : ''}
- Ubicación: ${datos && datos.ubicacion ? datos.ubicacion : ''}
- Intervenciones específicas realizadas (formato "Título: dato breve que anotó el operario"), una por línea:
${datos && datos.trabajosEspecificos ? datos.trabajosEspecificos : '(ninguna)'}
- Alertas o detecciones (formato "Título: dato breve que anotó el operario"), una por línea:
${datos && datos.novedades ? datos.novedades : '(ninguna)'}

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
