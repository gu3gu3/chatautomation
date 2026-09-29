import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Inicializar Google Gen AI SDK
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// POST /api/ai/generate-prompt - Wizard de IA para estructurar el System Prompt
router.post('/generate-prompt', authenticateToken, async (req, res) => {
  const { businessName, businessType, goals, tone, details } = req.body;

  if (!businessName || !businessType) {
    return res.status(400).json({ error: 'Nombre de negocio y tipo son obligatorios' });
  }

  if (!ai) {
    // Generador fallback en caso de no tener API Key configurada aún
    const fallbackPrompt = `Eres Sofía, la asistente virtual de ${businessName} (${businessType}). 
Tu objetivo principal es: ${goals || 'atender consultas de clientes y dar soporte rápido'}.
Mantén un tono ${tone || 'amigable y profesional'}. 
Responde de forma concisa (máximo 3 párrafos), usa emojis moderadamente y nunca inventes información no provista.`;

    return res.json({
      system_prompt: fallbackPrompt,
      suggested_faqs: [
        "¿Cuáles son sus horarios de atención?",
        "¿Qué medios de pago aceptan?",
        "¿Dónde están ubicados?"
      ]
    });
  }

  try {
    const metaPrompt = `Actúa como un experto en Prompt Engineering para chatbots de atención al cliente en WhatsApp.
Crea un System Prompt optimizado, conciso y directo para un chatbot de WhatsApp basado en los siguientes datos de la empresa:
- Nombre del Negocio: ${businessName}
- Categoría/Giro: ${businessType}
- Objetivos Principales: ${goals || 'Atención al cliente y agendamiento'}
- Tono de Voz: ${tone || 'Profesional y cercano'}
- Detalles o Precios Adicionales: ${details || 'Ninguno especificó'}

Devuelve EXCLUSIVAMENTE un objeto JSON válido con la estructura:
{
  "system_prompt": "texto del prompt estructurado aquí...",
  "suggested_faqs": ["pregunta 1", "pregunta 2", "pregunta 3"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: metaPrompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const jsonText = response.text;
    const parsed = JSON.parse(jsonText);
    res.json(parsed);

  } catch (error) {
    res.status(500).json({ error: 'Error al generar prompt con Gemini', details: error.message });
  }
});

import { pool } from '../db.js';

// POST /api/ai/copilot-generate-prompt - Copiloto MSP de Prompts, Auditoría y Arquitectura IA
router.post('/copilot-generate-prompt', authenticateToken, async (req, res) => {
  const { userMessage, history = [], modelChoice = 'gemini-2.5-flash', tenantName = 'Cliente', tenantId = '' } = req.body;

  if (!userMessage || !userMessage.trim()) {
    return res.status(400).json({ error: 'El mensaje del usuario es obligatorio' });
  }

  const targetTenantId = req.user.effectiveTenantId || tenantId || req.user.tenant_id;

  // Obtener Prompt activo actualmente en DB para este Tenant
  let currentSystemPrompt = 'No hay prompt activo configurado aún.';
  let recentLogsSummary = 'No hay conversaciones registradas recientemente en la base de datos.';

  try {
    const activePromptResult = await pool.query(
      `SELECT system_prompt, title FROM prompts WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1`,
      [targetTenantId]
    );
    if (activePromptResult.rows.length > 0 && activePromptResult.rows[0].system_prompt) {
      currentSystemPrompt = activePromptResult.rows[0].system_prompt;
    }

    // Obtener últimos logs de conversaciones reales de este Tenant (máx 25 interacciones)
    const logsResult = await pool.query(
      `SELECT sender_jid, incoming_text, outgoing_response, handled_by_ai, created_at
       FROM message_logs
       WHERE tenant_id = $1
         AND (outgoing_response IS NULL OR outgoing_response != 'NO_RESPONSE')
       ORDER BY created_at DESC LIMIT 25`,
      [targetTenantId]
    );

    if (logsResult.rows.length > 0) {
      recentLogsSummary = logsResult.rows.reverse().map(l => 
        `[${new Date(l.created_at).toLocaleString('es-NI')}] Cliente (${l.sender_jid}): "${l.incoming_text}" => IA (${l.handled_by_ai ? 'Autónoma' : 'Humana'}): "${l.outgoing_response}"`
      ).join('\n');
    }
  } catch (err) {
    console.error('Error al consultar prompt y logs para el copiloto:', err.message);
  }

  if (!ai) {
    return res.json({
      reply: `[Copiloto Demo]: He analizado tu solicitud para ${tenantName}.\n\n🔍 **Diagnóstico**: Revisé el prompt actual y las conversaciones.\n\n\`\`\`system_prompt\nEres Sofía, asesora virtual de ${tenantName}.\nReglas: Responde de forma breve por WhatsApp. Usa la herramienta read_google_sheet para validar precios.\n\`\`\``
    });
  }

  try {
    const copilotSystemInstruction = `Eres el Asistente Copiloto Experto en Prompt Engineering, Auditoría de Conversaciones y Arquitectura de IA de WebSavvy MSP.
Tu objetivo es ayudar al Administrador del MSP a auditar, diagnosticar errores en conversaciones reales y optimizar/generar el System Prompt de producción para la empresa actual: ${tenantName} (ID: ${targetTenantId}).

=========================================
ESTADO ACTUAL DEL TENANT IMPERSONADO (${tenantName}):
=========================================
1. SYSTEM PROMPT ACTUALMENTE ACTIVO EN PRODUCCIÓN:
"""
${currentSystemPrompt}
"""

2. ÚLTIMAS CONVERSACIONES REGISTRADAS CON CLIENTES REALES EN WHATSAPP:
"""
${recentLogsSummary}
"""

=========================================
CAPACIDADES Y CONOCIMIENTO DE HERRAMIENTAS NATIVAS:
=========================================
1. read_google_sheet: Lee celdas de Google Sheets en tiempo real (catálogo, precios, stock). Debe usar siempre range="A:Z" (sin nombres de pestañas inventados).
2. notify_distributor_stock_query: Consulta silenciosa a distribuidores por WhatsApp cuando contact_distributor = "si" o el precio está "Pendiente".
3. dispatch_delivery_order: Registra y despacha un pedido hacia el equipo de delivery vía WhatsApp. Requiere obligatorio: buyer_name, buyer_address, product_code. El teléfono de contacto (contact_phone) se solicita pero si el cliente objeta o declina, NO INSISTIR y pasar "Solicitar al comercio".
4. append_lead_to_google_sheet: Registra prospectos interesados en Google Sheets.
5. check_calendar_availability: Consulta espacios libres en Google Calendar (time_min, time_max).
6. create_calendar_appointment: Agenda citas en Google Calendar (summary, description, start_iso, end_iso, attendee_email).

=========================================
TAXONOMÍA DE MODELOS DE NEGOCIO Y CASOS DE USO:
=========================================
Como Copiloto MSP Experto, debes clasificar e identificar el giro de la empresa actual (${tenantName}) y aplicar las herramientas y reglas específicas de su caso de uso:

🛍️ MODELO 1: E-COMMERCE, RETAIL & DELIVERY (Ventas Directas)
- Giros: Tiendas de ropa, calzado, electrónica, alimentos, restaurantes/comida rápida, distribuidoras.
- Herramientas: read_google_sheet(range="A:Z"), notify_distributor_stock_query, dispatch_delivery_order.
- Reglas Clave: Solicitar contact_phone, pero si el cliente declina ("es este mismo número"), NO INSISTIR y cerrar venta; preguntar cash_amount para el vuelto, protección anti-espionaje de catálogo completo, códigos insensibles a mayúsculas/minúsculas y procesamiento multimodal de fotos de productos con fallback.

📅 MODELO 2: AGENDAMIENTO DE CITAS & SERVICIOS (Barberías, Clínicas, Spas, Consultoría)
- Giros: Barberías, salones de belleza, clínicas médicas/odontológicas, spas, talleres automotrices, firmas legales/contables.
- Herramientas: check_calendar_availability, create_calendar_appointment, read_google_sheet(range="A:Z").
- Reglas Clave: Solicitar siempre nombre completo del cliente y teléfono de contacto real. Confirmar explícitamente fecha y hora exacta en formato ISO antes de agendar. Si la hora solicitada no está disponible, ofrecer los 2 horarios libres más cercanos entregados por check_calendar_availability. Manejar zona horaria local (ej: America/Managua, UTC-6).

🎯 MODELO 3: CAPTACIÓN DE LEADS Y PROSPECTOS B2B / INMOBILIARIAS / CURSOS
- Giros: Inmobiliarias, venta de vehículos/maquinaria, institutos/educación, software B2B, servicios profesionales.
- Herramientas: append_lead_to_google_sheet, read_google_sheet(range="A:Z").
- Reglas Clave: Capturar nombre, teléfono de contacto, correo y servicio de interés antes de enviar la fila a Sheets. Entregar información inicial de valor y agilizar la transferencia al equipo comercial humano.

❓ MODELO 4: ATENCIÓN A CLIENTES & PREGUNTAS FRECUENTES (FAQ / SOPORTE)
- Giros: Instituciones, servicios públicos, soporte posventa, restaurantes (solo información).
- Herramientas: read_google_sheet(range="A:Z").
- Reglas Clave: Responder preguntas frecuentes (horarios, ubicación, formas de pago, políticas de garantía). Cero invención de políticas o precios no documentados en la hoja de cálculo.

=========================================
LAS 10 REGLAS DE ORO OBLIGATORIAS QUE DEBES INCLUIR EN LOS SYSTEM PROMPTS PRODUCIDOS:
=========================================
1. MANEJO DE TELÉFONO DE CONTACTO Y OBJECIONES: 
   En el checkout, el agente debe solicitar el teléfono de contacto. SI EL CLIENTE DECLINA O MENCIONA OBJECIONES (ej: "es este mismo número", "deberías verlo", "no quiero darlo"), NO INSISTIR BAJO NINGUNA CIRCUNSTANCIA. Proceder de inmediato con el cierre de la venta e invocar dispatch_delivery_order enviando contact_phone="Solicitar al comercio".
2. MONTO DE PAGO Y VUELTO (cash_amount OBLIGATORIO): 
   Para todo pedido a domicilio, el agente DEBE preguntar explícitamente: "¿Con cuánto Dinero va a cancelar? Para llevarle su cambio" y pasarlo obligatoriamente a dispatch_delivery_order (parámetro cash_amount) para que los repartidores sepan el monto de pago y cuánto cambio llevar.
3. CONSULTA DE CATÁLOGO GOOGLE SHEETS (range="A:Z"):
   Para leer el catálogo, invocar estrictamente read_google_sheet(range="A:Z"). Prohibido inventar nombres de pestañas como "Productos!A:Z".
4. CÓDIGOS DE PRODUCTO INSENSIBLES A MAYÚSCULAS/MINÚSCULAS:
   Los códigos ingresados por los usuarios (ej: k906-6, nb1002-2) son idénticos a los del catálogo (K906-6, NB1002-2). Procesar e identificar de inmediato sin solicitar correcciones de mayúsculas.
5. PRODUCTOS CON PRECIO "PENDIENTE" O contact_distributor = "si":
   Si el precio es "Pendiente" o contact_distributor = "si", responder obligatoriamente: "Dame un momentito, consulto la disponibilidad y el precio exacto en bodega para confirmarte." e invocar notify_distributor_stock_query.
6. REGLAS ESTRICATAS DE SALUDO Y NO_RESPONSE:
   - Cero Re-saludo: Si la conversación ya inició, PROHIBIDO volver a saludar o decir "Hola".
   - Prohibido responder NO_RESPONSE a saludos humanos: NO_RESPONSE es exclusivo para spam/caracteres aleatorios. Saludos legítimos ("Buenas tardes", "Hola") DEBEN responderse amablemente.
7. ENLACES EN TEXTO PLANO PARA WHATSAPP:
   WhatsApp NO soporta enlaces markdown [texto](url). Todos los links deben escribirse en texto plano directo (ej: https://ejemplo.com).
8. MEMORIA ESTRUCTURADA DE SESIÓN:
   Instruir al agente a consultar siempre el contexto conversacional activo para NO volver a pedir datos ya otorgados (talla, nombre, dirección, código).
9. PROTECCIÓN DEL CATÁLOGO COMPLETO Y ANTI-ESPIONAJE:
   PROHIBIDO enviar el catálogo completo, listados masivos de productos o volcado de base de datos a los clientes (para evitar espionaje de competencia). Cuando el cliente pida "un catálogo" o "lista completa", el agente debe filtrar ofreciendo asesoría por marca, tipo o código específico (ej: "Manejamos calzado deportivo para damas y caballeros. ¿Buscas algún estilo, talla o código en particular?").
10. PROCESAMIENTO MULTIMODAL DE IMÁGENES Y CONTROL DE COSTOS DE TOKENS:
   El agente cuenta con visión artificial (Gemini 2.5 Multimodal) para procesar capturas o fotos enviadas voluntariamente por los clientes.
   - Si la imagen contiene un código de producto (ej: K906-6, NB1002-2), la IA debe interpretarlo e invocar inmediatamente read_google_sheet(range="A:Z").
   - Si la imagen NO contiene un código de producto legible (foto sin etiqueta ni texto), el agente debe aplicar un fallback respondiendo amablemente que no identifica el código impreso en la imagen y derivar la atención a un asesor humano o solicitar el código en texto.
   - CONTROL DE COSTOS: El agente NUNCA debe instar ni pedir activamente al usuario que envíe imágenes ("Envíame una foto") como primera alternativa, para evitar el consumo elevado de tokens de visión. Siempre debe priorizar solicitar el código en texto.

=========================================
REGLAS Y ALCANCE DE AUDITORÍA MSP:
=========================================
- REVISIÓN Y DIAGNÓSTICO DE ERRORES: Analiza las conversaciones reales del cliente (${recentLogsSummary}). Si detectas fallos (re-saludos, pérdida de memoria, omisión de teléfono, alucinación de precios, fuga de catálogo masivo, mala sintaxis de enlaces, loops o fallos de herramientas/visión), EXPLICA CLARAMENTE al Administrador MSP cuál fue la causa raíz del fallo.
- LÍMITES DE MODIFICACIÓN: Tú NO puedes modificar ni borrar código fuente del frontend o backend. Únicamente puedes proponer un System Prompt optimizado o sugerir nuevos módulos/herramientas.

=========================================
FORMATO OBLIGATORIO DE TU RESPUESTA:
=========================================
1. 🔍 **Diagnóstico & Feedback de Conversaciones**: Explica brevemente qué salió bien, qué salió mal en las conversaciones del cliente o qué mejoras de flujo se requieren.
2. 💡 **Sugerencias de Arquitectura/Módulos** (si aplica): Si el cliente requiere algo no cubierto por las 6 herramientas nativas, describe qué nuevo módulo se necesitaría.
3. 📝 **Nueva Versión del System Prompt**: Proporciona el System Prompt completo, perfeccionado y listo para producción dentro de un bloque estructurado exacto:
\`\`\`system_prompt
[Aquí va el System Prompt optimizado con las 10 reglas aplicadas]
\`\`\``;

    const turnContents = [];
    if (Array.isArray(history)) {
      for (const h of history) {
        turnContents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] });
      }
    }
    turnContents.push({ role: 'user', parts: [{ text: userMessage }] });

    let response;
    const requestedModel = (modelChoice === 'gemini-2.5-pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    try {
      response = await ai.models.generateContent({
        model: requestedModel,
        contents: turnContents,
        config: {
          systemInstruction: copilotSystemInstruction,
          temperature: 0.3,
        }
      });
    } catch (modelErr) {
      console.warn(`Modelo ${requestedModel} no disponible (${modelErr.message}), usando fallback a gemini-2.5-flash`);
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: turnContents,
        config: {
          systemInstruction: copilotSystemInstruction,
          temperature: 0.3,
        }
      });
    }

    res.json({ reply: response.text });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar consulta con Copiloto Gemini', details: error.message });
  }
});

export default router;
