# Generador 212 Paisajismo

Herramienta interna para generar presupuestos y reportes de mantenimiento en PDF.

## Deploy en Vercel (una sola vez)

### 1. Subir a GitHub
1. Crear un repo nuevo en github.com (ej: `generador-212`)
2. Subir estos archivos al repo

### 2. Conectar con Vercel
1. Ir a vercel.com → New Project
2. Importar el repo de GitHub
3. Deploy (sin cambiar nada)

### 3. Configurar la API key de Gemini
1. En Vercel → tu proyecto → Settings → Environment Variables
2. Agregar:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** tu API key de Google AI Studio
3. Redeploy (Settings → Deployments → Redeploy)

### Obtener la API key de Gemini
1. Ir a aistudio.google.com
2. Get API Key → Create API Key
3. Copiar el valor (empieza con `AIza...`)

## Uso
- Abrir la URL de Vercel desde cualquier dispositivo
- Tab "Presupuesto": completar campos → Generar con IA → descarga el PDF
- Tab "Reporte": completar visita + fotos → Generar con IA → descarga el PDF
- "Generar PDF (sin IA)": genera el PDF con el texto que haya en los campos, sin llamar a Gemini

## Estructura
```
/
├── index.html          # Formulario completo
├── api/
│   └── generar.js      # Serverless function (proxy a Gemini)
├── vercel.json         # Config Vercel
└── README.md
```
