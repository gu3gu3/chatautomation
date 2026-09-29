# 🚀 WebSavvy AI — Multi-Tenant WhatsApp Automation & AI Agent Platform

Plataforma empresarial multi-tenant para la automatización inteligente de atención al cliente y gestión comercial en **WhatsApp**, impulsada por agentes autónomos de Inteligencia Artificial (Google Gemini AI), integración RAG vectorial, llamadas a herramientas externas (Google Workspace) y gestión logística social-commerce.

---

## 🏗️ Arquitectura del Sistema

El proyecto está diseñado bajo una arquitectura de microservicios contenerizados con **Docker Compose**:

```
                              ┌────────────────────────┐
                              │    Cliente WhatsApp    │
                              └───────────┬────────────┘
                                          │ (Baileys WebSockets / E2EE)
                                          ▼
┌───────────────────┐        ┌────────────────────────┐
│ PWA Dashboard     │        │  WhatsApp Gateway      │
│ (React / Vite)    ├───────►│  (Node.js / Baileys)   │
└─────────┬─────────┘        └───────────┬────────────┘
          │ (REST API)                   │ (Publica Eventos Entrantes)
          ▼                              ▼
┌───────────────────┐        ┌────────────────────────┐
│ Backend API       │        │  Redis Queue           │
│ (Node.js Express) │        │  (Pub/Sub & Sessions)  │
└─────────┬─────────┘        └───────────┬────────────┘
          │                              │ (Consume Mensajes)
          │                              ▼
          │                  ┌────────────────────────┐        ┌────────────────────────┐
          └─────────────────►│  AI Engine Worker      ├───────►│  Google Gemini API     │
                             │  (Function Calling)    │        │  (gemini-2.5-flash)    │
                             └───────────┬────────────┘        └────────────────────────┘
                                         │
                                         ▼
                             ┌────────────────────────┐
                             │ PostgreSQL + pgvector  │
                             │ (Tenants, RAG, Logs)   │
                             └────────────────────────┘
```

---

## 📦 Componentes y Microservicios

| Servicio | Descripción / Tecnologías |
| :--- | :--- |
| **`pwa`** | Dashboard Web progresivo (PWA) desarrollado en **React + Vite**. Permite la administración de sesiones WhatsApp (código QR en vivo vía SSE), configuración de prompts, versionado de respaldos, gestión de documentos KB y analítica. |
| **`backend-api`** | REST API en **Node.js / Express** con autenticación JWT, control de acceso por roles (Superadmin MSP, Tenant Owner, Operador), impersonación de cuentas y gestión de integraciones. |
| **`whatsapp-gateway`** | Pasarela Multi-Tenant basada en **`@whiskeysockets/baileys`**. Gestiona sesiones de WhatsApp activas, reintentos E2EE, recepción de imágenes/medios y envío de **Tarjetas de Eventos Nativas (`eventMessage`)**. |
| **`ai-engine`** | Procesador en segundo plano que consume colas de Redis. Orquesta la interacción con **Google Gemini AI**, ejecuta RAG sobre la base de conocimientos y realiza *Function Calling* dinámico. |
| **`db-migrator`** | Runner transaccional seguro que ejecuta migraciones SQL de forma automática e idempotente en cada despliegue antes de iniciar la aplicación. |
| **`postgres`** | Base de datos PostgreSQL 16 con extensión **`pgvector`** para búsquedas de similitud vectorial (768 dimensiones). |
| **`redis`** | Almacenamiento en memoria para colas de trabajo, caché de reintentos E2EE y estados de conexión. |

---

## 🔥 Características Destacadas

* 🤖 **Agentes de IA Autónomos (Gemini AI):** Respuestas conversacionales fluidas con soporte para personalidad personalizada por tenant.
* 📦 **Versionado y Respaldo de System Prompts:** Permite guardar hasta 3 versiones de respaldo por tenant con título/descripción y restaurar a principal en 1 clic.
* 📅 **Integración Google Calendar + Event Cards de WhatsApp:** Al agendar una cita mediante `create_calendar_appointment`, el sistema crea el evento en Google Calendar y envía en tándem una **tarjeta de evento nativa de WhatsApp** (`eventMessage`) para agregar al calendario con 1 toque.
* 📊 **Integración Google Sheets & Drive:** Consulta de catálogos, registro automático de leads y envío de folletos/PDFs multimedia directamente desde carpetas de Drive.
* 🛵 **Módulo Social-Commerce & Logística:** Gestión de pedidos, distribuidores por zona y asignación de repartidores para comercios locales.
* 🧠 **RAG (Retrieval-Augmented Generation):** Indexación de documentos vectoriales con `pgvector` y `text-embedding-004`.
* 🏢 **Arquitectura Multi-Tenant Real:** Aislamiento estricto de credenciales, prompts y bases de conocimientos por cliente (`tenant_id`).

---

## 🛠️ Guía de Despliegue en Producción

### 1. Requisitos Previos
* Servidor Linux (VPS con 4 vCPU, 8 GB RAM recomendados)
* Docker & Docker Compose v2 instalado
* Llave API de **Google Gemini** (`GEMINI_API_KEY`)

### 2. Clonar el Repositorio
```bash
git clone git@github.com:gu3gu3/chatautomation.git
cd chatautomation
```

### 3. Configurar Variables de Entorno
Copia el archivo de ejemplo e ingresa tus llaves:
```bash
cp .env.example .env
nano .env
```

### 4. Iniciar la Aplicación con Docker Compose
```bash
docker compose up -d --build
```

El servicio `db-migrator` se ejecutará automáticamente para estructurar la base de datos PostgreSQL e insertar los datos semilla iniciales.

---

## 🗄️ Gestión de Migraciones de Base de Datos

Las migraciones de base de datos se encuentran en `services/database/migrations/`.

Para crear una nueva migración:
1. Crea un nuevo archivo SQL numerado secuencialmente en `services/database/migrations/` (ej: `002_add_new_feature.sql`).
2. Al ejecutar `docker compose up -d`, la migración se aplicará de forma transaccional automática (`BEGIN` ... `COMMIT`).

---

## 📄 Licencia

Propiedad exclusiva de **WebSavvy Solutions**. Todos los derechos reservados.
