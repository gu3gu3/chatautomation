-- Habilitar extensión pgvector para embeddings de RAG
CREATE EXTENSION IF NOT EXISTS vector;

-- Tablas Principales

-- 1. Tenants (Empresas / Negocios)
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'pro',
    status VARCHAR(20) DEFAULT 'active',
    is_demo_mode BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Usuarios y Roles (Superadmin MSP, Tenant Owner, Operator)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'TENANT_OWNER', -- SUPERADMIN_MSP, TENANT_OWNER, OPERATOR
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Sesiones de WhatsApp (Baileys State por Tenant)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    tenant_id VARCHAR(36) PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number VARCHAR(50),
    status VARCHAR(50) DEFAULT 'DISCONNECTED', -- CONNECTING, CONNECTED, DISCONNECTED
    auth_credentials JSONB,
    last_connected_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. System Prompts por Tenant
CREATE TABLE IF NOT EXISTS prompts (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(100) DEFAULT 'Principal',
    system_prompt TEXT NOT NULL,
    temperature NUMERIC(3,2) DEFAULT 0.7,
    max_tokens INT DEFAULT 1000,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Documentos KB (Base de Conocimientos RAG)
CREATE TABLE IF NOT EXISTS kb_documents (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) DEFAULT 'text',
    file_path TEXT,
    raw_content TEXT,
    status VARCHAR(50) DEFAULT 'processed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Embeddings Vectoriales KB (768 dimensiones para Gemini text-embedding-004)
CREATE TABLE IF NOT EXISTS kb_embeddings (
    id VARCHAR(36) PRIMARY KEY,
    document_id VARCHAR(36) REFERENCES kb_documents(id) ON DELETE CASCADE,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    chunk_text TEXT NOT NULL,
    embedding vector(768),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Historial / Logs de Mensajes de WhatsApp
CREATE TABLE IF NOT EXISTS message_logs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sender_jid VARCHAR(100) NOT NULL,
    message_id VARCHAR(100),
    incoming_text TEXT,
    outgoing_response TEXT,
    handled_by_ai BOOLEAN DEFAULT TRUE,
    tokens_used INT DEFAULT 0,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Logs de Auditoría de Impersonación (MSP Security)
CREATE TABLE IF NOT EXISTS impersonation_audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    superadmin_id VARCHAR(36) NOT NULL REFERENCES users(id),
    impersonated_tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id),
    action VARCHAR(255) NOT NULL,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Integraciones de Herramientas (Google Sheets, Google Calendar, etc.)
CREATE TABLE IF NOT EXISTS tenant_integrations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    integration_type VARCHAR(50) NOT NULL, -- GOOGLE_SHEETS, GOOGLE_CALENDAR
    credentials_json JSONB,
    config JSONB,
    is_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, integration_type)
);

