import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  QrCode, 
  MessageSquare, 
  Sparkles, 
  ShieldCheck, 
  ShieldAlert,
  Sliders, 
  Send,
  RefreshCw,
  Building2,
  CheckCircle2,
  Sun,
  Moon,
  Store,
  Laptop2,
  LogIn,
  LogOut,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  Users,
  Wrench,
  FileSpreadsheet,
  Calendar,
  Save,
  AlertTriangle,
  Link2,
  ExternalLink,
  Truck,
  UserPlus,
  Package,
  Trash2,
  MapPin,
  Phone,
  Key,
  Copy,
  Check,
  Settings,
  BarChart3,
  Search,
  Clock,
  User,
  Download,
  Smartphone,
  Share
} from 'lucide-react';

const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || port === '5174') {
      return `http://${hostname}:3002`;
    }
    return `${protocol}//${hostname}`;
  }
  return 'http://localhost:3002';
};

const getGatewayBase = () => {
  if (import.meta.env.VITE_GATEWAY_BASE) return import.meta.env.VITE_GATEWAY_BASE;
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || port === '5174') {
      return `http://${hostname}:3003`;
    }
    return `${protocol}//${hostname}`;
  }
  return 'http://localhost:3003';
};

const API_BASE = getApiBase();
const GATEWAY_BASE = getGatewayBase();

