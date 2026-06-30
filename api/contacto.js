const https = require('https');
const fs = require('fs');
const path = require('path');

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

function loadInstrucciones() {
  try {
    const filePath = path.join(process.cwd(), 'instrucciones.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch(e) {
    return {
      identidad: { empresa: 'Paisajismo 212 / Vivero 212', ciudad: 'Mar del Plata, Argentina', historia: '18 años de historia.', clientes_referencia: ['Shell', 'Burgwagen', 'Shopping Aldrey', 'Green Mug Café', 'Tampico'] },
      voz: { tono: 'Cálido, directo, humano.', maximo_palabras_wa: 150, maximo_palabras_mail: 200, parrafos_max_lineas: 4 },
      reglas_absolutas: ['Escribir como persona real, no sistema de marketing', 'NUNCA usar: soluciones integrales, nos especializamos en, quedamos a disposición', 'NUNCA listar servicios en primer contacto'],
      reglas_por_toque: {},
      canal_por_rubro: {},
      ejemplos_buenos: [],
      correcciones: [],
      firmas: { Donato: 'Donato\nRelaciones y Desarrollo Comercial — Paisajismo 212\n@paisajismo212 | 223 512-8743' }
    };
  }
}

function buildSystemPrompt(inst) {
  const id = inst.identidad || {};
  const refs = (id.clientes_referencia || []).join(', ');
  const reglas = (inst.reglas_absolutas || []).map(r => `- ${r}`).join('\n');
  const correcciones = (inst.correcciones || []).length > 0
    ? '\nCORRECCIONES ESPECÍFICAS:\n' + inst.correcciones.map(c => `- ${c}`).join('\n') : '';
  const ejemplos = (inst.ejemplos_buenos || []).length > 0
    ? '\nEJEMPLOS QUE FUNCIONARON (tomá el estilo, no el texto):\n' +
      inst.ejemplos_buenos.map(e =>
        `[${e._descripcion || 'ejemplo'}]${e.asunto ? '\nASUNTO: ' + e.asunto : ''}\n${e.mensaje}`
      ).join('\n\n---\n\n') : '';
  const firmas = Object.entries(inst.firmas || {})
    .map(([n, f]) => `- ${n}: "${f.replace(/\n/g, ' / ')}"`)
    .join('\n');

  return `Sos el redactor comercial de ${id.empresa || 'Paisajismo 212'}, empresa familiar de paisajismo en ${id.ciudad || 'Mar del Plata'}.

HISTORIA Y EQUIPO: ${id.historia || '18 años de historia.'}
CLIENTES REFERENCIA: ${refs}

VOZ Y TONO: ${(inst.voz || {}).tono || 'Cálido, directo, humano.'}
Máximo ${(inst.voz || {}).maximo_palabras_wa || 150} palabras WA, ${(inst.voz || {}).maximo_palabras_mail || 200} mail. Párrafos de ${(inst.voz || {}).parrafos_max_lineas || 4} líneas max.

REGLAS ABSOLUTAS:
${reglas}${correcciones}

FIRMAS:
${firmas}
${ejemplos}

OUTPUT: SOLO el mensaje listo. Si mail → primera línea "ASUNTO: [asunto]", línea en blanco, cuerpo. Sin explicaciones.`;
}

function buildUserPrompt(tipo, datos, inst) {
  const { lead, ctx, toque } = datos;
  const reglaToque = ((inst.reglas_por_toque || {})[`toque_${toque || 1}`] || '');
  const canalSugerido = ((inst.canal_por_rubro || {})[lead && lead.rubro] || 'según criterio');

  if (tipo === 'mensaje_lead') {
    return `LEAD DEL CRM:
Empresa: ${lead.empresa}
Contacto: ${lead.contacto}
Estado: ${lead.estado}
Rubro: ${lead.rubro}
Canal: ${lead.canal || canalSugerido}
Acción pendiente: ${lead.accion || 'primer contacto'}
Días sin contacto: ${lead.dias || 0}
Valor: ${lead.valor || 'sin dato'}
Notas: ${lead.notas || 'sin notas'}
${ctx ? 'Contexto adicional: ' + ctx : ''}

TOQUE: ${toque || 1}
${reglaToque ? 'REGLA PARA ESTE TOQUE: ' + reglaToque : ''}

TAREA:
- NUEVO / Mail 1 / WPP 1: presentación. Personalizá con algo de las notas. Si hay "warm" o "Red Donato": tono directo, mencioná la conexión en la primera línea.
- Mail 2 / WPP 2: seguimiento con valor real por rubro. No "te recuerdo que te escribí".
- Mail 3 / WPP 3: suave, honesto, sin presión, puerta abierta.
- Visita Presencial: script de visita con contexto del lead.
- PRESUP. ENVIADO días>20 o Recontactar: reactivación. Reconocé el tiempo. Si hay razón de pausa en notas, usala.
- NEGOCIACIÓN: preguntá qué falta para avanzar (alcance, timing, precio).
- EN ESPERA: reactivación suave calibrada al motivo de pausa.
Firmante: Donato salvo arquitectura/desarrolladoras (Agustín) o institucional premium (Joaquín).`;
  }

  if (tipo === 'mensaje_libre') {
    return `DATOS:
Empresa: ${datos.empresa || ''}
Contacto: ${datos.contacto || ''}
Rubro: ${datos.rubro || ''}
Canal: ${datos.canal || 'según criterio'}
Toque: ${toque || 1}
${ctx ? 'Qué quiero decir / contexto: ' + ctx : ''}

TAREA: Redactá el mensaje. Aplicá todas las reglas. Firmante: Donato salvo que se indique otro.`;
  }

  return `Redactá un mensaje comercial con estos datos: ${JSON.stringify(datos)}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' });

  const { tipo, datos } = req.body;

  if (tipo === 'mensaje_lead' || tipo === 'mensaje_libre') {
    try {
      const inst = loadInstrucciones();
      const r = await claudeRequest(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: buildSystemPrompt(inst),
        messages: [{ role: 'user', content: buildUserPrompt(tipo, datos, inst) }]
      });
      return res.status(200).json({ ok: true, mensaje: extractText(r) });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Tipo no reconocido: ' + tipo });
};
