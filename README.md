# Generador 212 Paisajismo

Herramienta interna para generar presupuestos y reportes de mantenimiento en PDF.
Sitio estático (HTML/JS) desplegado en Vercel, con funciones serverless que hacen
de proxy a la API de Anthropic para la redacción, y un webhook de Google Apps
Script ("Panel Vivero 212") que hace de CRM (clientes, reportes, leads).

## Deploy en Vercel

### 1. Subir a GitHub
Repo privado `donatolacedonia25/GeneradorPresupuestos` → autodeploy en Vercel.
Cada push a `main` va a producción; cada rama genera una URL de *preview*.

### 2. Variable de entorno
En Vercel → Settings → Environment Variables:
- **Name:** `ANTHROPIC_API_KEY`
- **Value:** tu API key de Anthropic (console.anthropic.com → API Keys)

La clave vive sólo en Vercel. Nunca se pide ni se acepta en el chat ni en el front.

## Uso
- Abrir la URL de Vercel desde cualquier dispositivo (pensado para celular).
- Tab **Presupuesto**: completar campos → Generar con IA → descarga el PDF.
- Tab **Mantenimiento**: completar visita + fotos → Generar reporte → PDF, subida
  a Drive y escritura en el CRM, compartir por WhatsApp.
- Tab **Mensajes**: redacción de mensajes B2B (usa `instrucciones.json`).
- Tab **POS**: iframe embebido.
- "Generar PDF (sin IA)" (en Presupuesto): arma el PDF con el texto de los campos,
  sin llamar a la API.

## Estructura
```
/
├── index.html          # App completa (tabs Presupuesto / Mantenimiento / POS)
├── contacto.html       # Tab Mensajes
├── instrucciones.json  # "Cerebro" B2B que lee api/contacto.js
├── api/
│   ├── generar.js      # Serverless: proxy a Anthropic (presupuestos y reportes)
│   └── contacto.js     # Serverless: proxy a Anthropic (mensajes)
├── vercel.json         # Config Vercel
└── README.md
```