-- 10. Distribuidores por Tenant (Logística Social-Commerce)
CREATE TABLE IF NOT EXISTS tenant_distributors (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone_whatsapp VARCHAR(50) NOT NULL,
    address_location TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Repartidores / Drivers por Tenant (Logística Social-Commerce)
CREATE TABLE IF NOT EXISTS tenant_delivery_drivers (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone_whatsapp VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(50) DEFAULT 'Moto',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. Órdenes / Pedidos Logísticos
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    buyer_jid VARCHAR(100) NOT NULL,
    buyer_name VARCHAR(255),
    buyer_address TEXT,
    product_name VARCHAR(255) NOT NULL,
    price NUMERIC(10,2) DEFAULT 0.00,
    distributor_id VARCHAR(36) REFERENCES tenant_distributors(id) ON DELETE SET NULL,
    driver_id VARCHAR(36) REFERENCES tenant_delivery_drivers(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'PENDING_DISTRIBUTOR', -- PENDING_DISTRIBUTOR, CONFIRMED_STOCK, BROADCASTING_DELIVERY, ASSIGNED_DRIVER, DELIVERED, CANCELLED
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices para Rendimiento
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prompts_tenant ON prompts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant ON kb_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_tenant ON message_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON tenant_integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_distributors_tenant ON tenant_distributors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drivers_tenant ON tenant_delivery_drivers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);


-- Insertar Datos Semilla (Seed Tenants: MenuView & WebSavvySolutions)

INSERT INTO tenants (id, name, slug, plan, status)
VALUES 
    ('tenant-msp-001', 'WebSavvy MSP Central', 'websavvy-msp', 'enterprise', 'active'),
    ('tenant-menuview-001', 'MenuView', 'menu-view', 'pro', 'active'),
    ('tenant-websavvy-001', 'WebSavvySolutions', 'websavvy-solutions', 'enterprise', 'active')
ON CONFLICT (id) DO NOTHING;

-- Usuarios Iniciales
INSERT INTO users (id, tenant_id, name, email, password_hash, role)
VALUES 
    ('user-admin-msp', 'tenant-msp-001', 'Superadmin MSP', 'admin@websavvy.com', '$2b$10$8K1p/a0dL1LXMIgoED88UeM0hDvykYg/S1.hR0kK1t2o/8Qv8J7Gu', 'SUPERADMIN_MSP'),
    ('user-menuview', 'tenant-menuview-001', 'Administrador MenuView', 'contacto@menuview.app', '$2b$10$8K1p/a0dL1LXMIgoED88UeM0hDvykYg/S1.hR0kK1t2o/8Qv8J7Gu', 'TENANT_OWNER'),
    ('user-websavvy', 'tenant-websavvy-001', 'Equipo WebSavvy', 'soporte@websavvy.com', '$2b$10$8K1p/a0dL1LXMIgoED88UeM0hDvykYg/S1.hR0kK1t2o/8Qv8J7Gu', 'TENANT_OWNER')
ON CONFLICT (id) DO NOTHING;

-- System Prompts para MenuView y WebSavvySolutions
INSERT INTO prompts (id, tenant_id, title, system_prompt, temperature, is_active)
VALUES 
(
    'prompt-menuview-001',
    'tenant-menuview-001',
    'Asistente Inteligente MenuView',
    'Eres el asistente virtual interactivo de MenuView. Tu función es ayudar a los comensales y restaurantes a digitalizar menús físicos en Smart Menus interactivos potenciados por IA, responder consultas sobre platillos, alérgenos, ofertas del día y facilitar pedidos o reservas de mesa.',
    0.7,
    TRUE
),
(
    'prompt-websavvy-001',
    'tenant-websavvy-001',
    'Consultor Tecnológico WebSavvy',
    'Eres el consultor de ventas y soporte de WebSavvySolutions. Ayudas a empresas a cotizar sistemas de automatización de WhatsApp, soluciones de rastreo GPS (Traccar), desarrollo de aplicaciones web/móviles e integración de soluciones de Inteligencia Artificial.',
    0.7,
    TRUE
)
-- 13. Planes de Suscripción MSP
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    max_distributors INT NOT NULL DEFAULT 0,
    max_drivers INT NOT NULL DEFAULT 0,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insertar Planes Semilla
INSERT INTO subscription_plans (id, name, max_distributors, max_drivers, description)
VALUES 
    ('starter', 'Starter', 0, 0, 'Respuestas informáticas y agenda de citas'),
    ('emprendedor', 'Emprendedor', 3, 1, 'Gestión comercial básica con 3 distribuidores y 1 repartidor (3:1)'),
    ('emprendedor_plus', 'Emprendedor Plus', 6, 2, 'Gestión comercial intermedia con 6 distribuidores y 2 repartidores (6:2)'),
    ('emprendedor_pro', 'Emprendedor Pro', 9, 3, 'Gestión comercial avanzada con 9 distribuidores y 3 repartidores (9:3)'),
    ('enterprise', 'Enterprise', 99, 99, 'Capacidad ilimitada de distribución y logística dedicada')
ON CONFLICT (id) DO NOTHING;