// Extraer ID de carpeta de Google Drive si el usuario pega la URL completa de Drive
function extractDriveFolderId(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

// Extraer ID de hoja de cálculo si el usuario pega la URL completa de Google Sheets
function extractSpreadsheetId(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

// Generar slug URL autolimpiado y verificado contra duplicidad en la lista de tenants
function generateSlug(text, existingTenants = []) {
  if (!text) return '';
  let slug = text.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remover tildes/acentos
    .replace(/[^a-z0-9]+/g, '-')                    // caracteres especiales a guión
    .replace(/^-+|-+$/g, '');                        // quitar guiones extremos

  if (!slug) return '';

  let candidate = slug;
  let counter = 1;
  const existingSlugs = new Set((existingTenants || []).map(t => t.slug?.toLowerCase()));

  while (existingSlugs.has(candidate)) {
    candidate = `${slug}-${counter}`;
    counter++;
  }
  return candidate;
}

// Función para obtener iniciales del usuario para el avatar
function getUserInitials(user) {
  if (user?.name) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } else if (parts[0]) {
      return parts[0].substring(0, 2).toUpperCase();
    }
  }
  if (user?.email) {
    const namePart = user.email.split('@')[0];
    const parts = namePart.split(/[\._\-]/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return namePart.substring(0, 2).toUpperCase();
  }
  return 'WS';
}

// Formatear texto con formato ligero de Markdown para los globos de chat
function renderFormattedText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    let formattedLine = line
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');

    return (
      <React.Fragment key={idx}>
        <span dangerouslySetInnerHTML={{ __html: formattedLine }} />
        {idx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

export default function App() {
  // Inicialización inteligente de pestaña activa manteniendo posición tras refresco u OAuth redirect
  const [activeTab, setActiveTabState] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlTab = urlParams.get('tab');
      if (urlParams.get('google_connected') === 'true' || urlTab === 'tools') {
        return 'tools';
      }
      if (urlTab && ['chats', 'qr', 'prompt', 'tools', 'logistics', 'msp'].includes(urlTab)) {
        return urlTab;
      }
      const savedTab = localStorage.getItem('ws_active_tab');
      if (savedTab && ['chats', 'qr', 'prompt', 'tools', 'logistics', 'msp'].includes(savedTab)) {
        return savedTab;
      }
    }
    return 'chats';
  });

  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ws_active_tab', tab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const [theme, setTheme] = useState('light');

  // Estado de Autenticación
  const [token, setToken] = useState(localStorage.getItem('ws_token') || '');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Aplicar tema claro/oscuro
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  const logoSrc = theme === 'dark' ? '/websavvy-dark-transparency.png' : '/websavvy.png';

  // Estado de Usuario Autenticado
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('ws_user');
    if (savedUser) {
      try { return JSON.parse(savedUser); } catch(e) {}
    }
    return {
      id: 'user-admin-msp',
      name: 'Superadmin MSP',
      email: 'admin@websavvy.com',
      role: 'SUPERADMIN_MSP',
      tenant_id: 'tenant-msp-001',
      effectiveTenantId: 'tenant-msp-001',
      isImpersonating: false,
      tenantName: 'WebSavvy MSP Central'
    };
  });

  const isDemoMode = !!user.is_demo_mode && user.role !== 'SUPERADMIN_MSP';

  useEffect(() => {
    if (isDemoMode && ['prompt', 'tools', 'logistics', 'msp'].includes(activeTab)) {
      setActiveTabState('chats');
    }
  }, [isDemoMode, activeTab]);

  // Lista de Tenants y Planes disponibles (MSP)
  const [tenants, setTenants] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [planForm, setPlanForm] = useState({ id: '', name: '', max_distributors: 3, max_drivers: 1, description: '' });

  // Modal para Nuevo Tenant (MSP)
  const [showNewTenantModal, setShowNewTenantModal] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantSlug, setNewTenantSlug] = useState('');
  const [newTenantPlan, setNewTenantPlan] = useState('emprendedor');
  const [newTenantAdminName, setNewTenantAdminName] = useState('');
  const [newTenantAdminEmail, setNewTenantAdminEmail] = useState('');
  const [newTenantIsDemoMode, setNewTenantIsDemoMode] = useState(false);
  const [createdTenantCredentials, setCreatedTenantCredentials] = useState(null);
  const [isCreatingTenant, setIsCreatingTenant] = useState(false);
  const [mspResetCredentialsModal, setMspResetCredentialsModal] = useState(null);

  // Estados de Reseteo y Cambio de Contraseña
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetEmailInput, setResetEmailInput] = useState('');
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [copiedTempPassword, setCopiedTempPassword] = useState(false);

  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [changePasswordMsg, setChangePasswordMsg] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Estados de Observabilidad de Tokens (MSP)
  const [tokenMetricsPeriod, setTokenMetricsPeriod] = useState('30days');
  const [tokenMetrics, setTokenMetrics] = useState({
    summary: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalMessages: 0, estimatedCostUsd: 0 },
    tenants: []
  });
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);


  // Estados para Instalación de PWA (Android & iOS)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [showIosInstallModal, setShowIosInstallModal] = useState(false);
  const [showPwaToastBanner, setShowPwaToastBanner] = useState(true);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsStandaloneApp(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    setIsIosDevice(isIos);

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleTriggerPwaInstall = () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          setDeferredInstallPrompt(null);
        }
      });
    } else if (isIosDevice) {
      setShowIosInstallModal(true);
    } else {
      alert('Para instalar WebSavvy AI en tu dispositivo, selecciona "Agregar a la pantalla de inicio" desde el menú de opciones de tu navegador.');
    }
  };

  // Estado del QR y Gateway
  const [qrStatus, setQrStatus] = useState('DISCONNECTED');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [connectedPhone, setConnectedPhone] = useState('50588713689');
  const [connectionMode, setConnectionMode] = useState('CENTRALIZED');
  const [isChangingMode, setIsChangingMode] = useState(false);

  // Estado de Prompts & Wizard
  const [promptTitle, setPromptTitle] = useState('Agente Principal');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [wizardData, setWizardData] = useState({
    businessName: 'MenuView',
    businessType: 'Menús Digitales Interactivos SaaS para Restaurantes, Bares y Hoteles',
    goals: 'Venta de suscripciones, demostración de menús interactivos y alta de clientes',
    tone: 'Profesional, ejecutiva, empática, ágil y comercial',
    details: 'Digitalización en 24h ($20 USD). Demos: sweet-boutique-ni y bella-vista. Planes: Emprendedor $6/mes, Crecimiento $20/mes, Pro $40/mes. Notificar ventas a Alejandro Morales.'
  });
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Estado de Versiones de Respaldos de System Prompt
  const [promptVersions, setPromptVersions] = useState([]);
  const [showSaveVersionModal, setShowSaveVersionModal] = useState(false);
  const [versionForm, setVersionForm] = useState({ title: '', description: '' });
  const [isSavingVersion, setIsSavingVersion] = useState(false);

  // Estado de Herramientas (Google Sheets, Google Calendar & Google Drive)
  const [googleAccountEmail, setGoogleAccountEmail] = useState('');
  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState('');
  const [sheetsDefaultRange, setSheetsDefaultRange] = useState('Sheet1!A:Z');
  const [sheetsCredsJson, setSheetsCredsJson] = useState('');
  const [sheetsIsEnabled, setSheetsIsEnabled] = useState(false);
  const [sheetsHasCreds, setSheetsHasCreds] = useState(false);
  const [isSavingSheets, setIsSavingSheets] = useState(false);
  const [isTestingSheets, setIsTestingSheets] = useState(false);

  // Google Drive
  const [driveFolderId, setDriveFolderId] = useState('');
  const [driveIsEnabled, setDriveIsEnabled] = useState(false);
  const [isSavingDrive, setIsSavingDrive] = useState(false);

  // Estado del Copiloto Asistente de Prompts MSP
  const [copilotModelChoice, setCopilotModelChoice] = useState('gemini-2.5-flash');
  const [copilotChatInput, setCopilotChatInput] = useState('');
  const [copilotMessages, setCopilotMessages] = useState([]);
  const [isCopilotThinking, setIsCopilotThinking] = useState(false);

  const extractPromptFromText = (text) => {
    if (!text) return null;
    const match = text.match(/```system_prompt\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return null;
  };

  const handleSendCopilotMessage = async () => {
    if (!token || !copilotChatInput.trim()) return;
    const userText = copilotChatInput.trim();
    setCopilotChatInput('');

    const updatedHistory = [...copilotMessages, { role: 'user', text: userText }];
    setCopilotMessages(updatedHistory);
    setIsCopilotThinking(true);

    try {
      const res = await fetch(`${API_BASE}/api/ai/copilot-generate-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          userMessage: userText,
          history: copilotMessages,
          modelChoice: copilotModelChoice,
          tenantName: user.tenantName,
          tenantId: user.effectiveTenantId || user.tenant_id
        })
      });

      const data = await res.json();
      if (data.reply) {
        setCopilotMessages([...updatedHistory, { role: 'model', text: data.reply }]);
      } else {
        alert(`Error del Copiloto: ${data.error || 'No se recibió respuesta'}`);
      }
    } catch (e) {
      alert('Error de conexión al consultar al Copiloto MSP');
    } finally {
      setIsCopilotThinking(false);
    }
  };

  const handleApplyCopilotPrompt = async (extractedPrompt) => {
    if (!extractedPrompt) return;
    setSystemPrompt(extractedPrompt);
    try {
      const res = await fetch(`${API_BASE}/api/prompts/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          title: 'Agente Principal (Generado por Copiloto MSP)',
          system_prompt: extractedPrompt,
          temperature: 0.7
        })
      });
      if (res.ok) {
        alert(`🎉 ¡Prompt aplicado y guardado exitosamente para ${user.tenantName}!`);
      } else {
        alert('Prompt cargado en el editor.');
      }
    } catch (e) {
      alert('Prompt cargado en el editor.');
    }
  };

  const [calCalendarId, setCalCalendarId] = useState('primary');
  const [calTimezone, setCalTimezone] = useState('America/Tegucigalpa');
  const [calCredsJson, setCalCredsJson] = useState('');
  const [calIsEnabled, setCalIsEnabled] = useState(false);
  const [calHasCreds, setCalHasCreds] = useState(false);
  const [isSavingCal, setIsSavingCal] = useState(false);
  const [isTestingCal, setIsTestingCal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Estado del Módulo de Logística (Distribuidores, Repartidores y Pedidos)
  const [logisticsSummary, setLogisticsSummary] = useState({
    planDisplayName: 'Cargando...',
    distributors: { current: 0, max: 0, canAdd: false },
    drivers: { current: 0, max: 0, canAdd: false },
    totalOrders: 0
  });
  const [distributors, setDistributors] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [orders, setOrders] = useState([]);

  // Formulario nuevo Distribuidor
  const [newDistName, setNewDistName] = useState('');
  const [newDistPhone, setNewDistPhone] = useState('');
  const [newDistAddress, setNewDistAddress] = useState('');
  const [isAddingDist, setIsAddingDist] = useState(false);

  // Formulario nuevo Repartidor
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverVehicle, setNewDriverVehicle] = useState('Moto');
  const [isAddingDriver, setIsAddingDriver] = useState(false);

  // Módulo de Chats en Vivo / Human Takeover
  const [chats, setChats] = useState([]);
  const [selectedChatJid, setSelectedChatJid] = useState('');
  const [activeChatMessages, setActiveChatMessages] = useState([]);
  const [humanReplyText, setHumanReplyText] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');

  const messagesEndRef = useRef(null);

  const formatChatTime = (dateStr, full = false) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

    if (full) {
      if (isToday) return timeStr;
      if (isYesterday) return `Ayer ${timeStr}`;
      return `${date.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${timeStr}`;
    } else {
      if (isToday) return timeStr;
      if (isYesterday) return 'Ayer';
      return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    }
  };

  // Capturar respuesta de redirección Google OAuth2
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('google_connected') === 'true') {
      const email = urlParams.get('email');
      setActiveTab('tools');
      fetchIntegrations();
      alert(`🎉 ¡Conexión Exitosa con Google!\nCuenta vinculada: ${email}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [token, user.effectiveTenantId]);

  // Escuchar stream SSE de QR
  useEffect(() => {
    if (!token) return;
    const tenantId = user.effectiveTenantId || user.tenant_id;
    const eventSource = new EventSource(`${GATEWAY_BASE}/api/gateway/qr-stream/${tenantId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'CONNECTED') {
          setQrStatus('CONNECTED');
          setConnectedPhone(data.phoneNumber || 'Conectado');
          setQrDataUrl('');
        } else if (data.status === 'RELAY_MODE') {
          setQrStatus('RELAY_MODE');
          if (data.phoneNumber) setConnectedPhone(data.phoneNumber);
          setQrDataUrl('');
        } else if (data.status === 'QR_READY') {
          setQrStatus('QR_READY');
          setQrDataUrl(data.qrDataUrl);
        } else {
          setQrStatus('DISCONNECTED');
          setQrDataUrl('');
        }
      } catch (e) {}
    };

    return () => eventSource.close();
  }, [user.effectiveTenantId, token]);

  // Cargar lista de Tenants (Superadmin MSP)
  const fetchTenants = async () => {
    if (!token || user.role !== 'SUPERADMIN_MSP') return;
    try {
      const res = await fetch(`${API_BASE}/api/tenants`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTenants(data);
      }
    } catch (e) {}
  };

  // Cargar métricas de observabilidad de tokens (MSP)
  const fetchTokenMetrics = async (period = tokenMetricsPeriod) => {
    if (!token || user.role !== 'SUPERADMIN_MSP') return;
    setIsLoadingMetrics(true);
    try {
      const res = await fetch(`${API_BASE}/api/analytics/token-metrics?period=${period}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTokenMetrics(data);
      }
    } catch (e) {
      console.error('Error cargando métricas de tokens:', e);
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  // Cargar datos del módulo de logística
  const fetchLogisticsData = async () => {
    if (!token) return;
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Impersonate-Tenant-Id': currentTenantId
    };

    try {
      const [sumRes, distRes, driverRes, orderRes] = await Promise.all([
        fetch(`${API_BASE}/api/logistics/summary`, { headers }),
        fetch(`${API_BASE}/api/logistics/distributors`, { headers }),
        fetch(`${API_BASE}/api/logistics/drivers`, { headers }),
        fetch(`${API_BASE}/api/logistics/orders`, { headers })
      ]);

      if (sumRes.ok) setLogisticsSummary(await sumRes.json());
      if (distRes.ok) setDistributors(await distRes.json());
      if (driverRes.ok) setDrivers(await driverRes.json());
      if (orderRes.ok) setOrders(await orderRes.json());
    } catch (e) {
      console.error('Error cargando datos logísticos:', e);
    }
  };

  // Cargar chats del tenant activo
  const fetchChats = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/chats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        }
      });
      if (res.ok) {
        const data = await res.json();
        setChats(data);
        setSelectedChatJid(prevJid => {
          if (prevJid && data.some(c => c.sender_jid === prevJid)) {
            return prevJid; // CONSERVAR EL CHAT QUE EL OPERADOR TIENE SELECCIONADO
          }
          return data.length > 0 ? data[0].sender_jid : '';
        });
      }
    } catch (e) {}
  };

  // Cargar historial completo de mensajes del chat seleccionado
  const fetchActiveChatMessages = async (jid) => {
    if (!token || !jid) return;
    try {
      const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(jid)}/messages`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        }
      });
      if (res.ok) {
        const data = await res.json();
        setActiveChatMessages(data.messages || []);
      }
    } catch (e) {
      console.error('Error cargando mensajes del chat:', e);
    }
  };

  // Cargar prompt activo del tenant actual
  const fetchPrompt = async () => {
    if (!token) return;
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/prompts/active`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': currentTenantId
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.system_prompt) {
          setSystemPrompt(data.system_prompt);
          setPromptTitle(data.title || 'Agente Principal');
        }
      }
    } catch (e) {
      console.error('Error cargando prompt:', e);
    }
  };

  // Cargar versiones de respaldo del prompt
  const fetchPromptVersions = async () => {
    if (!token) return;
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/prompts/versions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': currentTenantId
        }
      });
      if (res.ok) {
        const data = await res.json();
        setPromptVersions(data);
      }
    } catch (e) {
      console.error('Error cargando versiones de prompt:', e);
    }
  };

  const handleSaveVersion = async (e) => {
    e.preventDefault();
    if (!systemPrompt.trim()) {
      alert('El System Prompt actual no puede estar vacío.');
      return;
    }
    setIsSavingVersion(true);
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/prompts/versions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': currentTenantId
        },
        body: JSON.stringify({
          title: versionForm.title || 'Respaldo de Prompt',
          description: versionForm.description || '',
          system_prompt: systemPrompt
        })
      });
      if (res.ok) {
        setShowSaveVersionModal(false);
        setVersionForm({ title: '', description: '' });
        await fetchPromptVersions();
        alert('¡Versión de respaldo guardada con éxito!');
      } else {
        const err = await res.json();
        alert('Error al guardar versión: ' + (err.error || 'Intente nuevamente'));
      }
    } catch (e) {
      alert('Error al conectar con el servidor: ' + e.message);
    } finally {
      setIsSavingVersion(false);
    }
  };

  const handleRestoreVersion = async (v) => {
    if (!window.confirm(`¿Deseas restaurar la versión "${v.title}" como el System Prompt Principal activo?`)) return;
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/prompts/versions/${v.id}/restore`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': currentTenantId
        }
      });
      if (res.ok) {
        setSystemPrompt(v.system_prompt);
        setPromptTitle(v.title);
        await fetchPromptVersions();
        alert(`¡System Prompt Principal restaurado con éxito a la versión "${v.title}"!`);
      } else {
        const err = await res.json();
        alert('Error al restaurar versión: ' + (err.error || 'Intente nuevamente'));
      }
    } catch (e) {
      alert('Error al conectar con el servidor: ' + e.message);
    }
  };

  const handleDeleteVersion = async (versionId) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta versión de respaldo?')) return;
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/prompts/versions/${versionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': currentTenantId
        }
      });
      if (res.ok) {
        await fetchPromptVersions();
      }
    } catch (e) {
      console.error('Error al eliminar versión:', e);
    }
  };

  // Cargar integraciones del tenant activo
  const fetchIntegrations = async () => {
    if (!token) return;
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/integrations`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': currentTenantId
        }
      });
      if (res.ok) {
        const data = await res.json();
        let emailFound = '';

        if (data.GOOGLE_SHEETS) {
          setSheetsIsEnabled(data.GOOGLE_SHEETS.is_enabled);
          setSheetsSpreadsheetId(data.GOOGLE_SHEETS.config.spreadsheet_id || '');
          setSheetsDefaultRange(data.GOOGLE_SHEETS.config.default_sheet_name || 'Sheet1!A:Z');
          setSheetsHasCreds(data.GOOGLE_SHEETS.has_credentials);
          if (data.GOOGLE_SHEETS.has_credentials && data.GOOGLE_SHEETS.account_email) {
            emailFound = data.GOOGLE_SHEETS.account_email;
          }
        } else {
          setSheetsIsEnabled(false);
          setSheetsSpreadsheetId('');
          setSheetsDefaultRange('Sheet1!A:Z');
          setSheetsHasCreds(false);
        }

        if (data.GOOGLE_CALENDAR) {
          setCalIsEnabled(data.GOOGLE_CALENDAR.is_enabled);
          setCalCalendarId(data.GOOGLE_CALENDAR.config.calendar_id || 'primary');
          setCalTimezone(data.GOOGLE_CALENDAR.config.timezone || 'America/Tegucigalpa');
          setCalHasCreds(data.GOOGLE_CALENDAR.has_credentials);
          if (data.GOOGLE_CALENDAR.has_credentials && data.GOOGLE_CALENDAR.account_email) {
            emailFound = data.GOOGLE_CALENDAR.account_email;
          }
        } else {
          setCalIsEnabled(false);
          setCalCalendarId('primary');
          setCalTimezone('America/Tegucigalpa');
          setCalHasCreds(false);
        }

        if (data.GOOGLE_DRIVE) {
          setDriveIsEnabled(data.GOOGLE_DRIVE.is_enabled);
          setDriveFolderId(data.GOOGLE_DRIVE.config?.folder_id || '');
          if (!emailFound && data.GOOGLE_DRIVE.account_email) {
            emailFound = data.GOOGLE_DRIVE.account_email;
          }
        } else {
          setDriveIsEnabled(false);
          setDriveFolderId('');
        }

        setGoogleAccountEmail(emailFound);
      }
    } catch (e) {
      console.error('Error cargando integraciones:', e);
    }
  };

  // Iniciar flujo OAuth2 "Conectar con Google"
  const handleDisconnectWhatsApp = async () => {
    if (!window.confirm('¿Está seguro de que desea desvincular el dispositivo de WhatsApp actual para este tenant?')) return;
    
    setIsDisconnecting(true);
    try {
      const res = await fetch(`${GATEWAY_BASE}/api/gateway/disconnect/${user.effectiveTenantId || user.tenant_id}`, { method: 'POST' });
      if (res.ok) {
        setQrStatus('DISCONNECTED');
        setConnectedPhone('');
        setQrDataUrl('');
      } else {
        alert('Hubo un error al desvincular WhatsApp.');
      }
    } catch (err) {
      alert('Error de red al desvincular WhatsApp.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleConnectGoogle = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/integrations/google/auth-url`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        }
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Error obteniendo la URL de autorización de Google');
      }
    } catch (e) {
      alert('Error conectando con el servidor de autenticación');
    }
  };

  // Guardar prompt activo en PostgreSQL
  const handleSavePrompt = async () => {
    if (!token || !systemPrompt.trim()) return;
    setIsSavingPrompt(true);
    try {
      const res = await fetch(`${API_BASE}/api/prompts/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          title: promptTitle,
          system_prompt: systemPrompt,
          temperature: 0.7
        })
      });

      if (res.ok) {
        alert(`System Prompt guardado exitosamente para ${user.tenantName}`);
      } else {
        const err = await res.json();
        alert(`Error al guardar prompt: ${err.error || 'Intente de nuevo'}`);
      }
    } catch (e) {
      alert('Error de conexión al guardar el prompt');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  // Guardar configuración de Google Sheets con extracción automática de ID
  const handleSaveSheets = async () => {
    if (!token) return;
    setIsSavingSheets(true);
    const cleanId = extractSpreadsheetId(sheetsSpreadsheetId);
    setSheetsSpreadsheetId(cleanId);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          spreadsheet_id: cleanId,
          default_sheet_name: sheetsDefaultRange,
          credentials_json: sheetsCredsJson.trim() || undefined,
          is_enabled: sheetsIsEnabled
        })
      });
      if (res.ok) {
        alert(`Configuración de Google Sheets guardada para ${user.tenantName}`);
        setSheetsCredsJson('');
        fetchIntegrations();
      } else {
        const err = await res.json();
        alert(`Error al guardar Google Sheets: ${err.error}`);
      }
    } catch (e) {
      alert('Error guardando configuración de Google Sheets');
    } finally {
      setIsSavingSheets(false);
    }
  };

  // Probar conexión con Google Sheets
  const handleTestSheets = async () => {
    if (!token) return;
    setIsTestingSheets(true);
    const cleanId = extractSpreadsheetId(sheetsSpreadsheetId);
    setSheetsSpreadsheetId(cleanId);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          integration_type: 'GOOGLE_SHEETS',
          spreadsheet_id: cleanId,
          credentials_json: sheetsCredsJson.trim() || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ${data.message}`);
      } else {
        const errMsg = data.error || '';
        if (errMsg.includes('invalid_grant') || errMsg.includes('expiró') || errMsg.includes('revocada')) {
          alert(`⚠️ La sesión de Google OAuth ha expirado o fue revocada por Google (los tokens de prueba expiran a los 7 días).\n\nPor favor haz clic arriba en el botón "Reconectar / Cambiar Cuenta de Google" para renovar los permisos de acceso.`);
        } else {
          alert(`❌ Error en prueba de Google Sheets: ${errMsg}`);
        }
      }
    } catch (e) {
      alert('Error probando conexión con Google Sheets');
    } finally {
      setIsTestingSheets(false);
    }
  };

  // Sincronizar catálogo de Google Sheets con la tabla de Embeddings de Postgres
  const [isSyncingEmbeddings, setIsSyncingEmbeddings] = useState(false);

  const handleSyncSheetsEmbeddings = async () => {
    if (!token) return;
    setIsSyncingEmbeddings(true);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/google/sync-sheets-embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        }
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ${data.message}`);
      } else {
        const errMsg = data.error || '';
        if (errMsg.includes('invalid_grant') || errMsg.includes('expiró') || errMsg.includes('revocada')) {
          alert(`⚠️ La sesión de Google OAuth ha expirado o fue revocada por Google (los tokens de prueba expiran a los 7 días).\n\nPor favor haz clic arriba en el botón "Reconectar / Cambiar Cuenta de Google" para renovar el acceso.`);
        } else {
          alert(`❌ Error en sincronización: ${errMsg}`);
        }
      }
    } catch (e) {
      alert('Error de conexión al sincronizar la hoja con la base de datos de vectores');
    } finally {
      setIsSyncingEmbeddings(false);
    }
  };

  // Guardar configuración de Google Calendar
  const handleSaveCalendar = async () => {
    if (!token) return;
    setIsSavingCal(true);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/calendar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          calendar_id: calCalendarId,
          timezone: calTimezone,
          credentials_json: calCredsJson.trim() || undefined,
          is_enabled: calIsEnabled
        })
      });
      if (res.ok) {
        alert(`Configuración de Google Calendar guardada para ${user.tenantName}`);
        setCalCredsJson('');
        fetchIntegrations();
      } else {
        const err = await res.json();
        alert(`Error al guardar Google Calendar: ${err.error}`);
      }
    } catch (e) {
      alert('Error guardando configuración de Google Calendar');
    } finally {
      setIsSavingCal(false);
    }
  };

  // Probar conexión con Google Calendar
  const handleTestCalendar = async () => {
    if (!token) return;
    setIsTestingCal(true);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          integration_type: 'GOOGLE_CALENDAR',
          calendar_id: calCalendarId,
          credentials_json: calCredsJson.trim() || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ${data.message}`);
      } else {
        alert(`❌ Error en prueba de Google Calendar: ${data.error}`);
      }
    } catch (e) {
      alert('Error probando conexión con Google Calendar');
    } finally {
      setIsTestingCal(false);
    }
  };

  // Guardar configuración de Google Drive
  const handleSaveDrive = async () => {
    if (!token) return;
    setIsSavingDrive(true);
    try {
      const cleanFolderId = extractDriveFolderId(driveFolderId);
      setDriveFolderId(cleanFolderId);
      const res = await fetch(`${API_BASE}/api/integrations/drive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          folder_id: cleanFolderId,
          is_enabled: driveIsEnabled
        })
      });
      if (res.ok) {
        alert('✅ Configuración de Google Drive guardada con éxito.');
        fetchIntegrations();
      } else {
        const errData = await res.json();
        alert(`❌ Error guardando Google Drive: ${errData.error}`);
      }
    } catch (e) {
      alert('Error de red guardando Google Drive');
    } finally {
      setIsSavingDrive(false);
    }
  };

  // Agregar Distribuidor (validando cuota)
  const handleAddDistributor = async (e) => {
    e.preventDefault();
    if (!newDistName || !newDistPhone) return;
    setIsAddingDist(true);
    try {
      const res = await fetch(`${API_BASE}/api/logistics/distributors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          name: newDistName,
          phone_whatsapp: newDistPhone,
          address_location: newDistAddress
        })
      });

      if (res.ok) {
        setNewDistName('');
        setNewDistPhone('');
        setNewDistAddress('');
        fetchLogisticsData();
      } else {
        const err = await res.json();
        alert(`⚠️ ${err.error}`);
      }
    } catch (e) {
      alert('Error agregando distribuidor');
    } finally {
      setIsAddingDist(false);
    }
  };

  // Eliminar Distribuidor
  const handleDeleteDistributor = async (id) => {
    if (!confirm('¿Deseas eliminar este distribuidor?')) return;
    try {
      await fetch(`${API_BASE}/api/logistics/distributors/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        }
      });
      fetchLogisticsData();
    } catch (e) {}
  };

  // Agregar Repartidor (validando cuota)
  const handleAddDriver = async (e) => {
    e.preventDefault();
    if (!newDriverName || !newDriverPhone) return;
    setIsAddingDriver(true);
    try {
      const res = await fetch(`${API_BASE}/api/logistics/drivers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        },
        body: JSON.stringify({
          name: newDriverName,
          phone_whatsapp: newDriverPhone,
          vehicle_type: newDriverVehicle
        })
      });

      if (res.ok) {
        setNewDriverName('');
        setNewDriverPhone('');
        fetchLogisticsData();
      } else {
        const err = await res.json();
        alert(`⚠️ ${err.error}`);
      }
    } catch (e) {
      alert('Error agregando repartidor');
    } finally {
      setIsAddingDriver(false);
    }
  };

  // Eliminar Repartidor
  const handleDeleteDriver = async (id) => {
    if (!confirm('¿Deseas eliminar este repartidor?')) return;
    try {
      await fetch(`${API_BASE}/api/logistics/drivers/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId || user.tenant_id
        }
      });
      fetchLogisticsData();
    } catch (e) {}
  };

  // Actualizar Plan de Tenant (Superadmin MSP CRUD)
  const handleUpdateTenantPlan = async (tenantId, newPlan) => {
    try {
      const res = await fetch(`${API_BASE}/api/tenants/${tenantId}/plan`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ plan: newPlan })
      });

      if (res.ok) {
        fetchTenants();
        fetchLogisticsData();
        alert(`Plan actualizado a ${newPlan.toUpperCase()} para el tenant ${tenantId}`);
      } else {
        const err = await res.json();
        alert(`Error al actualizar plan: ${err.error}`);
      }
    } catch (e) {
      alert('Error actualizando plan');
    }
  };

  // Alternar Modo Demo de Tenant (Superadmin MSP CRUD)
  const handleToggleTenantDemoMode = async (tenantId, currentDemoStatus) => {
    const nextStatus = !currentDemoStatus;
    try {
      const res = await fetch(`${API_BASE}/api/tenants/${tenantId}/demo-mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isDemoMode: nextStatus })
      });

      if (res.ok) {
        fetchTenants();
        if (user.effectiveTenantId === tenantId || user.tenant_id === tenantId) {
          setUser(prev => {
            const updated = { ...prev, is_demo_mode: nextStatus };
            localStorage.setItem('ws_user', JSON.stringify(updated));
            return updated;
          });
        }
      } else {
        const err = await res.json();
        alert(`Error al actualizar modo demo: ${err.error}`);
      }
    } catch (e) {
      alert('Error de red al actualizar modo demo');
    }
  };

  // Alternar Connection Mode de Tenant (Superadmin MSP CRUD)
  const handleUpdateTenantConnectionModeMSP = async (tenantId, mode) => {
    try {
      const res = await fetch(`${API_BASE}/api/tenants/${tenantId}/connection-mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ mode })
      });

      if (res.ok) {
        fetchTenants();
        if (user.effectiveTenantId === tenantId || user.tenant_id === tenantId) {
          setConnectionMode(mode);
        }
      } else {
        const err = await res.json();
        alert(`Error al actualizar connection mode: ${err.error}`);
      }
    } catch (e) {
      alert('Error de red al actualizar connection mode');
    }
  };

  // Resetear Contraseña de Tenant (Generar Clave Temporal para el Cliente - MSP)
  const handleResetTenantPasswordMSP = async (t) => {
    if (!confirm(`¿Deseas generar una contraseña temporal de acceso para la empresa "${t.name}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/tenants/${t.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        setMspResetCredentialsModal({
          tenantName: t.name,
          email: data.email,
          tempPassword: data.tempPassword
        });
      } else {
        const err = await res.json();
        alert(`Error reseteando clave: ${err.error}`);
      }
    } catch (e) {
      alert('Error de conexión reseteando contraseña');
    }
  };

  // Cargar lista de planes de suscripción MSP
  const fetchPlans = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plans`);
      if (res.ok) {
        const data = await res.json();
        setSubscriptionPlans(data);
      }
    } catch (e) {}
  };

  // Verificación de estado del Gateway de WhatsApp
  const fetchGatewayStatus = async (tId) => {
    if (!tId) return;
    try {
      const res = await fetch(`${GATEWAY_BASE}/api/gateway/status/${tId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.connectionMode) setConnectionMode(data.connectionMode);
        
        if (data.connected) {
          setQrStatus('CONNECTED');
          if (data.phoneNumber) setConnectedPhone(data.phoneNumber);
          setQrDataUrl('');
        } else if (data.status === 'RELAY_MODE' || data.connectionMode === 'RELAY') {
          setQrStatus('RELAY_MODE');
          if (data.phoneNumber) setConnectedPhone(data.phoneNumber);
          setQrDataUrl('');
        } else {
          setQrStatus(data.status || 'DISCONNECTED');
        }
      }
    } catch (e) {}
  };

  const handleUpdateConnectionMode = async (mode) => {
    if (!token) return;
    setIsChangingMode(true);
    const tenantId = user.effectiveTenantId || user.tenant_id;
    try {
      const res = await fetch(`${API_BASE}/api/tenants/${tenantId}/connection-mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ mode })
      });
      if (res.ok) {
        setConnectionMode(mode);
        alert(`Modo de conexión actualizado a: ${mode === 'CENTRALIZED' ? 'Servidor (Rápido)' : 'Dispositivo Local (Anti-Bloqueo)'}`);
      } else {
        const err = await res.json();
        alert('Error al actualizar el modo: ' + err.error);
      }
    } catch (e) {
      alert('Error de conexión al actualizar el modo.');
    } finally {
      setIsChangingMode(false);
    }
  };

  // Crear/Actualizar Plan en MSP Maestro
  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(planForm)
      });
      if (res.ok) {
        fetchPlans();
        setPlanForm({ id: '', name: '', max_distributors: 3, max_drivers: 1, description: '' });
        alert('Plan de suscripción guardado exitosamente');
      } else {
        const err = await res.json();
        alert(`Error al guardar plan: ${err.error}`);
      }
    } catch (e) {
      alert('Error guardando plan');
    }
  };

  // Crear Nuevo Tenant (MSP) con Administrador y Clave Temporal
  const handleCreateTenant = async (e) => {
    e.preventDefault();
    if (!token) return;
    setIsCreatingTenant(true);

    try {
      const res = await fetch(`${API_BASE}/api/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newTenantName,
          slug: newTenantSlug,
          plan: newTenantPlan,
          adminName: newTenantAdminName,
          adminEmail: newTenantAdminEmail,
          isDemoMode: newTenantIsDemoMode
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.adminUser) {
          setCreatedTenantCredentials(data.adminUser);
        }
        setNewTenantName('');
        setNewTenantSlug('');
        setNewTenantAdminName('');
        setNewTenantAdminEmail('');
        setNewTenantIsDemoMode(false);
        fetchTenants();
      } else {
        const err = await res.json();
        alert(`Error creando tenant: ${err.error}`);
      }
    } catch (e) {
      alert('Error de conexión creando tenant');
    } finally {
      setIsCreatingTenant(false);
    }
  };

  // Solicitud de Reseteo de Contraseña (Genera clave temporal)
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setIsResetting(true);
    setResetError('');
    setResetResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmailInput })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al solicitar el reseteo de contraseña');
      }
      setResetResult(data);
    } catch (err) {
      setResetError(err.message);
    } finally {
      setIsResetting(false);
    }
  };

  // Cambio de Contraseña para Usuario Autenticado
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setIsChangingPassword(true);
    setChangePasswordError('');
    setChangePasswordMsg('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al actualizar la contraseña');
      }
      setChangePasswordMsg('Contraseña actualizada exitosamente');
      setCurrentPasswordInput('');
      setNewPasswordInput('');
    } catch (err) {
      setChangePasswordError(err.message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  useEffect(() => {
    fetchChats();
    fetchPrompt();
    fetchPromptVersions();
    fetchIntegrations();
    fetchLogisticsData();
    fetchTenants();
    fetchPlans();
    fetchTokenMetrics(tokenMetricsPeriod);
    const currentTenantId = user.effectiveTenantId || user.tenant_id;
    fetchGatewayStatus(currentTenantId);

    const interval = setInterval(() => {
      fetchChats();
      if (selectedChatJid) {
        fetchActiveChatMessages(selectedChatJid);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [user.effectiveTenantId, token, tokenMetricsPeriod, activeTab, selectedChatJid]);

  useEffect(() => {
    if (selectedChatJid) {
      fetchActiveChatMessages(selectedChatJid);
    }
  }, [selectedChatJid, user.effectiveTenantId]);

  useEffect(() => {
    if (activeTab === 'chats' && selectedChatJid) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [selectedChatJid, activeChatMessages.length, activeTab]);


  // Login Handler Real
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });

      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        localStorage.setItem('ws_token', data.token);

        const targetTenantId = data.user.role === 'SUPERADMIN_MSP' ? 'tenant-websavvy-001' : data.user.tenant_id;
        const targetTenantName = data.user.role === 'SUPERADMIN_MSP' ? 'WebSavvySolutions' : (data.user.tenant_name || data.user.name);

        const newUserState = {
          ...data.user,
          effectiveTenantId: targetTenantId,
          isImpersonating: false,
          tenantName: targetTenantName
        };

        setUser(newUserState);
        localStorage.setItem('ws_user', JSON.stringify(newUserState));
        setActiveTab('chats');
      } else {
        setLoginError(data.error || 'Credenciales inválidas');
      }
    } catch (e) {
      setLoginError('Error conectando al servidor de autenticación');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Selector de Accesos Rápidos Demo
  const fillQuickDemo = (email, roleName) => {
    setLoginEmail(email);
    setLoginPassword('admin123');
  };

  // Logout
  const handleLogout = () => {
    setToken('');
    localStorage.removeItem('ws_token');
    localStorage.removeItem('ws_user');
  };

  // Switcher de Tenant (Impersonación MSP)
  const handleSwitchTenant = (targetTenantId) => {
    const target = tenants.find(t => t.id === targetTenantId) || { name: targetTenantId };

    const updatedUser = {
      ...user,
      effectiveTenantId: targetTenantId,
      isImpersonating: targetTenantId !== user.tenant_id,
      tenantName: target.name || targetTenantId,
      effectiveTenantAdminEmail: target.admin_email || null
    };

    setUser(updatedUser);
    localStorage.setItem('ws_user', JSON.stringify(updatedUser));

    fetch(`${API_BASE}/api/tenants/impersonate-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Impersonate-Tenant-Id': targetTenantId
      },
      body: JSON.stringify({ targetTenantId, action: 'IMPERSONATE_VIEW_SWITCH' })
    }).catch(() => {});
  };

  // Restaurar vista MSP
  const handleResetImpersonation = () => {
    const updatedUser = {
      ...user,
      effectiveTenantId: user.tenant_id,
      isImpersonating: false,
      tenantName: 'WebSavvy MSP Central'
    };
    setUser(updatedUser);
    localStorage.setItem('ws_user', JSON.stringify(updatedUser));
  };

  // Toggle Pausa de IA
  const handleToggleAiPause = async (jid, currentPaused) => {
    try {
      await fetch(`${API_BASE}/api/chats/${encodeURIComponent(jid)}/toggle-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId
        },
        body: JSON.stringify({ pause: !currentPaused })
      });

      setChats(prev => prev.map(c => c.sender_jid === jid ? { ...c, aiPaused: !currentPaused } : c));
    } catch (e) {}
  };

  // Enviar mensaje humano
  const handleSendHumanMessage = async () => {
    if (!humanReplyText.trim() || !selectedChatJid) return;

    const textToSend = humanReplyText;
    setHumanReplyText('');

    try {
      const res = await fetch(`${API_BASE}/api/chats/send-human`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Impersonate-Tenant-Id': user.effectiveTenantId
        },
        body: JSON.stringify({ toJid: selectedChatJid, text: textToSend })
      });

      if (res.ok) {
        setChats(prev => prev.map(c => c.sender_jid === selectedChatJid ? {
          ...c,
          outgoing_response: textToSend,
          handled_by_ai: false,
          aiPaused: true
        } : c));
        fetchActiveChatMessages(selectedChatJid);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    } catch (e) {
      alert('Error enviando mensaje humano');
    }
  };


  // Wizard Gemini
  const handleGeneratePromptWithAI = async () => {
    setIsGeneratingPrompt(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(wizardData)
      });

      const data = await res.json();
      if (data.system_prompt) setSystemPrompt(data.system_prompt);
    } catch (e) {
      alert('Prompt configurado.');
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const selectedChat = chats.find(c => c.sender_jid === selectedChatJid) || chats[0];

  // =========================================================================
  // VISTA DEDICADA DE LOGIN PROFESIONAL (SI NO HAY SESIÓN ACTIVA)
  // =========================================================================
  if (!token) {
    return (
      <div className="login-page-container">
        <div className="login-page-overlay"></div>

        <header className="login-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button className="theme-toggle-btn" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={18} color="#F59E0B" /> : <Moon size={18} color="#0284C7" />}
              <span>{theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}</span>
            </button>
          </div>
        </header>

        <div className="login-content">
          <div className="card login-card">
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <img src={logoSrc} alt="WebSavvy AI" style={{ height: '52px', margin: '0 auto 12px', display: 'block', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))' }} />
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#FFF' }}>Iniciar Sesión</h2>
              <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)', marginTop: '6px', lineHeight: '1.4' }}>
                Accede a la plataforma WebSavvy AI<br />
                para Automatización con Agentes IA
              </p>
            </div>

            {loginError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.25)', border: '1px solid #EF4444', color: '#FCA5A5', padding: '10px 14px', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '18px' }}>
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div className="input-group">
                <label style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>Correo Electrónico</label>
                <input 
                  className="input-control" 
                  type="email" 
                  placeholder="ejemplo@websavvy.com"
                  value={loginEmail} 
                  onChange={e => setLoginEmail(e.target.value)} 
                  required 
                />
              </div>

              <div className="input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ marginBottom: 0, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>Contraseña</label>
                  <button 
                    type="button" 
                    onClick={() => { setResetEmailInput(loginEmail); setShowResetPasswordModal(true); setResetResult(null); setResetError(''); }}
                    style={{ background: 'none', border: 'none', color: '#38BDF8', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}
                  >
                    🔑 ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <input 
                  className="input-control" 
                  type="password" 
                  placeholder="••••••••"
                  value={loginPassword} 
                  onChange={e => setLoginPassword(e.target.value)} 
                  required 
                />
              </div>

              <button type="submit" className="btn btn-whatsapp" style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: '12px', fontSize: '1rem', fontWeight: 700, borderRadius: '12px' }} disabled={isLoggingIn}>
                <LogIn size={20} /> {isLoggingIn ? 'Ingresando...' : 'Acceder al Sistema'}
              </button>
            </form>

            {!isStandaloneApp && (
              <div 
                onClick={handleTriggerPwaInstall}
                style={{
                  marginTop: '22px',
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(6,182,212,0.18) 100%)',
                  border: '1px solid rgba(16,185,129,0.4)',
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                className="pwa-install-card-banner"
              >
                <div style={{ width: '38px', height: '38px', background: 'linear-gradient(135deg, #10B981, #06B6D4)', color: '#FFF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Smartphone size={22} />
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#FFF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Instalar App en tu Teléfono</span>
                    <span style={{ fontSize: '0.68rem', background: '#10B981', color: '#FFF', padding: '1px 6px', borderRadius: '8px' }}>PWA</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.75)', marginTop: '2px' }}>
                    Acceso directo desde tu pantalla de inicio
                  </div>
                </div>
                <Download size={18} color="#10B981" />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }


  // =========================================================================
  // VISTA AUTENTICADA (DASHBOARD MULTI-TENANT & OPERADOR)
  // =========================================================================
  return (
    <div>
      {/* Banner de Impersonación para Superadmin MSP */}
      {user.role === 'SUPERADMIN_MSP' && user.isImpersonating && (
        <div className="impersonation-banner" style={{ background: 'linear-gradient(90deg, #D97706, #B45309)', color: '#FFF' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} />
            <span>
              ⚠️ MODO ASISTENCIA TÉCNICA / IMPERSONACIÓN: Administrando a <strong>{user.tenantName}</strong> ({user.effectiveTenantId})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'rgba(0,0,0,0.35)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '6px 14px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🏬 <span>{user.tenantName}</span>
            </div>
            <button onClick={handleResetImpersonation} style={{ background: '#FFF', color: '#B45309', border: 'none', fontWeight: 'bold', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}>
              🔴 Finalizar Asistencia / Volver a MSP Central
            </button>
          </div>
        </div>
      )}

      {/* Navbar Principal */}
      <nav className="navbar">
        <div className="brand">
          <img src={logoSrc} alt="WebSavvy Logo" className="brand-logo" />
          <span style={{ fontWeight: 800, letterSpacing: '-0.5px' }}>
            WebSavvy AI <span style={{ fontSize: '0.75rem', background: 'rgba(2,132,199,0.15)', color: 'var(--primary-cyan)', padding: '2px 8px', borderRadius: '10px', marginLeft: '4px' }}>Platform</span>
          </span>
          {isDemoMode && (
            <span style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              ⚡ Modo Demo (Prueba Gratuita)
            </span>
          )}
        </div>

        <div className="nav-links">
          {/* Pestañas de Navegación de Escritorio */}
          <div className="nav-desktop-tabs" style={{ display: 'flex', gap: '8px' }}>
            <button 
              className={`nav-btn ${activeTab === 'chats' ? 'active' : ''}`}
              onClick={() => setActiveTab('chats')}
            >
              <MessageSquare size={18} /> Chats
            </button>
            <button 
              className={`nav-btn ${activeTab === 'qr' ? 'active' : ''}`}
              onClick={() => setActiveTab('qr')}
            >
              <QrCode size={18} /> WhatsApp QR
            </button>

            {!isDemoMode && (
              <>
                <button 
                  className={`nav-btn ${activeTab === 'prompt' ? 'active' : ''}`}
                  onClick={() => setActiveTab('prompt')}
                >
                  <Sparkles size={18} /> Prompts & IA
                </button>
                <button 
                  className={`nav-btn ${activeTab === 'tools' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tools')}
                >
                  <Wrench size={18} /> Herramientas
                </button>
                <button 
                  className={`nav-btn ${activeTab === 'logistics' ? 'active' : ''}`}
                  onClick={() => setActiveTab('logistics')}
                >
                  <Truck size={18} /> Logística & Pedidos
                </button>
              </>
            )}

            {/* Opción exclusiva para Superadmin MSP */}
            {user.role === 'SUPERADMIN_MSP' && (
              <button 
                className={`nav-btn ${activeTab === 'msp' ? 'active' : ''}`}
                onClick={() => setActiveTab('msp')}
                style={{ color: '#8B5CF6' }}
              >
                <ShieldCheck size={18} /> Panel MSP Maestro
              </button>
            )}
          </div>

          <button className="theme-toggle-btn" onClick={toggleTheme} title="Cambiar Tema Claro / Oscuro">
            {theme === 'dark' ? <Sun size={18} color="#F59E0B" /> : <Moon size={18} color="#0284C7" />}
          </button>

          <div style={{ position: 'relative' }}>
            <button 
              className="user-avatar-btn"
              onClick={() => setShowUserDropdown(prev => !prev)}
              title={`Cuenta: ${user.name} (${user.email})`}
            >
              <div className="user-avatar-circle">
                {getUserInitials(user)}
              </div>
            </button>

            {showUserDropdown && (
              <div className="user-dropdown-menu">
                <div className="user-dropdown-header">
                  <div className="user-avatar-circle" style={{ width: '40px', height: '40px', fontSize: '0.95rem' }}>
                    {getUserInitials(user)}
                  </div>
                  <div className="user-info-text">
                    <span className="user-info-name">{user.name || 'Usuario'}</span>
                    <span className="user-info-email">{user.email || user.tenantName}</span>
                    <span className="user-role-badge">{user.role}</span>
                  </div>
                </div>

                <div style={{ height: '1px', background: 'var(--border-color)', margin: '8px 0' }} />

                <button className="user-dropdown-item" onClick={() => { setShowUserDropdown(false); setShowChangePasswordModal(true); setChangePasswordMsg(''); setChangePasswordError(''); }}>
                  <Key size={16} /> Cambiar Contraseña
                </button>

                <div style={{ height: '1px', background: 'var(--border-color)', margin: '6px 0' }} />

                <button className="user-dropdown-item logout-item" onClick={() => { setShowUserDropdown(false); handleLogout(); }}>
                  <LogOut size={16} /> Cerrar Sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>


      {/* Main Container */}
      <main className="container">


        {/* TAB 1: Live Chats */}
        {activeTab === 'chats' && (
          <div className="grid-2">
            {/* Panel Izquierdo: Conversaciones Entrantes */}
            <div className="card" style={{ height: '520px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
              <div className="card-title" style={{ marginBottom: '8px' }}>
                <Users color="var(--primary-cyan)" /> Conversaciones Entrantes ({user.tenantName})
              </div>
              <p style={{ color: 'var(--text-muted)', marginBottom: '12px', fontSize: '0.82rem' }}>
                Revisa las interacciones en tiempo real de WhatsApp e interviene cuando sea necesario.
              </p>

              {/* Buscador de Contactos y Mensajes */}
              <div style={{ position: 'relative', marginBottom: '12px' }}>
                <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="input-control" 
                  placeholder="Buscar conversación por teléfono o mensaje..." 
                  value={chatSearchQuery} 
                  onChange={e => setChatSearchQuery(e.target.value)} 
                  style={{ paddingLeft: '34px', fontSize: '0.84rem' }} 
                />
              </div>

              {/* Lista de Conversaciones */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                {chats.filter(c => {
                  if (!chatSearchQuery.trim()) return true;
                  const q = chatSearchQuery.toLowerCase();
                  return (c.sender_jid || '').toLowerCase().includes(q) ||
                         (c.incoming_text || '').toLowerCase().includes(q) ||
                         (c.outgoing_response || '').toLowerCase().includes(q);
                }).length > 0 ? (
                  chats.filter(c => {
                    if (!chatSearchQuery.trim()) return true;
                    const q = chatSearchQuery.toLowerCase();
                    return (c.sender_jid || '').toLowerCase().includes(q) ||
                           (c.incoming_text || '').toLowerCase().includes(q) ||
                           (c.outgoing_response || '').toLowerCase().includes(q);
                  }).map(chat => (
                    <div 
                      key={chat.id}
                      onClick={() => setSelectedChatJid(chat.sender_jid)}
                      style={{
                        padding: '12px',
                        borderRadius: '12px',
                        background: selectedChatJid === chat.sender_jid ? 'rgba(2,132,199,0.18)' : 'var(--input-bg)',
                        border: `1px solid ${selectedChatJid === chat.sender_jid ? 'var(--primary-cyan)' : 'var(--border-color)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: selectedChatJid === chat.sender_jid ? '0 4px 12px rgba(0, 194, 255, 0.15)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Phone size={13} color="var(--primary-cyan)" /> +{chat.sender_jid.split('@')[0]}
                        </strong>
                        {chat.created_at && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={11} /> {formatChatTime(chat.created_at)}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <p style={{ 
                          fontSize: '0.81rem', 
                          color: 'var(--text-muted)', 
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis',
                          flex: 1,
                          margin: 0
                        }}>
                          {chat.incoming_text ? (
                            <span><strong style={{ color: 'var(--text-main)' }}>Cliente:</strong> {chat.incoming_text}</span>
                          ) : chat.outgoing_response ? (
                            <span><strong style={{ color: 'var(--primary-cyan)' }}>{chat.handled_by_ai ? 'Gemini:' : 'Operador:'}</strong> {chat.outgoing_response}</span>
                          ) : (
                            'Sin mensajes recientes'
                          )}
                        </p>

                        <span style={{ 
                          fontSize: '0.68rem', 
                          padding: '2px 8px', 
                          borderRadius: '10px',
                          background: chat.aiPaused ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                          color: chat.aiPaused ? '#EF4444' : '#22C55E',
                          border: `1px solid ${chat.aiPaused ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                          fontWeight: '600',
                          whiteSpace: 'nowrap'
                        }}>
                          {chat.aiPaused ? '🔴 Humano' : '🟢 IA'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No se encontraron conversaciones
                  </div>
                )}
              </div>
            </div>

            {/* Panel Derecho: Historial de Mensajes y Envió Manual */}
            <div className="card" style={{ height: '520px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
              <div className="card-title" style={{ justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MessageSquare color="var(--primary-cyan)" /> 
                  <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: '700' }}>
                      {selectedChat ? '+' + selectedChat.sender_jid.split('@')[0] : 'Selecciona un chat'}
                    </div>
                    {selectedChat && selectedChat.created_at && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                        Última actividad: {formatChatTime(selectedChat.created_at, true)}
                      </div>
                    )}
                  </div>
                </div>
                
                {selectedChat && (
                  <button 
                    className={`btn ${selectedChat.aiPaused ? 'btn-secondary' : 'btn-whatsapp'}`}
                    style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                    onClick={() => handleToggleAiPause(selectedChat.sender_jid, selectedChat.aiPaused)}
                  >
                    {selectedChat.aiPaused ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                    {selectedChat.aiPaused ? 'Reanudar IA' : 'Pausar IA 30m'}
                  </button>
                )}
              </div>

              {selectedChat ? (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {/* Scroll container para los mensajes */}
                  <div 
                    style={{ 
                      flex: 1, 
                      minHeight: 0,
                      overflowY: 'auto', 
                      overflowX: 'hidden', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '12px', 
                      padding: '14px', 
                      background: 'var(--sim-bg)', 
                      borderRadius: '12px', 
                      marginBottom: '12px',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    {activeChatMessages && activeChatMessages.length > 0 ? (
                      activeChatMessages.map((msg, idx) => (
                        <div key={msg.id || idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {msg.incoming_text && (
                            <div className="chat-bubble incoming">
                              <div className="chat-bubble-header" style={{ color: 'var(--primary-cyan)' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><User size={13} /> Cliente</span>
                              </div>
                              <div>{renderFormattedText(msg.incoming_text)}</div>
                              {msg.created_at && (
                                <div className="chat-bubble-time">
                                  <Clock size={10} />
                                  <span>{formatChatTime(msg.created_at, true)}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {msg.outgoing_response && (
                            <div className="chat-bubble outgoing">
                              <div className="chat-bubble-header" style={{ color: msg.handled_by_ai ? '#A7F3D0' : '#FDE047' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {msg.handled_by_ai ? <Bot size={13} /> : <ShieldCheck size={13} />}
                                  {msg.handled_by_ai ? 'Gemini AI' : 'Operador Humano'}
                                </span>
                              </div>
                              <div>{renderFormattedText(msg.outgoing_response)}</div>
                              {msg.created_at && (
                                <div className="chat-bubble-time">
                                  <Clock size={10} />
                                  <span>{formatChatTime(msg.created_at, true)}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <>
                        {selectedChat.incoming_text && (
                          <div className="chat-bubble incoming">
                            <div className="chat-bubble-header" style={{ color: 'var(--primary-cyan)' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><User size={13} /> Cliente</span>
                            </div>
                            <div>{renderFormattedText(selectedChat.incoming_text)}</div>
                            {selectedChat.created_at && (
                              <div className="chat-bubble-time">
                                <Clock size={10} />
                                <span>{formatChatTime(selectedChat.created_at, true)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {selectedChat.outgoing_response && (
                          <div className="chat-bubble outgoing">
                            <div className="chat-bubble-header" style={{ color: selectedChat.handled_by_ai ? '#A7F3D0' : '#FDE047' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {selectedChat.handled_by_ai ? <Bot size={13} /> : <ShieldCheck size={13} />}
                                {selectedChat.handled_by_ai ? 'Gemini AI' : 'Operador Humano'}
                              </span>
                            </div>
                            <div>{renderFormattedText(selectedChat.outgoing_response)}</div>
                            {selectedChat.created_at && (
                              <div className="chat-bubble-time">
                                <Clock size={10} />
                                <span>{formatChatTime(selectedChat.created_at, true)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input para responder */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      className="input-control"
                      placeholder="Responder como operador humano directamente a WhatsApp..."
                      value={humanReplyText}
                      onChange={e => setHumanReplyText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendHumanMessage()}
                    />
                    <button className="btn btn-whatsapp" onClick={handleSendHumanMessage} title="Enviar Mensaje">
                      <Send size={18} />
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <MessageSquare size={36} style={{ marginBottom: '12px', opacity: 0.4 }} />
                  <div>Selecciona una conversación a la izquierda para interactuar</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: WhatsApp QR */}
        {activeTab === 'qr' && (
          <div className="grid-2">
            <div className="card">
              <div className="card-title">
                <QrCode /> Vinculación de WhatsApp — {user.tenantName}
              </div>
              <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.9rem' }}>
                Escanea el código QR desde tu celular para vincular el agente de <strong>{user.tenantName}</strong>.
              </p>

              <div style={{ textAlign: 'center', margin: '24px 0' }}>
                {qrStatus === 'CONNECTED' ? (
                  <div style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid var(--primary-green)', padding: '24px', borderRadius: '14px' }}>
                    <CheckCircle2 size={52} color="var(--primary-green)" style={{ margin: '0 auto 12px' }} />
                    <h3 style={{ color: 'var(--primary-green)', marginBottom: '4px' }}>¡WhatsApp Conectado!</h3>
                    <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', marginTop: '6px' }}>Número: <strong>+{connectedPhone}</strong></p>
                    <button 
                      className="btn btn-secondary" 
                      onClick={handleDisconnectWhatsApp} 
                      disabled={isDisconnecting}
                      style={{ marginTop: '16px', border: '1px solid #EF4444', color: '#EF4444', background: 'rgba(239, 68, 68, 0.1)', fontWeight: 'bold' }}
                    >
                      {isDisconnecting ? 'Desvinculando...' : 'Desvincular Dispositivo'}
                    </button>
                  </div>
                ) : qrStatus === 'RELAY_MODE' ? (
                  <div style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid var(--primary-green)', padding: '24px', borderRadius: '14px' }}>
                    <Smartphone size={52} color="var(--primary-green)" style={{ margin: '0 auto 12px' }} />
                    <h3 style={{ color: 'var(--primary-green)', marginBottom: '6px' }}>¡Vinculación Exitosa en Teléfono del Cliente!</h3>
                    <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', marginTop: '4px' }}>
                      Modo Relay Móvil Activo (Gestionado directamente desde la aplicación móvil Android).
                    </p>
                    {connectedPhone && <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', marginTop: '6px' }}>Número: <strong>+{connectedPhone}</strong></p>}
                  </div>
                ) : qrDataUrl ? (
                  <div style={{ background: '#FFFFFF', padding: '16px', borderRadius: '14px', display: 'inline-block' }}>
                    <img src={qrDataUrl} alt="Escanea QR con WhatsApp" style={{ maxWidth: '240px', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{ padding: '40px 0', color: 'var(--text-muted)' }}>
                    <RefreshCw size={32} className="spin" style={{ margin: '0 auto 12px', display: 'block' }} />
                    Verificando estado de conexión con WhatsApp...
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-title"><Building2 /> Detalles de la Empresa</div>
              <div className="input-group">
                <label>ID del Tenant</label>
                <input className="input-control" value={user.effectiveTenantId || user.tenant_id} readOnly />
              </div>
              <div className="input-group">
                <label>Organización</label>
                <input className="input-control" value={user.tenantName} readOnly />
              </div>
              <div className="input-group">
                <label>Correo Electrónico del Administrador</label>
                <input 
                  className="input-control" 
                  value={
                    user.isImpersonating 
                      ? (user.effectiveTenantAdminEmail || (tenants.find(t => t.id === user.effectiveTenantId)?.admin_email) || user.email)
                      : (user.email || (tenants.find(t => t.id === user.tenant_id)?.admin_email) || 'Sin correo asignado')
                  } 
                  readOnly 
                />
              </div>
              <div className="input-group">
                <label>Motor de Inteligencia Artificial</label>
                <input className="input-control" value="Google Gemini 2.5 Flash (Conectado con Herramientas)" readOnly />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: System Prompt Activo */}
        {activeTab === 'prompt' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Editor del System Prompt */}
            <div className="card">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sliders color="var(--primary-cyan)" /> System Prompt Activo — {user.tenantName}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                  ID: {user.effectiveTenantId}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
                Instrucciones del sistema y comportamiento de la IA Gemini para este negocio. Puedes editar el texto directamente y guardar los cambios.
              </p>
              <textarea 
                className="input-control" 
                style={{ minHeight: '400px', fontFamily: 'monospace', fontSize: '0.9rem', lineHeight: '1.5', resize: 'vertical' }} 
                value={systemPrompt} 
                onChange={e => setSystemPrompt(e.target.value)} 
              />
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button className="btn btn-whatsapp" onClick={handleSavePrompt} disabled={isSavingPrompt} style={{ flex: 2, justifyContent: 'center', fontWeight: 'bold' }}>
                  <Sliders size={18} /> {isSavingPrompt ? 'Guardando en Base de Datos...' : 'Guardar Configuración Principal'}
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setVersionForm({ title: '', description: '' });
                    setShowSaveVersionModal(true);
                  }}
                  style={{ flex: 1, justifyContent: 'center', fontWeight: 'bold', background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', border: '1px solid rgba(56, 189, 248, 0.3)' }}
                  title="Guardar el texto actual como versión de respaldo guardada"
                >
                  💾 Guardar como Respaldo
                </button>
              </div>
            </div>

            {/* SECCIÓN: Versiones de Prompts */}
            <div className="card">
              <div className="card-title" style={{ marginBottom: '16px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📦 Versiones de Prompts
                </span>
              </div>

              {promptVersions.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontStyle: 'italic', margin: '12px 0' }}>
                  No hay versiones de respaldo guardadas aún. Haz clic en "Guardar como Respaldo" para almacenar versiones de reserva de tu System Prompt.
                </p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '12px' }}>
                  {promptVersions.map(v => (
                    <div 
                      key={v.id} 
                      style={{ 
                        background: 'var(--input-bg)', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '12px', 
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        justify: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <strong style={{ fontSize: '0.98rem', color: 'var(--text-main)' }}>🏷️ {v.title}</strong>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {new Date(v.created_at).toLocaleDateString()} {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {v.description && (
                          <p style={{ fontSize: '0.82rem', color: '#38BDF8', margin: '0 0 10px 0', fontWeight: 500 }}>
                            📝 {v.description}
                          </p>
                        )}
                        <div style={{ 
                          background: 'rgba(0,0,0,0.3)', 
                          borderRadius: '8px', 
                          padding: '10px', 
                          fontSize: '0.78rem', 
                          fontFamily: 'monospace', 
                          maxHeight: '110px', 
                          overflowY: 'auto',
                          color: 'var(--text-muted)',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {v.system_prompt}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                        <button 
                          className="btn"
                          onClick={() => handleRestoreVersion(v)}
                          style={{ flex: 1, padding: '6px 10px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #10B981, #059669)', justifyContent: 'center' }}
                          title="Restaurar este respaldo como el System Prompt Principal activo"
                        >
                          🔄 Restaurar a Principal
                        </button>
                        <button 
                          className="btn btn-secondary"
                          onClick={() => handleDeleteVersion(v.id)}
                          style={{ padding: '6px 10px', fontSize: '0.82rem', color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)' }}
                          title="Eliminar esta versión de respaldo"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Herramientas (Google Sheets & Google Calendar) */}
        {activeTab === 'tools' && (
          <div>
            <div className="card" style={{ marginBottom: '24px', background: 'linear-gradient(135deg, rgba(2,132,199,0.1) 0%, rgba(59,130,246,0.1) 100%)', border: '1px solid rgba(2,132,199,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Link2 color="var(--primary-cyan)" /> Integración Autónoma con Google (OAuth2) — {user.tenantName}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Conecta la cuenta oficial de tu empresa con un solo clic para otorgar permisos a Gemini para leer/escribir en Hojas de Cálculo y gestionar la agenda de Google Calendar.
                  </p>

                  {googleAccountEmail && (
                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ padding: '4px 12px', borderRadius: '20px', background: 'rgba(34,197,94,0.15)', border: '1px solid #22C55E', color: '#22C55E', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        🟢 Conectado como: {googleAccountEmail}
                      </span>
                    </div>
                  )}
                </div>

                <button 
                  className="btn btn-whatsapp" 
                  onClick={handleConnectGoogle}
                  style={{ padding: '12px 24px', fontSize: '0.95rem', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(37,211,102,0.3)' }}
                >
                  <ExternalLink size={18} /> {googleAccountEmail ? 'Reconectar / Cambiar Cuenta de Google' : '🔗 Conectar con Google'}
                </button>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileSpreadsheet color="#10B981" /> Google Sheets
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input 
                      type="checkbox" 
                      checked={sheetsIsEnabled} 
                      onChange={e => setSheetsIsEnabled(e.target.checked)} 
                    />
                    <strong>{sheetsIsEnabled ? '🟢 Habilitado' : '⚪ Inactivo'}</strong>
                  </label>
                </div>

                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
                  Permite a Gemini consultar catálogos/FAQs y registrar datos de clientes (leads) automáticamente en Google Sheets.
                </p>

                <div className="input-group">
                  <label>URL o ID de la Hoja de Cálculo (Spreadsheet URL / ID)</label>
                  <input 
                    className="input-control" 
                    placeholder="Pega la URL completa de tu Hoja de Google (ej. https://docs.google.com/spreadsheets/d/1BxiMV.../edit)" 
                    value={sheetsSpreadsheetId} 
                    onChange={e => setSheetsSpreadsheetId(e.target.value)} 
                    onBlur={e => setSheetsSpreadsheetId(extractSpreadsheetId(e.target.value))}
                  />
                </div>

                <div className="input-group">
                  <label>Nombre de la Pestaña / Rango por Defecto</label>
                  <input 
                    className="input-control" 
                    placeholder="ej. Sheet1!A:Z o Leads!A:F" 
                    value={sheetsDefaultRange} 
                    onChange={e => setSheetsDefaultRange(e.target.value)} 
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={handleTestSheets} 
                    disabled={isTestingSheets}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <RefreshCw size={16} className={isTestingSheets ? 'spin' : ''} /> {isTestingSheets ? 'Probando...' : 'Probar Conexión'}
                  </button>
                  <button 
                    className="btn" 
                    onClick={handleSaveSheets} 
                    disabled={isSavingSheets}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <Save size={16} /> {isSavingSheets ? 'Guardando...' : 'Guardar Sheets'}
                  </button>
                </div>

                <button 
                  className="btn" 
                  onClick={handleSyncSheetsEmbeddings} 
                  disabled={isSyncingEmbeddings}
                  style={{ width: '100%', marginTop: '12px', justifyContent: 'center', background: 'rgba(16,185,129,0.15)', border: '1px solid #10B981', color: '#10B981', fontWeight: 'bold' }}
                >
                  <RefreshCw size={16} className={isSyncingEmbeddings ? 'spin' : ''} /> {isSyncingEmbeddings ? 'Sincronizando...' : '⚡ Sincronizar Inventario a Vectores'}
                </button>
              </div>

              <div className="card">
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar color="#3B82F6" /> Google Calendar
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input 
                      type="checkbox" 
                      checked={calIsEnabled} 
                      onChange={e => setCalIsEnabled(e.target.checked)} 
                    />
                    <strong>{calIsEnabled ? '🟢 Habilitado' : '⚪ Inactivo'}</strong>
                  </label>
                </div>

                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
                  Permite a Gemini verificar disponibilidad de horarios y agendar citas en Google Calendar las 24 horas del día.
                </p>

                <div className="input-group">
                  <label>ID del Calendario (Calendar ID)</label>
                  <input 
                    className="input-control" 
                    placeholder="ej. primary o mi-empresa@group.calendar.google.com" 
                    value={calCalendarId} 
                    onChange={e => setCalCalendarId(e.target.value)} 
                  />
                </div>

                <div className="input-group">
                  <label>Zona Horaria</label>
                  <input 
                    className="input-control" 
                    placeholder="ej. America/Tegucigalpa o America/Managua" 
                    value={calTimezone} 
                    onChange={e => setCalTimezone(e.target.value)} 
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={handleTestCalendar} 
                    disabled={isTestingCal}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <RefreshCw size={16} className={isTestingCal ? 'spin' : ''} /> {isTestingCal ? 'Probando...' : 'Probar Conexión'}
                  </button>
                  <button 
                    className="btn" 
                    onClick={handleSaveCalendar} 
                    disabled={isSavingCal}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <Save size={16} /> {isSavingCal ? 'Guardando...' : 'Guardar Calendar'}
                  </button>
                </div>
              </div>
            </div>

            {/* SECCIÓN GOOGLE DRIVE (MEDIA & DOCUMENTOS) */}
            <div className="card" style={{ marginTop: '24px' }}>
              <div className="card-title" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package color="#06B6D4" /> Google Drive (Envío de Publicidad, Folletos y Documentos)
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input 
                    type="checkbox" 
                    checked={driveIsEnabled} 
                    onChange={e => setDriveIsEnabled(e.target.checked)} 
                  />
                  <strong>{driveIsEnabled ? '🟢 Habilitado' : '⚪ Inactivo'}</strong>
                </label>
              </div>

              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
                Permite a Gemini buscar y enviar nativamente por WhatsApp archivos multimedia, imágenes de promociones y documentos PDF guardados en tu carpeta de Google Drive según el contexto.
              </p>

              <div className="input-group">
                <label>URL o ID de la Carpeta de Google Drive (Drive Folder URL / ID)</label>
                <input 
                  className="input-control" 
                  placeholder="Pega la URL o ID de tu carpeta (ej. https://drive.google.com/drive/folders/1a2b3c4d5e...)" 
                  value={driveFolderId} 
                  onChange={e => setDriveFolderId(e.target.value)} 
                  onBlur={e => setDriveFolderId(extractDriveFolderId(e.target.value))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button 
                  className="btn" 
                  onClick={handleSaveDrive} 
                  disabled={isSavingDrive}
                  style={{ justifyContent: 'center', minWidth: '180px' }}
                >
                  <Save size={16} /> {isSavingDrive ? 'Guardando...' : 'Guardar Google Drive'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: Logística & Pedidos (Social Commerce) */}
        {activeTab === 'logistics' && (
          <div>
            {/* Banner de Estado del Plan y Cuotas */}
            <div className="card" style={{ marginBottom: '24px', background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(2,132,199,0.15) 100%)', border: '1px solid rgba(139,92,246,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Truck color="#8B5CF6" /> Módulo de Logística Social-Commerce — {user.tenantName}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Plan Activo: <strong style={{ color: '#8B5CF6' }}>{logisticsSummary.planDisplayName}</strong>. El agente orquesta automáticamente consultas de stock con distribuidores y despacho por WhatsApp a repartidores.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ background: 'var(--card-bg)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Distribuidores</span>
                    <strong style={{ fontSize: '1.1rem', color: logisticsSummary.distributors.canAdd ? 'var(--primary-green)' : '#EF4444' }}>
                      {logisticsSummary.distributors.current} / {logisticsSummary.distributors.max}
                    </strong>
                  </div>

                  <div style={{ background: 'var(--card-bg)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Repartidores</span>
                    <strong style={{ fontSize: '1.1rem', color: logisticsSummary.drivers.canAdd ? 'var(--primary-cyan)' : '#EF4444' }}>
                      {logisticsSummary.drivers.current} / {logisticsSummary.drivers.max}
                    </strong>
                  </div>

                  <div style={{ background: 'var(--card-bg)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Pedidos Totales</span>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>
                      {logisticsSummary.totalOrders}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: '24px' }}>
              {/* Sección 1: Distribuidores */}
              <div className="card">
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building2 color="#8B5CF6" /> Mis Distribuidores (Cuota: {logisticsSummary.distributors.current}/{logisticsSummary.distributors.max})
                  </div>
                </div>

                <form onSubmit={handleAddDistributor} style={{ marginBottom: '20px', background: 'var(--input-bg)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontSize: '0.88rem', marginBottom: '10px', color: 'var(--text-main)' }}>+ Agregar Nuevo Distribuidor</h4>
                  <div className="input-group" style={{ marginBottom: '8px' }}>
                    <input className="input-control" placeholder="Nombre de la Distribuidora" value={newDistName} onChange={e => setNewDistName(e.target.value)} required />
                  </div>
                  <div className="input-group" style={{ marginBottom: '8px' }}>
                    <input className="input-control" placeholder="Teléfono WhatsApp (ej. +50588889999)" value={newDistPhone} onChange={e => setNewDistPhone(e.target.value)} required />
                  </div>
                  <div className="input-group" style={{ marginBottom: '10px' }}>
                    <input className="input-control" placeholder="Dirección / Ubicación de retiro" value={newDistAddress} onChange={e => setNewDistAddress(e.target.value)} />
                  </div>
                  <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={isAddingDist || !logisticsSummary.distributors.canAdd}>
                    <PlusCircle size={16} /> {isAddingDist ? 'Agregando...' : 'Registrar Distribuidor'}
                  </button>
                  {!logisticsSummary.distributors.canAdd && (
                    <span style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '6px', display: 'block', textAlign: 'center' }}>
                      ⚠️ Cuota máxima de distribuidores alcanzada para tu plan.
                    </span>
                  )}
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                  {distributors.map(dist => (
                    <div key={dist.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--input-bg)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                      <div>
                        <strong style={{ fontSize: '0.9rem', display: 'block' }}>{dist.name}</strong>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Phone size={12} /> {dist.phone_whatsapp}
                        </span>
                        {dist.address_location && (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <MapPin size={12} /> {dist.address_location}
                          </span>
                        )}
                      </div>
                      <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => handleDeleteDistributor(dist.id)} title="Eliminar Distribuidor">
                        <Trash2 size={16} color="#EF4444" />
                      </button>
                    </div>
                  ))}
                  {distributors.length === 0 && (
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '20px 0' }}>No hay distribuidores registrados aún.</p>
                  )}
                </div>
              </div>

              {/* Sección 2: Repartidores */}
              <div className="card">
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Truck color="#0284C7" /> Mis Repartidores (Cuota: {logisticsSummary.drivers.current}/{logisticsSummary.drivers.max})
                  </div>
                </div>

                <form onSubmit={handleAddDriver} style={{ marginBottom: '20px', background: 'var(--input-bg)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontSize: '0.88rem', marginBottom: '10px', color: 'var(--text-main)' }}>+ Agregar Nuevo Repartidor</h4>
                  <div className="input-group" style={{ marginBottom: '8px' }}>
                    <input className="input-control" placeholder="Nombre del Repartidor" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} required />
                  </div>
                  <div className="input-group" style={{ marginBottom: '8px' }}>
                    <input className="input-control" placeholder="Teléfono WhatsApp (ej. +50588881111)" value={newDriverPhone} onChange={e => setNewDriverPhone(e.target.value)} required />
                  </div>
                  <div className="input-group" style={{ marginBottom: '10px' }}>
                    <select className="input-control" value={newDriverVehicle} onChange={e => setNewDriverVehicle(e.target.value)}>
                      <option value="Moto">🏍️ Motocicleta</option>
                      <option value="Automóvil">🚗 Automóvil</option>
                      <option value="Panel / Furgón">🚐 Panel / Furgón</option>
                    </select>
                  </div>
                  <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={isAddingDriver || !logisticsSummary.drivers.canAdd}>
                    <PlusCircle size={16} /> {isAddingDriver ? 'Agregando...' : 'Registrar Repartidor'}
                  </button>
                  {!logisticsSummary.drivers.canAdd && (
                    <span style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '6px', display: 'block', textAlign: 'center' }}>
                      ⚠️ Cuota máxima de repartidores alcanzada para tu plan.
                    </span>
                  )}
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                  {drivers.map(driver => (
                    <div key={driver.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--input-bg)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                      <div>
                        <strong style={{ fontSize: '0.9rem', display: 'block' }}>{driver.name} ({driver.vehicle_type})</strong>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Phone size={12} /> {driver.phone_whatsapp}
                        </span>
                      </div>
                      <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => handleDeleteDriver(driver.id)} title="Eliminar Repartidor">
                        <Trash2 size={16} color="#EF4444" />
                      </button>
                    </div>
                  ))}
                  {drivers.length === 0 && (
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '20px 0' }}>No hay repartidores registrados aún.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Sección 3: Monitor de Pedidos en Vivo */}
            <div className="card">
              <div className="card-title">
                <Package color="#25D366" /> Monitor de Pedidos en Vivo
              </div>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
                <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px' }}>ID Pedido</th>
                    <th style={{ padding: '10px' }}>Cliente</th>
                    <th style={{ padding: '10px' }}>Producto / Precio</th>
                    <th style={{ padding: '10px' }}>Dirección Entrega</th>
                    <th style={{ padding: '10px' }}>Repartidor Asignado</th>
                    <th style={{ padding: '10px' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => (
                    <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px', fontFamily: 'monospace', fontWeight: 'bold' }}>#{order.id.substring(0, 10)}</td>
                      <td style={{ padding: '10px' }}>{order.buyer_name || order.buyer_jid}</td>
                      <td style={{ padding: '10px' }}><strong>{order.product_name}</strong> (${order.price})</td>
                      <td style={{ padding: '10px', fontSize: '0.82rem' }}>{order.buyer_address || 'Por confirmar'}</td>
                      <td style={{ padding: '10px' }}>{order.driver_name ? `🛵 ${order.driver_name}` : 'En espera'}</td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '0.78rem',
                          fontWeight: 'bold',
                          background: (order.status === 'ASSIGNED_DRIVER' || order.status === 'DELIVERED') 
                            ? 'rgba(34,197,94,0.2)' 
                            : order.status === 'CANCELLED' 
                            ? 'rgba(239,68,68,0.2)' 
                            : 'rgba(2,132,199,0.2)',
                          color: (order.status === 'ASSIGNED_DRIVER' || order.status === 'DELIVERED') 
                            ? '#22C55E' 
                            : order.status === 'CANCELLED' 
                            ? '#EF4444' 
                            : 'var(--primary-cyan)'
                        }}>
                          {order.status === 'BROADCASTING_DELIVERY' ? '📡 Buscando Delivery' : 
                           order.status === 'ASSIGNED_DRIVER' ? '🛵 Delivery en Camino' : 
                           order.status === 'DELIVERED' ? '✅ Entregado con Éxito' : 
                           order.status === 'CANCELLED' ? '❌ Cancelado / No Entregado' : 
                           order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No hay pedidos en la plataforma actualmente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: Panel MSP Maestro (Solo visible para Superadmin MSP) */}
        {activeTab === 'msp' && user.role === 'SUPERADMIN_MSP' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2>Panel MSP Maestro — Gestión Multi-Tenant, Planes & Observabilidad IA</h2>
                <p style={{ color: 'var(--text-muted)' }}>Administra empresas clientes, audita el consumo de tokens IA y purga automática de logs (máximo 3 meses).</p>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-secondary" onClick={() => setShowPlansModal(true)}>
                  <Settings size={18} /> Crear Planes
                </button>
                <button className="btn" onClick={() => { setCreatedTenantCredentials(null); setShowNewTenantModal(true); }}>
                  <PlusCircle size={18} /> Crear Empresa
                </button>
              </div>
            </div>

            {/* SECCIÓN DE OBSERVABILIDAD IA & TOKENS */}
            <div className="card" style={{ marginBottom: '24px', padding: '24px', background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(59,130,246,0.04) 100%)', border: '1px solid rgba(139,92,246,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF' }}>
                    <BarChart3 size={24} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>📊 Observabilidad & Consumo de Tokens IA</h3>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Modelo Gemini 2.5 Flash — Retención de logs: Máx. 3 meses (Purga nocturna)</span>
                  </div>
                </div>

                {/* Selector de Periodo */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>Periodo:</span>
                  <select 
                    value={tokenMetricsPeriod} 
                    onChange={e => setTokenMetricsPeriod(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    <option value="today">📅 Hoy</option>
                    <option value="7days">📆 Últimos 7 Días</option>
                    <option value="30days">🗓️ Últimos 30 Días</option>
                    <option value="90days">⏳ Últimos 3 Meses</option>
                    <option value="this_month">📈 Este Mes</option>
                  </select>
                  <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => fetchTokenMetrics(tokenMetricsPeriod)} title="Actualizar Métricas">
                    <RefreshCw size={16} className={isLoadingMetrics ? 'spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Tarjetas KPI de Tokens */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '6px' }}>📥 TOKENS DE PROMPT (INPUT)</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#3B82F6' }}>
                    {tokenMetrics.summary.totalPromptTokens.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Tarifa: $0.075 / 1M tokens</div>
                </div>

                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '6px' }}>📤 TOKENS DE RESPUESTA (OUTPUT)</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#10B981' }}>
                    {tokenMetrics.summary.totalCompletionTokens.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Tarifa: $0.30 / 1M tokens</div>
                </div>

                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '6px' }}>⚡ TOTAL TOKENS CONSUMIDOS</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#8B5CF6' }}>
                    {tokenMetrics.summary.totalTokens.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{tokenMetrics.summary.totalMessages.toLocaleString()} Mensajes procesados</div>
                </div>

                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#22C55E', fontWeight: 'bold', marginBottom: '6px' }}>💰 COSTO ESTIMADO ($USD)</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', color: '#22C55E' }}>
                    ${tokenMetrics.summary.estimatedCostUsd.toFixed(4)} USD
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Estimación en Gemini 2.5 Flash</div>
                </div>
              </div>

              {/* Tabla Desglose por Tenant */}
              <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 'bold' }}>Desglose de Consumo por Tenant</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '10px' }}>Empresa / Tenant</th>
                      <th style={{ padding: '10px' }}>Plan</th>
                      <th style={{ padding: '10px' }}>Mensajes</th>
                      <th style={{ padding: '10px' }}>Prompt Tokens</th>
                      <th style={{ padding: '10px' }}>Completion Tokens</th>
                      <th style={{ padding: '10px' }}>Total Tokens</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Costo Est. ($USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenMetrics.tenants.length > 0 ? (
                      tokenMetrics.tenants.map(tn => (
                        <tr key={tn.tenantId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '10px', fontWeight: 'bold' }}>{tn.tenantName}</td>
                          <td style={{ padding: '10px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '6px', background: 'rgba(139,92,246,0.15)', color: '#8B5CF6', fontSize: '0.75rem', fontWeight: 'bold' }}>
                              {tn.planId}
                            </span>
                          </td>
                          <td style={{ padding: '10px' }}>{tn.messageCount.toLocaleString()}</td>
                          <td style={{ padding: '10px', color: '#3B82F6' }}>{tn.promptTokens.toLocaleString()}</td>
                          <td style={{ padding: '10px', color: '#10B981' }}>{tn.completionTokens.toLocaleString()}</td>
                          <td style={{ padding: '10px', fontWeight: 'bold', color: '#8B5CF6' }}>{tn.totalTokens.toLocaleString()}</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', color: '#22C55E' }}>
                            ${tn.estimatedCostUsd.toFixed(4)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          No hay datos de consumo registrados en el periodo seleccionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SECCIÓN COPILOTO ASISTENTE DE PROMPTS CON IA (GEMINI 2.5) */}
            <div className="card" style={{ marginBottom: '24px', background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(2,132,199,0.08) 100%)', border: '1px solid rgba(139,92,246,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #8B5CF6, #0284C7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF' }}>
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>🤖 Copiloto Asistente de Prompts con IA</h3>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Asistente MSP para diseñar System Prompts optimizados con Tool Calling & Reglas de WhatsApp
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Modelo:</span>
                  <select 
                    value={copilotModelChoice} 
                    onChange={e => setCopilotModelChoice(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    <option value="gemini-2.5-flash">⚡ Gemini 2.5 Flash (Ultrarrápido)</option>
                    <option value="gemini-2.5-pro">🧠 Gemini 2.5 Pro (Razonamiento Complejo)</option>
                  </select>
                </div>
              </div>

              {/* Sugerencias Rápidas de Auditoría MSP */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: '16px', background: 'rgba(139,92,246,0.15)', color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', fontWeight: 'bold' }}
                  onClick={() => {
                    setCopilotChatInput(`Audita el System Prompt actual de ${user.tenantName} y analiza las últimas conversaciones registradas en WhatsApp. Diagnostica si hubo errores, fallos de memoria o formato, y proporciona la versión perfeccionada del System Prompt.`);
                  }}
                >
                  🔍 Auditar Conversaciones Recientes & Ajustar Prompt
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: '16px' }}
                  onClick={() => {
                    setCopilotChatInput(`Diseña un System Prompt optimizado para ${user.tenantName} enfocado en ventas por catálogo de Google Sheets y despacho de pedidos a repartidores.`);
                  }}
                >
                  🛍️ Generar Prompt E-commerce & Delivery
                </button>
              </div>

              {/* Chat Container */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', maxHeight: '420px', overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {copilotMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                    <Bot size={40} style={{ margin: '0 auto 12px', opacity: 0.5, color: '#8B5CF6' }} />
                    <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 'bold' }}>¿En qué caso de uso trabajaremos hoy para {user.tenantName}?</p>
                    <p style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
                      Describe las necesidades de tu cliente. El copiloto conoce todas las herramientas nativas (<code style={{ color: 'var(--primary-cyan)' }}>read_google_sheet</code>, <code style={{ color: '#22C55E' }}>dispatch_delivery_order</code>, <code style={{ color: '#8B5CF6' }}>notify_distributor_stock_query</code>, etc.) y estructurará el prompt óptimo.
                    </p>
                  </div>
                ) : (
                  copilotMessages.map((msg, idx) => {
                    const isUser = msg.role === 'user';
                    const extractedPrompt = !isUser ? extractPromptFromText(msg.text) : null;

                    return (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '88%',
                          padding: '12px 16px',
                          borderRadius: '12px',
                          background: isUser ? 'linear-gradient(135deg, #0284C7, #0369A1)' : 'var(--input-bg)',
                          color: isUser ? '#FFF' : 'var(--text-main)',
                          border: isUser ? 'none' : '1px solid var(--border-color)',
                          fontSize: '0.88rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}>
                          {renderFormattedText(msg.text)}
                        </div>

                        {extractedPrompt && (
                          <button
                            className="btn btn-whatsapp"
                            style={{ marginTop: '8px', fontSize: '0.82rem', padding: '6px 14px', fontWeight: 'bold' }}
                            onClick={() => handleApplyCopilotPrompt(extractedPrompt)}
                          >
                            ⚡ Aplicar este Prompt al Tenant Impersonado ({user.tenantName})
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
                {isCopilotThinking && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <RefreshCw size={16} className="spin" /> Gemini 2.5 está analizando las herramientas y diseñando el prompt...
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  className="input-control"
                  placeholder={`Describe el negocio o caso de uso para ${user.tenantName}...`}
                  value={copilotChatInput}
                  onChange={e => setCopilotChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSendCopilotMessage(); }}
                  disabled={isCopilotThinking}
                />
                <button 
                  className="btn" 
                  style={{ background: '#8B5CF6', color: '#FFF', padding: '0 20px' }}
                  onClick={handleSendCopilotMessage}
                  disabled={isCopilotThinking || !copilotChatInput.trim()}
                >
                  <Send size={18} />
                </button>
              </div>
            </div>

            {/* SECCIÓN PLANTILLAS DE INDUSTRIA Y CATALOGO DE HERRAMIENTAS MSP */}
            <div className="card" style={{ marginBottom: '24px', background: 'linear-gradient(135deg, rgba(139,92,246,0.06) 0%, rgba(2,132,199,0.06) 100%)', border: '1px solid rgba(139,92,246,0.2)' }}>
              <div className="card-title" style={{ color: 'var(--text-main)' }}>
                <Sparkles color="#8B5CF6" /> Plantillas de Industria (Biblioteca MSP)
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '16px' }}>
                Selecciona una plantilla preconfigurada para cargar automáticamente en el System Prompt del tenant impersonado actual (<strong>{user.tenantName}</strong>).
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                {/* Template 1: E-commerce / Retail */}
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', color: 'var(--primary-cyan)', marginBottom: '6px', fontWeight: 'bold' }}>🛍️ E-commerce / Retail con Delivery y Distribuidores</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Ideal para tiendas de calzado, ropa o artículos físicos. Incluye consulta de stock silenciosa a distribuidores y despacho de pedidos a repartidores.
                    </p>
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(2,132,199,0.15)', color: 'var(--primary-cyan)' }}>read_google_sheet</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(139,92,246,0.15)', color: '#8B5CF6' }}>notify_distributor_stock_query</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>dispatch_delivery_order</span>
                    </div>
                  </div>
                  <button 
                    className="btn btn-secondary"
                    style={{ width: '100%', marginTop: '14px', justifyContent: 'center', fontSize: '0.82rem' }}
                    onClick={() => {
                      const tPrompt = `Eres Verónica, asesora de ventas ejecutiva de ${user.tenantName}. Tu objetivo es atender amablemente a los clientes por WhatsApp y cerrar ventas.

REGLAS CRÍTICAS DE FORMATO Y CONTINUIDAD:
1. FORMATO DE ENLACES: NUNCA uses la sintaxis de markdown [texto](url) ni [url](url). En WhatsApp escribe la URL directamente en texto plano (ejemplo: https://${user.tenantName.toLowerCase().replace(/[^a-z0-9]/g, '')}.app/catalogo).
2. MEMORIA Y NO RE-SALUDAR: Revisa siempre el [ESTADO ESTRUCTURADO ACTUAL DE LA SESIÓN]. Si el cliente ya indicó un código de producto o talla, NUNCA lo vuelvas a pedir. Responde directamente a su solicitud.
3. CONSULTA A DISTRIBUIDORES: Si la información del producto indica contact_distributor = "si", utiliza silenciosamente la herramienta notify_distributor_stock_query para verificar disponibilidad. Informa al cliente que estás verificando la existencia en bodega/inventario sin mencionar que contactas a un distribuidor.
4. CONFIRMACIÓN Y DESPACHO A DELIVERY: Cuando el cliente confirme la compra y proporcione su nombre y dirección, utiliza la herramienta dispatch_delivery_order para registrar el pedido y despacharlo al equipo de repartidores.
5. MENSAJES ANÓMALOS: Si el cliente envía textos ininteligibles o códigos aislados como "X2", responde únicamente NO_RESPONSE para evitar bucles.`;
                      handleApplyCopilotPrompt(tPrompt);
                    }}
                  >
                    ⚡ Aplicar Plantilla E-commerce
                  </button>
                </div>

                {/* Template 2: SaaS / Demos */}
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', color: '#3B82F6', marginBottom: '6px', fontWeight: 'bold' }}>💻 SaaS / Ventas Consultivas y Demos</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Para empresas de software, suscripciones o servicios digitales. Incluye entrega de enlaces de demos y captura de prospectos a Google Sheets.
                    </p>
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(2,132,199,0.15)', color: 'var(--primary-cyan)' }}>read_google_sheet</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>append_lead_to_google_sheet</span>
                    </div>
                  </div>
                  <button 
                    className="btn btn-secondary"
                    style={{ width: '100%', marginTop: '14px', justifyContent: 'center', fontSize: '0.82rem' }}
                    onClick={() => {
                      const tPrompt = `Eres Verónica, asesora de ventas ejecutiva de ${user.tenantName}, solución SaaS 100% en la nube.

REGLAS CRÍTICAS DE FORMATO EN WHATSAPP Y CONTINUIDAD:
1. FORMATO DE ENLACES: NUNCA uses la sintaxis de markdown [texto](url) ni [url](url). En WhatsApp escribe la URL directamente en texto plano (ejemplo: https://${user.tenantName.toLowerCase().replace(/[^a-z0-9]/g, '')}.app/demo).
2. MEMORIA Y NO RE-SALUDAR: Si el cliente ya te saludó o ya iniciaste la conversación, NUNCA te vuelvas a presentar ("Hola, soy Verónica..."). Si el cliente responde "Sí", "Claro", "Ok", entrega directamente la información.
3. CAPTURA DE LEADS: Utiliza la herramienta append_lead_to_google_sheet para registrar los datos de contacto de prospectos interesados para dar seguimiento comercial.`;
                      handleApplyCopilotPrompt(tPrompt);
                    }}
                  >
                    ⚡ Aplicar Plantilla SaaS
                  </button>
                </div>

                {/* Template 3: Agendamiento de Citas */}
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', color: '#10B981', marginBottom: '6px', fontWeight: 'bold' }}>📅 Agendamiento de Citas y Servicios</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Para clínicas, consultorías o spas. Permite verificar la agenda en tiempo real y agendar citas en Google Calendar.
                    </p>
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', color: '#3B82F6' }}>check_calendar_availability</span>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(16,185,129,0.15)', color: '#10B981' }}>create_calendar_appointment</span>
                    </div>
                  </div>
                  <button 
                    className="btn btn-secondary"
                    style={{ width: '100%', marginTop: '14px', justifyContent: 'center', fontSize: '0.82rem' }}
                    onClick={() => {
                      const tPrompt = `Eres el asistente de agendamiento de ${user.tenantName}. Tu objetivo es ayudar a los clientes a consultar disponibilidad y agendar citas de atención.

REGLAS DE AGENDAMIENTO Y HERRAMIENTAS:
1. DISPONIBILIDAD: Utiliza la herramienta check_calendar_availability para buscar espacios libres en Google Calendar antes de proponer un horario.
2. AGENDAR CITA: Cuando el cliente confirme la hora e indique su nombre completo y teléfono, utiliza create_calendar_appointment para registrar la cita en la agenda.
3. FORMATO: Mantén un trato profesional y amable. Escribe números telefónicos y confirmaciones sin sintaxis markdown.`;
                      handleApplyCopilotPrompt(tPrompt);
                    }}
                  >
                    ⚡ Aplicar Plantilla Citas
                  </button>
                </div>
              </div>

              {/* CATALOGO DE HERRAMIENTAS NATIVAS MSP */}
              <div className="card-title" style={{ marginTop: '20px' }}>
                <Wrench color="var(--primary-cyan)" /> Catalogo de Herramientas Nativas & Modulos MSP
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '16px' }}>
                Funciones nativas habilitadas para integrarse autónomamente en las respuestas del motor Gemini.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: 'var(--primary-cyan)', fontWeight: 'bold' }}>read_google_sheet</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Lectura de celdas de Google Sheets para catálogo, existencias y precios en tiempo real.</p>
                </div>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: '#22C55E', fontWeight: 'bold' }}>dispatch_delivery_order</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Registro y despacho de pedidos hacia el equipo de repartidores vía WhatsApp.</p>
                </div>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: '#8B5CF6', fontWeight: 'bold' }}>notify_distributor_stock_query</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Consulta silenciosa de existencias a distribuidores registrados.</p>
                </div>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: '#F59E0B', fontWeight: 'bold' }}>append_lead_to_google_sheet</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Captura automática de leads e inserción de filas en Google Sheets.</p>
                </div>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: '#3B82F6', fontWeight: 'bold' }}>check_calendar_availability</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Verificación de franjas horarias disponibles en Google Calendar.</p>
                </div>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: '#EC4899', fontWeight: 'bold' }}>create_calendar_appointment</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Creación de eventos y confirmación de citas en Google Calendar.</p>
                </div>
                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
                  <code style={{ fontSize: '0.88rem', color: '#06B6D4', fontWeight: 'bold' }}>send_drive_media</code>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>Búsqueda y envío nativo de folletos, imágenes y PDFs promocionales desde Google Drive por WhatsApp.</p>
                </div>
              </div>
            </div>

            <div className="card">
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
                <table style={{ width: '100%', minWidth: '920px', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px' }}>ID Tenant</th>
                    <th style={{ padding: '12px' }}>Empresa</th>
                    <th style={{ padding: '12px' }}>Correo Admin</th>
                    <th style={{ padding: '12px' }}>Suscripcion</th>
                    <th style={{ padding: '12px' }}>Modo</th>
                    <th style={{ padding: '12px' }}>Relay</th>
                    <th style={{ padding: '12px' }}>Estado GW</th>
                    <th style={{ padding: '12px' }}>Acción MSP</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px', fontFamily: 'monospace' }}>{t.id}</td>
                      <td style={{ padding: '12px', fontWeight: 'bold' }}>
                        <div>{t.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>slug: {t.slug}</div>
                      </td>
                      <td style={{ padding: '12px', fontSize: '0.85rem' }}>
                        {t.admin_email ? (
                          <span style={{ color: 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            📧 {t.admin_email}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin email</span>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <select 
                          value={t.plan || 'starter'}
                          onChange={(e) => handleUpdateTenantPlan(t.id, e.target.value)}
                          style={{ background: 'rgba(139,92,246,0.15)', color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '6px 10px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          {subscriptionPlans.length > 0 ? (
                            subscriptionPlans.map(p => (
                              <option key={p.id} value={p.id} style={{ background: '#0F172A', color: '#FFF' }}>{p.name} ({p.max_distributors}:{p.max_drivers})</option>
                            ))
                          ) : (
                            <>
                              <option value="starter" style={{ background: '#0F172A' }}>Starter (0:0)</option>
                              <option value="emprendedor" style={{ background: '#0F172A' }}>Emprendedor (3:1)</option>
                              <option value="emprendedor_plus" style={{ background: '#0F172A' }}>Emprendedor Plus (6:2)</option>
                              <option value="emprendedor_pro" style={{ background: '#0F172A' }}>Emprendedor Pro (9:3)</option>
                              <option value="enterprise" style={{ background: '#0F172A' }}>Enterprise (Ilimitado)</option>
                            </>
                          )}
                        </select>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <button 
                          onClick={() => handleToggleTenantDemoMode(t.id, t.is_demo_mode)}
                          style={{
                            background: t.is_demo_mode ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.15)',
                            color: t.is_demo_mode ? '#F59E0B' : '#10B981',
                            border: `1px solid ${t.is_demo_mode ? 'rgba(245,158,11,0.4)' : 'rgba(16,185,129,0.3)'}`,
                            padding: '4px 10px',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                          title="Haz clic para alternar entre Modo Demo (Prueba) y Acceso Completo"
                        >
                          {t.is_demo_mode ? '🔒 Demo (Solo Chats)' : '🔓 Completo (Pro)'}
                        </button>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <button 
                          onClick={() => handleUpdateTenantConnectionModeMSP(t.id, t.connection_mode === 'RELAY' ? 'CENTRALIZED' : 'RELAY')}
                          style={{
                            background: t.connection_mode === 'RELAY' ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)',
                            color: t.connection_mode === 'RELAY' ? '#3B82F6' : '#9CA3AF',
                            border: `1px solid ${t.connection_mode === 'RELAY' ? 'rgba(59,130,246,0.3)' : 'rgba(107,114,128,0.3)'}`,
                            padding: '4px 10px',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                          title="Activar/Desactivar Relay Móvil"
                        >
                          {t.connection_mode === 'RELAY' ? '📱 Relay On' : '🖥️ Relay Off'}
                        </button>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ 
                          color: (t.whatsapp_status === 'CONNECTED' || t.connection_mode === 'RELAY') ? '#22C55E' : '#EF4444', 
                          fontWeight: 'bold' 
                        }}>
                          {t.connection_mode === 'RELAY' 
                            ? '🟢 Conectado (Relay)' 
                            : (t.whatsapp_status === 'CONNECTED' ? '🟢 Conectado' : '🔴 Desconectado')}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                            onClick={() => { handleSwitchTenant(t.id); setActiveTab('chats'); }}
                            title="Asistir / Impersonar sesión"
                          >
                            <ShieldCheck size={14} /> Asistir
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 8px', fontSize: '0.78rem', background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', border: '1px solid rgba(245, 158, 11, 0.3)' }}
                            onClick={() => handleResetTenantPasswordMSP(t)}
                            title="Generar nueva clave temporal para el cliente"
                          >
                            <Key size={14} /> Reset Clave
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODAL NUEVO TENANT (MSP) */}
      {showNewTenantModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div className="card" style={{ maxWidth: '460px', width: '100%', padding: '28px' }}>
            <div className="card-title"><PlusCircle /> Crear Empresa</div>

            {!createdTenantCredentials ? (
              <form onSubmit={handleCreateTenant}>
                <div className="input-group">
                  <label>Nombre de la Empresa</label>
                  <input 
                    className="input-control" 
                    placeholder="Ej. Quintero Store" 
                    value={newTenantName} 
                    onChange={e => {
                      const nameVal = e.target.value;
                      setNewTenantName(nameVal);
                      setNewTenantSlug(generateSlug(nameVal, tenants));
                    }} 
                    required 
                  />
                </div>
                <div className="input-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ marginBottom: 0 }}>Slug de Identificación</label>
                    {newTenantSlug && (
                      <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 600 }}>
                        ✨ Autogenerado sin duplicidad
                      </span>
                    )}
                  </div>
                  <input 
                    className="input-control" 
                    placeholder="Ej. quintero-store" 
                    value={newTenantSlug} 
                    onChange={e => setNewTenantSlug(generateSlug(e.target.value, tenants))} 
                    required 
                  />
                </div>
                <div className="input-group">
                  <label>Plan de Suscripción Inicial</label>
                  <select className="input-control" value={newTenantPlan} onChange={e => setNewTenantPlan(e.target.value)}>
                    {subscriptionPlans.length > 0 ? (
                      subscriptionPlans.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.max_distributors}:{p.max_drivers})</option>
                      ))
                    ) : (
                      <>
                        <option value="starter">Starter (0:0)</option>
                        <option value="emprendedor">Emprendedor (3:1)</option>
                        <option value="emprendedor_plus">Emprendedor Plus (6:2)</option>
                        <option value="emprendedor_pro">Emprendedor Pro (9:3)</option>
                        <option value="enterprise">Enterprise (Ilimitado)</option>
                      </>
                    )}
                  </select>
                </div>
                <div className="input-group">
                  <label>Nombre del Administrador del Cliente</label>
                  <input className="input-control" placeholder="Ej. Carlos Rodríguez" value={newTenantAdminName} onChange={e => setNewTenantAdminName(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label>Correo Electrónico del Administrador</label>
                  <input className="input-control" type="email" placeholder="carlos@lacasona.com" value={newTenantAdminEmail} onChange={e => setNewTenantAdminEmail(e.target.value)} required />
                </div>
                <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', background: 'var(--input-bg)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', marginTop: '8px' }}>
                  <div>
                    <label style={{ marginBottom: 0, fontWeight: 'bold' }}>Modo Demo (Prueba Gratuita)</label>
                    <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Limita la visibilidad del cliente únicamente a Chats y WhatsApp QR.</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={newTenantIsDemoMode} 
                    onChange={e => setNewTenantIsDemoMode(e.target.checked)} 
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }} 
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowNewTenantModal(false)}>Cancelar</button>
                  <button type="submit" className="btn" disabled={isCreatingTenant}>{isCreatingTenant ? 'Creando...' : 'Crear Tenant & Usuario'}</button>
                </div>
              </form>
            ) : (
              <div>
                <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22C55E', color: '#22C55E', padding: '14px', borderRadius: '10px', textAlign: 'center', marginBottom: '18px' }}>
                  <CheckCircle2 size={36} style={{ margin: '0 auto 8px' }} />
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>¡Empresa y Usuario Creados!</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>Entrega estas credenciales de acceso inicial a tu cliente:</p>
                </div>

                <div className="input-group">
                  <label>Usuario / Correo de Acceso</label>
                  <input className="input-control" value={createdTenantCredentials.email} readOnly />
                </div>

                <div className="input-group">
                  <label>Contraseña Temporal Generada</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input className="input-control" value={createdTenantCredentials.tempPassword} readOnly style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#0284C7', background: 'rgba(2,132,199,0.1)' }} />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={() => {
                        navigator.clipboard.writeText(`Correo: ${createdTenantCredentials.email}\nContraseña Temporal: ${createdTenantCredentials.tempPassword}`);
                        setCopiedTempPassword(true);
                        setTimeout(() => setCopiedTempPassword(false), 2000);
                      }}
                    >
                      {copiedTempPassword ? <Check size={16} color="#22C55E" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button className="btn" onClick={() => { setCreatedTenantCredentials(null); setShowNewTenantModal(false); }}>
                    Entendido / Cerrar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL GESTIÓN DE PLANES MSP */}
      {showPlansModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div className="card" style={{ maxWidth: '650px', width: '100%', padding: '28px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div className="card-title" style={{ margin: 0 }}><Settings /> Configuración de Planes de Suscripción MSP</div>
              <button className="btn btn-secondary" onClick={() => setShowPlansModal(false)}>Cerrar</button>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '10px', fontSize: '0.95rem' }}>Planes Registrados Activos</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>ID / Código</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Nombre</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>Distribuidores</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>Repartidores</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptionPlans.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px', fontFamily: 'monospace', fontWeight: 'bold' }}>{p.id}</td>
                      <td style={{ padding: '8px', fontWeight: 'bold', color: '#8B5CF6' }}>{p.name}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{p.max_distributors}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{p.max_drivers}</td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <h4 style={{ marginBottom: '12px', fontSize: '0.95rem' }}>+ Crear / Actualizar Plan Personalizado</h4>
              <form onSubmit={handleSavePlan} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group" style={{ gridColumn: 'span 1' }}>
                  <label>ID / Código Plan</label>
                  <input className="input-control" placeholder="ej. plan_vip" value={planForm.id} onChange={e => setPlanForm({...planForm, id: e.target.value})} required />
                </div>
                <div className="input-group" style={{ gridColumn: 'span 1' }}>
                  <label>Nombre del Plan</label>
                  <input className="input-control" placeholder="ej. Emprendedor VIP" value={planForm.name} onChange={e => setPlanForm({...planForm, name: e.target.value})} required />
                </div>
                <div className="input-group" style={{ gridColumn: 'span 1' }}>
                  <label>Cuota Distribuidores</label>
                  <input className="input-control" type="number" min="0" value={planForm.max_distributors} onChange={e => setPlanForm({...planForm, max_distributors: e.target.value})} required />
                </div>
                <div className="input-group" style={{ gridColumn: 'span 1' }}>
                  <label>Cuota Repartidores</label>
                  <input className="input-control" type="number" min="0" value={planForm.max_drivers} onChange={e => setPlanForm({...planForm, max_drivers: e.target.value})} required />
                </div>
                <div className="input-group" style={{ gridColumn: 'span 2' }}>
                  <label>Descripción del Plan</label>
                  <input className="input-control" placeholder="Detalle comercial del plan..." value={planForm.description} onChange={e => setPlanForm({...planForm, description: e.target.value})} />
                </div>
                <div style={{ gridColumn: 'span 2', textAlign: 'right' }}>
                  <button type="submit" className="btn"><Save size={16} /> Guardar Plan</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RECUPERAR CONTRASEÑA (LOGIN) */}
      {showResetPasswordModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div className="card" style={{ maxWidth: '420px', width: '100%', padding: '28px' }}>
            <div className="card-title"><Key /> Recuperar Contraseña</div>
            {!resetResult ? (
              <form onSubmit={handleResetPassword}>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  Ingresa tu correo electrónico registrado para generar una nueva contraseña temporal de acceso.
                </p>
                {resetError && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', color: '#EF4444', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '14px' }}>
                    {resetError}
                  </div>
                )}
                <div className="input-group">
                  <label>Correo Electrónico</label>
                  <input className="input-control" type="email" value={resetEmailInput} onChange={e => setResetEmailInput(e.target.value)} required placeholder="ejemplo@websavvy.com" />
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowResetPasswordModal(false)}>Cancelar</button>
                  <button type="submit" className="btn" disabled={isResetting}>{isResetting ? 'Generando...' : 'Generar Clave Temporal'}</button>
                </div>
              </form>
            ) : (
              <div>
                <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22C55E', color: '#22C55E', padding: '12px', borderRadius: '8px', fontSize: '0.9rem', marginBottom: '16px', textAlign: 'center' }}>
                  ✅ {resetResult.message}
                </div>
                <div className="input-group">
                  <label>Correo Registrado</label>
                  <input className="input-control" value={resetResult.email} readOnly />
                </div>
                <div className="input-group">
                  <label>Nueva Contraseña Temporal</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input className="input-control" value={resetResult.tempPassword} readOnly style={{ fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '1px', background: 'rgba(2,132,199,0.1)', color: '#0284C7' }} />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={() => {
                        navigator.clipboard.writeText(resetResult.tempPassword);
                        setCopiedTempPassword(true);
                        setTimeout(() => setCopiedTempPassword(false), 2000);
                      }}
                    >
                      {copiedTempPassword ? <Check size={16} color="#22C55E" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button className="btn" onClick={() => { setLoginEmail(resetResult.email); setLoginPassword(resetResult.tempPassword); setShowResetPasswordModal(false); }}>
                    Usar y Volver al Login
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL CAMBIAR CONTRASEÑA (PERFIL AUTENTICADO) */}
      {showChangePasswordModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div className="card" style={{ maxWidth: '420px', width: '100%', padding: '28px' }}>
            <div className="card-title"><Key /> Cambiar Mi Contraseña</div>
            <form onSubmit={handleChangePassword}>
              {changePasswordMsg && (
                <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22C55E', color: '#22C55E', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '14px' }}>
                  ✅ {changePasswordMsg}
                </div>
              )}
              {changePasswordError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', color: '#EF4444', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '14px' }}>
                  {changePasswordError}
                </div>
              )}
              <div className="input-group">
                <label>Contraseña Actual</label>
                <input className="input-control" type="password" value={currentPasswordInput} onChange={e => setCurrentPasswordInput(e.target.value)} required placeholder="••••••••" />
              </div>
              <div className="input-group">
                <label>Nueva Contraseña (mínimo 6 caracteres)</label>
                <input className="input-control" type="password" value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)} required placeholder="••••••••" minLength={6} />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowChangePasswordModal(false)}>Cerrar</button>
                <button type="submit" className="btn" disabled={isChangingPassword}>{isChangingPassword ? 'Guardando...' : 'Actualizar Contraseña'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RESETEO DE CLAVE TEMPORAL (MSP) */}
      {mspResetCredentialsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div className="card" style={{ maxWidth: '440px', width: '100%', padding: '28px' }}>
            <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid #F59E0B', color: '#F59E0B', padding: '14px', borderRadius: '10px', textAlign: 'center', marginBottom: '18px' }}>
              <Key size={36} style={{ margin: '0 auto 8px' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Contraseña Temporal Generada</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Copia y entrega estas credenciales a tu cliente de <b>{mspResetCredentialsModal.tenantName}</b>:</p>
            </div>

            <div className="input-group">
              <label>Correo Electrónico de Acceso</label>
              <input className="input-control" value={mspResetCredentialsModal.email} readOnly />
            </div>

            <div className="input-group">
              <label>Contraseña Temporal Generada</label>
              <input className="input-control" value={mspResetCredentialsModal.tempPassword} readOnly style={{ fontWeight: 'bold', color: '#06B6D4', letterSpacing: '1px' }} />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button 
                className="btn" 
                onClick={() => {
                  navigator.clipboard.writeText(`Credenciales de Acceso WebSavvy AI:\nUsuario: ${mspResetCredentialsModal.email}\nContraseña Temporal: ${mspResetCredentialsModal.tempPassword}`);
                  alert('📋 Credenciales copiadas al portapapeles');
                }}
              >
                📋 Copiar Credenciales
              </button>
              <button className="btn btn-secondary" onClick={() => setMspResetCredentialsModal(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GUÍA DE INSTALACIÓN PWA iOS */}
      {showIosInstallModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2050 }}>
          <div className="card" style={{ maxWidth: '420px', width: '90%', padding: '24px', borderRadius: '18px', textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', background: 'rgba(6,182,212,0.15)', color: '#06B6D4', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Smartphone size={32} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 700 }}>Instalar en iPhone / iPad</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '18px' }}>
              Sigue estos sencillos pasos para instalar <b>WebSavvy AI</b> como app nativa en tu pantalla de inicio:
            </p>

            <div style={{ textAlign: 'left', background: 'var(--input-bg)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem' }}>
                <span style={{ width: '28px', height: '28px', background: 'rgba(2,132,199,0.2)', color: '#0284C7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>1</span>
                <span>Toca el botón <b>Compartir <Share size={16} style={{ display: 'inline', verticalAlign: 'middle', color: '#0284C7' }} /></b> en el menú inferior de Safari.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem' }}>
                <span style={{ width: '28px', height: '28px', background: 'rgba(16,185,129,0.2)', color: '#10B981', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>2</span>
                <span>Desplázate hacia abajo y selecciona <b>"Agregar al inicio ➕"</b>.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem' }}>
                <span style={{ width: '28px', height: '28px', background: 'rgba(139,92,246,0.2)', color: '#8B5CF6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>3</span>
                <span>Confirma tocando <b>"Agregar"</b> en la esquina superior derecha.</span>
              </div>
            </div>

            <button className="btn" style={{ width: '100%' }} onClick={() => setShowIosInstallModal(false)}>
              Entendido 👍
            </button>
          </div>
        </div>
      )}

      {/* BARRA DE NAVEGACIÓN INFERIOR PWA MÓVIL */}
      <nav className="mobile-bottom-nav">
        <button 
          className={`mobile-nav-btn ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          <MessageSquare size={20} />
          <span>Chats</span>
        </button>

        <button 
          className={`mobile-nav-btn ${activeTab === 'qr' ? 'active' : ''}`}
          onClick={() => setActiveTab('qr')}
        >
          <QrCode size={20} />
          <span>WhatsApp QR</span>
        </button>

        {!isDemoMode && (
          <>
            <button 
              className={`mobile-nav-btn ${activeTab === 'prompt' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompt')}
            >
              <Sparkles size={20} />
              <span>Prompts</span>
            </button>

            <button 
              className={`mobile-nav-btn ${activeTab === 'tools' ? 'active' : ''}`}
              onClick={() => setActiveTab('tools')}
            >
              <Wrench size={20} />
              <span>Herramientas</span>
            </button>

            <button 
              className={`mobile-nav-btn ${activeTab === 'logistics' ? 'active' : ''}`}
              onClick={() => setActiveTab('logistics')}
            >
              <Truck size={20} />
              <span>Logística</span>
            </button>
          </>
        )}

        {user.role === 'SUPERADMIN_MSP' && (
          <button 
            className={`mobile-nav-btn ${activeTab === 'msp' ? 'active' : ''}`}
            onClick={() => setActiveTab('msp')}
            style={{ color: activeTab === 'msp' ? '#8B5CF6' : undefined }}
          >
            <ShieldCheck size={20} />
            <span>Panel MSP</span>
          </button>
        )}
      </nav>

      {/* BARRA FLOTANTE INTERACTIVA DE INSTALACIÓN PWA */}
      {!isStandaloneApp && showPwaToastBanner && (
        <div className="pwa-floating-toast-banner">
          <div className="pwa-toast-icon">
            <Smartphone size={24} />
          </div>
          <div className="pwa-toast-text">
            <strong>📲 Instala la App WebSavvy AI</strong>
            <span>Acceso directo rápido y notificaciones en tu pantalla de inicio</span>
          </div>
          <div className="pwa-toast-actions">
            <button className="btn pwa-toast-install-btn" onClick={handleTriggerPwaInstall}>
              <Download size={16} /> Instalar Ahora
            </button>
            <button className="pwa-toast-close-btn" onClick={() => setShowPwaToastBanner(false)} title="Cerrar aviso">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* MODAL GUARDAR VERSIÓN DE RESPALDO DE SYSTEM PROMPT */}
      {showSaveVersionModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div className="card" style={{ maxWidth: '500px', width: '100%', padding: '28px' }}>
            <div className="card-title">💾 Guardar Versión de Respaldo</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '18px' }}>
              Se guardará una copia del System Prompt actual como versión de respaldo. Puedes almacenar hasta 3 respaldos y restaurarlos cuando desees.
            </p>

            <form onSubmit={handleSaveVersion}>
              <div className="input-group">
                <label>Nombre de la Versión *</label>
                <input 
                  className="input-control" 
                  placeholder="ej. Modo Campaña Navideña o Asesoría Consultiva" 
                  value={versionForm.title} 
                  onChange={e => setVersionForm({...versionForm, title: e.target.value})} 
                  required 
                />
              </div>

              <div className="input-group">
                <label>Descripción Corta</label>
                <input 
                  className="input-control" 
                  placeholder="ej. Incluye regla estricta de verificación de catálogo y tono formal" 
                  value={versionForm.description} 
                  onChange={e => setVersionForm({...versionForm, description: e.target.value})} 
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSaveVersionModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn" disabled={isSavingVersion}>
                  {isSavingVersion ? 'Guardando...' : '💾 Guardar Respaldo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
