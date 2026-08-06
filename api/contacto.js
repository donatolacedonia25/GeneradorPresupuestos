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
      voz: { tono: 'Cálido, directo, humano.', maximo_palabras_wa: 80, maximo_palabras_mail: 150, parrafos_max_lineas: 3 },
      reglas_absolutas: ['Escribir como persona real, no sistema de marketing', 'NUNCA listar servicios en primer contacto'],
      secciones: {},
      firmas: { Donato: 'Donato' },
      lo_que_nunca_somos: [],
      ejemplos_buenos: [],
      correcciones: []
    };
  }
}

// ---------- helpers de normalización ----------

function normalizarCanal(canalTexto) {
  const c = (canalTexto || '').toLowerCase();
  if (c.includes('wpp') || c.includes('whatsapp')) return 'whatsapp';
  if (c.includes('mail')) return 'mail';
  if (c.includes('visita')) return 'visita_presencial';
  if (c.includes('linkedin')) return 'linkedin';
  return null;
}

function normalizarEstado(estadoTexto) {
  return (estadoTexto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\./g, '');
}

function normalizarTipoAlianza(tipoTexto) {
  const t = (tipoTexto || '').toLowerCase();
  if (t.includes('recomend')) return 'recomendador';
  if (t.includes('canal')) return 'canal';
  if (t.includes('co-creador') || t.includes('co creador') || t.includes('cocreador')) return 'co_creador';
  return null;
}

// FIX #1: matching tolerante para canal_por_rubro (antes era clave exacta y nunca matcheaba
// contra los valores reales de la hoja, ej. "Adm. Consorcios" vs clave "administradoras").
function buscarCanalPorRubro(inst, rubro) {
  const canalPorRubro = inst.canal_por_rubro || {};
  const rubroLower = (rubro || '').toLowerCase().trim();
  if (!rubroLower) return null;
  for (const [key, canal] of Object.entries(canalPorRubro)) {
    if (rubroLower.includes(key) || key.includes(rubroLower)) return canal;
  }
  return null;
}

function buscarSegmentoPorRubro(inst, rubro) {
  const segmentos = inst.segmentos || {};
  const rubroLower = (rubro || '').toLowerCase().trim();
  for (const [key, seg] of Object.entries(segmentos)) {
    const rubros = (seg.rubros || []).map(r => r.toLowerCase());
    if (rubros.some(r => rubroLower.includes(r) || r.includes(rubroLower))) {
      return { key, ...seg };
    }
  }
  return null;
}

// FIX #2: el warm ahora se decide primero por la columna ORIGEN (dato estructurado real
// de la hoja: "Red Donato", "Cliente", "Referido", etc.) y recién si no hay dato ahí,
// cae al escaneo de texto libre en notas/contexto como respaldo.
function esWarm(lead, ctx) {
  const origen = (lead.origen || '').toLowerCase();
  const origenesWarm = ['red donato', 'red joaquin', 'red agustin', 'referido', 'cliente'];
  if (origenesWarm.some(o => origen.includes(o))) return true;

  const texto = `${lead.notas || ''} ${ctx || ''}`.toLowerCase();
  return texto.includes('warm') || texto.includes('red donato') || texto.includes('referencia');
}

// Elige el paso de la secuencia de presupuesto según los días transcurridos.
function elegirPasoPresupuesto(inst, dias) {
  const pasos = (inst.secuencia_presupuesto || {}).pasos || [];
  const d = Number(dias) || 0;
  if (d < 2) return pasos.find(p => p.dia === 0);
  if (d < 6) return pasos.find(p => p.dia === 3);
  if (d < 11) return pasos.find(p => p.dia === 7);
  if (d <= 30) return pasos.find(p => p.dia === 15);
  return pasos.find(p => p.dia === '45-60');
}

// ---------- prompt building ----------

function buildSystemPrompt(inst) {
  const id = inst.identidad || {};
  const voz = inst.voz || {};
  const refs = (id.clientes_referencia || []).join(', ');
  const reglas = (inst.reglas_absolutas || []).map(r => `- ${r}`).join('\n');
  const nuncaSomos = (inst.lo_que_nunca_somos || []).map(r => `- ${r}`).join('\n');
  const prohibidoInformal = (voz.prohibido_informal || []).join(', ');
  const preferido = (voz.preferido || []).join(', ');
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

VOZ Y TONO: ${voz.tono || 'Cálido, directo, humano.'}
Registro: ${voz.registro || 'Tuteo profesional cálido.'}
${voz.principio_rector ? 'PRINCIPIO RECTOR: ' + voz.principio_rector : ''}
Máximo ${voz.maximo_palabras_wa || 80} palabras WA, ${voz.maximo_palabras_mail || 150} mail. Párrafos de ${voz.parrafos_max_lineas || 3} líneas max.
${prohibidoInformal ? 'Nunca usar estas frases informales: ' + prohibidoInformal + '.' : ''}
${preferido ? 'Preferir giros como: ' + preferido + '.' : ''}

REGLAS ABSOLUTAS:
${reglas}${correcciones}
- NUNCA usar guiones medios ni largos ("-" / "—") dentro del mensaje. Reformular con punto, coma o conector.

LO QUE NUNCA SOMOS:
${nuncaSomos}

FIRMAS:
${firmas}
${ejemplos}

OUTPUT: SOLO el mensaje listo. Si mail → primera línea "ASUNTO: [asunto]", línea en blanco, cuerpo. Sin explicaciones, sin comentarios sobre lo que hiciste.`;
}

function buildUserPrompt(tipo, datos, inst) {
  const { lead, ctx, firmante, accion } = datos;

  if (tipo === 'mensaje_lead') {
    const seccion = (datos.seccion || lead.seccion || 'base_leads').toLowerCase();
    const estadoNorm = normalizarEstado(lead.estado);
    const canalNorm = normalizarCanal(lead.canal);
    const canalSugerido = buscarCanalPorRubro(inst, lead.rubro) || 'según criterio'; // FIX #1

    const bloques = [];

    bloques.push(`LEAD DEL CRM (sección: ${seccion}):
Empresa: ${lead.empresa}
Contacto: ${lead.contacto}
Estado: ${lead.estado}
Rubro: ${lead.rubro || 'sin dato'}
Origen: ${lead.origen || 'sin dato'}
Canal: ${lead.canal || canalSugerido}
Acción pendiente: ${lead.accion || 'primer contacto'}
Días sin contacto: ${lead.dias || 0}
Valor: ${lead.valor || 'sin dato'}
Notas: ${lead.notas || 'sin notas'}
${ctx ? 'Contexto adicional: ' + ctx : ''}`);

    if (canalNorm && inst.reglas_por_canal && inst.reglas_por_canal[canalNorm]) {
      bloques.push(`REGLAS DEL CANAL (${canalNorm}):\n${JSON.stringify(inst.reglas_por_canal[canalNorm], null, 2)}`);
    }

    if (seccion !== 'alianzas') {
      const seg = buscarSegmentoPorRubro(inst, lead.rubro);
      if (seg) {
        bloques.push(`SEGMENTO (${seg.key}):
Lógica: ${seg.logica}
Dolor consciente: ${seg.dolor_consciente || ''}
Dolor inconsciente: ${seg.dolor_inconsciente || ''}
Nuestro rol: ${seg.nuestro_rol || ''}`);
      }
    }

    const seccionesInst = inst.secciones || {};

    if (seccion === 'alianzas') {
      const alianzas = seccionesInst.alianzas || {};
      const tipoNorm = normalizarTipoAlianza(lead.tipoAlianza);
      const tipoInfo = tipoNorm ? (alianzas.tipos || {})[tipoNorm] : null;
      const estadoInfo = (alianzas.estados || {})[estadoNorm];

      if (tipoInfo) {
        bloques.push(`TIPO DE ALIANZA (${tipoNorm}):
Definición: ${tipoInfo.definicion}
Quiénes: ${tipoInfo.quienes}
Ángulo central: ${tipoInfo.angulo_central}
Rubro de contexto (NO determina el ángulo, solo aporta el dato específico a mencionar): ${lead.rubro || 'sin dato'}`);
      }
      if (estadoInfo) {
        bloques.push(`ESTADO (${estadoNorm}) — lo que corresponde generar:\n${JSON.stringify(estadoInfo, null, 2)}`);
      }

    } else {
      const seccionInfo = seccionesInst[seccion] || {};
      const estadoInfo = (seccionInfo.estados || {})[estadoNorm];

      if (estadoInfo) {
        if (estadoInfo.usa_regla_toque && inst.reglas_por_toque) {
          bloques.push(`REGLA DE TOQUE (${estadoInfo.usa_regla_toque}):\n${inst.reglas_por_toque[estadoInfo.usa_regla_toque] || ''}`);
        }
        if (estadoInfo.usa_template && inst[estadoInfo.usa_template]) {
          bloques.push(`TEMPLATE BASE A ADAPTAR (no copiar literal, adaptar al lead):\n${inst[estadoInfo.usa_template]}`);
        }
        if (estadoInfo.usa_secuencia === 'secuencia_presupuesto') {
          const paso = elegirPasoPresupuesto(inst, lead.dias);
          if (paso) {
            bloques.push(`PASO DE LA SECUENCIA DE PRESUPUESTO (día ${paso.dia} — ${paso.nombre}):
Canal: ${paso.canal}
Mensaje base a adaptar: ${paso.mensaje}
${paso.regla ? 'Regla: ' + paso.regla : ''}`);
            if (paso.dia === 15) {
              bloques.push(`MOTIVOS DE URGENCIA DISPONIBLES (elegir UNO SOLO, el más honesto para este caso):\n${JSON.stringify(inst.motivos_urgencia, null, 2)}`);
            }
          }
          bloques.push(`Regla general de la secuencia: ${(inst.secuencia_presupuesto || {}).regla_dura_general || ''}`);
        }
        if (estadoInfo.cta_ejemplos) {
          bloques.push(`CTA DE REFERENCIA para este estado (inspirate, no copies literal):\n- ${estadoInfo.cta_ejemplos.join('\n- ')}`);
        }
        if (estadoInfo.angulo) {
          bloques.push(`Ángulo para este estado: ${estadoInfo.angulo}`);
        }
        if (estadoInfo.regla_dura) {
          bloques.push(`Regla dura de este estado: ${estadoInfo.regla_dura}`);
        }
        if (estadoInfo.canal_default) {
          bloques.push(`Canal por defecto para este estado: ${estadoInfo.canal_default}`);
        }
      }

      // FIX #2: warm ahora considera ORIGEN primero, texto libre como respaldo.
      if (esWarm(lead, ctx)) {
        bloques.push(`ESTRUCTURA WARM (hay vínculo previo/referencia — Origen: "${lead.origen || 'detectado en notas'}"):\n${JSON.stringify(inst.estructura_warm, null, 2)}`);
      }
    }

    bloques.push(`FIRMANTE ELEGIDO POR EL USUARIO: ${firmante || 'Donato'}. Usar SOLO este nombre en la firma — nunca elegir otro por tu cuenta, aunque el rubro sugiera otro firmante.`);

    return bloques.join('\n\n');
  }

  if (tipo === 'mensaje_libre') {
    return `DATOS:
Empresa: ${datos.empresa || ''}
Contacto: ${datos.contacto || ''}
Rubro: ${datos.rubro || ''}
Canal: ${datos.canal || 'según criterio'}
Acción / objetivo del mensaje: ${accion || 'presentación inicial'}
${ctx ? 'Qué quiero decir / contexto: ' + ctx : ''}

FIRMANTE ELEGIDO POR EL USUARIO: ${firmante || 'Donato'}. Usar SOLO este nombre en la firma.

TAREA: Redactá el mensaje aplicando todas las reglas del sistema.`;
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
