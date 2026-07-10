// URL del backend: definida en config.js (vacía = mismo origen)
const API = window.API_URL || "";

let estadoApp = {
  token: localStorage.getItem("token"),
  usuario: localStorage.getItem("usuario") ? JSON.parse(localStorage.getItem("usuario")) : null,
  tipoUsuario: localStorage.getItem("tipoUsuario"), // 'clinica' o 'dentista'
  publicaciones: [],
  paginaActual: 1,
  hayMasPublicaciones: false,
  especialidades: [],
  archivosUsuario: [],
  filtros: {
    tipo: "",
    ciudad: "",
    especialidad: "",
    contrato: "",
    jornada: "",
    soloMias: false,
    contactadas: false
  },
  publicacionActual: null
};

// ============================================
// Módulo: Utilidades
// ============================================

const utils = {
  async request(endpoint, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...options.headers
    };

    if (estadoApp.token) {
      headers.Authorization = `Bearer ${estadoApp.token}`;
    }

    // Si la respuesta tarda (arranque en frío del servidor gratuito), avisar
    const avisoLento = setTimeout(() => {
      if (!utils._avisoDespertarMostrado) {
        utils._avisoDespertarMostrado = true;
        utils.mostrarAlerta("⏳ Despertando el servidor… puede tardar unos segundos", "info");
        setTimeout(() => { utils._avisoDespertarMostrado = false; }, 60000);
      }
    }, 3000);

    try {
      const response = await fetch(API + endpoint, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error en la solicitud");
      }

      return data;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      clearTimeout(avisoLento);
    }
  },

  async requestForm(endpoint, formData) {
    const headers = {};
    if (estadoApp.token) {
      headers.Authorization = `Bearer ${estadoApp.token}`;
    }

    try {
      const response = await fetch(API + endpoint, {
        method: "POST",
        headers,
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error en la solicitud");
      }

      return data;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },

  mostrarAlerta(mensaje, tipo = "info") {
    const alertaDiv = document.createElement("div");
    alertaDiv.className = `alert alert-${tipo}`;
    alertaDiv.textContent = mensaje;
    document.body.insertBefore(alertaDiv, document.body.firstChild);

    setTimeout(() => alertaDiv.remove(), 4000);
  },

  formatearFecha(fecha) {
    const date = new Date(fecha);
    return date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  },

  formatearTamanyo(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  },

  ordenarPorCiudadYEspecialidad(items) {
    return items.sort((a, b) => {
      const ciudadA = (a.ciudad || '').toLowerCase();
      const ciudadB = (b.ciudad || '').toLowerCase();
      if (ciudadA !== ciudadB) {
        return ciudadA.localeCompare(ciudadB);
      }
      const espA = (a.especialidades || '').toLowerCase();
      const espB = (b.especialidades || '').toLowerCase();
      return espA.localeCompare(espB);
    });
  },

  ordenarPorCiudadFechaEspecialidadSalario(items) {
    return items.sort((a, b) => {
      const ciudadA = (a.ciudad || '').toLowerCase();
      const ciudadB = (b.ciudad || '').toLowerCase();
      if (ciudadA !== ciudadB) {
        return ciudadA.localeCompare(ciudadB);
      }
      const fechaA = new Date(a.creado_en || 0);
      const fechaB = new Date(b.creado_en || 0);
      if (fechaA.getTime() !== fechaB.getTime()) {
        return fechaB - fechaA;
      }
      const espA = (a.especialidad_id || 0);
      const espB = (b.especialidad_id || 0);
      if (espA !== espB) {
        return espA - espB;
      }
      const salarioA = parseFloat(a.salario) || 0;
      const salarioB = parseFloat(b.salario) || 0;
      return salarioB - salarioA;
    });
  },

  escapeJsonForHtml(obj) {
    return JSON.stringify(obj).replace(/"/g, '&quot;');
  },

  // Color y etiqueta de cada estado de candidatura
  colorEstado(estado) {
    return {
      pendiente: '#f59e0b',
      vista: '#6366f1',
      en_proceso: '#0ea5e9',
      entrevista: '#8b5cf6',
      aceptada: '#10b981',
      rechazada: '#ef4444',
      retirada: '#9ca3af'
    }[estado] || '#9ca3af';
  },

  textoEstado(estado) {
    return {
      pendiente: 'Pendiente',
      vista: 'CV visto',
      en_proceso: 'En proceso',
      entrevista: 'Entrevista',
      aceptada: 'Aceptada',
      rechazada: 'Rechazada',
      retirada: 'Retirada'
    }[estado] || estado;
  },

  // Selector de estado que usan las clínicas en las listas de candidatos
  selectorEstado(candidaturaId, estadoActual, onchangeJs) {
    const opciones = ['pendiente', 'vista', 'en_proceso', 'entrevista', 'aceptada', 'rechazada'];
    return `
      <select onchange="${onchangeJs}" style="padding: 0.4rem 0.6rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem; cursor: pointer;">
        ${opciones.map(e => `<option value="${e}" ${e === estadoActual ? 'selected' : ''}>${utils.textoEstado(e)}</option>`).join('')}
      </select>
    `;
  },

  escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  ocultarElementos(...ids) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }
};

// ============================================
// Módulo: Landing
// ============================================

const app = {
  landing: {
    seleccionarTipo(tipo) {
      if (tipo === 'empresa') {
        app.modal.abrirAuthEmpresa();
      } else {
        app.modal.abrirAuthCandidato();
      }
    }
  },

  // ============================================
  // Módulo: Auth
  // ============================================

  auth: {
    async loginEmpresa() {
      const email = document.getElementById("loginEmailEmp").value;
      const password = document.getElementById("loginPasswordEmp").value;

      if (!email) {
        utils.mostrarAlerta("Por favor ingresa tu email", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });

        if (response.usuario.tipo !== 'clinica') {
          utils.mostrarAlerta("Este usuario no es una clínica", "error");
          return;
        }

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'clinica';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'clinica');

        utils.mostrarAlerta("¡Sesión iniciada!", "success");
        app.modal.cerrarAuthEmpresa();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async registroEmpresa() {
      const nombre = document.getElementById("regNombreEmp").value;
      const email = document.getElementById("regEmailEmp").value;
      const password = document.getElementById("regPasswordEmp").value;
      const direccion = document.getElementById("regDireccionEmp").value;
      const codigo_postal = document.getElementById("regCodigoPostalEmp").value;
      const pais = document.getElementById("regPaisEmp").value;
      const telefono = document.getElementById("regMovilEmp").value;

      if (!nombre || !email || !direccion || !codigo_postal || !telefono) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      if (!password || password.length < 8) {
        utils.mostrarAlerta("La contraseña debe tener al menos 8 caracteres", "error");
        return;
      }

      if (!document.getElementById("regTerminosEmp").checked) {
        utils.mostrarAlerta("Debes aceptar la política de privacidad y los términos de uso", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/registro", {
          method: "POST",
          body: JSON.stringify({ nombre, email, password, tipo: 'clinica', telefono, direccion, codigo_postal, pais, aceptaTerminos: true })
        });

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'clinica';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'clinica');

        utils.mostrarAlerta("¡Registro exitoso!", "success");
        app.modal.cerrarAuthEmpresa();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async loginCandidato() {
      const email = document.getElementById("loginEmailCand").value;
      const password = document.getElementById("loginPasswordCand").value;

      if (!email) {
        utils.mostrarAlerta("Por favor ingresa tu email", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });

        if (response.usuario.tipo !== 'dentista') {
          utils.mostrarAlerta("Este usuario no es un dentista", "error");
          return;
        }

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'dentista';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'dentista');

        utils.mostrarAlerta("¡Sesión iniciada!", "success");
        app.modal.cerrarAuthCandidato();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async registroCandidato() {
      const nombre = document.getElementById("regNombreCand").value;
      const email = document.getElementById("regEmailCand").value;
      const password = document.getElementById("regPasswordCand").value;
      const telefono = document.getElementById("regMovilCand").value || null;

      if (!nombre || !email) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      if (!password || password.length < 8) {
        utils.mostrarAlerta("La contraseña debe tener al menos 8 caracteres", "error");
        return;
      }

      if (!document.getElementById("regTerminosCand").checked) {
        utils.mostrarAlerta("Debes aceptar la política de privacidad y los términos de uso", "error");
        return;
      }

      try {
        const response = await utils.request("/auth/registro", {
          method: "POST",
          body: JSON.stringify({ nombre, email, password, tipo: 'dentista', telefono, aceptaTerminos: true })
        });

        estadoApp.token = response.token;
        estadoApp.usuario = response.usuario;
        estadoApp.tipoUsuario = 'dentista';

        localStorage.setItem("token", response.token);
        localStorage.setItem("usuario", JSON.stringify(response.usuario));
        localStorage.setItem("tipoUsuario", 'dentista');

        utils.mostrarAlerta("¡Registro exitoso!", "success");
        app.modal.cerrarAuthCandidato();
        app.ui.mostrarPlataforma();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Recuperación de contraseña: pide el email y envía las instrucciones
    async olvidePassword(inputEmailId) {
      const prefill = inputEmailId ? document.getElementById(inputEmailId)?.value : "";
      const email = prompt("Escribe el email de tu cuenta:", prefill || "");
      if (!email) return;

      try {
        const res = await utils.request("/auth/olvide-password", {
          method: "POST",
          body: JSON.stringify({ email: email.trim() })
        });
        utils.mostrarAlerta(res.mensaje || "Revisa tu correo", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    tokenRestablecer: null,

    async restablecerPassword() {
      const password = document.getElementById("restablecerPassword").value;
      const confirma = document.getElementById("restablecerPasswordConfirma").value;

      if (password !== confirma) {
        utils.mostrarAlerta("Las contraseñas no coinciden", "error");
        return;
      }

      try {
        const res = await utils.request("/auth/restablecer-password", {
          method: "POST",
          body: JSON.stringify({ token: this.tokenRestablecer, passwordNueva: password })
        });
        document.getElementById("modalRestablecer").classList.remove("active");
        this.tokenRestablecer = null;
        utils.mostrarAlerta("✅ " + (res.mensaje || "Contraseña actualizada"), "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async reenviarVerificacion() {
      try {
        const res = await utils.request("/auth/reenviar-verificacion", { method: "POST" });
        utils.mostrarAlerta(res.mensaje || "Correo reenviado", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Procesa los enlaces que llegan por correo (#verificar= / #restablecer= / #confirmar-email=)
    async procesarEnlacesDeCorreo() {
      const hash = window.location.hash || "";

      const limpiarHash = () => history.replaceState(null, "", window.location.pathname + window.location.search);

      if (hash.startsWith("#verificar=")) {
        const token = hash.slice("#verificar=".length);
        limpiarHash();
        try {
          const res = await utils.request(`/auth/verificar-email/${encodeURIComponent(token)}`);
          utils.mostrarAlerta("✅ " + (res.mensaje || "Email verificado"), "success");
        } catch (error) {
          utils.mostrarAlerta(error.message, "error");
        }
      } else if (hash.startsWith("#restablecer=")) {
        this.tokenRestablecer = hash.slice("#restablecer=".length);
        limpiarHash();
        document.getElementById("restablecerPassword").value = "";
        document.getElementById("restablecerPasswordConfirma").value = "";
        document.getElementById("modalRestablecer").classList.add("active");
      } else if (hash.startsWith("#confirmar-email=")) {
        const token = hash.slice("#confirmar-email=".length);
        limpiarHash();
        try {
          const res = await utils.request(`/auth/confirmar-cambio-email/${encodeURIComponent(token)}`);
          utils.mostrarAlerta("✅ " + (res.message || "Email actualizado. Vuelve a iniciar sesión."), "success");
          // El JWT lleva el email antiguo: cerrar sesión para regenerarlo
          if (estadoApp.token) app.auth.logout();
        } catch (error) {
          utils.mostrarAlerta(error.message, "error");
        }
      }
    },

    logout() {
      app.ui.detenerActualizacionAutomatica();

      localStorage.removeItem("token");
      localStorage.removeItem("usuario");
      localStorage.removeItem("tipoUsuario");
      estadoApp.token = null;
      estadoApp.usuario = null;
      estadoApp.tipoUsuario = null;

      // Limpiar formularios
      document.querySelectorAll("form").forEach(form => form.reset());

      utils.mostrarAlerta("Sesión cerrada", "info");
      app.ui.mostrarLanding();
    },

    switchAuthTab(tab) {
      const prefix = tab.includes('Empresa') ? 'Empresa' :
                     tab.includes('Candidato') ? 'Candidato' : '';

      const modalId = prefix === 'Empresa' ? 'modalAuthEmpresa' : 'modalAuthCandidato';

      document.querySelectorAll(`#${modalId} .tab-content`).forEach(el => el.classList.remove("active"));
      document.querySelectorAll(`#${modalId} .tab-btn`).forEach(el => el.classList.remove("active"));

      document.getElementById(`tab-${tab}`).classList.add("active");
      event.target.classList.add("active");
    }
  },

  // ============================================
  // Módulo: Publicaciones
  // ============================================

  publicaciones: {
    async cargar(pagina = 1) {
      // Cerrar todos los modales antes de cargar
      app.modal.cerrarTodosModales();

      // Determinar tipo según modo
      let tipo;
      if (estadoApp.filtros.verSuplencias) {
        // Suplencias y turnos sueltos (solo dentistas navegando)
        tipo = 'suplencia';
      } else if (estadoApp.filtros.soloMias) {
        // Mis publicaciones: empresas ven sus OFERTAS y SUPLENCIAS (sin filtro de tipo), candidatos ven sus SOLICITUDES
        tipo = estadoApp.tipoUsuario === 'clinica' ? null : 'solicitud';
      } else {
        // Ver todas: empresas ven SOLICITUDES, candidatos ven OFERTAS
        tipo = estadoApp.tipoUsuario === 'clinica' ? 'solicitud' : 'oferta';
      }

      const q = document.getElementById("filterQ").value;
      const ciudad = document.getElementById("filterCiudad").value;
      const especialidad = document.getElementById("filterEspecialidad").value;
      const contrato = document.getElementById("filterContrato").value;
      const jornada = document.getElementById("filterJornada").value;
      const equipamiento = document.getElementById("filterEquipamiento").value;
      const certificacion = document.getElementById("filterCertificacion").value;
      const retribucion = document.getElementById("filterRetribucion").value;
      const salarioMin = document.getElementById("filterSalarioMin").value;
      const experienciaMin = document.getElementById("filterExperienciaMin").value;
      const orden = document.getElementById("filterOrden").value;

      estadoApp.filtros = { tipo, q, ciudad, especialidad, contrato, jornada, equipamiento, certificacion, retribucion, salarioMin, experienciaMin, orden, soloMias: estadoApp.filtros.soloMias, verSuplencias: estadoApp.filtros.verSuplencias };

      let url = "/publicaciones?";
      if (tipo) url += `tipo=${tipo}&`;
      if (estadoApp.filtros.soloMias && estadoApp.usuario) {
        url += `usuario_id=${estadoApp.usuario.id}&`;
      } else {
        if (q) url += `q=${encodeURIComponent(q)}&`;
        if (ciudad) url += `ciudad=${encodeURIComponent(ciudad)}&`;
        if (especialidad) url += `especialidad=${especialidad}&`;
        if (contrato) url += `contrato=${encodeURIComponent(contrato)}&`;
        if (jornada) url += `jornada=${encodeURIComponent(jornada)}&`;
        if (equipamiento) url += `equipamiento=${encodeURIComponent(equipamiento)}&`;
        if (certificacion) url += `certificacion=${encodeURIComponent(certificacion)}&`;
        if (retribucion) url += `retribucion=${retribucion}&`;
        if (salarioMin) url += `salarioMin=${salarioMin}&`;
        if (experienciaMin) url += `experienciaMin=${experienciaMin}&`;
        if (orden && orden !== 'recientes') {
          url += `sort=${orden}&`;
          if (orden === 'relevancia' && estadoApp.usuario) url += `paraUsuarioId=${estadoApp.usuario.id}&`;
        } else if (estadoApp.filtros.verSuplencias) {
          // Suplencias: urgentes primero y luego por fecha de inicio más próxima
          url += `sort=fecha&`;
        } else if (
          (estadoApp.tipoUsuario === 'clinica' && tipo === 'solicitud') ||
          (estadoApp.tipoUsuario === 'dentista' && tipo === 'oferta')
        ) {
          // Clínicas viendo dentistas, o dentistas viendo clínicas: por defecto, ordenar por ciudad
          url += `sort=ciudad&`;
        }
      }

      const limit = 20;
      url += `page=${pagina}&limit=${limit}`;

      try {
        let publicaciones = await utils.request(url);
        estadoApp.publicaciones = pagina === 1 ? publicaciones : estadoApp.publicaciones.concat(publicaciones);
        estadoApp.paginaActual = pagina;
        estadoApp.hayMasPublicaciones = publicaciones.length === limit;
        app.ui.renderizarPublicaciones();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarContactadas() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }

      try {
        const publicaciones = await utils.request(`/publicaciones/contactadas/${estadoApp.usuario.id}`);
        estadoApp.publicaciones = publicaciones;
        app.ui.renderizarPublicaciones();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarFavoritos() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }

      try {
        const publicaciones = await utils.request("/favoritos");
        estadoApp.publicaciones = publicaciones;
        app.ui.renderizarPublicaciones();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async crear(tipo) {
      if (!estadoApp.token) {
        utils.mostrarAlerta("Debes iniciar sesión para publicar", "error");
        return;
      }

      let formData;
      if (tipo === "oferta") {
        // Obtener especialidades seleccionadas
        const especialidadesCheckboxes = document.querySelectorAll('#ofertaEspecialidadesContainer input[type="checkbox"]:checked');
        const especialidades = Array.from(especialidadesCheckboxes).map(cb => parseInt(cb.value));
        const ciudad = document.getElementById("ofertaCiudad").value;
        const especialidadNombre = especialidades.length > 0 ? estadoApp.especialidades.find(e => e.id === especialidades[0])?.nombre : "Dentista";

        formData = {
          tipo: "oferta",
          descripcion: document.getElementById("ofertaDescripcion").value,
          ciudad: ciudad,
          especialidades: especialidades,
          contrato: document.getElementById("ofertaContrato").value || null,
          jornada: document.getElementById("ofertaJornada").value || null,
          salario: (() => {
            const desde = document.getElementById("ofertaSalarioDesde").value;
            const hasta = document.getElementById("ofertaSalarioHasta").value;
            if (!desde && !hasta) return null;
            return hasta ? `${desde || '?'}-${hasta} €/mes` : `Desde ${desde} €/mes`;
          })(),
          salarioDesde: document.getElementById("ofertaSalarioDesde").value || null,
          salarioHasta: document.getElementById("ofertaSalarioHasta").value || null,
          experiencia: document.getElementById("ofertaExperiencia").value || null,
          nombre_contacto: document.getElementById("ofertaNombreContacto").value,
          email_contacto: document.getElementById("ofertaEmailContacto").value,
          telefono_contacto: document.getElementById("ofertaTelefonoContacto").value || null,
          sede_id: document.getElementById("ofertaSede")?.value || null,
          retribucionTipo: document.querySelector('input[name="ofertaRetribucionTipo"]:checked')?.value || 'fijo',
          retribucionPorcentaje: document.getElementById("ofertaRetribucionPorcentaje").value || null,
          equipamiento: Array.from(document.querySelectorAll('#ofertaEquipamientoContainer input[type="checkbox"]:checked')).map(cb => cb.value)
        };
      } else if (tipo === "suplencia") {
        const especialidadesCheckboxes = document.querySelectorAll('#suplenciaEspecialidadesContainer input[type="checkbox"]:checked');
        const especialidades = Array.from(especialidadesCheckboxes).map(cb => parseInt(cb.value));

        formData = {
          tipo: "suplencia",
          descripcion: document.getElementById("suplenciaDescripcion").value,
          ciudad: document.getElementById("suplenciaCiudad").value,
          especialidades: especialidades,
          salario: document.getElementById("suplenciaSalario").value || null,
          fecha_desde: document.getElementById("suplenciaFechaDesde").value || null,
          fecha_hasta: document.getElementById("suplenciaFechaHasta").value || null,
          urgente: document.getElementById("suplenciaUrgente").checked,
          nombre_contacto: document.getElementById("suplenciaNombreContacto").value,
          email_contacto: document.getElementById("suplenciaEmailContacto").value,
          telefono_contacto: document.getElementById("suplenciaTelefonoContacto").value || null,
          sede_id: document.getElementById("suplenciaSede")?.value || null,
          retribucionTipo: document.querySelector('input[name="suplenciaRetribucionTipo"]:checked')?.value || 'fijo',
          retribucionPorcentaje: document.getElementById("suplenciaRetribucionPorcentaje").value || null,
          equipamiento: Array.from(document.querySelectorAll('#suplenciaEquipamientoContainer input[type="checkbox"]:checked')).map(cb => cb.value)
        };
      } else {
        // Obtener especialidades seleccionadas
        const especialidadesCheckboxes = document.querySelectorAll('#solicitudEspecialidadesContainer input[type="checkbox"]:checked');
        const especialidades = Array.from(especialidadesCheckboxes).map(cb => parseInt(cb.value));
        const ciudad = document.getElementById("solicitudCiudad").value;
        const especialidadNombre = especialidades.length > 0 ? estadoApp.especialidades.find(e => e.id === especialidades[0])?.nombre : "Dentista";

        formData = {
          tipo: "solicitud",
          descripcion: document.getElementById("solicitudDescripcion").value,
          ciudad: ciudad,
          especialidades: especialidades,
          contrato: document.getElementById("solicitudContrato").value || null,
          jornada: document.getElementById("solicitudJornada").value || null,
          experiencia: document.getElementById("solicitudExperiencia").value || null,
          nombre_contacto: document.getElementById("solicitudNombreContacto").value,
          email_contacto: document.getElementById("solicitudEmailContacto").value,
          telefono_contacto: document.getElementById("solicitudTelefonoContacto").value || null
        };
      }

      const esClinicaPub = (tipo === 'oferta' || tipo === 'suplencia');
      if (esClinicaPub && !formData.sede_id) {
        utils.mostrarAlerta("Elige una sede para publicar (créala en \"Mi perfil\" → Sedes si aún no tienes)", "error");
        return;
      }

      // Para ofertas/suplencias, ciudad, empresa y contacto se derivan de la sede/perfil en el backend
      if (!formData.descripcion || (tipo === 'solicitud' && (!formData.nombre_contacto || !formData.email_contacto))) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      if (tipo === "suplencia" && !formData.fecha_desde) {
        utils.mostrarAlerta("Indica al menos la fecha de inicio de la suplencia", "error");
        return;
      }

      // Validar el email que introduce el dentista en una solicitud (en ofertas sale del perfil)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (tipo === 'solicitud' && !emailRegex.test(formData.email_contacto)) {
        utils.mostrarAlerta("Por favor ingresa un email válido", "error");
        return;
      }

      // Validar descripción no vacía
      if (formData.descripcion.trim().length < 10) {
        utils.mostrarAlerta("La descripción debe tener al menos 10 caracteres", "error");
        return;
      }

      try {
        const respuesta = await utils.request("/publicaciones", {
          method: "POST",
          body: JSON.stringify(formData)
        });

        utils.mostrarAlerta("¡Publicación creada exitosamente!", "success");
        app.modal.cerrarPublicar();
        app.publicaciones.cargar();
        app.ui.actualizarStats();

        document.getElementById(`tab-${tipo}`).querySelector("form").reset();
        if (tipo === "oferta" || tipo === "suplencia") app.publicaciones.toggleRetribucion(tipo);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Rellena (solo lectura) la ciudad y provincia de la solicitud a partir del perfil del dentista
    async rellenarCiudadSolicitudDesdePerfil() {
      const inputCiudad = document.getElementById("solicitudCiudad");
      const inputProvincia = document.getElementById("solicitudProvincia");
      const hint = document.getElementById("solicitudCiudadHint");
      if (!inputCiudad) return;
      try {
        const u = await utils.request("/auth/mi-perfil");
        const ciudad = u.ciudad || "";
        const provincia = u.provincia || "";
        inputCiudad.value = provincia ? `${ciudad} (${provincia})` : ciudad;
        if (inputProvincia) inputProvincia.value = provincia;
        if (hint) {
          hint.textContent = ciudad
            ? 'Se toma de tu perfil. Para cambiarla ve a "Mi perfil" → Mis datos.'
            : '⚠️ No tienes ciudad en tu perfil. Defínela en "Mi perfil" → Mis datos antes de publicar.';
          hint.style.color = ciudad ? "" : "#b45309";
        }
      } catch (error) {
        console.error("Error al cargar la ciudad del perfil:", error);
      }
    },

    // Muestra el campo de importe fijo o el de porcentaje según la opción elegida
    toggleRetribucion(prefijo) {
      const tipo = document.querySelector(`input[name="${prefijo}RetribucionTipo"]:checked`)?.value || 'fijo';
      const grupoFijo = document.getElementById(`${prefijo}SalarioFijoGroup`);
      const grupoPorcentaje = document.getElementById(`${prefijo}RetribucionPorcentajeGroup`);
      grupoFijo.style.display = tipo === 'fijo' ? (prefijo === 'oferta' ? 'flex' : 'block') : 'none';
      grupoPorcentaje.style.display = tipo === 'porcentaje' ? 'block' : 'none';
    },

    async eliminar(id) {
      if (!confirm("¿Estás seguro de que deseas eliminar esta publicación?")) return;

      try {
        await utils.request(`/publicaciones/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Publicación eliminada", "success");
        app.publicaciones.cargar();
        app.ui.actualizarStats();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarEspecialidadesPublicar(tipo) {
      try {
        if (!estadoApp.especialidades || estadoApp.especialidades.length === 0) {
          await app.especialidades.cargar();
        }

        const containerId = `${tipo}EspecialidadesContainer`;
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = estadoApp.especialidades.map(esp => `
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" value="${esp.id}" style="cursor: pointer;">
            ${esp.nombre}
          </label>
        `).join('');
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }
    },

    marcarTodasEspecialidades(tipo) {
      const containerId = `${tipo}EspecialidadesContainer`;
      const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]`);
      const marcarTodas = document.getElementById(`${tipo}MarcarTodas`);

      checkboxes.forEach(cb => {
        cb.checked = marcarTodas.checked;
      });
    },

    // Copia al portapapeles la URL pública (indexable) de una oferta
    async copiarEnlacePublico(publicacionId) {
      const base = API || window.location.origin;
      const url = `${base}/oferta/${publicacionId}`;
      try {
        await navigator.clipboard.writeText(url);
        utils.mostrarAlerta("🔗 Enlace copiado: compártelo donde quieras", "success");
      } catch (e) {
        prompt("Copia el enlace público de la oferta:", url);
      }
    },

    async retirarPublicacion(publicacionId) {
      if (!confirm("¿Estás seguro de que deseas retirar esta publicación?")) {
        return;
      }

      try {
        await utils.request(`/publicaciones/${publicacionId}`, { method: 'DELETE' });
        utils.mostrarAlerta("Publicación retirada correctamente", "success");
        await app.publicaciones.cargar();
        await app.ui.actualizarStats();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Filtros
  // ============================================

  filtros: {
    mostrarTodas(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.verSuplencias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      // Actualizar título de filtros
      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "Dentistas";
      } else {
        filtersTitle.textContent = "";
      }

      app.publicaciones.cargar();
    },

    mostrarMias(btn) {
      estadoApp.filtros.soloMias = true;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      // Actualizar título de filtros
      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "";
      } else {
        filtersTitle.textContent = "";
      }

      app.publicaciones.cargar();
    },

    mostrarMisPublicaciones(btn) {
      estadoApp.filtros.soloMias = true;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "";
      } else {
        filtersTitle.textContent = "";
      }

      app.publicaciones.cargar();
    },

    mostrarContactadas(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = true;
      estadoApp.filtros.verSuplencias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Solicitudes contactadas";

      app.publicaciones.cargarContactadas();
    },

    mostrarFavoritos(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Favoritos";

      app.publicaciones.cargarFavoritos();
    },

    mostrarKanban(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Mis Postulaciones";
      filtersTitle.style.display = "block";

      app.kanban.render();
    },

    mostrarSuplencias(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      estadoApp.filtros.verSuplencias = true;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "🚨 Suplencias y turnos sueltos";
      filtersTitle.style.display = "block";

      app.publicaciones.cargar();
    },

    mostrarMisPostulaciones(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Postulaciones a Clínicas";

      app.stats.mostrarMisPostulaciones();
    },

    mostrarMisAceptadas(btn) {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = false;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Postulaciones a Clínicas Aceptadas";

      app.stats.mostrarMisPostulacionesAceptadas();
    },

    mostrarMisPostulacionesDentistas(btn) {
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Mis Postulaciones a Dentistas";

      app.stats.mostrarMisPostulacionesDentistas();
    },

    mostrarMisPostulacionesDentistasAceptadas(btn) {
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Mis Postulaciones a Dentistas Aceptadas";

      app.stats.mostrarMisPostulacionesDentistasAceptadas();
    },

    setTipo(tipo, btn) {
      estadoApp.filtros.tipo = tipo;
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      app.publicaciones.cargar();
    }
  },

  // ============================================
  // Módulo: Modal
  // ============================================

  modal: {
    cerrarTodosModales() {
      // Cerrar todos los modales para evitar bloqueos
      const modales = [
        "modalAuth",
        "modalChat",
        "modalResenya",
        "modalPublicar",
        "modalDetalle",
        "modalPostulaciones",
        "modalContacto",
        "modalCandidatos",
        "modalInteresados",
        "modalOpcionesStats",
        "modalOpcionesClinicas",
        "modalOpcionesClinicasPotenciales"
      ];
      modales.forEach(id => {
        const modal = document.getElementById(id);
        if (modal) {
          modal.classList.remove("active");
          modal.style.display = "none";
          modal.style.pointerEvents = "none";
          modal.style.opacity = "0";
          modal.style.visibility = "hidden";
          modal.style.zIndex = "-1";
        }
      });

      // Limpiar any stray overlays
      document.querySelectorAll(".modal").forEach(modal => {
        if (!modal.classList.contains("active")) {
          modal.style.display = "none";
          modal.style.pointerEvents = "none";
          modal.style.visibility = "hidden";
          modal.style.zIndex = "-1";
        }
      });

      // Asegurar que body no tenga estilos bloqueantes
      document.body.style.overflow = "";
      document.body.style.pointerEvents = "auto";
    },

    abrirPublicar() {
      if (!estadoApp.token) {
        utils.mostrarAlerta("Debes iniciar sesión para publicar", "error");
        return;
      }

      // Mostrar/ocultar tabs según tipo de usuario
      if (estadoApp.tipoUsuario === 'clinica') {
        // Empresa elige entre Oferta fija y Suplencia
        document.getElementById("tabsPublicar").style.display = "flex";
        document.getElementById("tabBtnOferta").style.display = "inline-block";
        document.getElementById("tabBtnSuplencia").style.display = "inline-block";
        document.getElementById("tabBtnSolicitud").style.display = "none";
        document.getElementById("tab-oferta").classList.add("active");
        document.getElementById("tab-suplencia").classList.remove("active");
        document.getElementById("tab-solicitud").classList.remove("active");
        document.getElementById("tabBtnOferta").classList.add("active");
        document.getElementById("tabBtnSuplencia").classList.remove("active");
        app.publicaciones.cargarEspecialidadesPublicar('oferta');
        app.publicaciones.cargarEspecialidadesPublicar('suplencia');
        app.plantillas.cargar('oferta');
        app.plantillas.cargar('suplencia');
        app.sedes.cargarEnSelector('oferta');
        app.sedes.cargarEnSelector('suplencia');
        app.catalogos.renderizarEquipamientoPublicar('oferta');
        app.catalogos.renderizarEquipamientoPublicar('suplencia');
        app.publicaciones.toggleRetribucion('oferta');
        app.publicaciones.toggleRetribucion('suplencia');
        document.getElementById("modalPublicarTitle").textContent = "Publicar nueva oferta";
      } else {
        // Candidato solo ve tab de Solicitud
        document.getElementById("tabsPublicar").style.display = "none";
        document.getElementById("tabBtnOferta").style.display = "none";
        document.getElementById("tabBtnSuplencia").style.display = "none";
        document.getElementById("tabBtnSolicitud").style.display = "inline-block";
        document.getElementById("tab-solicitud").classList.add("active");
        document.getElementById("tab-oferta").classList.remove("active");
        document.getElementById("tab-suplencia").classList.remove("active");
        document.getElementById("tabBtnSolicitud").classList.add("active");
        app.publicaciones.cargarEspecialidadesPublicar('solicitud');
        app.plantillas.cargar('solicitud');
        document.getElementById("modalPublicarTitle").textContent = "Publicar nueva solicitud";
        // La ciudad de la solicitud se hereda del perfil (no editable)
        app.publicaciones.rellenarCiudadSolicitudDesdePerfil();
      }

      document.getElementById("modalPublicar").classList.add("active");
    },

    cerrarPublicar() {
      document.getElementById("modalPublicar").classList.remove("active");
    },

    abrirAuthEmpresa() {
      document.getElementById("modalAuthEmpresa").classList.add("active");
    },

    cerrarAuthEmpresa() {
      document.getElementById("modalAuthEmpresa").classList.remove("active");
    },

    abrirAuthCandidato() {
      document.getElementById("modalAuthCandidato").classList.add("active");
    },

    cerrarAuthCandidato() {
      document.getElementById("modalAuthCandidato").classList.remove("active");
    },

    abrirPerfil() {
      document.getElementById("modalPerfil").classList.add("active");
      app.perfil.cargar();
    },

    cerrarPerfil() {
      document.getElementById("modalPerfil").classList.remove("active");
    },

    switchTab(tab) {
      document.querySelectorAll("#modalPublicar .tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll("#modalPublicar .tab-btn").forEach(el => el.classList.remove("active"));

      document.getElementById(`tab-${tab}`).classList.add("active");
      event.target.classList.add("active");

      const titulos = { oferta: "Publicar nueva oferta", suplencia: "🚨 Publicar suplencia / turno suelto", solicitud: "Publicar nueva solicitud" };
      document.getElementById("modalPublicarTitle").textContent = titulos[tab] || "Publicar";
    },

    abrirDetalleConManejo(publicacion) {
      this.abrirDetalle(publicacion).catch(error => {
        console.error("Error al cargar detalles:", error);
        utils.mostrarAlerta("Error al cargar detalles de la publicación", "error");
      });
    },

    async abrirDetalle(publicacion) {
      estadoApp.publicacionActual = publicacion;

      // Registrar vista si quien mira no es el dueño
      if (publicacion.usuario_id !== estadoApp.usuario?.id) {
        utils.request(`/publicaciones/${publicacion.id}/vista`, { method: 'POST' })
          .catch(err => console.error("Error al registrar vista:", err));
      }

      // Cargar especialidades de la publicación
      let especialidadesText = "";
      try {
        const data = await utils.request(`/publicaciones/${publicacion.id}/especialidades`, { method: 'GET' });
        if (data && data.especialidades && data.especialidades.length > 0) {
          especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
        }
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }

      // Equipamiento (solo relevante en ofertas y suplencias)
      let equipamientoText = "";
      if (publicacion.tipo === 'oferta' || publicacion.tipo === 'suplencia') {
        try {
          const data = await utils.request(`/publicaciones/${publicacion.id}/equipamiento`, { method: 'GET' });
          if (data && data.equipamiento && data.equipamiento.length > 0) {
            equipamientoText = data.equipamiento.join(", ");
          }
        } catch (error) {
          console.error("Error al cargar equipamiento:", error);
        }
      }

      let html = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; width: 30%; color: #0F4C75;">ID:</td>
              <td style="padding: 0.8rem;">${publicacion.id}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">Tipo:</td>
              <td style="padding: 0.8rem;">${publicacion.tipo === 'oferta' ? '📋 Oferta' : publicacion.tipo === 'suplencia' ? `🚨 Suplencia${publicacion.urgente ? ' (urgente)' : ''}` : '🔍 Solicitud'}</td>
            </tr>
            ${publicacion.tipo === 'suplencia' && (publicacion.fecha_desde || publicacion.fecha_hasta) ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🗓️ Fechas:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml([publicacion.fecha_desde, publicacion.fecha_hasta].filter(Boolean).join(' → '))}</td>
            </tr>
            ` : ''}
            ${publicacion.usuario_nombre ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">Publicado por:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.usuario_nombre)} (${publicacion.usuario_tipo === 'clinica' ? '🏥 Clínica' : '👨‍⚕️ Dentista'})</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📍 Ciudad:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.ciudad)}</td>
            </tr>
            ${especialidadesText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🦷 Especialidades:</td>
              <td style="padding: 0.8rem;">${especialidadesText}</td>
            </tr>
            ` : ''}
            ${publicacion.contrato ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📋 Contrato:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.contrato)}</td>
            </tr>
            ` : ''}
            ${publicacion.jornada ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">⏰ Jornada:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.jornada)}</td>
            </tr>
            ` : ''}
            ${publicacion.retribucion_tipo === 'porcentaje' && publicacion.retribucion_porcentaje ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">💰 Retribución:</td>
              <td style="padding: 0.8rem;">${publicacion.retribucion_porcentaje}% de facturación</td>
            </tr>
            ` : publicacion.salario ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">💰 Salario:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.salario)}</td>
            </tr>
            ` : ''}
            ${equipamientoText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🔬 Equipamiento:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(equipamientoText)}</td>
            </tr>
            ` : ''}
            ${publicacion.experiencia_minima !== null && publicacion.experiencia_minima !== undefined ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🎓 Experiencia:</td>
              <td style="padding: 0.8rem;">${publicacion.experiencia_minima} años</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📅 Publicado:</td>
              <td style="padding: 0.8rem;">${utils.formatearFecha(publicacion.creado_en)}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">👤 Contacto - Nombre:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(publicacion.nombre_contacto)}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📧 Contacto - Email:</td>
              <td style="padding: 0.8rem;"><a href="mailto:${utils.escapeHtml(publicacion.email_contacto)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(publicacion.email_contacto)}</a></td>
            </tr>
            ${publicacion.telefono_contacto ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📞 Contacto - Teléfono:</td>
              <td style="padding: 0.8rem;"><a href="tel:${utils.escapeHtml(publicacion.telefono_contacto)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(publicacion.telefono_contacto)}</a></td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <h4 style="margin: 1rem 0 0.5rem; color: #0F4C75; font-weight: 700;">Descripción</h4>
        <p style="white-space: pre-wrap; line-height: 1.6; background: #fff; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb;">${utils.escapeHtml(publicacion.descripcion)}</p>

        <div id="detalleContacto" style="display: none;"></div>
      `;

      // Agregar botón de editar si es propietario
      const esPropio = publicacion.usuario_id === estadoApp.usuario?.id;
      if (esPropio) {
        html = `<div id="detalleVistaPrevia">${html}</div>
                <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                  <button class="btn-primary" onclick="app.modal.activarEdicionConManejo()">Editar</button>
                  <button class="btn-text" onclick="app.modal.cerrarDetalle()">Cerrar</button>
                </div>`;
      } else if (estadoApp.usuario && publicacion.usuario_id) {
        const nombreOtro = (publicacion.usuario_nombre || publicacion.nombre_contacto || 'Usuario').replace(/'/g, "\\'");
        let candidaturaAceptada = false;
        try {
          const misPostulaciones = await utils.request('/candidaturas/mis-postulaciones');
          candidaturaAceptada = (misPostulaciones.candidaturas || []).some(
            c => c.publicacion_id === publicacion.id && c.estado === 'aceptada'
          );
        } catch (error) {
          console.error("Error al comprobar postulación:", error);
        }

        if (candidaturaAceptada) {
          html += `<div style="margin-top: 1.5rem;">
                    <button class="btn-primary" onclick="app.chat.abrirConDestinatario(${publicacion.id}, ${publicacion.usuario_id}, '${nombreOtro}')">💬 Enviar mensaje</button>
                  </div>`;
        }
      }

      document.getElementById("detalleBody").innerHTML = html;
      document.getElementById("detalleTitle").textContent = publicacion.tipo === "oferta" ? "Oferta de trabajo" : publicacion.tipo === "suplencia" ? "Suplencia / turno suelto" : "Solicitud de empleo";

      // Ocultar sección de contacto si es propia publicación
      const detalleContacto = document.getElementById("detalleContacto");
      if (esPropio) {
        detalleContacto.style.display = "none";
      } else {
        detalleContacto.style.display = "block";
      }

      document.getElementById("modalDetalle").classList.add("active");
    },

    activarEdicionConManejo() {
      this.activarEdicion().catch(error => {
        console.error("Error al activar edición:", error);
        utils.mostrarAlerta("Error al cargar formulario de edición", "error");
      });
    },

    async activarEdicion() {
      const pub = estadoApp.publicacionActual;

      // Obtener especialidades actuales
      let especialidadesActuales = [];
      try {
        const data = await utils.request(`/publicaciones/${pub.id}/especialidades`, { method: 'GET' });
        if (data && data.especialidades) {
          especialidadesActuales = data.especialidades.map(e => e.id);
        }
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }

      let html = `
        <form id="formEdicion" onsubmit="event.preventDefault(); app.modal.guardarEdicion();">
          <div class="form-group">
            <label for="editDescripcion">Descripción *</label>
            <textarea id="editDescripcion" required>${utils.escapeHtml(pub.descripcion)}</textarea>
          </div>
          <div class="form-group">
            <label for="editCiudad">Ciudad *</label>
            <input id="editCiudad" type="text" value="${utils.escapeHtml(pub.ciudad)}" required>
          </div>
          <div class="form-group">
            <label>Especialidades</label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin-bottom: 0.5rem;">
              <input type="checkbox" id="editMarcarTodas" onchange="app.modal.marcarTodasEspecialidadesEdicion()">
              <strong>Marcar todas</strong>
            </label>
            <div id="editEspecialidadesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              ${estadoApp.especialidades.map(e => `
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                  <input type="checkbox" class="editEspecialidadCheck" value="${e.id}" ${especialidadesActuales.includes(e.id) ? 'checked' : ''}>
                  <span>${e.nombre}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-group">
            <label for="editContrato">Contrato</label>
            <select id="editContrato">
              <option value="">Seleccionar...</option>
              <option value="Indefinido" ${pub.contrato === 'Indefinido' ? 'selected' : ''}>Indefinido</option>
              <option value="Temporal" ${pub.contrato === 'Temporal' ? 'selected' : ''}>Temporal</option>
              <option value="Autónomo" ${pub.contrato === 'Autónomo' ? 'selected' : ''}>Autónomo</option>
              <option value="Prácticas" ${pub.contrato === 'Prácticas' ? 'selected' : ''}>Prácticas</option>
            </select>
          </div>
          <div class="form-group">
            <label for="editJornada">Jornada</label>
            <select id="editJornada">
              <option value="">Seleccionar...</option>
              <option value="Completa" ${pub.jornada === 'Completa' ? 'selected' : ''}>Completa</option>
              <option value="Parcial" ${pub.jornada === 'Parcial' ? 'selected' : ''}>Parcial</option>
              <option value="Flexible" ${pub.jornada === 'Flexible' ? 'selected' : ''}>Flexible</option>
            </select>
          </div>
          <div class="form-group">
            <label for="editSalario">Salario</label>
            <input id="editSalario" type="text" value="${utils.escapeHtml(pub.salario || '')}">
          </div>
          <div class="form-group">
            <label for="editExperiencia">Años de experiencia</label>
            <input id="editExperiencia" type="number" min="0" value="${pub.experiencia_minima ?? ''}">
          </div>
          <div class="form-group">
            <label for="editNombreContacto">Nombre de contacto *</label>
            <input id="editNombreContacto" type="text" value="${utils.escapeHtml(pub.nombre_contacto)}" required>
          </div>
          <div class="form-group">
            <label for="editEmailContacto">Email de contacto *</label>
            <input id="editEmailContacto" type="email" value="${utils.escapeHtml(pub.email_contacto)}" required>
          </div>
          <div class="form-group">
            <label for="editTelefonoContacto">Teléfono de contacto</label>
            <input id="editTelefonoContacto" type="text" value="${utils.escapeHtml(pub.telefono_contacto || '')}">
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
            <button type="submit" class="btn-primary">Guardar</button>
            <button type="button" class="btn-text" onclick="app.modal.cerrarTodosModales()">Cancelar</button>
          </div>
        </form>
      `;

      document.getElementById("detalleBody").innerHTML = html;
      document.getElementById("detalleTitle").textContent = "Editar publicación";
    },

    marcarTodasEspecialidadesEdicion() {
      const checkAll = document.getElementById("editMarcarTodas").checked;
      document.querySelectorAll(".editEspecialidadCheck").forEach(cb => cb.checked = checkAll);
    },

    // Genérica para cualquier contenedor de checkboxes
    marcarTodasEnContenedor(containerId) {
      const checkbox = document.querySelector(`#${containerId}MarcarTodas`);
      if (!checkbox) return;
      const checkboxes = document.querySelectorAll(`#${containerId} input[type="checkbox"]:not(#${containerId}MarcarTodas)`);
      checkboxes.forEach(cb => cb.checked = checkbox.checked);
    },

    async guardarEdicion() {
      try {
        const pub = estadoApp.publicacionActual;
        const especialidades = Array.from(document.querySelectorAll(".editEspecialidadCheck:checked")).map(cb => parseInt(cb.value));

        const data = {
          descripcion: document.getElementById("editDescripcion").value,
          ciudad: document.getElementById("editCiudad").value,
          especialidades: especialidades,
          contrato: document.getElementById("editContrato").value || null,
          jornada: document.getElementById("editJornada").value || null,
          salario: document.getElementById("editSalario").value || null,
          experiencia: document.getElementById("editExperiencia").value || null,
          nombre_contacto: document.getElementById("editNombreContacto").value,
          email_contacto: document.getElementById("editEmailContacto").value,
          telefono_contacto: document.getElementById("editTelefonoContacto").value || null
        };

        await utils.request(`/publicaciones/${pub.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' }
        });

        utils.mostrarAlerta("Publicación actualizada", "success");
        app.modal.cerrarDetalle();
        app.publicaciones.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cerrarDetalle() {
      this.cerrarTodosModales();
    },

    abrirContacto() {
      document.getElementById("modalDetalle").classList.remove("active");
      document.getElementById("modalContacto").classList.add("active");
    },

    cerrarContacto() {
      document.getElementById("modalContacto").classList.remove("active");
    },

    abrirPostulaciones() {
      document.getElementById("modalPostulaciones").classList.add("active");
      app.candidaturas.cargarMisPostulaciones();
    },

    cerrarPostulaciones() {
      document.getElementById("modalPostulaciones").classList.remove("active");
    },

    abrirCandidatos(publicacionId, publicacionTitulo) {
      document.getElementById("modalCandidatos").classList.add("active");
      const titulo = document.querySelector("#modalCandidatos .modal-header h2");
      if (titulo) {
        titulo.textContent = `Dentistas: ${publicacionTitulo}`;
      }
      app.candidaturas.cargarCandidatos(publicacionId);
    },

    cerrarCandidatos() {
      document.getElementById("modalCandidatos").classList.remove("active");
    },

    abrirPostularseModal() {
      document.getElementById("modalPostularseForm").classList.add("active");
      document.getElementById("postulacionMensaje").value = "";
      document.getElementById("postulacionError").style.display = "none";
    },

    abrirPostularseDesdeOferta(oferta) {
      if (typeof oferta === 'string') {
        oferta = JSON.parse(oferta);
      }
      estadoApp.publicacionActual = oferta;
      document.getElementById("modalPostularseForm").classList.add("active");
      document.getElementById("postulacionMensaje").value = "";
      document.getElementById("postulacionError").style.display = "none";
    },

    cerrarPostularseModal() {
      document.getElementById("modalPostularseForm").classList.remove("active");
    },

    async abrirInteresados(publicacionId, tipo) {
      try {
        if (tipo === 'solicitud') {
          // Para dentistas: mismo flujo que clínicas
          app.stats.mostrarPostulacionesRecibidas();
        } else {
          // Para clínicas: mostrar mensajes
          const mensajes = await utils.request(`/mensajes/${publicacionId}`);
          const interesados = [];
          const visitados = new Set();

          mensajes.forEach(m => {
            if (!visitados.has(m.remitente_email)) {
              visitados.add(m.remitente_email);
              interesados.push(m);
            }
          });

          const label = tipo === "oferta" ? "Candidatos" : "Empresas";
          let html = `<h3>${interesados.length} ${label} interesado${interesados.length !== 1 ? 's' : ''}</h3>`;

          if (interesados.length === 0) {
            html += `<p>Aún no hay ${label.toLowerCase()} interesados.</p>`;
          } else {
            html += `<div class="interesados-list">`;
            interesados.forEach(m => {
              html += `
                <div class="interesado-item">
                  <div class="interesado-header">
                    <strong>${utils.escapeHtml(m.remitente_nombre)}</strong>
                    <span class="interesado-email">${utils.escapeHtml(m.remitente_email)}</span>
                  </div>
                  <p class="interesado-mensaje">${utils.escapeHtml(m.cuerpo)}</p>
                  <span class="interesado-fecha">${utils.formatearFecha(m.creado_en)}</span>
                </div>
              `;
            });
            html += `</div>`;
          }

          document.getElementById("modalInteresados").querySelector(".modal-content").innerHTML = `
            <div class="modal-header">
              <h2>${label} Interesados</h2>
              <button class="close-btn" onclick="app.modal.cerrarInteresados()">✕</button>
            </div>
            ${html}
          `;
          document.getElementById("modalInteresados").classList.add("active");
        }
      } catch (error) {
        console.error("ERROR en abrirInteresados:", error);
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cerrarInteresados() {
      this.cerrarTodosModales();
    }
  },

  // ============================================
  // Módulo: Contacto
  // ============================================

  contacto: {
    async enviar() {
      if (!estadoApp.publicacionActual) return;

      const nombre = document.getElementById("contactoNombre").value;
      const email = document.getElementById("contactoEmail").value;
      const cuerpo = document.getElementById("contactoMensaje").value;

      if (!nombre || !email || !cuerpo) {
        utils.mostrarAlerta("Por favor completa todos los campos", "error");
        return;
      }

      try {
        await utils.request("/mensajes", {
          method: "POST",
          body: JSON.stringify({
            publicacion_id: estadoApp.publicacionActual.id,
            remitente_nombre: nombre,
            remitente_email: email,
            cuerpo: cuerpo
          })
        });

        utils.mostrarAlerta("¡Mensaje enviado exitosamente!", "success");
        app.modal.cerrarContacto();
        document.getElementById("contactoNombre").value = "";
        document.getElementById("contactoEmail").value = "";
        document.getElementById("contactoMensaje").value = "";
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Stats
  // ============================================

  stats: {
    async mostrarTotalDentistas() {
      document.getElementById("modalOpcionesStats").classList.add("active");
    },

    async mostrarTotalClinicas() {
      document.getElementById("modalOpcionesClinicas").classList.add("active");
    },

    async mostrarClinicasPorEspecialidad() {
      try {
        const datos = await utils.request("/stats/clinicas-por-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Una clínica puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de clínicas.</p>`;
        html += "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarClinicasEspecialidad('${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesClinicas").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Clínicas por Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasPorCiudad() {
      try {
        const datos = await utils.request("/stats/clinicas-por-ciudad");
        let html = "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarClinicasCiudad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.ciudad)}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesClinicas").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Clínicas por Ciudad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasPorCiudadEspecialidad() {
      try {
        const datos = await utils.request("/stats/clinicas-por-ciudad-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Una clínica puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de clínicas.</p>`;
        html += "<div class='desglose-grupos'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          let ciudadActual = null;
          datos.forEach(d => {
            if (d.ciudad !== ciudadActual) {
              if (ciudadActual !== null) {
                html += "</div>";
              }
              ciudadActual = d.ciudad;
              html += `<div class='desglose-grupo'><h4>${utils.escapeHtml(ciudadActual)}</h4>`;
            }
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarClinicasCiudadEspecialidad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}', '${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
          html += "</div>";
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesClinicas").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Clínicas por Ciudad y Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorEspecialidad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Un dentista puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de dentistas.</p>`;
        html += "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarDentistasEspecialidad('${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesStats").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Dentistas por Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorCiudad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-ciudad");
        let html = "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarDentistasCiudad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.ciudad)}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesStats").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Dentistas por Ciudad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorCiudadEspecialidad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-ciudad-especialidad");
        let html = `<p style="margin: 0 0 1rem 0; padding: 0.75rem 1rem; background: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px; font-size: 0.85rem; color: #0c4a6e;">ℹ️ Un dentista puede cubrir varias especialidades a la vez, así que puede aparecer en más de una — la suma de los números no tiene por qué coincidir con el total de dentistas.</p>`;
        html += "<div class='desglose-grupos'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          let ciudadActual = null;
          datos.forEach(d => {
            if (d.ciudad !== ciudadActual) {
              if (ciudadActual !== null) {
                html += "</div>";
              }
              ciudadActual = d.ciudad;
              html += `<div class='desglose-grupo'><h4>${utils.escapeHtml(ciudadActual)}</h4>`;
            }
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarDentistasCiudadEspecialidad('${utils.escapeHtml(d.ciudad.replace(/'/g, "\\'"))}', '${utils.escapeHtml((d.especialidad || "Sin especialidad").replace(/'/g, "\\'"))}')">
                <strong>${utils.escapeHtml(d.especialidad || "Sin especialidad")}</strong>
                <span class="desglose-numero">${d.total}</span>
              </div>
            `;
          });
          html += "</div>";
        }

        html += "</div>";
        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalOpcionesStats").classList.remove("active");
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Dentistas por Ciudad y Especialidad";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasEspecialidad(especialidad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-especialidad-lista/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaDentistas(dentistas, `Dentistas - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasCiudad(ciudad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-ciudad-lista/${encodeURIComponent(ciudad)}`);
        app.stats.mostrarListaDentistas(dentistas, `Dentistas - ${utils.escapeHtml(ciudad)}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasCiudadEspecialidad(ciudad, especialidad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-ciudad-especialidad-lista/${encodeURIComponent(ciudad)}/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaDentistas(dentistas, `Dentistas - ${utils.escapeHtml(ciudad)} - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasEspecialidad(especialidad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-especialidad-lista/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasCiudad(ciudad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-ciudad-lista/${encodeURIComponent(ciudad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${utils.escapeHtml(ciudad)}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasCiudadEspecialidad(ciudad, especialidad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-ciudad-especialidad-lista/${encodeURIComponent(ciudad)}/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${utils.escapeHtml(ciudad)} - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarListaClinicasSimple(clinicas, titulo) {
      if (clinicas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por publicación y obtener especialidades
      const porPublicacion = {};

      // Primero, agrupar por publicación_id para obtener especialidades
      const porPublicacionId = {};
      clinicas.forEach(c => {
        if (!porPublicacionId[c.publicacion_id]) {
          porPublicacionId[c.publicacion_id] = {
            ciudad: c.ciudad,
            clinicas: {}
          };
        }
        if (!porPublicacionId[c.publicacion_id].clinicas[c.usuario_id]) {
          porPublicacionId[c.publicacion_id].clinicas[c.usuario_id] = c;
        }
      });

      // Obtener especialidades para cada publicación
      for (const pubId of Object.keys(porPublicacionId)) {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          const especialidades = data.especialidades ? data.especialidades.map(e => e.nombre).join(", ") : 'Sin especialidades';
          const ciudad = porPublicacionId[pubId].ciudad;
          const clave = `${especialidades}-${utils.escapeHtml(ciudad)}`;

          porPublicacion[clave] = {
            especialidades: especialidades,
            ciudad: ciudad,
            clinicas: porPublicacionId[pubId].clinicas
          };
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
      }

      let totalClinicas = 0;
      let html = `<div class="candidatos-list">`;

      // Ordenar grupos por: ciudad → especialidad
      const publicacionesOrdenadas = utils.ordenarPorCiudadYEspecialidad(Object.values(porPublicacion));

      publicacionesOrdenadas.forEach(pub => {
        // Ordenar clínicas dentro del grupo por: ciudad → fecha → especialidad → salario
        const clinicasList = utils.ordenarPorCiudadFechaEspecialidadSalario(Object.values(pub.clinicas));
        totalClinicas += clinicasList.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${utils.escapeHtml(pub.especialidades)} - 📍 ${utils.escapeHtml(pub.ciudad)}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Clínicas coincidentes: ${clinicasList.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        clinicasList.forEach(c => {
          const clinicaConEspecialidad = {...c, especialidades: pub.especialidades};
          html += `
            <div style="background: white; border-left: 3px solid #0F4C75; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${utils.escapeHtml(c.nombre)}</strong>
                <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${utils.escapeHtml(c.email)}</p>
                ${c.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${utils.escapeHtml(c.ciudad)}</p>` : ''}
              </div>
              <button class="btn-primary" onclick="app.stats.mostrarPerfilClinica(${JSON.stringify(clinicaConEspecialidad).replace(/"/g, '&quot;')})" style="white-space: nowrap; margin-left: 1rem;">Ver detalles</button>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${totalClinicas})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarListaDentistas(dentistas, titulo) {
      if (dentistas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      let html = `<div class="candidatos-list">`;

      dentistas.forEach(d => {
        html += `
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">${utils.escapeHtml(d.nombre)}</h4>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🦷 Especialidades:</strong> ${utils.escapeHtml(d.especialidades || 'Sin especialidad')}</p>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📧 Email:</strong> ${utils.escapeHtml(d.email)}</p>
            ${d.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📞 Teléfono:</strong> ${utils.escapeHtml(d.telefono)}</p>` : ''}
            ${d.movil ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📱 Móvil:</strong> ${utils.escapeHtml(d.movil)}</p>` : ''}
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(d.ciudad)}</p>
            ${d.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🏠 Dirección:</strong> ${utils.escapeHtml(d.direccion)}</p>` : ''}
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${dentistas.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarListaClinicas(clinicas, titulo) {
      if (clinicas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      let html = `<div class="candidatos-list">`;

      clinicas.forEach(c => {
        html += `
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">${utils.escapeHtml(c.nombre)}</h4>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🦷 Especialidades:</strong> ${utils.escapeHtml(c.especialidades || 'Sin especialidad')}</p>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📧 Email:</strong> ${utils.escapeHtml(c.email)}</p>
            ${c.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📞 Teléfono:</strong> ${utils.escapeHtml(c.telefono)}</p>` : ''}
            ${c.movil ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📱 Móvil:</strong> ${utils.escapeHtml(c.movil)}</p>` : ''}
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(c.ciudad)}</p>
            ${c.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🏠 Dirección:</strong> ${utils.escapeHtml(c.direccion)}</p>` : ''}
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${clinicas.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarPerfilClinica(clinica) {
      const resumenResenyas = clinica.usuario_id ? await app.resenyas.cargarResumen(clinica.usuario_id) : null;

      // Datos públicos (descripción) y fotos de la clínica
      let publico = null;
      let fotos = [];
      if (clinica.usuario_id) {
        try { publico = await utils.request(`/usuarios/${clinica.usuario_id}/publico`); } catch (e) { /* opcional */ }
        try {
          const archivos = await utils.request(`/archivos/usuario/${clinica.usuario_id}`);
          fotos = (archivos || []).filter(a => a.tipo === 'foto');
        } catch (e) { /* opcional */ }
      }
      const descripcion = (publico && publico.descripcion) || clinica.descripcion;

      let html = `
        <div style="padding: 2rem; background: #f9fafb; border-radius: 12px;">

          ${resumenResenyas ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">⭐ Valoraciones</h4>
            ${app.resenyas.resumenHtml(resumenResenyas, clinica.usuario_id, clinica.nombre)}
          </div>` : ''}

          ${clinica.especialidades ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">🦷 Especialidad</h4>
            <p style="margin: 0; font-size: 0.95rem;">${utils.escapeHtml(clinica.especialidades)}</p>
          </div>` : ''}

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📞 Contacto</h4>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📧 Email:</strong> ${utils.escapeHtml(clinica.email)}</p>
            ${clinica.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📞 Teléfono:</strong> ${utils.escapeHtml(clinica.telefono)}</p>` : ''}
            ${clinica.movil ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📱 Móvil:</strong> ${utils.escapeHtml(clinica.movil)}</p>` : ''}
          </div>

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📍 Ubicación</h4>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🌆 Ciudad:</strong> ${utils.escapeHtml(clinica.ciudad)}</p>
            ${clinica.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🏠 Dirección:</strong> ${utils.escapeHtml(clinica.direccion)}</p>` : ''}
            ${clinica.codigo_postal ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📮 Código Postal:</strong> ${utils.escapeHtml(clinica.codigo_postal)}</p>` : ''}
            ${clinica.pais ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🌍 País:</strong> ${utils.escapeHtml(clinica.pais)}</p>` : ''}
          </div>

          ${descripcion ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📋 Descripción</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(descripcion)}</p>
          </div>` : ''}

          ${fotos.length > 0 ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📷 Fotos de la clínica</h4>
            <div class="fotos-gallery">
              ${fotos.map(f => `<div class="foto-item"><img src="${API}/archivos/${f.id}/download" alt="Foto de la clínica" loading="lazy"></div>`).join('')}
            </div>
          </div>` : ''}

          ${clinica.web ? `<div style="background: white; border-radius: 8px; padding: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">🌐 Web</h4>
            <p style="margin: 0; font-size: 0.95rem;"><a href="${utils.escapeHtml(clinica.web)}" target="_blank" style="color: #0ea5e9; text-decoration: none;">${utils.escapeHtml(clinica.web)}</a></p>
          </div>` : ''}
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = clinica.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarClinicasPotenciales() {
      try {
        const clinicas = await utils.request(`/stats/clinicas-potenciales-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaClinicasSimple(clinicas, "Clínicas Potenciales");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarOfertasActivas() {
      try {
        const ofertas = await utils.request("/publicaciones?tipo=oferta&limit=500");

        if (ofertas.length === 0) {
          utils.mostrarAlerta("No hay ofertas activas", "info");
          return;
        }

        // Agrupar por ciudad
        const agrupadoPorCiudad = {};
        ofertas.forEach(o => {
          if (!agrupadoPorCiudad[o.ciudad]) agrupadoPorCiudad[o.ciudad] = [];
          agrupadoPorCiudad[o.ciudad].push(o);
        });

        let html = `<h3>${ofertas.length} Ofertas Activas</h3><div class="desglose-grupos">`;

        Object.keys(agrupadoPorCiudad).sort().forEach(ciudad => {
          html += `<div class="desglose-grupo"><h4>${utils.escapeHtml(ciudad)}</h4>`;

          agrupadoPorCiudad[ciudad].forEach((o, idx) => {
            const esp = estadoApp.especialidades.find(e => e.id === o.especialidad_id);
            const titulo = esp ? esp.nombre : 'Oferta';
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarOfertaCompleta(${JSON.stringify(o).replace(/"/g, '&quot;')})">
                <strong>${titulo}</strong>
                <span class="desglose-numero">Oferta ${idx + 1}</span>
              </div>
            `;
          });

          html += "</div>";
        });

        html += "</div>";

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    pollingInterval: null,

    async mostrarMisPostulaciones() {
      try {
        const postulaciones = await utils.request(`/stats/mis-postulaciones-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulaciones(postulaciones, "Postulaciones a Clínicas");

        // Iniciar polling automático
        this.iniciarPolling('postulaciones');
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisPostulacionesAceptadas() {
      try {
        const postulaciones = await utils.request(`/stats/mis-postulaciones-aceptadas-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulaciones(postulaciones, "Postulaciones a Clínicas Aceptadas");

        // Iniciar polling automático
        this.iniciarPolling('aceptadas');
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    iniciarPolling(tipo) {
      // Detener polling anterior si existe
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }

      // Función para hacer polling
      const hacerPolling = async () => {
        const modal = document.getElementById("modalInteresados");
        if (!modal || !modal.classList.contains("active")) {
          // Si el modal se cierra, detener polling
          if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
          }
          return;
        }

        try {
          let postulaciones = [];
          if (tipo === 'postulaciones') {
            postulaciones = await utils.request(`/stats/mis-postulaciones-lista/${estadoApp.usuario.id}`);
          } else if (tipo === 'aceptadas') {
            postulaciones = await utils.request(`/stats/mis-postulaciones-aceptadas-lista/${estadoApp.usuario.id}`);
          }

          const html = await app.stats.generarHtmlPostulaciones(postulaciones);
          document.getElementById("interesadosBody").innerHTML = html;

          // Actualizar título con nuevo count
          const modal = document.getElementById("modalInteresados");
          if (modal) {
            const titulo = tipo === 'postulaciones' ? 'Postulaciones a Clínicas' : 'Postulaciones a Clínicas Aceptadas';
            modal.querySelector(".modal-header h2").textContent = `${titulo} (${postulaciones.length})`;
          }
        } catch (error) {
          console.error("Error en polling:", error);
        }
      };

      // Ejecutar inmediatamente y luego cada 3 segundos
      hacerPolling();
      this.pollingInterval = setInterval(hacerPolling, 3000);
    },

    async generarHtmlPostulaciones(postulaciones) {
      if (postulaciones.length === 0) {
        return '<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No hay postulaciones</p></div>';
      }

      // Obtener especialidades reales de cada publicación (guardadas en tabla de unión)
      const especialidadesPorPublicacion = {};
      const publicacionIds = [...new Set(postulaciones.map(p => p.publicacion_id))];
      await Promise.all(publicacionIds.map(async (pubId) => {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          especialidadesPorPublicacion[pubId] = data.especialidades && data.especialidades.length > 0
            ? data.especialidades.map(e => e.nombre).join(", ")
            : 'Sin especialidad';
        } catch (error) {
          especialidadesPorPublicacion[pubId] = 'Sin especialidad';
        }
      }));

      // Ordenar por: ciudad → fecha → especialidad → salario
      const ordenadas = utils.ordenarPorCiudadFechaEspecialidadSalario(postulaciones);

      let html = `<div class="candidatos-list">`;
      ordenadas.forEach(post => {
        const estadoColor = utils.colorEstado(post.estado);
        const tituloPublicacion = post.ciudad || 'Publicación';
        const especialidad = especialidadesPorPublicacion[post.publicacion_id] || 'Sin especialidad';
        const fecha = utils.formatearFecha(post.creado_en);
        const postConEspecialidad = {...post, especialidad_nombre: especialidad};
        html += `
          <div style="background: white; border: 2px solid ${estadoColor}; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
              <div>
                <h4 style="margin: 0 0 0.3rem 0; color: #0f4c75; font-size: 1.2rem; font-weight: 700;">${utils.escapeHtml(tituloPublicacion)}</h4>
                ${post.empresa_nombre ? `<p style="margin: 0; color: #6b7280; font-size: 0.95rem;">🏢 ${utils.escapeHtml(post.empresa_nombre)}</p>` : ''}
              </div>
              <span style="background: ${estadoColor}; color: white; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; text-transform: capitalize; white-space: nowrap;">${utils.textoEstado(post.estado)}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; font-size: 0.9rem; color: #6b7280;">
              <p style="margin: 0;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(post.ciudad)}</p>
              <p style="margin: 0;"><strong>📅 Fecha:</strong> ${fecha}</p>
              <p style="margin: 0;"><strong>🦷 Especialidad:</strong> ${especialidad}</p>
              ${post.salario ? `<p style="margin: 0;"><strong>💰 Salario:</strong> ${utils.escapeHtml(post.salario)}</p>` : ''}
              ${post.contrato ? `<p style="margin: 0;"><strong>📋 Contrato:</strong> ${utils.escapeHtml(post.contrato)}</p>` : ''}
              ${post.jornada ? `<p style="margin: 0;"><strong>⏰ Jornada:</strong> ${utils.escapeHtml(post.jornada)}</p>` : ''}
            </div>
            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 1rem;">
              <p style="margin: 0; color: #6b7280; white-space: pre-wrap; line-height: 1.6; font-size: 0.9rem;">${utils.escapeHtml(post.descripcion || 'Sin descripción')}</p>
            </div>
            ${post.mensaje ? `<div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #0ea5e9;">
              <p style="margin: 0; font-size: 0.85rem; color: #0c4a6e; font-weight: 600;">💬 Tu mensaje:</p>
              <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #0c4a6e; white-space: pre-wrap;">${utils.escapeHtml(post.mensaje)}</p>
            </div>` : ''}
            <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
              <button class="btn-primary" onclick="app.stats.mostrarDetalleMiPostulacion(${utils.escapeJsonForHtml(postConEspecialidad)})" style="flex: 1; background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">👁️ Ver detalles</button>
              ${post.estado === 'aceptada' ? `<button onclick="app.resenyas.abrirFormulario(${post.id}, '${utils.escapeHtml((post.empresa_nombre || 'la otra parte').replace(/'/g, "\\'"))}')" style="flex: 1; background: #f59e0b; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">⭐ Valorar</button>` : ''}
              <button onclick="app.candidaturas.retirarPostulacion(${post.id})" style="flex: 1; background: #ef4444; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">🗑️ Retirar</button>
            </div>
          </div>
        `;
      });
      html += "</div>";
      return html;
    },

    mostrarDetalleMiPostulacion(post) {
      // Detener el refresco automático: si no, sobrescribe este detalle con la lista a los pocos segundos
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      const estadoColor = utils.colorEstado(post.estado);
      const especialidad = post.especialidad_nombre || 'Sin especialidad';
      const fecha = utils.formatearFecha(post.creado_en);

      let html = `
        <div style="padding: 2rem; background: #f9fafb; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3 style="margin: 0; color: #0f4c75; font-size: 1.5rem; font-weight: 700;">${utils.escapeHtml(post.empresa_nombre || post.ciudad)}</h3>
            <span style="background: ${estadoColor}; color: white; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; text-transform: capitalize;">${utils.textoEstado(post.estado)}</span>
          </div>

          <div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📋 Detalles</h4>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📍 Ciudad:</strong> ${utils.escapeHtml(post.ciudad)}</p>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📅 Fecha:</strong> ${fecha}</p>
            <p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>🦷 Especialidad:</strong> ${especialidad}</p>
            ${post.salario ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>💰 Salario:</strong> ${utils.escapeHtml(post.salario)}</p>` : ''}
            ${post.contrato ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📋 Contrato:</strong> ${utils.escapeHtml(post.contrato)}</p>` : ''}
            ${post.jornada ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>⏰ Jornada:</strong> ${utils.escapeHtml(post.jornada)}</p>` : ''}
            ${post.empresa_email ? `<p style="margin: 0.3rem 0; font-size: 0.95rem;"><strong>📧 Email:</strong> ${utils.escapeHtml(post.empresa_email)}</p>` : ''}
          </div>

          ${post.descripcion ? `<div style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">📝 Descripción</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(post.descripcion)}</p>
          </div>` : ''}

          ${post.mensaje ? `<div style="background: white; border-radius: 8px; padding: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-weight: 600; font-size: 1.1rem;">💬 Tu mensaje</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(post.mensaje)}</p>
          </div>` : ''}
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = post.empresa_nombre || post.ciudad;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarListaPostulaciones(postulaciones, titulo) {
      if (postulaciones.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      const html = await this.generarHtmlPostulaciones(postulaciones);
      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${postulaciones.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarMisPostulacionesDentistas() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const misPostulaciones = data.candidaturas || [];

        // Filtrar solo postulaciones a solicitudes de dentistas
        const postulacionesDentistas = misPostulaciones.filter(p => p.publicacion_tipo === 'solicitud');

        app.stats.mostrarListaPostulaciones(postulacionesDentistas, "Mis Postulaciones a Dentistas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisPostulacionesDentistasAceptadas() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const misPostulaciones = data.candidaturas || [];

        // Filtrar solo postulaciones aceptadas a solicitudes de dentistas
        const postulacionesAceptadas = misPostulaciones.filter(p => p.publicacion_tipo === 'solicitud' && p.estado === 'aceptada');

        app.stats.mostrarListaPostulaciones(postulacionesAceptadas, "Mis Postulaciones a Dentistas Aceptadas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisSolicitudes() {
      try {
        const misSolicitudes = await utils.request(`/publicaciones?tipo=solicitud&usuario_id=${estadoApp.usuario.id}&limit=500`);

        if (misSolicitudes.length === 0) {
          utils.mostrarAlerta("No has publicado ninguna solicitud", "info");
          return;
        }

        // Obtener respuestas para cada solicitud
        const solicitudesConRespuestas = [];
        for (const solicitud of misSolicitudes) {
          const mensajes = await utils.request(`/mensajes/${solicitud.id}`);
          solicitudesConRespuestas.push({
            ...solicitud,
            respuestas: mensajes.length,
            mensajes: mensajes
          });
        }

        // Agrupar por ciudad
        const agrupadoPorCiudad = {};
        solicitudesConRespuestas.forEach(s => {
          if (!agrupadoPorCiudad[s.ciudad]) agrupadoPorCiudad[s.ciudad] = [];
          agrupadoPorCiudad[s.ciudad].push(s);
        });

        // Ordenar por ciudad
        let html = `<h3>${misSolicitudes.length} Mis solicitudes</h3><div class="desglose-grupos">`;

        Object.keys(agrupadoPorCiudad).sort().forEach(ciudad => {
          html += `<div class="desglose-grupo"><h4>${utils.escapeHtml(ciudad)}</h4>`;

          agrupadoPorCiudad[ciudad].forEach(s => {
            const esp = estadoApp.especialidades.find(e => e.id === s.especialidad_id);
            const tituloSolicitud = esp ? `${esp.nombre} - ${s.ciudad}` : s.ciudad;
            const resp = s.respuestas > 0 ? `${s.respuestas} respuesta${s.respuestas !== 1 ? 's' : ''}` : 'Sin respuestas';
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarSolicitudConRespuesta(${s.id})">
                <div>
                  <strong>${tituloSolicitud}</strong>
                  <p style="font-size: 0.85rem; color: var(--gray-600); margin: 0.25rem 0 0 0;">${esp?.nombre || 'Sin especialidad'}</p>
                </div>
                <span class="desglose-numero">${resp}</span>
              </div>
            `;
          });

          html += "</div>";
        });

        html += "</div>";

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    mostrarOfertaCompleta(oferta) {
      const esp = estadoApp.especialidades.find(e => e.id === oferta.especialidad_id);
      const titulo = esp ? `${esp.nombre} - ${utils.escapeHtml(oferta.ciudad)}` : oferta.ciudad;

      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0; color: var(--primary);">${titulo}</h3>

          <div class="info-section">
            <h4>Detalles</h4>
            <p><strong>Ciudad:</strong> ${utils.escapeHtml(oferta.ciudad)}</p>
            ${esp ? `<p><strong>Especialidades:</strong> ${esp.nombre}</p>` : ''}
            ${oferta.contrato ? `<p><strong>Contrato:</strong> ${utils.escapeHtml(oferta.contrato)}</p>` : ''}
            ${oferta.jornada ? `<p><strong>Jornada:</strong> ${utils.escapeHtml(oferta.jornada)}</p>` : ''}
            ${oferta.salario ? `<p><strong>Salario:</strong> ${utils.escapeHtml(oferta.salario)}</p>` : ''}
          </div>

          ${oferta.descripcion ? `
          <div class="info-section">
            <h4>Descripción</h4>
            <p style="white-space: pre-wrap;">${utils.escapeHtml(oferta.descripcion)}</p>
          </div>
          ` : ''}

          ${oferta.nombre_contacto ? `
          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Nombre:</strong> ${utils.escapeHtml(oferta.nombre_contacto)}</p>
            ${oferta.email_contacto ? `<p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(oferta.email_contacto)}">${utils.escapeHtml(oferta.email_contacto)}</a></p>` : ''}
            ${oferta.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${utils.escapeHtml(oferta.telefono_contacto)}">${utils.escapeHtml(oferta.telefono_contacto)}</a></p>` : ''}
          </div>
          ` : ''}
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Oferta de Trabajo";
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarSolicitudConRespuesta(solicitudId) {
      try {
        // Obtener la solicitud completa
        const solicitud = await utils.request(`/publicaciones/${solicitudId}`);

        const esp = estadoApp.especialidades.find(e => e.id === solicitud.especialidad_id);

        // Obtener mensajes
        const mensajes = await utils.request(`/mensajes/${solicitudId}`);

        const tituloSolicitud = esp ? `${esp.nombre} - ${utils.escapeHtml(solicitud.ciudad)}` : solicitud.ciudad;

        let html = `
          <div class="perfil-dentista">
            <h3 style="margin-top: 0; color: var(--primary);">${tituloSolicitud}</h3>

            <div class="info-section">
              <h4>Detalles</h4>
              <p><strong>Ciudad:</strong> ${utils.escapeHtml(solicitud.ciudad)}</p>
              <p><strong>Especialidad:</strong> ${esp?.nombre || 'No especificada'}</p>
              ${solicitud.jornada ? `<p><strong>Disponibilidad:</strong> ${utils.escapeHtml(solicitud.jornada)}</p>` : ''}
              ${solicitud.salario ? `<p><strong>Salario esperado:</strong> ${utils.escapeHtml(solicitud.salario)}</p>` : ''}
              ${solicitud.contrato ? `<p><strong>Contrato:</strong> ${utils.escapeHtml(solicitud.contrato)}</p>` : ''}
            </div>

            <div class="info-section">
              <h4>Descripción</h4>
              <p style="white-space: pre-wrap;">${utils.escapeHtml(solicitud.descripcion)}</p>
            </div>

            <div class="info-section">
              <h4>Mi Contacto</h4>
              ${solicitud.nombre_contacto ? `<p><strong>Nombre:</strong> ${utils.escapeHtml(solicitud.nombre_contacto)}</p>` : ''}
              ${solicitud.email_contacto ? `<p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(solicitud.email_contacto)}">${utils.escapeHtml(solicitud.email_contacto)}</a></p>` : ''}
              ${solicitud.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${utils.escapeHtml(solicitud.telefono_contacto)}">${utils.escapeHtml(solicitud.telefono_contacto)}</a></p>` : ''}
            </div>
        `;

        // Mostrar mensajes recibidos
        if (mensajes && mensajes.length > 0) {
          html += `
            <div class="info-section">
              <h4>Respuestas Recibidas (${mensajes.length})</h4>
          `;

          mensajes.forEach(m => {
            html += `
              <div style="background: #F8FAFF; padding: 1rem; border-radius: 8px; border-left: 4px solid #2ec4b6; margin-bottom: 1rem;">
                <p><strong>De:</strong> ${utils.escapeHtml(m.remitente_nombre)}</p>
                <p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(m.remitente_email)}">${utils.escapeHtml(m.remitente_email)}</a></p>
                <p style="white-space: pre-wrap; margin-top: 1rem; font-style: italic;">💬 "${utils.escapeHtml(m.cuerpo)}"</p>
                <p style="font-size: 0.85rem; color: var(--gray-600); margin-top: 0.5rem;">📅 ${utils.formatearFecha(m.creado_en)}</p>
              </div>
            `;
          });

          html += `</div>`;
        } else {
          html += `
            <div class="info-section">
              <p style="color: var(--gray-600); font-style: italic;">Sin respuestas aún</p>
            </div>
          `;
        }

        html += `</div>`;

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Mi Búsqueda";
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarPosiblesCandidatos() {
      try {
        const candidatos = await utils.request(`/stats/posibles-candidatos-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaCandidatosSimple(candidatos, "Dentistas Potenciales");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarCandidatosInteresados() {
      try {
        const candidatos = await utils.request(`/stats/candidatos-interesados-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaCandidatos(candidatos, "Postulaciones Recibidas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarPostulacionesRecibidas() {
      try {
        const postulaciones = await utils.request(`/stats/postulaciones-recibidas-dentista-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulacionesRecibidas(postulaciones, "Postulaciones Recibidas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarPostulacionesRecibdasAceptadas() {
      try {
        const postulaciones = await utils.request(`/stats/postulaciones-recibidas-aceptadas-dentista-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaPostulacionesRecibidas(postulaciones, "Postulaciones Recibidas Aceptadas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarEstadisticasPublicacion(publicacionId, titulo) {
      try {
        const stats = await utils.request(`/publicaciones/${publicacionId}/estadisticas`);
        const p = stats.postulantes;

        const tiempoMedio = stats.tiempo_medio_respuesta_dias !== null
          ? (stats.tiempo_medio_respuesta_dias < 1
              ? "menos de 1 día"
              : `${stats.tiempo_medio_respuesta_dias} días`)
          : "—";

        const html = `
          <div style="padding: 1rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
              <div class="pub-stat-card">
                <span style="font-size: 1.6rem;">👁️</span>
                <h3 style="margin: 0.3rem 0; font-size: 1.8rem; color: #0f4c75;">${stats.vistas}</h3>
                <p style="margin: 0; color: #6b7280; font-size: 0.85rem;">Vistas</p>
              </div>
              <div class="pub-stat-card">
                <span style="font-size: 1.6rem;">📬</span>
                <h3 style="margin: 0.3rem 0; font-size: 1.8rem; color: #0f4c75;">${p.total}</h3>
                <p style="margin: 0; color: #6b7280; font-size: 0.85rem;">Postulantes</p>
              </div>
              <div class="pub-stat-card">
                <span style="font-size: 1.6rem;">⏱️</span>
                <h3 style="margin: 0.3rem 0; font-size: 1.4rem; color: #0f4c75;">${tiempoMedio}</h3>
                <p style="margin: 0; color: #6b7280; font-size: 0.85rem;">Tiempo medio de respuesta</p>
              </div>
            </div>

            <h4 style="color: #0f4c75; margin: 0 0 0.75rem 0;">Postulantes por estado</h4>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <span class="pub-stat-chip" style="background: #fef3c7; color: #92400e;">⏳ Pendientes: ${p.pendientes}</span>
              <span class="pub-stat-chip" style="background: #d1fae5; color: #065f46;">✅ Aceptadas: ${p.aceptadas}</span>
              <span class="pub-stat-chip" style="background: #fee2e2; color: #991b1b;">❌ Rechazadas: ${p.rechazadas}</span>
              <span class="pub-stat-chip" style="background: #f3f4f6; color: #4b5563;">↩️ Retiradas: ${p.retiradas}</span>
            </div>

            ${p.total === 0 ? '<p style="color: #9ca3af; margin-top: 1.5rem; text-align: center;">Todavía nadie se ha postulado a esta publicación.</p>' : ''}
          </div>
        `;

        document.getElementById("interesadosBody").innerHTML = html;
        document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `📊 ${titulo}`;
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cambiarEstadoCandidatura(candidaturaId, nuevoEstado) {
      try {
        await utils.request(`/candidaturas/${candidaturaId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: nuevoEstado })
        });
        utils.mostrarAlerta("Estado actualizado correctamente", "success");

        // Recargar stats del banner
        await app.ui.actualizarStats();

        // Recargar el contenido del modal SIN cerrarlo
        setTimeout(() => {
          const modal = document.getElementById("modalInteresados");
          if (modal && modal.classList.contains("active")) {
            const publicacionId = estadoApp.publicacionActual?.id;
            const tipo = estadoApp.publicacionActual?.tipo;

            if (publicacionId && tipo === 'solicitud') {
              // Recargar desde "Empresas" (abrirInteresados) - dentista
              app.modal.abrirInteresados(publicacionId, tipo);
            } else if (publicacionId && tipo === 'oferta') {
              // Recargar desde "Postulaciones Recibidas" - clínica
              app.modal.abrirInteresados(publicacionId, tipo);
            } else if (estadoApp.tipoUsuario === 'dentista') {
              // Recargar desde stats "Postulaciones Recibidas" - dentista
              app.stats.mostrarPostulacionesRecibidas();
              // También recargar aceptadas
              app.stats.mostrarPostulacionesRecibdasAceptadas();
            } else if (estadoApp.tipoUsuario === 'clinica') {
              // Recargar desde stats "Candidatos Interesados" - clínica
              app.stats.mostrarCandidatosInteresados();
            }
          }
        }, 300);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },


    async mostrarListaPostulacionesRecibidas(postulaciones, titulo) {
      if (postulaciones.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por publicación
      const porPublicacion = {};
      const porPublicacionId = {};

      postulaciones.forEach(p => {
        if (!porPublicacionId[p.publicacion_id]) {
          porPublicacionId[p.publicacion_id] = {
            ciudad: p.solicitud_ciudad,
            especialidad_id: p.especialidad_id,
            postulaciones: []
          };
        }
        porPublicacionId[p.publicacion_id].postulaciones.push(p);
      });

      // Obtener especialidades para cada publicación
      for (const pubId of Object.keys(porPublicacionId)) {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          const especialidades = data.especialidades ? data.especialidades.map(e => e.nombre).join(", ") : 'Sin especialidades';
          const ciudad = porPublicacionId[pubId].ciudad;
          const clave = `${especialidades}-${utils.escapeHtml(ciudad)}`;

          porPublicacion[clave] = {
            especialidades: especialidades,
            ciudad: ciudad,
            postulaciones: porPublicacionId[pubId].postulaciones
          };
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
      }

      let totalPostulaciones = 0;
      let html = `<div class="candidatos-list">`;

      // Ordenar grupos por: ciudad → especialidad
      const publicacionesOrdenadas = utils.ordenarPorCiudadYEspecialidad(Object.values(porPublicacion));

      publicacionesOrdenadas.forEach(pub => {
        // Ordenar postulaciones dentro del grupo por: ciudad → fecha → especialidad → salario
        const postulacionesOrdenadas = pub.postulaciones.sort((a, b) => {
          const ciudadA = (a.ciudad || '').toLowerCase();
          const ciudadB = (b.ciudad || '').toLowerCase();
          if (ciudadA !== ciudadB) {
            return ciudadA.localeCompare(ciudadB);
          }
          const fechaA = new Date(a.creado_en || 0);
          const fechaB = new Date(b.creado_en || 0);
          if (fechaA.getTime() !== fechaB.getTime()) {
            return fechaB - fechaA;
          }
          const espA = (a.especialidad_id || 0);
          const espB = (b.especialidad_id || 0);
          if (espA !== espB) {
            return espA - espB;
          }
          const salarioA = parseFloat(a.salario) || 0;
          const salarioB = parseFloat(b.salario) || 0;
          return salarioB - salarioA;
        });
        totalPostulaciones += postulacionesOrdenadas.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${utils.escapeHtml(pub.especialidades)} - 📍 ${utils.escapeHtml(pub.ciudad)}
            </h4>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        postulacionesOrdenadas.forEach(p => {
          const estadoColor = utils.colorEstado(p.estado);
          html += `
            <div style="background: white; border-left: 3px solid ${estadoColor}; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1; cursor: pointer;" onclick="app.stats.mostrarDetallePostulacion('${p.id}', '${utils.escapeHtml(p.nombre.replace(/'/g, "\\'"))}', '${utils.escapeHtml(p.email.replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.ciudad || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.direccion || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.codigo_postal || '').replace(/'/g, "\\'"))}', '${p.estado}', '${utils.escapeHtml((p.mensaje || '').replace(/'/g, "\\'").replace(/"/g, '\\"'))}')">
                  <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${utils.escapeHtml(p.nombre)}</strong>
                  <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${utils.escapeHtml(p.email)}</p>
                  ${p.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${utils.escapeHtml(p.ciudad)}</p>` : ''}
                </div>
                <span style="background: ${estadoColor}; color: white; padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.75rem; text-transform: capitalize; white-space: nowrap; margin-left: 1rem;">${utils.textoEstado(p.estado)}</span>
              </div>
              <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                <button onclick="event.stopPropagation(); app.stats.mostrarDetallePostulacion('${p.id}', '${utils.escapeHtml(p.nombre.replace(/'/g, "\\'"))}', '${utils.escapeHtml(p.email.replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.ciudad || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.direccion || '').replace(/'/g, "\\'"))}', '${utils.escapeHtml((p.codigo_postal || '').replace(/'/g, "\\'"))}', '${p.estado}', '${utils.escapeHtml((p.mensaje || '').replace(/'/g, "\\'").replace(/"/g, '\\"'))}')" style="background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">👁️ Ver Detalles</button>
                ${utils.selectorEstado(p.id, p.estado, `event.stopPropagation(); app.stats.cambiarEstadoCandidatura(${p.id}, this.value)`)}
                ${p.estado === 'aceptada' ? `<button onclick="event.stopPropagation(); app.resenyas.abrirFormulario(${p.id}, '${utils.escapeHtml(p.nombre.replace(/'/g, "\\'"))}')" style="background: #8b5cf6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">⭐ Valorar</button>` : ''}
              </div>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${totalPostulaciones})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarDetallePostulacion(id, nombre, email, ciudad, direccion, codigoPostal, estado, mensaje) {
      let html = `
        <div style="padding: 1.5rem;">
          <h3 style="margin-top: 0; color: var(--primary);">${utils.escapeHtml(nombre)}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>📧 Email:</strong> ${utils.escapeHtml(email)}</p>
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            ${ciudad ? `<p><strong>📍 Ciudad:</strong> ${utils.escapeHtml(ciudad)}</p>` : ''}
            ${direccion ? `<p><strong>🏠 Dirección:</strong> ${utils.escapeHtml(direccion)}</p>` : ''}
            ${codigoPostal ? `<p><strong>📮 Código Postal:</strong> ${utils.escapeHtml(codigoPostal)}</p>` : ''}
          </div>

          <div class="info-section">
            <h4>Estado de la Postulación</h4>
            <p><strong>Estado:</strong> ${estado}</p>
            ${mensaje ? `<p><strong>Mensaje:</strong> ${utils.escapeHtml(mensaje)}</p>` : ''}
          </div>
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarContactados() {
      try {
        const contactados = await utils.request(`/stats/contactados-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaCandidatos(contactados, "Candidatos Contactados");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarListaCandidatosSimple(candidatos, titulo) {
      if (candidatos.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por publicación y obtener especialidades
      const porPublicacion = {};

      // Primero, agrupar por publicación_id para obtener especialidades
      const porPublicacionId = {};
      candidatos.forEach(c => {
        if (!porPublicacionId[c.publicacion_id]) {
          porPublicacionId[c.publicacion_id] = {
            ciudad: c.ciudad,
            dentistas: {}
          };
        }
        if (!porPublicacionId[c.publicacion_id].dentistas[c.usuario_id]) {
          porPublicacionId[c.publicacion_id].dentistas[c.usuario_id] = c;
        }
      });

      // Obtener especialidades para cada publicación
      for (const pubId of Object.keys(porPublicacionId)) {
        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          const especialidades = data.especialidades ? data.especialidades.map(e => e.nombre).join(", ") : 'Sin especialidades';
          const ciudad = porPublicacionId[pubId].ciudad;
          const clave = `${especialidades}-${utils.escapeHtml(ciudad)}`;

          porPublicacion[clave] = {
            especialidades: especialidades,
            ciudad: ciudad,
            dentistas: porPublicacionId[pubId].dentistas
          };
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
      }

      let totalDentistas = 0;
      let html = `<div class="candidatos-list">`;

      Object.values(porPublicacion).forEach(pub => {
        const dentistas = Object.values(pub.dentistas);
        totalDentistas += dentistas.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${utils.escapeHtml(pub.especialidades)} - 📍 ${utils.escapeHtml(pub.ciudad)}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Dentistas coincidentes: ${dentistas.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        dentistas.forEach(d => {
          html += `
            <div style="background: white; border-left: 3px solid #0F4C75; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${utils.escapeHtml(d.nombre)}</strong>
                <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${utils.escapeHtml(d.email)}</p>
                ${d.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${utils.escapeHtml(d.ciudad)}</p>` : ''}
              </div>
              <button class="btn-primary" onclick="app.stats.mostrarPerfilDentistaCompleto(${JSON.stringify(d).replace(/"/g, '&quot;')})" style="white-space: nowrap; margin-left: 1rem;">Ver detalles</button>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${totalDentistas})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarListaCandidatos(candidatos, titulo) {
      if (candidatos.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      // Agrupar por oferta
      const porOferta = {};
      candidatos.forEach(c => {
        if (!porOferta[c.publicacion_id]) {
          porOferta[c.publicacion_id] = {
            oferta_descripcion: c.oferta_descripcion,
            oferta_ciudad: c.oferta_ciudad,
            publicacion_id: c.publicacion_id,
            candidatos: []
          };
        }
        porOferta[c.publicacion_id].candidatos.push(c);
      });

      let html = `<div class="candidatos-list">`;

      const entries = Object.entries(porOferta);
      for (let idx = 0; idx < entries.length; idx++) {
        const [pubId, oferta] = entries[idx];
        let especialidadesText = '';

        try {
          const data = await utils.request(`/publicaciones/${pubId}/especialidades`, { method: 'GET' });
          if (data.especialidades && data.especialidades.length > 0) {
            especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
          }
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <p style="margin: 0 0 1rem 0; color: #1f2937; font-size: 0.9rem;"><strong>🦷 Especialidades:</strong> ${especialidadesText || 'Sin especialidades'} | <strong>📍 Ciudad:</strong> ${oferta.oferta_ciudad}</p>
            <div style="border-top: 1px solid #d1d5db; padding-top: 1rem;">
        `;

        oferta.candidatos.forEach(c => {
          const estadoColor = utils.colorEstado(c.estado);
          html += `
            <div style="background: white; padding: 1rem; border-radius: 6px; margin-bottom: 0.75rem; border-left: 3px solid ${estadoColor};">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1; cursor: pointer;" onclick="app.stats.mostrarPerfilDentista(${JSON.stringify(c).replace(/"/g, '&quot;')})">
                  <strong>${utils.escapeHtml(c.nombre)}</strong>
                  <p style="margin: 0.3rem 0 0 0; font-size: 0.85rem; color: #6b7280;">${utils.escapeHtml(c.email)}</p>
                  ${c.ciudad ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.85rem; color: #6b7280;">📍 ${utils.escapeHtml(c.ciudad)}</p>` : ''}
                </div>
                <span style="background: ${estadoColor}; color: white; padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.8rem; text-transform: capitalize; white-space: nowrap; margin-left: 1rem;">${utils.textoEstado(c.estado)}</span>
              </div>
              ${c.mensaje ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; padding: 0.75rem; background: #f0f9ff; border-radius: 4px; border-left: 2px solid #0ea5e9; color: #0c4a6e;"><strong>Mensaje:</strong> ${utils.escapeHtml(c.mensaje)}</p>` : ''}
              <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                <button onclick="app.stats.mostrarPerfilDentista(${JSON.stringify(c).replace(/"/g, '&quot;')})" style="background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">👁️ Ver Detalles</button>
                ${utils.selectorEstado(c.id, c.estado, `app.stats.cambiarEstadoCandidatura(${c.id}, this.value)`)}
                ${c.estado === 'aceptada' ? `<button onclick="app.resenyas.abrirFormulario(${c.id}, '${utils.escapeHtml(c.nombre.replace(/'/g, "\\'"))}')" style="background: #8b5cf6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">⭐ Valorar</button>` : ''}
              </div>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      }

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${candidatos.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarPerfilDentistaCompleto(dentista) {
      const resumenResenyas = dentista.usuario_id ? await app.resenyas.cargarResumen(dentista.usuario_id) : null;

      // Datos públicos (años de experiencia, descripción)
      let publico = null;
      let trayectoria = null;
      if (dentista.usuario_id) {
        try { publico = await utils.request(`/usuarios/${dentista.usuario_id}/publico`); } catch (e) { /* opcional */ }
        try { trayectoria = await utils.request(`/usuarios/${dentista.usuario_id}/trayectoria`); } catch (e) { /* opcional */ }
      }

      // Obtener especialidades del dentista si existen
      let especialidadesText = "";
      try {
        const publicacionesDentista = estadoApp.publicaciones.filter(p => p.usuario_id === dentista.usuario_id && p.tipo === 'solicitud');
        if (publicacionesDentista.length > 0) {
          const publicacionId = publicacionesDentista[0].id;
          const data = await utils.request(`/publicaciones/${publicacionId}/especialidades`, { method: 'GET' });
          if (data && data.especialidades && data.especialidades.length > 0) {
            especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
          }
        }
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }

      let html = `
        ${resumenResenyas ? `<div style="margin-bottom: 1rem;">${app.resenyas.resumenHtml(resumenResenyas, dentista.usuario_id, dentista.nombre)}</div>` : ''}
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; width: 30%; color: #0F4C75;">Nombre:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.nombre || '-')}</td>
            </tr>
            ${publico && publico.colegiado_estado === 'verificado' ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🎓 Colegiado:</td>
              <td style="padding: 0.8rem; color: #059669; font-weight: 600;">✓ Verificado — nº ${utils.escapeHtml(publico.num_colegiado)}${publico.colegio ? ` (${utils.escapeHtml(publico.colegio)})` : ''}</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📧 Email:</td>
              <td style="padding: 0.8rem;"><a href="mailto:${utils.escapeHtml(dentista.email)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(dentista.email || '-')}</a></td>
            </tr>
            ${(dentista.telefono || dentista.movil) ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📞 Teléfono:</td>
              <td style="padding: 0.8rem;"><a href="tel:${utils.escapeHtml(dentista.telefono || dentista.movil)}" style="color: #0F4C75; text-decoration: none;">${utils.escapeHtml(dentista.telefono || dentista.movil)}</a></td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📍 Ciudad:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.ciudad || '-')}</td>
            </tr>
            ${dentista.direccion ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🏠 Dirección:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.direccion)}</td>
            </tr>
            ` : ''}
            ${dentista.codigo_postal ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📮 Código Postal:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.codigo_postal)}</td>
            </tr>
            ` : ''}
            ${dentista.pais ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🌍 País:</td>
              <td style="padding: 0.8rem;">${utils.escapeHtml(dentista.pais)}</td>
            </tr>
            ` : ''}
            ${especialidadesText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🦷 Especialidades:</td>
              <td style="padding: 0.8rem;">${especialidadesText}</td>
            </tr>
            ` : ''}
            ${publico && publico.anyos_experiencia !== null && publico.anyos_experiencia !== undefined ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🎓 Experiencia:</td>
              <td style="padding: 0.8rem;">${publico.anyos_experiencia} año${publico.anyos_experiencia === 1 ? '' : 's'}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>
        ${publico && publico.descripcion ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">👤 Sobre mí</h4>
          <p style="margin: 0; line-height: 1.6; white-space: pre-wrap;">${utils.escapeHtml(publico.descripcion)}</p>
        </div>
        ` : ''}
        ${trayectoria && trayectoria.experiencia.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">💼 Experiencia laboral</h4>
          ${trayectoria.experiencia.map(e => `
            <div style="margin-bottom: 0.9rem;">
              <strong>${utils.escapeHtml(e.puesto)}</strong>${e.lugar ? ` · ${utils.escapeHtml(e.lugar)}` : ''}
              <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #6b7280;">${utils.escapeHtml(app.trayectoria.formatearRango(e.fecha_inicio, e.fecha_fin, e.actual))}</p>
              ${e.descripcion ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.9rem; white-space: pre-wrap;">${utils.escapeHtml(e.descripcion)}</p>` : ''}
            </div>
          `).join('')}
        </div>
        ` : ''}
        ${trayectoria && trayectoria.formacion.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">🎓 Formación</h4>
          ${trayectoria.formacion.map(f => `<p style="margin: 0.3rem 0;">${utils.escapeHtml(f.titulo)}${f.centro ? ` · ${utils.escapeHtml(f.centro)}` : ''}${f.anyo ? ` (${utils.escapeHtml(f.anyo)})` : ''}</p>`).join('')}
        </div>
        ` : ''}
        ${trayectoria && trayectoria.idiomas.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">🌐 Idiomas</h4>
          <p style="margin: 0;">${trayectoria.idiomas.map(i => `${utils.escapeHtml(i.idioma)} (${utils.escapeHtml(i.nivel)})`).join('  ·  ')}</p>
        </div>
        ` : ''}
        ${trayectoria && trayectoria.certificaciones && trayectoria.certificaciones.length > 0 ? `
        <div style="background: #F8FAFF; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #0F4C75; font-weight: 700;">📜 Certificaciones</h4>
          <p style="margin: 0;">${trayectoria.certificaciones.map(c => utils.escapeHtml(c)).join('  ·  ')}</p>
        </div>
        ` : ''}
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Perfil: " + dentista.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarPerfilDentista(dentista) {
      let publico = null;
      if (dentista.usuario_id) {
        try { publico = await utils.request(`/usuarios/${dentista.usuario_id}/publico`); } catch (e) { /* opcional */ }
      }

      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0;">${utils.escapeHtml(dentista.nombre)}</h3>
          ${publico && publico.colegiado_estado === 'verificado' ? `<p style="color: #059669; font-weight: 600;">✓ Colegiado verificado — nº ${utils.escapeHtml(publico.num_colegiado)}${publico.colegio ? ` (${utils.escapeHtml(publico.colegio)})` : ''}</p>` : ''}

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Email:</strong> <a href="mailto:${utils.escapeHtml(dentista.email)}">${utils.escapeHtml(dentista.email)}</a></p>
            ${(dentista.telefono || dentista.movil) ? `<p><strong>Teléfono:</strong> <a href="tel:${utils.escapeHtml(dentista.telefono || dentista.movil)}">${utils.escapeHtml(dentista.telefono || dentista.movil)}</a></p>` : ''}
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            ${dentista.ciudad ? `<p><strong>Ciudad:</strong> ${utils.escapeHtml(dentista.ciudad)}</p>` : ''}
            ${dentista.direccion ? `<p><strong>Dirección:</strong> ${utils.escapeHtml(dentista.direccion)}</p>` : ''}
            ${dentista.codigo_postal ? `<p><strong>Código Postal:</strong> ${utils.escapeHtml(dentista.codigo_postal)}</p>` : ''}
            ${dentista.pais ? `<p><strong>País:</strong> ${utils.escapeHtml(dentista.pais)}</p>` : ''}
          </div>
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Perfil: " + dentista.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    }
  },

  // ============================================
  // Módulo: Archivos
  // ============================================

  archivos: {
    async subirCV() {
      const input = document.getElementById("cvInput");
      if (input.files.length === 0) return;

      const formData = new FormData();
      formData.append("archivo", input.files[0]);
      formData.append("tipo", "cv");

      try {
        const response = await utils.requestForm("/archivos/upload", formData);
        utils.mostrarAlerta("CV subido exitosamente", "success");
        input.value = '';
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async subirPortfolio() {
      const input = document.getElementById("portfolioInput");
      if (input.files.length === 0) return;

      const formData = new FormData();
      formData.append("archivo", input.files[0]);
      formData.append("tipo", "portfolio");

      try {
        const response = await utils.requestForm("/archivos/upload", formData);
        utils.mostrarAlerta("Archivo subido exitosamente", "success");
        input.value = '';
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async subirFoto() {
      const input = document.getElementById("fotoInput");
      if (input.files.length === 0) return;

      const formData = new FormData();
      formData.append("archivo", input.files[0]);
      formData.append("tipo", "foto");

      try {
        await utils.requestForm("/archivos/upload", formData);
        utils.mostrarAlerta("Foto subida exitosamente", "success");
        input.value = '';
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    manejarDrop(event, tipo) {
      event.preventDefault();
      const zone = event.currentTarget;
      zone.classList.remove('dragover');

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        const inputIds = { cv: "cvInput", portfolio: "portfolioInput", foto: "fotoInput" };
        const input = document.getElementById(inputIds[tipo]);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(files[0]);
        input.files = dataTransfer.files;

        if (tipo === 'cv') {
          app.archivos.subirCV();
        } else if (tipo === 'portfolio') {
          app.archivos.subirPortfolio();
        } else {
          app.archivos.subirFoto();
        }
      }
    },

    async cargarArchivosUsuario() {
      if (!estadoApp.usuario) return;

      try {
        const archivos = await utils.request(`/archivos/usuario/${estadoApp.usuario.id}`);
        estadoApp.archivosUsuario = archivos;
        app.archivos.renderizarArchivos();
      } catch (error) {
        console.error(error);
      }
    },

    renderizarArchivos() {
      const cv = estadoApp.archivosUsuario.find(a => a.tipo === 'cv');
      const portfolios = estadoApp.archivosUsuario.filter(a => a.tipo === 'portfolio');

      // Renderizar CV
      const cvContainer = document.getElementById("cvContainer");
      if (cv) {
        cvContainer.innerHTML = `
          <div style="background: #F8FAFF; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #0F4C75;">
            <p style="font-weight: 700; color: #0F4C75; margin-bottom: 0.5rem;">📄 ${utils.escapeHtml(cv.nombre_archivo)}</p>
            <p style="font-size: 0.9rem; color: #666; margin-bottom: 1rem;">Subido el ${utils.formatearFecha(cv.creado_en)} · ${utils.formatearTamanyo(cv.tamanyo)}</p>
            <div style="display: flex; gap: 0.8rem;">
              <a href="${API}/archivos/${cv.id}/download" class="btn-primary btn-small" style="text-decoration: none; display: inline-block;">Descargar</a>
              <button class="btn-outline btn-small" onclick="app.archivos.eliminar(${cv.id})">Eliminar</button>
            </div>
          </div>
        `;
      } else {
        cvContainer.innerHTML = `
          <div class="drag-drop-zone" id="cvDropZone" ondrop="event.preventDefault(); app.archivos.manejarDrop(event, 'cv')" ondragover="event.preventDefault(); document.getElementById('cvDropZone').classList.add('dragover')" ondragleave="document.getElementById('cvDropZone').classList.remove('dragover')">
            <p>📄 Sube tu CV (PDF, máx 5 MB)</p>
            <span>Arrastra y suelta o haz clic para seleccionar</span>
            <input type="file" id="cvInput" accept=".pdf" style="display: none;" onchange="app.archivos.subirCV()">
          </div>
          <button class="btn-primary" style="width: 100%; margin-top: 1rem;" onclick="document.getElementById('cvInput').click()">Seleccionar archivo</button>
        `;
      }

      // Renderizar galería de fotos (clínicas)
      const fotos = estadoApp.archivosUsuario.filter(a => a.tipo === 'foto');
      const fotosGallery = document.getElementById("fotosGallery");
      if (fotosGallery) {
        if (fotos.length > 0) {
          fotosGallery.innerHTML = fotos.map(f => `
            <div class="foto-item">
              <img src="${API}/archivos/${f.id}/download" alt="Foto de la clínica" loading="lazy">
              <button class="foto-eliminar" title="Eliminar foto" onclick="app.archivos.eliminar(${f.id})">✕</button>
            </div>
          `).join('');
        } else {
          fotosGallery.innerHTML = `<p style="color: #9ca3af; text-align: center;">Aún no has subido fotos de tu clínica.</p>`;
        }
      }

      // Renderizar Portfolio
      const portfolioList = document.getElementById("portfolioList");
      if (portfolios.length > 0) {
        portfolioList.innerHTML = portfolios.map(p => `
          <div style="background: #F8FAFF; padding: 1rem; border-radius: 8px; border-left: 4px solid #2ec4b6; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="font-weight: 700; color: #2ec4b6; margin-bottom: 0.3rem;">🎨 ${utils.escapeHtml(p.nombre_archivo)}</p>
              <p style="font-size: 0.9rem; color: #666;">${utils.formatearFecha(p.creado_en)} · ${utils.formatearTamanyo(p.tamanyo)}</p>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <a href="${API}/archivos/${p.id}/download" class="btn-primary btn-small" style="text-decoration: none; display: inline-block;">Descargar</a>
              <button class="btn-outline btn-small" onclick="app.archivos.eliminar(${p.id})">Eliminar</button>
            </div>
          </div>
        `).join("");
      }
    },

    async eliminar(id) {
      if (!confirm("¿Estás seguro de que deseas eliminar este archivo?")) return;

      try {
        await utils.request(`/archivos/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Archivo eliminado", "success");
        app.archivos.cargarArchivosUsuario();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Selector de municipio + provincia (dataset window.MUNICIPIOS_ES)
  // ============================================

  ciudades: {
    lista() { return window.MUNICIPIOS_ES || []; },

    // Monta un autocompletado sobre un input de ciudad que, al elegir un municipio,
    // rellena el input (oculto) de provincia y un span opcional con su etiqueta.
    montar(inputCiudad, inputProvincia, labelProvincia) {
      if (!inputCiudad || inputCiudad.dataset.autocompleteMontado) return;
      inputCiudad.dataset.autocompleteMontado = "1";
      const cont = inputCiudad.parentElement;
      cont.style.position = "relative";

      const drop = document.createElement("div");
      drop.style.cssText = "position:absolute;left:0;right:0;top:100%;z-index:60;background:white;border:1px solid #e5e7eb;border-radius:6px;max-height:220px;overflow:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,.12);";
      cont.appendChild(drop);
      const cerrar = () => { drop.style.display = "none"; };
      const fijarProvincia = (valor) => {
        if (inputProvincia) inputProvincia.value = valor || "";
        if (labelProvincia) labelProvincia.textContent = valor ? `· Provincia: ${valor}` : "";
      };

      inputCiudad.addEventListener("input", () => {
        const q = inputCiudad.value.trim().toLowerCase();
        fijarProvincia(""); // hasta que se elija un municipio válido, no hay provincia
        if (q.length < 2) { cerrar(); return; }
        const res = this.lista().filter(m => m.m.toLowerCase().includes(q)).slice(0, 20);
        if (!res.length) { cerrar(); return; }
        drop.innerHTML = res.map(m =>
          `<div class="ciudad-op" data-m="${utils.escapeHtml(m.m)}" data-p="${utils.escapeHtml(m.p)}" style="padding:.5rem .75rem;cursor:pointer;">${utils.escapeHtml(m.m)} <span style="color:#9ca3af;">(${utils.escapeHtml(m.p)})</span></div>`
        ).join("");
        drop.style.display = "block";
      });

      drop.addEventListener("mousedown", (e) => {
        const op = e.target.closest(".ciudad-op");
        if (!op) return;
        inputCiudad.value = op.dataset.m;
        fijarProvincia(op.dataset.p);
        cerrar();
      });

      inputCiudad.addEventListener("blur", () => setTimeout(cerrar, 150));
    }
  },

  // ============================================
  // Módulo: Perfil
  // ============================================

  perfil: {
    // Aviso del estado de verificación del nº de colegiado, para el propio formulario
    badgeColegiado(estado) {
      const estilos = {
        pendiente: `<small style="color: #6366f1; font-weight: 600; margin-top: 0.3rem; display: block;">⏳ Verificación pendiente de revisión</small>`,
        verificado: `<small style="color: #10b981; font-weight: 600; margin-top: 0.3rem; display: block;">✓ Colegiado verificado</small>`,
        rechazado: `<small style="color: #ef4444; font-weight: 600; margin-top: 0.3rem; display: block;">⚠️ No hemos podido verificarlo. Revisa los datos y vuelve a guardarlos.</small>`
      };
      return estilos[estado] || '';
    },

    async cargar() {
      if (!estadoApp.usuario) return;

      // Mostrar/ocultar tabs según tipo de usuario
      if (estadoApp.tipoUsuario === 'clinica') {
        document.getElementById("tabDatos").style.display = "inline-block";
        document.getElementById("tabTrayectoria").style.display = "none";
        document.getElementById("tabCv").style.display = "none";
        document.getElementById("tabPortfolio").style.display = "none";
        document.getElementById("tabFotos").style.display = "inline-block";
        document.getElementById("tabSedes").style.display = "inline-block";
        document.getElementById("perfilTitle").textContent = "Datos de la Empresa";
        app.sedes.cargar();
      } else {
        document.getElementById("tabDatos").style.display = "inline-block";
        document.getElementById("tabTrayectoria").style.display = "inline-block";
        document.getElementById("tabCv").style.display = "inline-block";
        document.getElementById("tabPortfolio").style.display = "inline-block";
        document.getElementById("tabFotos").style.display = "none";
        document.getElementById("tabSedes").style.display = "none";
        document.getElementById("perfilTitle").textContent = "Mi perfil";
        app.trayectoria.cargar();
      }

      app.perfil.mostrarFormularioEdicion();

      // Archivos: CV/portfolio para dentistas, fotos para clínicas
      app.archivos.cargarArchivosUsuario();
    },

    async cargarDatos() {
      // Método vacío - las publicaciones se cargan desde la página principal
      // No se muestran en el perfil
    },

    switchTab(tab) {
      document.querySelectorAll("#modalPerfil .tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll("#modalPerfil .tab-btn").forEach(el => el.classList.remove("active"));

      document.getElementById(`tab-${tab}`).classList.add("active");
      event.target.classList.add("active");

      // La pestaña de CV muestra una vista previa generada a partir de Mis datos + Trayectoria
      if (tab === 'cv' && estadoApp.tipoUsuario === 'dentista') {
        app.perfil.renderPreviewCv();
      }
    },

    async mostrarFormularioEdicion() {
      const misDatosContainer = document.getElementById("misDatosContainer");

      try {
        // Obtener datos completos del usuario desde el backend
        const u = await utils.request("/auth/mi-perfil");

        if (!u) {
          utils.mostrarAlerta("Error al cargar perfil", "error");
          return;
        }

      if (estadoApp.tipoUsuario === 'clinica') {
        misDatosContainer.innerHTML = `
          <form id="formPerfilEmpresa" onsubmit="app.perfil.guardar(event)">
            <div class="form-group">
              <label>Nombre de la Empresa</label>
              <input type="text" id="perfilNombre" value="${utils.escapeHtml(u.nombre)}" required>
            </div>

            <div class="form-group">
              <label>Email</label>
              <input type="email" id="perfilEmail" value="${utils.escapeHtml(u.email)}" required>
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Se enviará un email de confirmación al cambiar</small>
              ${u.email_verificado
                ? `<small style="color: #10b981; font-weight: 600; margin-top: 0.3rem; display: block;">✓ Email verificado</small>`
                : `<small style="color: #f59e0b; margin-top: 0.3rem; display: block;">⚠️ Email sin verificar
                     <button type="button" class="btn-text btn-small" onclick="app.auth.reenviarVerificacion()">Reenviar correo</button>
                   </small>`}
            </div>

            <div class="form-group">
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" id="perfilRecibirEmails" ${u.recibir_emails ? 'checked' : ''}>
                Recibir avisos por email (postulaciones, mensajes, cambios de estado)
              </label>
            </div>

            <div class="form-group">
              <label>Fijo</label>
              <input type="tel" id="perfilTelefono" value="${utils.escapeHtml(u.telefono || '')}">
            </div>

            <div class="form-group">
              <label>Móbil</label>
              <input type="tel" id="perfilMovil" value="${utils.escapeHtml(u.movil || '')}">
            </div>

            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="perfilDireccion" value="${utils.escapeHtml(u.direccion || '')}">
            </div>

            <div class="form-group">
              <label>Código Postal</label>
              <input type="text" id="perfilCodigoPostal" value="${utils.escapeHtml(u.codigo_postal || '')}">
            </div>

            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="perfilCiudad" value="${utils.escapeHtml(u.ciudad || '')}">
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" id="perfilPais" value="${utils.escapeHtml(u.pais || '')}">
            </div>

            <div class="form-group">
              <label>Descripción de la clínica</label>
              <textarea id="perfilDescripcion" placeholder="Cuenta cómo es tu clínica: equipo, instalaciones, filosofía de trabajo...">${utils.escapeHtml(u.descripcion || '')}</textarea>
            </div>

            <div class="form-group">
              <label>Especialidades que ofrece</label>
              <div id="especialidadesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <!-- Se llenarán dinámicamente -->
              </div>
            </div>

            <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid #e5e7eb;">

            <div class="form-group">
              <label>Contraseña actual (obligatorio para cambiar)</label>
              <input type="text" id="perfilPasswordActual" placeholder="Ingresa tu contraseña actual" style="margin-bottom: 0.8rem;">

              <label>Nueva contraseña (opcional)</label>
              <input type="text" id="perfilPasswordNueva" placeholder="Deja vacío si no quieres cambiar" style="margin-bottom: 0.8rem;">

              <label>Confirmar contraseña (debe coincidir)</label>
              <input type="text" id="perfilPasswordConfirma" placeholder="Repite la nueva contraseña">
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Si no cambias contraseña, deja los últimos dos campos en blanco.</small>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
              <button type="button" class="btn-outline" style="flex: 1;" onclick="app.perfil.cancelarEdicion()">❌ Deshacer cambios</button>
              <button type="submit" class="btn-primary" style="flex: 1;">💾 Guardar cambios</button>
            </div>
          </form>
          <div class="zona-peligro">
            <h4>⚠️ Zona de peligro</h4>
            <p>Eliminar tu cuenta borra tus datos personales, archivos y publicaciones de forma irreversible. Los mensajes y reseñas que compartiste con otros usuarios quedarán anonimizados.</p>
            <button type="button" class="btn-outline btn-small" style="border-color: #dc2626; color: #dc2626;" onclick="app.perfil.eliminarCuenta()">Eliminar mi cuenta</button>
          </div>
        `;

        // Cargar especialidades para empresa
        await app.perfil.cargarEspecialidades();
      } else {
        misDatosContainer.innerHTML = `
          <form id="formPerfilCandidato" onsubmit="app.perfil.guardar(event)">
            <div class="form-group">
              <label>Nombre Completo</label>
              <input type="text" id="perfilNombre" value="${utils.escapeHtml(u.nombre)}" required>
            </div>

            <div class="form-group">
              <label>Email</label>
              <input type="email" id="perfilEmail" value="${utils.escapeHtml(u.email)}" required>
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Se enviará un email de confirmación al cambiar</small>
              ${u.email_verificado
                ? `<small style="color: #10b981; font-weight: 600; margin-top: 0.3rem; display: block;">✓ Email verificado</small>`
                : `<small style="color: #f59e0b; margin-top: 0.3rem; display: block;">⚠️ Email sin verificar
                     <button type="button" class="btn-text btn-small" onclick="app.auth.reenviarVerificacion()">Reenviar correo</button>
                   </small>`}
            </div>

            <div class="form-group">
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" id="perfilRecibirEmails" ${u.recibir_emails ? 'checked' : ''}>
                Recibir avisos por email (postulaciones, mensajes, cambios de estado)
              </label>
            </div>

            <div class="form-group">
              <label>Fijo</label>
              <input type="tel" id="perfilTelefono" value="${utils.escapeHtml(u.telefono || '')}">
            </div>

            <div class="form-group">
              <label>Móbil</label>
              <input type="tel" id="perfilMovil" value="${utils.escapeHtml(u.movil || '')}">
            </div>

            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="perfilDireccion" value="${utils.escapeHtml(u.direccion || '')}">
            </div>

            <div class="form-group">
              <label>Código Postal</label>
              <input type="text" id="perfilCodigoPostal" value="${utils.escapeHtml(u.codigo_postal || '')}">
            </div>

            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="perfilCiudad" value="${utils.escapeHtml(u.ciudad || '')}" autocomplete="off" placeholder="Escribe tu municipio…">
              <input type="hidden" id="perfilProvincia" value="${utils.escapeHtml(u.provincia || '')}">
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Elige un municipio de la lista para fijar la provincia. <span id="perfilProvinciaLabel">${u.provincia ? '· Provincia: ' + utils.escapeHtml(u.provincia) : ''}</span></small>
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" id="perfilPais" value="${utils.escapeHtml(u.pais || '')}">
            </div>

            <div class="form-group">
              <label>Años de experiencia</label>
              <input type="number" id="perfilAnyosExperiencia" min="0" value="${u.anyos_experiencia ?? ''}" placeholder="Ej: 5">
            </div>

            <div class="form-group">
              <label>Nº de colegiado</label>
              <input type="text" id="perfilNumColegiado" value="${utils.escapeHtml(u.num_colegiado || '')}" placeholder="Ej: 12345">
            </div>

            <div class="form-group">
              <label>Colegio profesional</label>
              <input type="text" id="perfilColegio" value="${utils.escapeHtml(u.colegio || '')}" placeholder="Ej: Colegio de Odontólogos de Barcelona">
              ${app.perfil.badgeColegiado(u.colegiado_estado)}
            </div>

            <div class="form-group">
              <label>Certificaciones</label>
              <div id="certificacionesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <!-- Se llenarán dinámicamente -->
              </div>
            </div>

            <div class="form-group">
              <label>Sobre mí</label>
              <textarea id="perfilDescripcion" placeholder="Cuenta tu trayectoria, formación y qué tipo de trabajo buscas...">${utils.escapeHtml(u.descripcion || '')}</textarea>
            </div>

            <div class="form-group">
              <label>Especialidades</label>
              <div id="especialidadesContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <!-- Se llenarán dinámicamente -->
              </div>
            </div>

            <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid #e5e7eb;">

            <div class="form-group">
              <label>Contraseña actual (obligatorio para cambiar)</label>
              <input type="text" id="perfilPasswordActual" placeholder="Ingresa tu contraseña actual" style="margin-bottom: 0.8rem;">

              <label>Nueva contraseña (opcional)</label>
              <input type="text" id="perfilPasswordNueva" placeholder="Deja vacío si no quieres cambiar" style="margin-bottom: 0.8rem;">

              <label>Confirmar contraseña (debe coincidir)</label>
              <input type="text" id="perfilPasswordConfirma" placeholder="Repite la nueva contraseña">
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Si no cambias contraseña, deja los últimos dos campos en blanco.</small>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
              <button type="button" class="btn-outline" style="flex: 1;" onclick="app.perfil.cancelarEdicion()">❌ Deshacer cambios</button>
              <button type="submit" class="btn-primary" style="flex: 1;">💾 Guardar cambios</button>
            </div>
          </form>
          <div class="zona-peligro">
            <h4>⚠️ Zona de peligro</h4>
            <p>Eliminar tu cuenta borra tus datos personales, archivos y publicaciones de forma irreversible. Los mensajes y reseñas que compartiste con otros usuarios quedarán anonimizados.</p>
            <button type="button" class="btn-outline btn-small" style="border-color: #dc2626; color: #dc2626;" onclick="app.perfil.eliminarCuenta()">Eliminar mi cuenta</button>
          </div>
        `;

        // Cargar especialidades y certificaciones para candidatos
        await app.perfil.cargarEspecialidades();
        await app.perfil.cargarCertificaciones();

        // Autocompletado de municipio + provincia
        app.ciudades.montar(
          document.getElementById("perfilCiudad"),
          document.getElementById("perfilProvincia"),
          document.getElementById("perfilProvinciaLabel")
        );
      }
      } catch (error) {
        utils.mostrarAlerta("Error al cargar perfil: " + error.message, "error");
      }
    },

    async cargarCertificaciones() {
      try {
        await app.catalogos.cargar();
        const respuesta = await utils.request("/auth/mis-certificaciones");
        app.catalogos.renderizarCertificacionesPerfil(respuesta.certificaciones || []);
      } catch (error) {
        console.error("Error al cargar certificaciones:", error);
      }
    },

    async guardar(event) {
      event.preventDefault();

      const nuevoEmail = document.getElementById("perfilEmail").value;

      // Validar email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(nuevoEmail)) {
        utils.mostrarAlerta("Por favor ingresa un email válido", "error");
        return;
      }

      const emailCambio = nuevoEmail !== estadoApp.usuario.email;

      const datosActualizados = {
        nombre: document.getElementById("perfilNombre").value,
        email: nuevoEmail,
        telefono: document.getElementById("perfilTelefono").value || null,
        movil: document.getElementById("perfilMovil").value || null,
        ciudad: document.getElementById("perfilCiudad").value || null,
        provincia: document.getElementById("perfilProvincia")?.value || null,
        direccion: document.getElementById("perfilDireccion").value || null,
        codigo_postal: document.getElementById("perfilCodigoPostal").value || null,
        pais: document.getElementById("perfilPais").value || null,
        descripcion: document.getElementById("perfilDescripcion")?.value || null,
        anyos_experiencia: document.getElementById("perfilAnyosExperiencia")?.value || null,
        recibir_emails: document.getElementById("perfilRecibirEmails")?.checked ?? true,
        num_colegiado: document.getElementById("perfilNumColegiado")?.value || null,
        colegio: document.getElementById("perfilColegio")?.value || null
      };

      try {
        if (emailCambio) {
          // Si cambió el email, solicitar confirmación
          await app.perfil.solicitarCambioEmail(datosActualizados);
        } else {
          // Si no cambió el email, solo actualizar otros datos
          const response = await utils.request("/auth/actualizar-perfil", {
            method: "PUT",
            body: JSON.stringify(datosActualizados)
          });

          if (response.error) {
            utils.mostrarAlerta(response.error, "error");
            return;
          }

          estadoApp.usuario = { ...estadoApp.usuario, ...datosActualizados };

          // Guardar especialidades si es candidato o empresa
          if (['dentista', 'clinica'].includes(estadoApp.tipoUsuario)) {
            const checkboxes = document.querySelectorAll('#especialidadesContainer input[type="checkbox"]');
            const especialidadesSeleccionadas = Array.from(checkboxes)
              .filter(cb => cb.checked)
              .map(cb => parseInt(cb.value));

            await utils.request("/auth/guardar-especialidades", {
              method: "POST",
              body: JSON.stringify({ especialidades: especialidadesSeleccionadas })
            });
          }

          // Guardar certificaciones (solo dentistas)
          if (estadoApp.tipoUsuario === 'dentista') {
            const certCheckboxes = document.querySelectorAll('#certificacionesContainer input[type="checkbox"]');
            const certificacionesSeleccionadas = Array.from(certCheckboxes)
              .filter(cb => cb.checked)
              .map(cb => cb.value);

            await utils.request("/auth/guardar-certificaciones", {
              method: "POST",
              body: JSON.stringify({ certificaciones: certificacionesSeleccionadas })
            });
          }

          // Cambiar contraseña si se proporcionó
          const passwordActual = document.getElementById("perfilPasswordActual").value;
          const passwordNueva = document.getElementById("perfilPasswordNueva").value;
          const passwordConfirma = document.getElementById("perfilPasswordConfirma").value;

          // Procesar cambio si hay intención: si se ingresó algo en cualquier campo
          const hayIntencionCambio = passwordActual || passwordNueva || passwordConfirma;

          if (hayIntencionCambio) {
            // Validar que las nuevas contraseñas coincidan
            if (passwordNueva !== passwordConfirma) {
              utils.mostrarAlerta("❌ Las contraseñas no coinciden", "error");
              return;
            }

            // Nota: passwordActual puede ser vacío si la contraseña actual es también vacía
            // Se enviará al backend para validar

            const resPassword = await utils.request("/auth/cambiar-password", {
              method: "PUT",
              body: JSON.stringify({ passwordActual, passwordNueva })
            });

            if (resPassword.error) {
              utils.mostrarAlerta("❌ " + resPassword.error, "error");
              return;
            }

            // Limpiar campos de password después de guardar exitosamente
            document.getElementById("perfilPasswordActual").value = "";
            document.getElementById("perfilPasswordNueva").value = "";
            document.getElementById("perfilPasswordConfirma").value = "";
          }

          utils.mostrarAlerta("✅ Perfil actualizado correctamente", "success");

          setTimeout(() => {
            // Cerrar el modal - solo remover la clase active, no tocar display
            const modal = document.getElementById("modalPerfil");
            if (modal) {
              modal.classList.remove("active");
            }
          }, 1000);
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async solicitarCambioEmail(datosActualizados) {
      try {
        // Guardar especialidades primero si es candidato o empresa
        if (['dentista', 'clinica'].includes(estadoApp.tipoUsuario)) {
          const checkboxes = document.querySelectorAll('#especialidadesContainer input[type="checkbox"]');
          const especialidadesSeleccionadas = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.value));

          await utils.request("/auth/guardar-especialidades", {
            method: "POST",
            body: JSON.stringify({ especialidades: especialidadesSeleccionadas })
          });
        }

        // Guardar certificaciones (solo dentistas)
        if (estadoApp.tipoUsuario === 'dentista') {
          const certCheckboxes = document.querySelectorAll('#certificacionesContainer input[type="checkbox"]');
          const certificacionesSeleccionadas = Array.from(certCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

          await utils.request("/auth/guardar-certificaciones", {
            method: "POST",
            body: JSON.stringify({ certificaciones: certificacionesSeleccionadas })
          });
        }

        // Cambiar contraseña si se proporcionó (ANTES de cambiar email)
        const passwordActual = document.getElementById("perfilPasswordActual").value;
        const passwordNueva = document.getElementById("perfilPasswordNueva").value;
        const passwordConfirma = document.getElementById("perfilPasswordConfirma").value;

        // Procesar cambio si hay intención: si se ingresó algo en cualquier campo
        const hayIntencionCambio = passwordActual || passwordNueva || passwordConfirma;

        if (hayIntencionCambio) {
          // Validar que las nuevas contraseñas coincidan
          if (passwordNueva !== passwordConfirma) {
            utils.mostrarAlerta("❌ Las contraseñas no coinciden", "error");
            return;
          }

          const resPassword = await utils.request("/auth/cambiar-password", {
            method: "PUT",
            body: JSON.stringify({ passwordActual, passwordNueva })
          });

          if (resPassword.error) {
            utils.mostrarAlerta("❌ " + resPassword.error, "error");
            return;
          }

          // Limpiar campos de password después de guardar exitosamente
          document.getElementById("perfilPasswordActual").value = "";
          document.getElementById("perfilPasswordNueva").value = "";
          document.getElementById("perfilPasswordConfirma").value = "";
        }

        // Solicitar cambio de email
        const response = await utils.request("/auth/solicitar-cambio-email", {
          method: "POST",
          body: JSON.stringify({
            nuevoEmail: datosActualizados.email,
            datos: {
              nombre: datosActualizados.nombre,
              telefono: datosActualizados.telefono,
              movil: datosActualizados.movil,
              ciudad: datosActualizados.ciudad,
              direccion: datosActualizados.direccion,
              codigo_postal: datosActualizados.codigo_postal,
              pais: datosActualizados.pais
            }
          })
        });

        if (response.error) {
          utils.mostrarAlerta(response.error, "error");
          return;
        }

        // Actualizar estadoApp con los datos (sin email, que se confirmará después)
        const { email: emailNuevo, ...datosOtros } = datosActualizados;
        estadoApp.usuario = { ...estadoApp.usuario, ...datosOtros };

        // Mostrar modal de confirmación
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'modalConfirmacionEmail';
        modal.innerHTML = `
          <div class="modal-overlay"></div>
          <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
              <h2>Confirmación de Email</h2>
              <button class="close-btn" onclick="document.getElementById('modalConfirmacionEmail').remove()">✕</button>
            </div>
            <div style="padding: 1.5rem;">
              <div style="background: #F0F9FF; padding: 1rem; border-radius: 8px; border-left: 4px solid #3b82f6; margin-bottom: 1rem;">
                <p style="margin: 0; font-size: 0.95rem;">
                  📧 Se ha enviado un email de confirmación a <strong>${datosActualizados.email}</strong>
                </p>
              </div>
              <p style="color: var(--gray-600); margin: 1rem 0;">
                Haz clic en el link de confirmación en el email para completar el cambio de email. Tu email actual seguirá siendo válido hasta confirmar.
              </p>
              <div style="background: #FEF3C7; padding: 0.75rem; border-radius: 6px; border-left: 3px solid #F59E0B;">
                <small style="color: #92400E;">💡 Verifica tu carpeta de spam si no ves el email</small>
              </div>
              <button class="btn-primary" style="width: 100%; margin-top: 1.5rem;" onclick="document.getElementById('modalConfirmacionEmail').remove(); app.perfil.cargar();">
                Entendido
              </button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cancelarEdicion() {
      app.perfil.cargar();
    },

    // Derecho de supresión: borra la cuenta previa doble confirmación
    async eliminarCuenta() {
      const seguro = confirm("⚠️ Vas a eliminar tu cuenta de forma IRREVERSIBLE.\n\nSe borrarán tus datos, archivos y publicaciones. ¿Quieres continuar?");
      if (!seguro) return;

      const password = prompt("Para confirmar, escribe tu contraseña:");
      if (password === null) return;

      try {
        const res = await utils.request("/auth/mi-cuenta", {
          method: "DELETE",
          body: JSON.stringify({ password })
        });
        app.modal.cerrarTodosModales();
        utils.mostrarAlerta(res.mensaje || "Cuenta eliminada", "info");
        app.auth.logout();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Descarga el CV en PDF generado por el backend (fetch con token → blob)
    async descargarCvPdf() {
      try {
        const response = await fetch(`${API}/auth/mi-cv.pdf`, {
          headers: { Authorization: `Bearer ${estadoApp.token}` }
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Error al generar el CV");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement("a");
        enlace.href = url;
        enlace.download = `CV-${(estadoApp.usuario?.nombre || 'dentista').replace(/\s+/g, '-')}.pdf`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Vista previa en pantalla del CV, con los mismos datos que el PDF (Mis datos + Trayectoria)
    async renderPreviewCv() {
      const cont = document.getElementById("cvPreview");
      if (!cont) return;
      try {
        const cv = await utils.request("/auth/mi-cv");
        const u = cv.usuario || {};
        const seccion = (titulo, cuerpo) => cuerpo
          ? `<h4 style="color: #0f4c75; margin: 1rem 0 0.4rem;">${titulo}</h4>${cuerpo}`
          : "";

        const contacto = [u.email, u.movil || u.telefono, [u.ciudad, u.pais].filter(Boolean).join(", ")]
          .filter(Boolean).map(utils.escapeHtml).join("  ·  ");

        const colegiado = (u.colegiado_estado === "verificado" && u.num_colegiado)
          ? `<p style="color: #059669; font-size: 0.85rem; margin: 0.3rem 0;">✓ Colegiado nº ${utils.escapeHtml(u.num_colegiado)}${u.colegio ? " — " + utils.escapeHtml(u.colegio) : ""} (verificado)</p>`
          : "";
        const valoracion = (cv.resenyas && cv.resenyas.total > 0)
          ? `<p style="color: #b45309; font-size: 0.85rem; margin: 0.3rem 0;">Valoración media: ${Math.round(cv.resenyas.media * 10) / 10}/5 (${cv.resenyas.total} reseña${cv.resenyas.total === 1 ? "" : "s"})</p>`
          : "";

        const experiencia = (u.anyos_experiencia !== null && u.anyos_experiencia !== undefined)
          ? `<p style="margin: 0.2rem 0;">${u.anyos_experiencia} año${u.anyos_experiencia === 1 ? "" : "s"} de experiencia profesional</p>` : "";

        const expLaboral = (cv.experienciaLaboral || []).map(e => {
          const rango = [e.fecha_inicio, e.actual ? "Actualidad" : e.fecha_fin].filter(Boolean).join(" – ");
          return `<div style="margin-bottom: 0.5rem;">
            <strong>${utils.escapeHtml(e.puesto)}${e.lugar ? " · " + utils.escapeHtml(e.lugar) : ""}</strong>
            ${rango ? `<div style="color: #6b7280; font-size: 0.85rem;">${utils.escapeHtml(rango)}</div>` : ""}
            ${e.descripcion ? `<div style="color: #6b7280; font-size: 0.9rem;">${utils.escapeHtml(e.descripcion)}</div>` : ""}
          </div>`;
        }).join("");

        const formacion = (cv.formacionLista || [])
          .map(f => `<div>${utils.escapeHtml([f.titulo, f.centro].filter(Boolean).join(" · ") + (f.anyo ? ` (${f.anyo})` : ""))}</div>`).join("");
        const idiomas = (cv.idiomasLista || []).length
          ? `<p style="margin: 0.2rem 0;">${cv.idiomasLista.map(i => `${utils.escapeHtml(i.idioma)} (${utils.escapeHtml(i.nivel)})`).join("  ·  ")}</p>` : "";
        const especialidades = (cv.especialidades || [])
          .map(e => `<div>•  ${utils.escapeHtml(e.nombre)}</div>`).join("");
        const certificaciones = (cv.certificacionesLista || [])
          .map(c => `<div>•  ${utils.escapeHtml(c.certificacion)}</div>`).join("");

        cont.innerHTML = `
          <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; background: white;">
            <h3 style="color: #0f4c75; margin: 0;">${utils.escapeHtml(u.nombre || "")}</h3>
            <p style="color: #4b5563; margin: 0.1rem 0;">Dentista</p>
            ${contacto ? `<p style="font-size: 0.85rem; color: #4b5563; margin: 0.3rem 0;">${contacto}</p>` : ""}
            ${colegiado}
            ${valoracion}
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0.75rem 0;">
            ${seccion("Perfil", u.descripcion ? `<p style="margin: 0.2rem 0;">${utils.escapeHtml(u.descripcion)}</p>` : "")}
            ${seccion("Experiencia", experiencia)}
            ${seccion("Experiencia laboral", expLaboral)}
            ${seccion("Formación", formacion)}
            ${seccion("Idiomas", idiomas)}
            ${seccion("Especialidades", especialidades)}
            ${seccion("Certificaciones", certificaciones)}
          </div>`;
      } catch (error) {
        cont.innerHTML = `<p style="color: #ef4444;">${utils.escapeHtml(error.message)}</p>`;
      }
    },

    async cargarEspecialidades() {
      // Funciona tanto para candidatos como para empresas
      if (!['dentista', 'clinica'].includes(estadoApp.tipoUsuario)) return;

      try {
        // Obtener especialidades disponibles
        if (!estadoApp.especialidades || estadoApp.especialidades.length === 0) {
          await app.especialidades.cargar();
        }

        // Obtener especialidades del usuario
        const respuesta = await utils.request("/auth/mi-especialidades");
        const especialidadesUsuario = respuesta.especialidades || [];

        const container = document.getElementById("especialidadesContainer");
        if (!container) return;

        container.innerHTML = estadoApp.especialidades.map(esp => `
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" value="${esp.id}" ${especialidadesUsuario.includes(esp.id) ? 'checked' : ''} style="cursor: pointer;">
            ${esp.nombre}
          </label>
        `).join('');
      } catch (error) {
        console.error("Error al cargar especialidades:", error);
      }
    }
  },

  // ============================================
  // Módulo: UI
  // ============================================

  ui: {
    statsPollingInterval: null,

    iniciarActualizacionAutomatica() {
      // Detener polling anterior si existe
      if (this.statsPollingInterval) {
        clearInterval(this.statsPollingInterval);
      }

      // Actualizar stats cada 3 minutos; no son datos que cambien al segundo,
      // así que no hace falta más frecuencia y se ahorran peticiones al backend
      this.statsPollingInterval = setInterval(async () => {
        // Con la pestaña en segundo plano, esperar a que vuelva a estar visible
        if (document.visibilityState !== "visible") return;
        try {
          await app.ui.actualizarStats();
          await app.chat.actualizarContador();
        } catch (error) {
          console.error("Error al actualizar stats:", error);
        }
      }, 180000);
    },

    detenerActualizacionAutomatica() {
      if (this.statsPollingInterval) {
        clearInterval(this.statsPollingInterval);
        this.statsPollingInterval = null;
      }
    },

    async init() {
      await app.especialidades.cargar();
      await app.catalogos.cargar();
      app.catalogos.renderizarFiltros();

      if (estadoApp.token && estadoApp.usuario) {
        app.ui.mostrarPlataforma();
      } else {
        app.ui.mostrarLanding();
      }

      // Enlaces llegados por correo (verificación, restablecer contraseña…)
      app.auth.procesarEnlacesDeCorreo();
    },

    mostrarLanding() {
      document.getElementById("heroLanding").style.display = "block";
      document.getElementById("heroPlataforma").style.display = "none";
      document.getElementById("statsContainer").style.display = "none";
      document.getElementById("mainContainer").style.display = "none";
      document.getElementById("navButtonsLanding").style.display = "flex";
      document.getElementById("navButtonsLogueado").style.display = "none";
    },

    async mostrarPlataforma() {
      utils.ocultarElementos("heroLanding", "landingFeatures", "landingBenefitsDentistas", "landingBenefitsClinicas");
      document.getElementById("heroPlataforma").style.display = "block";
      document.getElementById("statsContainer").style.display = "block";
      document.getElementById("mainContainer").style.display = "block";
      document.getElementById("navButtonsLanding").style.display = "none";
      document.getElementById("navButtonsLogueado").style.display = "flex";
      document.getElementById("btnPublicar").style.display = "inline-block";
      document.getElementById("btnPerfil").style.display = "inline-block";
      document.getElementById("btnLogout").style.display = "inline-block";
      document.getElementById("btnExportarCsv").style.display = "inline-block";
      document.getElementById("btnFavoritos").style.display = "inline-block";
      document.getElementById("btnChat").style.display = "inline-block";
      app.chat.actualizarContador();
      app.recordatorios.comprobar();

      // Actualizar texto del hero según tipo de usuario
      const heroTitle = document.querySelector("#heroPlataforma h1");
      const filtersTitle = document.getElementById("filtrosTitle");
      const btnTodas = document.getElementById("btnTodas");
      const btnMias = document.getElementById("btnMias");

      const btnContactadas = document.getElementById("btnContactadas");

      if (estadoApp.tipoUsuario === 'clinica') {
        heroTitle.textContent = `🦷 ${estadoApp.usuario?.nombre || 'Mi Empresa'}`;
        filtersTitle.textContent = "";
        filtersTitle.style.display = "none";
        btnTodas.style.display = "inline-block";
        btnMias.style.display = "none";
        document.getElementById("btnPublicaciones").style.display = "inline-block";
        btnContactadas.style.display = "none";
        const btnMisPostClinica = document.getElementById("btnMisPostulacionesDentistas");
        btnMisPostClinica.style.display = "inline-block";
        btnMisPostClinica.textContent = "📌 Mis Postulaciones";
        document.getElementById("btnMisPostulacionesDentistasAceptadas").style.display = "none";
        document.getElementById("btnKanban").style.display = "none";
        document.getElementById("btnSuplencias").style.display = "none";
        document.getElementById("filterEquipamientoGroup").style.display = "none";
        document.getElementById("filterCertificacionGroup").style.display = "block";
        btnTodas.textContent = "Dentistas";
      } else {
        // Dentista
        const nombrePartes = (estadoApp.usuario?.nombre || 'Candidato').split(' ');
        const nombreCorto = nombrePartes.length >= 2 ? `${nombrePartes[0]} ${nombrePartes[1]}` : nombrePartes[0];
        heroTitle.textContent = `🦷 ${nombreCorto}`;
        filtersTitle.textContent = "Clínicas";
        filtersTitle.style.display = "block";
        btnTodas.style.display = "inline-block";
        btnMias.style.display = "none";
        document.getElementById("btnPublicaciones").style.display = "inline-block";
        btnContactadas.style.display = "none";
        document.getElementById("btnMisPostulacionesDentistas").style.display = "none";
        document.getElementById("btnMisPostulacionesDentistasAceptadas").style.display = "none";
        document.getElementById("btnKanban").style.display = "inline-block";
        document.getElementById("btnSuplencias").style.display = "inline-block";
        document.getElementById("filterEquipamientoGroup").style.display = "block";
        document.getElementById("filterCertificacionGroup").style.display = "none";
        btnTodas.textContent = "Clínicas";
      }

      estadoApp.filtros.soloMias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      document.getElementById("btnTodas").classList.add("active");

      await app.publicaciones.cargar();
      await app.ui.actualizarStats();

      // Iniciar actualización automática cada 30 segundos
      app.ui.iniciarActualizacionAutomatica();
    },

    async actualizarStats() {
      try {
        if (!estadoApp.usuario) return; // el usuario pudo cerrar sesión mientras esto cargaba

        const statsGrid = document.getElementById("statsGrid");

        if (estadoApp.tipoUsuario === 'clinica') {
          // Empresa: mostrar Total Dentistas, Posibles Candidatos, Candidatos que se postularon, Candidatos contactados
          const totalDentistas = await utils.request("/stats/total-dentistas");
          const posiblesCandidatos = await utils.request(`/stats/posibles-candidatos/${estadoApp.usuario.id}`);
          const candidatosInteresados = await utils.request(`/stats/candidatos-interesados/${estadoApp.usuario.id}`);

          // Contar contactados (dentistas a los que hemos enviado mensaje)
          const contactadosList = await utils.request(`/stats/contactados-lista/${estadoApp.usuario.id}`);
          const contactados = contactadosList.length;

          // Postulaciones a dentistas (solicitudes que he visto)
          const miPostulacionesDentistas = await utils.request(`/stats/mis-postulaciones/${estadoApp.usuario.id}`);
          const misPostulacionesDentistasAceptadas = await utils.request(`/stats/mis-postulaciones-aceptadas/${estadoApp.usuario.id}`);

          // Mostrar stats de "Mis Ofertas"
          if (estadoApp.filtros.soloMias) {
            // En "Mis Ofertas" mostrar Postulaciones Recibidas y Aceptadas
            statsGrid.innerHTML = `
              <div class="stat-item stat-clickable" onclick="app.stats.mostrarCandidatosInteresados()">
                <span>📧</span>
                <h3>${candidatosInteresados.total}</h3>
                <p>Postulaciones Recibidas</p>
                <div class="stat-tooltip">Dentistas postulados a nuestras publicaciones</div>
              </div>
              <div class="stat-item stat-clickable" onclick="app.stats.mostrarContactados()">
                <span>✅</span>
                <h3>${contactados}</h3>
                <p>Postulaciones Recibidas Aceptadas</p>
                <div class="stat-tooltip">Dentistas postulados a nuestras publicaciones aceptados</div>
              </div>
            `;
          }

          statsGrid.innerHTML = `
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarTotalDentistas()">
              <span>👥</span>
              <h3>${totalDentistas.total}</h3>
              <p>Dentistas</p>
              <div class="stat-tooltip">Total de dentistas en la plataforma. Ver desglose por especialidad, ciudad o ambas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarPosiblesCandidatos()">
              <span>🔍</span>
              <h3>${posiblesCandidatos.total}</h3>
              <p>Dentistas Potenciales</p>
              <div class="stat-tooltip">Dentistas que coinciden con ciudad y especialidad de mis publicaciones</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarMisPostulacionesDentistas()">
              <span>📬</span>
              <h3>${miPostulacionesDentistas.total}</h3>
              <p>Postulaciones a Dentistas</p>
              <div class="stat-tooltip">Postulaciones a publicaciones de dentistas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarCandidatosInteresados()">
              <span>📧</span>
              <h3>${candidatosInteresados.total}</h3>
              <p>Postulaciones Recibidas</p>
              <div class="stat-tooltip">Dentistas postulados a nuestras publicaciones</div>
            </div>
          `;
        } else {
          // Dentista: mostrar Clínicas, Clínicas Potenciales, Postulaciones a Clínicas y Postulaciones Recibidas
          const totalClinicas = await utils.request("/stats/total-clinicas");
          const misPostulaciones = await utils.request(`/stats/mis-postulaciones/${estadoApp.usuario.id}`);
          const clinicasPotenciales = await utils.request(`/stats/clinicas-potenciales/${estadoApp.usuario.id}`);
          const postulacionesRecibidas = await utils.request(`/stats/postulaciones-recibidas-dentista/${estadoApp.usuario.id}`);

          statsGrid.innerHTML = `
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarTotalClinicas()">
              <span>📋</span>
              <h3>${totalClinicas.total}</h3>
              <p>Clínicas</p>
              <div class="stat-tooltip">Total de clínicas en la plataforma. Ver desglose por especialidad, ciudad o ambas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarClinicasPotenciales()">
              <span>🔍</span>
              <h3>${clinicasPotenciales.total}</h3>
              <p>Clínicas Potenciales</p>
              <div class="stat-tooltip">Clínicas que coinciden con ciudad y especialidad de mis publicaciones</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarMisPostulaciones()">
              <span>📬</span>
              <h3>${misPostulaciones.total}</h3>
              <p>Postulaciones a Clínicas</p>
              <div class="stat-tooltip">Postulaciones a publicaciones de clínicas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarPostulacionesRecibidas()">
              <span>📧</span>
              <h3>${postulacionesRecibidas.total}</h3>
              <p>Postulaciones Recibidas</p>
              <div class="stat-tooltip">Clínicas postuladas a nuestras publicaciones</div>
            </div>
          `;
        }
      } catch (error) {
        console.error(error);
      }
    },

    async renderizarPublicaciones() {
      const container = document.getElementById("publicacionesContainer");

      // Cargar postulaciones del usuario actual para verificar estado
      let misPostulaciones = [];
      let misFavoritos = new Set();
      if (estadoApp.usuario) {
        try {
          const data = await utils.request("/candidaturas/mis-postulaciones");
          misPostulaciones = data.candidaturas || [];
        } catch (error) {
          console.error("Error al cargar postulaciones:", error);
        }
        try {
          const favoritos = await utils.request("/favoritos");
          misFavoritos = new Set(favoritos.map(f => f.id));
        } catch (error) {
          console.error("Error al cargar favoritos:", error);
        }
      }

      if (estadoApp.publicaciones.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <h3>No hay publicaciones</h3>
            <p>Intenta cambiar los filtros o vuelve más tarde.</p>
          </div>
        `;
        return;
      }

      // Cargar candidatos para las ofertas propias
      const candidatosPorOferta = {};
      if (estadoApp.tipoUsuario === 'clinica' && estadoApp.usuario) {
        try {
          const data = await utils.request(`/publicaciones/usuario/${estadoApp.usuario.id}/candidatos`);
          if (data.ofertas) {
            data.ofertas.forEach(oferta => {
              candidatosPorOferta[oferta.publicacion_id] = oferta.candidatos_count || 0;
            });
          }
        } catch (error) {
          console.error("Error al cargar candidatos:", error);
        }
      }

      const html = await Promise.all(estadoApp.publicaciones.map(async pub => {
        let especialidadesText = '';
        try {
          const data = await utils.request(`/publicaciones/${pub.id}/especialidades`, { method: 'GET' });
          if (data.especialidades && data.especialidades.length > 0) {
            especialidadesText = data.especialidades.map(e => e.nombre).join(", ");
          }
        } catch (error) {
          console.error("Error al obtener especialidades:", error);
        }
        const ciudadLabel = utils.escapeHtml(pub.provincia ? `${pub.ciudad} (${pub.provincia})` : pub.ciudad);
        const generatedTitle = pub.tipo === 'solicitud'
          ? `${ciudadLabel} - ${pub.usuario_nombre || 'Dentista'}`
          : pub.tipo === 'suplencia'
            ? `Suplencia en ${ciudadLabel} - ${pub.usuario_nombre || 'Clínica'}`
            : `${ciudadLabel} - ${pub.usuario_nombre || 'Clínica'}`;
        let tipoBadge, tipoClase;
        if (pub.tipo === "oferta") {
          tipoBadge = "";
          tipoClase = "type-oferta";
        } else if (pub.tipo === "suplencia") {
          tipoBadge = pub.urgente ? "🚨 Urgente" : "🚨 Suplencia";
          tipoClase = "type-suplencia";
        } else {
          // tipo: 'solicitud' (dentistas)
          tipoBadge = "";
          tipoClase = "type-solicitud";
        }

        let interesadosHTML = "";
        // Solo mostrar interesados para solicitudes (dentistas buscando trabajo), no para ofertas (usamos candidaturas)
        if (estadoApp.filtros.soloMias && estadoApp.usuario && pub.usuario_id === estadoApp.usuario.id && pub.tipo === 'solicitud') {
          try {
            const data = await utils.request(`/publicaciones/${pub.id}/candidatos`);
            const interesados = (data.candidatos || []).length;
              interesadosHTML = `
              <button class="btn-interesados" onclick="app.modal.abrirInteresados(${pub.id}, '${pub.tipo}')">
                👥 Clínicas (${interesados})
              </button>
            `;
          } catch (error) {
            console.error("Error al obtener mensajes:", error);
          }
        }

        const esFavorito = misFavoritos.has(pub.id);
        return `
          <div class="card ${tipoClase}">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
              ${tipoBadge ? `<span class="card-type ${tipoClase}">${tipoBadge}</span>` : "<span></span>"}
              ${estadoApp.usuario && ((estadoApp.tipoUsuario === 'clinica' && pub.tipo === 'solicitud') || (estadoApp.tipoUsuario === 'dentista' && (pub.tipo === 'oferta' || pub.tipo === 'suplencia'))) ? `<button onclick="app.favoritos.toggle(${pub.id}, this)" data-favorito="${esFavorito}" style="background: none; border: none; cursor: pointer; font-size: 1.3rem; padding: 0;" title="${esFavorito ? 'Quitar de favoritos' : 'Guardar en favoritos'}">${esFavorito ? '⭐' : '☆'}</button>` : ''}
            </div>
            <h3>${utils.escapeHtml(generatedTitle)}</h3>
            <div class="card-details">
              <div class="detail">
                <span class="detail-icon">🦷</span>
                <span>${especialidadesText || 'Sin especialidades'}</span>
              </div>
              ${pub.tipo === 'suplencia' && (pub.fecha_desde || pub.fecha_hasta) ? `<div class="detail"><span class="detail-icon">🗓️</span><span>${utils.escapeHtml([pub.fecha_desde, pub.fecha_hasta].filter(Boolean).join(' → '))}</span></div>` : ""}
              ${pub.contrato ? `<div class="detail"><span class="detail-icon">📋</span><span>${utils.escapeHtml(pub.contrato)}</span></div>` : ""}
              ${pub.jornada ? `<div class="detail"><span class="detail-icon">⏰</span><span>${utils.escapeHtml(pub.jornada)}</span></div>` : ""}
              ${pub.salario ? `<div class="detail"><span class="detail-icon">💰</span><span>${utils.escapeHtml(pub.salario)}</span></div>` : ""}
              ${pub.experiencia_minima !== null && pub.experiencia_minima !== undefined ? `<div class="detail"><span class="detail-icon">🎓</span><span>${pub.experiencia_minima} años exp.</span></div>` : ""}
            </div>
            <div class="badges">
              ${pub.nombre_contacto ? `<span class="badge">${utils.escapeHtml(pub.nombre_contacto)}</span>` : ""}
              <span class="badge" style="margin-left: auto;">${utils.formatearFecha(pub.creado_en)}</span>
            </div>
            <div class="card-footer" style="display: flex; gap: 0.5rem;">
              <button class="btn-primary" onclick="app.modal.abrirDetalleConManejo(${JSON.stringify(pub).replace(/"/g, '&quot;')})" style="flex: 1;">Ver detalles</button>
              ${(() => {
                if (estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id)) {
                  return `${(pub.tipo === 'oferta' || pub.tipo === 'suplencia') ? `<button class="btn-outline" onclick="app.publicaciones.copiarEnlacePublico(${pub.id})" style="flex: 1;" title="Copiar el enlace público de esta publicación">🔗 Compartir</button>` : ''}
                          <button class="btn-outline" onclick="app.stats.mostrarEstadisticasPublicacion(${pub.id}, '${utils.escapeHtml(generatedTitle.replace(/'/g, "\\'"))}')" style="flex: 1;">📊 Estadísticas</button>
                          <button class="btn-danger" onclick="app.publicaciones.retirarPublicacion(${pub.id})" style="flex: 1;">🗑️ Retirar</button>`;
                }
                return '';
              })()}
              ${(() => {
                if (estadoApp.tipoUsuario === 'dentista' && (pub.tipo === 'oferta' || pub.tipo === 'suplencia')) {
                  const yaPostulada = misPostulaciones.find(p => p.publicacion_id === pub.id);
                  if (yaPostulada) {
                    const estadoText = yaPostulada.estado === 'aceptada' ? 'Aceptada' : 'Pendiente';
                    const estadoColor = yaPostulada.estado === 'aceptada' ? '#10b981' : '#f59e0b';
                    return `<button style="flex: 1; opacity: 0.7; background: ${estadoColor}; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">✓ ${estadoText}</button>
                            <button class="btn-danger" onclick="app.candidaturas.retirarPostulacion(${yaPostulada.id})" style="flex: 1;">Retirar</button>`;
                  } else {
                    return `<button class="btn-secondary" onclick="estadoApp.publicacionActual = estadoApp.publicaciones.find(p => p.id === ${pub.id}); app.modal.abrirPostularseModal();" style="flex: 1;">Postularme</button>`;
                  }
                }
                return '';
              })()}
              ${(() => {
                if (estadoApp.tipoUsuario === 'clinica' && pub.tipo === 'solicitud') {
                  const yaPostulada = misPostulaciones.find(p => p.publicacion_id === pub.id);
                  if (yaPostulada) {
                    return `<button class="btn-success" style="flex: 1; opacity: 0.7;">✓ Postulada</button>
                            <button class="btn-danger" onclick="app.candidaturas.retirarPostulacion(${yaPostulada.id})" style="flex: 1;">Retirar</button>`;
                  } else {
                    return `<button class="btn-secondary" onclick="estadoApp.publicacionActual = estadoApp.publicaciones.find(p => p.id === ${pub.id}); app.modal.abrirPostularseModal();" style="flex: 1;">Postularme</button>`;
                  }
                }
                return '';
              })()}
              ${estadoApp.tipoUsuario === 'clinica' && (pub.tipo === 'oferta' || pub.tipo === 'suplencia') && estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id) && candidatosPorOferta[pub.id] > 0 ? `<button class="btn-outline" onclick="app.modal.abrirCandidatos(${pub.id}, '${utils.escapeHtml(generatedTitle.replace(/'/g, "\\'"))}')" style="flex: 1;">👥 Dentistas (${candidatosPorOferta[pub.id]})</button>` : ''}
              ${interesadosHTML}
            </div>
          </div>
        `;
      }));

      const botonCargarMas = estadoApp.hayMasPublicaciones
        ? `<div style="text-align: center; margin-top: 2rem;">
             <button class="btn-outline" onclick="app.publicaciones.cargar(${estadoApp.paginaActual + 1})">Cargar más</button>
           </div>`
        : "";

      // En "Mis Publicaciones" de una clínica, separar visualmente Ofertas de Empleo y Suplencia
      let cuerpo;
      if (estadoApp.filtros.soloMias && estadoApp.tipoUsuario === 'clinica') {
        const ofertas = [];
        const suplencias = [];
        estadoApp.publicaciones.forEach((pub, i) => {
          (pub.tipo === 'suplencia' ? suplencias : ofertas).push(html[i]);
        });
        const encabezado = (texto) => `<h3 style="margin: 1.5rem 0 1rem; color: #0f4c75;">${texto}</h3>`;
        cuerpo = "";
        if (ofertas.length) cuerpo += `${encabezado("Ofertas de Empleo")}<div class="publicaciones">${ofertas.join("")}</div>`;
        if (suplencias.length) cuerpo += `${encabezado("Suplencia")}<div class="publicaciones">${suplencias.join("")}</div>`;
      } else {
        cuerpo = `<div class="publicaciones">${html.join("")}</div>`;
      }

      container.innerHTML = `${cuerpo}${botonCargarMas}`;
    }
  },

  // ============================================
  // Módulo: Favoritos
  // ============================================

  favoritos: {
    async toggle(publicacionId, btn) {
      const esFavorito = btn.dataset.favorito === "true";
      try {
        if (esFavorito) {
          await utils.request(`/favoritos/${publicacionId}`, { method: "DELETE" });
          btn.dataset.favorito = "false";
          btn.textContent = "☆";
          btn.title = "Guardar en favoritos";
        } else {
          await utils.request("/favoritos", {
            method: "POST",
            body: JSON.stringify({ publicacion_id: publicacionId })
          });
          btn.dataset.favorito = "true";
          btn.textContent = "⭐";
          btn.title = "Quitar de favoritos";
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Exportar datos
  // ============================================

  exportar: {
    // Descarga el CSV de postulaciones (recibidas para clínicas, enviadas para dentistas)
    async postulacionesCsv() {
      try {
        const response = await fetch(`${API}/candidaturas/export.csv`, {
          headers: { Authorization: `Bearer ${estadoApp.token}` }
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Error al exportar");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement("a");
        enlace.href = url;
        enlace.download = `postulaciones-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(url);
        utils.mostrarAlerta("✅ CSV descargado", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Kanban de postulaciones
  // ============================================

  kanban: {
    async render() {
      const container = document.getElementById("publicacionesContainer");

      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const candidaturas = data.candidaturas || [];

        if (candidaturas.length === 0) {
          container.innerHTML = `
            <div class="empty-state">
              <h3>No tienes postulaciones</h3>
              <p>Cuando te postules a una publicación aparecerá aquí su seguimiento.</p>
            </div>
          `;
          return;
        }

        const columnas = [
          { estado: 'pendiente', titulo: '⏳ Pendientes', color: '#f59e0b' },
          { estado: 'vista', titulo: '👁️ CV visto', color: '#6366f1' },
          { estado: 'en_proceso', titulo: '🔄 En proceso', color: '#0ea5e9' },
          { estado: 'entrevista', titulo: '🗓️ Entrevista', color: '#8b5cf6' },
          { estado: 'aceptada', titulo: '✅ Aceptadas', color: '#10b981' },
          { estado: 'rechazada', titulo: '❌ Rechazadas', color: '#ef4444' }
        ];

        container.innerHTML = `
          <div class="kanban-board">
            ${columnas.map(col => {
              const items = candidaturas.filter(c => c.estado === col.estado);
              return `
                <div class="kanban-col">
                  <div class="kanban-col-header" style="border-top: 4px solid ${col.color};">
                    <span>${col.titulo}</span>
                    <span class="kanban-col-contador" style="background: ${col.color};">${items.length}</span>
                  </div>
                  <div class="kanban-col-body">
                    ${items.length === 0
                      ? `<p class="kanban-vacio">Nada por aquí</p>`
                      : items.map(c => this.tarjetaHtml(c, col.color)).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    tarjetaHtml(c, color) {
      const destinatario = c.publicacion_tipo === 'oferta' ? 'clínica' : 'dentista';
      return `
        <div class="kanban-tarjeta" style="border-left: 3px solid ${color};">
          <strong>${utils.escapeHtml(c.empresa_nombre || 'Publicación')}</strong>
          <p class="kanban-tarjeta-detalle">📍 ${utils.escapeHtml(c.ciudad || '')}</p>
          ${c.salario ? `<p class="kanban-tarjeta-detalle">💰 ${utils.escapeHtml(c.salario)}</p>` : ''}
          ${c.contrato || c.jornada ? `<p class="kanban-tarjeta-detalle">📋 ${utils.escapeHtml([c.contrato, c.jornada].filter(Boolean).join(' · '))}</p>` : ''}
          <p class="kanban-tarjeta-fecha">Postulada el ${utils.formatearFecha(c.creado_en)}</p>
          <div class="kanban-tarjeta-acciones">
            ${c.estado === 'aceptada' ? `<button class="btn-small" style="background: #f59e0b; color: white; border: none; border-radius: 4px; padding: 0.35rem 0.7rem; cursor: pointer;" onclick="app.resenyas.abrirFormulario(${c.id}, '${(c.empresa_nombre || `la ${destinatario}`).replace(/'/g, "\\'")}')">⭐ Valorar</button>` : ''}
            <button class="btn-small" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 0.35rem 0.7rem; cursor: pointer;" onclick="app.candidaturas.retirarPostulacion(${c.id})">🗑️ Retirar</button>
          </div>
        </div>
      `;
    }
  },

  // ============================================
  // Módulo: Trayectoria profesional
  // ============================================

  trayectoria: {
    async cargar() {
      if (!estadoApp.usuario) return;
      try {
        const data = await utils.request(`/usuarios/${estadoApp.usuario.id}/trayectoria`);
        this.renderExperiencia(data.experiencia || []);
        this.renderFormacion(data.formacion || []);
        this.renderIdiomas(data.idiomas || []);
      } catch (error) {
        console.error("Error al cargar trayectoria:", error);
      }
    },

    formatearRango(inicio, fin, actual) {
      const partes = [inicio, actual ? "Actualidad" : fin].filter(Boolean);
      return partes.join(" – ");
    },

    renderExperiencia(lista) {
      const contenedor = document.getElementById("trayectoriaExperienciaLista");
      if (!contenedor) return;
      if (lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; font-size: 0.9rem;">Aún no has añadido experiencia laboral.</p>`;
        return;
      }
      contenedor.innerHTML = lista.map(e => `
        <div style="background: #f8faff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; gap: 1rem;">
          <div>
            <strong style="color: #0f4c75;">${utils.escapeHtml(e.puesto)}</strong>${e.lugar ? ` · ${utils.escapeHtml(e.lugar)}` : ''}
            <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #6b7280;">${utils.escapeHtml(this.formatearRango(e.fecha_inicio, e.fecha_fin, e.actual))}</p>
            ${e.descripcion ? `<p style="margin: 0.3rem 0 0 0; font-size: 0.9rem; color: #374151; white-space: pre-wrap;">${utils.escapeHtml(e.descripcion)}</p>` : ''}
          </div>
          <button class="btn-text btn-small" onclick="app.trayectoria.eliminarExperiencia(${e.id})" style="white-space: nowrap;">Eliminar</button>
        </div>
      `).join('');
    },

    renderFormacion(lista) {
      const contenedor = document.getElementById("trayectoriaFormacionLista");
      if (!contenedor) return;
      if (lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; font-size: 0.9rem;">Aún no has añadido formación.</p>`;
        return;
      }
      contenedor.innerHTML = lista.map(f => `
        <div style="background: #f8faff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; gap: 1rem;">
          <div>
            <strong style="color: #0f4c75;">${utils.escapeHtml(f.titulo)}</strong>
            <p style="margin: 0.2rem 0; font-size: 0.85rem; color: #6b7280;">${[f.centro, f.anyo].filter(Boolean).map(x => utils.escapeHtml(x)).join(' · ')}</p>
          </div>
          <button class="btn-text btn-small" onclick="app.trayectoria.eliminarFormacion(${f.id})" style="white-space: nowrap;">Eliminar</button>
        </div>
      `).join('');
    },

    renderIdiomas(lista) {
      const contenedor = document.getElementById("trayectoriaIdiomasLista");
      if (!contenedor) return;
      if (lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; font-size: 0.9rem;">Aún no has añadido idiomas.</p>`;
        return;
      }
      contenedor.innerHTML = `<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">` + lista.map(i => `
        <span style="background: #eef2ff; color: #3730a3; padding: 0.4rem 0.8rem; border-radius: 999px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 0.5rem;">
          ${utils.escapeHtml(i.idioma)} · ${utils.escapeHtml(i.nivel)}
          <button onclick="app.trayectoria.eliminarIdioma(${i.id})" style="background: none; border: none; cursor: pointer; color: #6366f1; font-weight: bold; padding: 0;">✕</button>
        </span>
      `).join('') + `</div>`;
    },

    async crearExperiencia() {
      const datos = {
        puesto: document.getElementById("expPuesto").value,
        lugar: document.getElementById("expLugar").value || null,
        fecha_inicio: document.getElementById("expInicio").value || null,
        fecha_fin: document.getElementById("expFin").value || null,
        actual: document.getElementById("expActual").checked
      };
      datos.descripcion = document.getElementById("expDescripcion").value || null;

      try {
        await utils.request("/experiencia-laboral", { method: "POST", body: JSON.stringify(datos) });
        ["expPuesto", "expLugar", "expInicio", "expFin", "expDescripcion"].forEach(id => document.getElementById(id).value = "");
        document.getElementById("expActual").checked = false;
        document.getElementById("expFin").disabled = false;
        utils.mostrarAlerta("✅ Experiencia añadida", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminarExperiencia(id) {
      if (!confirm("¿Eliminar esta experiencia?")) return;
      try {
        await utils.request(`/experiencia-laboral/${id}`, { method: "DELETE" });
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async crearFormacion() {
      const datos = {
        titulo: document.getElementById("formTitulo").value,
        centro: document.getElementById("formCentro").value || null,
        anyo: document.getElementById("formAnyo").value || null
      };
      try {
        await utils.request("/formacion", { method: "POST", body: JSON.stringify(datos) });
        ["formTitulo", "formCentro", "formAnyo"].forEach(id => document.getElementById(id).value = "");
        utils.mostrarAlerta("✅ Formación añadida", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminarFormacion(id) {
      if (!confirm("¿Eliminar esta formación?")) return;
      try {
        await utils.request(`/formacion/${id}`, { method: "DELETE" });
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async crearIdioma() {
      const datos = {
        idioma: document.getElementById("idiomaNombre").value,
        nivel: document.getElementById("idiomaNivel").value
      };
      try {
        await utils.request("/idiomas", { method: "POST", body: JSON.stringify(datos) });
        document.getElementById("idiomaNombre").value = "";
        document.getElementById("idiomaNivel").value = "";
        utils.mostrarAlerta("✅ Idioma añadido", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminarIdioma(id) {
      try {
        await utils.request(`/idiomas/${id}`, { method: "DELETE" });
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Sedes
  // ============================================

  sedes: {
    lista: [],

    async cargar() {
      try {
        const data = await utils.request("/sedes");
        this.lista = data.sedes || [];
        this.renderLista();
        this.prepararFormulario();
      } catch (error) {
        console.error("Error al cargar sedes:", error);
      }
    },

    // Prepara el formulario de "Añadir sede": checkboxes de equipamiento + autocompletado de ciudad
    async prepararFormulario() {
      try { await app.catalogos.cargar(); } catch (e) { /* el catálogo ya puede estar cargado */ }
      app.catalogos.renderizarEquipamientoPublicar('sede');
      app.ciudades.montar(
        document.getElementById("sedeCiudad"),
        document.getElementById("sedeProvincia"),
        document.getElementById("sedeProvinciaLabel")
      );
    },

    renderLista() {
      const contenedor = document.getElementById("sedesLista");
      if (!contenedor) return;

      if (this.lista.length === 0) {
        contenedor.innerHTML = `<p style="color: #9ca3af; text-align: center;">Aún no has añadido ninguna sede.</p>`;
        return;
      }

      contenedor.innerHTML = this.lista.map(s => {
        const ciudadLabel = s.provincia ? `${s.ciudad} (${s.provincia})` : s.ciudad;
        const equipos = s.equipamiento || [];
        return `
        <div style="background: #f8faff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
          <div>
            <strong style="color: #0f4c75;">🏥 ${utils.escapeHtml(s.nombre)}</strong>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.9rem; color: #6b7280;">
              📍 ${utils.escapeHtml(ciudadLabel)}${s.direccion ? ` · ${utils.escapeHtml(s.direccion)}` : ''}${s.codigo_postal ? ` (${utils.escapeHtml(s.codigo_postal)})` : ''}
            </p>
            ${s.telefono ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.9rem; color: #6b7280;">📞 ${utils.escapeHtml(s.telefono)}</p>` : ''}
            ${equipos.length ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.85rem; color: #6b7280;">🦷 ${equipos.map(utils.escapeHtml).join(', ')}</p>` : ''}
          </div>
          <button class="btn-outline btn-small" onclick="app.sedes.eliminar(${s.id})">Eliminar</button>
        </div>
      `;
      }).join('');
    },

    async crear() {
      const equipos = Array.from(document.querySelectorAll('#sedeEquipamientoContainer input[type="checkbox"]:checked')).map(cb => cb.value);
      const datos = {
        nombre: document.getElementById("sedeNombre").value,
        ciudad: document.getElementById("sedeCiudad").value,
        provincia: document.getElementById("sedeProvincia").value || null,
        direccion: document.getElementById("sedeDireccion").value || null,
        codigo_postal: document.getElementById("sedeCodigoPostal").value || null,
        telefono: document.getElementById("sedeTelefono").value || null,
        equipamiento: equipos
      };

      try {
        await utils.request("/sedes", {
          method: "POST",
          body: JSON.stringify(datos)
        });
        utils.mostrarAlerta("✅ Sede añadida", "success");
        ["sedeNombre", "sedeCiudad", "sedeProvincia", "sedeDireccion", "sedeCodigoPostal", "sedeTelefono"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        document.querySelectorAll('#sedeEquipamientoContainer input[type="checkbox"]').forEach(cb => cb.checked = false);
        const lbl = document.getElementById("sedeProvinciaLabel");
        if (lbl) lbl.textContent = "";
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminar(id) {
      if (!confirm("¿Eliminar esta sede? Sus publicaciones seguirán activas, pero sin sede asociada.")) return;
      try {
        await utils.request(`/sedes/${id}`, { method: "DELETE" });
        utils.mostrarAlerta("Sede eliminada", "success");
        await this.cargar();
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    // Rellena el selector de sedes del formulario de oferta/suplencia.
    // La sede es obligatoria: de ella se heredan ciudad, provincia, teléfono y equipamiento.
    // prefijo: 'oferta' o 'suplencia' (ambas comparten el mismo patrón de ids)
    async cargarEnSelector(prefijo = 'oferta') {
      const grupo = document.getElementById(`${prefijo}SedeGroup`);
      const select = document.getElementById(`${prefijo}Sede`);
      if (!grupo || !select) return;

      grupo.style.display = "block";
      const aviso = document.getElementById(`${prefijo}SinSedes`);
      const submitBtn = document.querySelector(`#tab-${prefijo} button[type="submit"]`);
      const preview = document.getElementById(`${prefijo}SedePreview`);

      // La empresa y el email de contacto salen del perfil (constantes, no dependen de la sede)
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
      setVal(`${prefijo}NombreContacto`, estadoApp.usuario?.nombre || "");
      setVal(`${prefijo}EmailContacto`, estadoApp.usuario?.email || "");

      try {
        const data = await utils.request("/sedes");
        this.lista = data.sedes || [];

        if (this.lista.length === 0) {
          select.innerHTML = `<option value="">— No tienes sedes —</option>`;
          if (aviso) aviso.style.display = "block";
          if (submitBtn) submitBtn.disabled = true;
          if (preview) preview.innerHTML = "";
          return;
        }

        if (aviso) aviso.style.display = "none";
        if (submitBtn) submitBtn.disabled = false;
        select.innerHTML = `<option value="">Elige una sede…</option>` +
          this.lista.map(s => `<option value="${s.id}">${utils.escapeHtml(s.nombre)} (${utils.escapeHtml(s.ciudad)})</option>`).join('');
        if (preview) preview.innerHTML = "";
      } catch (error) {
        console.error("Error al cargar sedes:", error);
        grupo.style.display = "none";
      }
    },

    // Al elegir sede, rellenar (solo lectura) ciudad, teléfono y equipamiento heredados, y una vista previa.
    aplicarAPublicacion(prefijo = 'oferta') {
      const select = document.getElementById(`${prefijo}Sede`);
      const sede = this.lista.find(s => String(s.id) === select.value);
      const preview = document.getElementById(`${prefijo}SedePreview`);
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
      const empresa = estadoApp.usuario?.nombre || "";

      if (!sede) {
        setVal(`${prefijo}Ciudad`, "");
        setVal(`${prefijo}TelefonoContacto`, "");
        if (preview) preview.innerHTML = "";
        return;
      }

      const ciudadLabel = sede.provincia ? `${sede.ciudad} (${sede.provincia})` : sede.ciudad;
      setVal(`${prefijo}Ciudad`, ciudadLabel);
      setVal(`${prefijo}TelefonoContacto`, sede.telefono || "");

      const equipos = sede.equipamiento || [];
      if (preview) {
        preview.innerHTML = `
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:.75rem 1rem;font-size:.88rem;color:#0c4a6e;">
            <div><strong>Empresa:</strong> ${utils.escapeHtml(empresa)}</div>
            <div><strong>Ciudad:</strong> ${utils.escapeHtml(ciudadLabel)}</div>
            ${sede.direccion ? `<div><strong>Dirección:</strong> ${utils.escapeHtml(sede.direccion)}</div>` : ""}
            ${sede.telefono ? `<div><strong>Teléfono:</strong> ${utils.escapeHtml(sede.telefono)}</div>` : ""}
            <div><strong>Equipamiento:</strong> ${equipos.length ? equipos.map(utils.escapeHtml).join(", ") : "ninguno"}</div>
            <div style="margin-top:.3rem;color:#0369a1;">Estos datos se toman de la sede y de tu perfil; no son editables aquí.</div>
          </div>`;
      }
    }
  },

  // ============================================
  // Módulo: Plantillas de publicación
  // ============================================

  plantillas: {
    lista: [],

    // Ids de los campos del formulario según el tipo de publicación
    camposDe(tipo) {
      return {
        ciudad: `${tipo}Ciudad`,
        contrato: `${tipo}Contrato`,
        jornada: `${tipo}Jornada`,
        salario: null, // el salario de oferta ahora son dos campos numéricos; la plantilla no lo rellena
        experiencia: `${tipo}Experiencia`,
        descripcion: `${tipo}Descripcion`,
        nombre_contacto: `${tipo}NombreContacto`,
        email_contacto: `${tipo}EmailContacto`,
        telefono_contacto: `${tipo}TelefonoContacto`
      };
    },

    async cargar(tipo) {
      try {
        const data = await utils.request("/plantillas");
        this.lista = data.plantillas || [];

        const select = document.getElementById(`${tipo}Plantillas`);
        if (!select) return;

        const propias = this.lista.filter(p => p.tipo === tipo);
        select.innerHTML = `<option value="">Sin plantilla…</option>` +
          propias.map(p => `<option value="${p.id}">${utils.escapeHtml(p.nombre)}</option>`).join('');
      } catch (error) {
        console.error("Error al cargar plantillas:", error);
      }
    },

    aplicar(tipo) {
      const select = document.getElementById(`${tipo}Plantillas`);
      const plantilla = this.lista.find(p => p.id === parseInt(select.value));
      if (!plantilla) return;

      const campos = this.camposDe(tipo);
      Object.entries(campos).forEach(([campo, elementId]) => {
        if (!elementId) return;
        const el = document.getElementById(elementId);
        if (el) el.value = plantilla[campo] ?? '';
      });

      // Marcar especialidades de la plantilla
      const checkboxes = document.querySelectorAll(`#${tipo}EspecialidadesContainer input[type="checkbox"]`);
      checkboxes.forEach(cb => {
        cb.checked = (plantilla.especialidades || []).includes(parseInt(cb.value));
      });

      utils.mostrarAlerta(`Plantilla "${plantilla.nombre}" aplicada`, "info");
    },

    async guardar(tipo) {
      const nombre = prompt("Nombre de la plantilla (ej: 'Oferta ortodoncia Barcelona'):");
      if (!nombre || !nombre.trim()) return;

      const campos = this.camposDe(tipo);
      const datos = { nombre: nombre.trim(), tipo };
      Object.entries(campos).forEach(([campo, elementId]) => {
        if (!elementId) return;
        const el = document.getElementById(elementId);
        datos[campo] = el ? el.value || null : null;
      });

      datos.especialidades = Array.from(
        document.querySelectorAll(`#${tipo}EspecialidadesContainer input[type="checkbox"]:checked`)
      ).map(cb => parseInt(cb.value));

      try {
        await utils.request("/plantillas", {
          method: "POST",
          body: JSON.stringify(datos)
        });
        utils.mostrarAlerta("✅ Plantilla guardada", "success");
        await this.cargar(tipo);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async eliminar(tipo) {
      const select = document.getElementById(`${tipo}Plantillas`);
      const plantilla = this.lista.find(p => p.id === parseInt(select.value));
      if (!plantilla) {
        utils.mostrarAlerta("Selecciona primero la plantilla que quieres eliminar", "info");
        return;
      }
      if (!confirm(`¿Eliminar la plantilla "${plantilla.nombre}"?`)) return;

      try {
        await utils.request(`/plantillas/${plantilla.id}`, { method: "DELETE" });
        utils.mostrarAlerta("Plantilla eliminada", "success");
        await this.cargar(tipo);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    }
  },

  // ============================================
  // Módulo: Reseñas
  // ============================================

  resenyas: {
    candidaturaActual: null,
    puntuacionSeleccionada: 0,

    estrellasHtml(media) {
      if (media === null || media === undefined) return '';
      const llenas = Math.round(media);
      return '★'.repeat(llenas) + '☆'.repeat(5 - llenas);
    },

    abrirFormulario(candidaturaId, nombreOtro) {
      this.candidaturaActual = candidaturaId;
      this.puntuacionSeleccionada = 0;
      document.getElementById("resenyaTitle").textContent = `⭐ Valorar a ${nombreOtro}`;
      document.getElementById("resenyaComentario").value = "";
      document.getElementById("resenyaEstrellasTexto").textContent = "Elige una puntuación";
      this.renderEstrellas();
      document.getElementById("modalResenya").classList.add("active");
    },

    renderEstrellas() {
      const contenedor = document.getElementById("resenyaEstrellas");
      contenedor.innerHTML = [1, 2, 3, 4, 5].map(v => `
        <span class="resenya-estrella ${v <= this.puntuacionSeleccionada ? 'activa' : ''}"
              onclick="app.resenyas.seleccionar(${v})">${v <= this.puntuacionSeleccionada ? '★' : '☆'}</span>
      `).join('');
    },

    seleccionar(valor) {
      this.puntuacionSeleccionada = valor;
      const textos = { 1: "Muy mala", 2: "Mala", 3: "Normal", 4: "Buena", 5: "Excelente" };
      document.getElementById("resenyaEstrellasTexto").textContent = `${valor}/5 — ${textos[valor]}`;
      this.renderEstrellas();
    },

    async enviar() {
      if (!this.candidaturaActual) return;
      if (!this.puntuacionSeleccionada) {
        utils.mostrarAlerta("Elige una puntuación de 1 a 5 estrellas", "error");
        return;
      }

      try {
        await utils.request("/resenyas", {
          method: "POST",
          body: JSON.stringify({
            candidatura_id: this.candidaturaActual,
            puntuacion: this.puntuacionSeleccionada,
            comentario: document.getElementById("resenyaComentario").value
          })
        });
        document.getElementById("modalResenya").classList.remove("active");
        utils.mostrarAlerta("✅ ¡Gracias por tu valoración!", "success");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async cargarResumen(usuarioId) {
      try {
        return await utils.request(`/resenyas/usuario/${usuarioId}`);
      } catch (error) {
        console.error("Error al cargar reseñas:", error);
        return { media: null, total: 0, resenyas: [] };
      }
    },

    // Bloque HTML con la media de reseñas para incrustar en perfiles
    resumenHtml(resumen, usuarioId, nombre) {
      if (!resumen || resumen.total === 0) {
        return `<p style="margin: 0.3rem 0; font-size: 0.95rem; color: #9ca3af;">Sin valoraciones todavía</p>`;
      }
      const nombreEscapado = (nombre || '').replace(/'/g, "\\'");
      return `
        <p style="margin: 0.3rem 0; font-size: 1.05rem;">
          <span style="color: #f59e0b; letter-spacing: 2px;">${this.estrellasHtml(resumen.media)}</span>
          <strong>${resumen.media}</strong> · ${resumen.total} valoraci${resumen.total === 1 ? 'ón' : 'ones'}
          <button class="btn-text btn-small" onclick="app.resenyas.verDeUsuario(${usuarioId}, '${nombreEscapado}')">Ver reseñas</button>
        </p>
      `;
    },

    async verDeUsuario(usuarioId, nombre) {
      const resumen = await this.cargarResumen(usuarioId);

      let html = `<div class="candidatos-list">`;
      if (resumen.total === 0) {
        html += `<p style="text-align: center; color: #6b7280;">Este usuario aún no tiene reseñas.</p>`;
      } else {
        html += `
          <div style="text-align: center; margin-bottom: 1.5rem;">
            <span style="color: #f59e0b; font-size: 1.8rem; letter-spacing: 3px;">${this.estrellasHtml(resumen.media)}</span>
            <p style="margin: 0.3rem 0; color: #6b7280;">${resumen.media} de 5 · ${resumen.total} valoraci${resumen.total === 1 ? 'ón' : 'ones'}</p>
          </div>
        `;
        resumen.resenyas.forEach(r => {
          html += `
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <strong style="color: #0f4c75;">${utils.escapeHtml(r.autor_nombre)} ${r.autor_tipo === 'clinica' ? '🏥' : '👨‍⚕️'}</strong>
                <span style="color: #f59e0b; letter-spacing: 1px;">${this.estrellasHtml(r.puntuacion)}</span>
              </div>
              ${r.comentario ? `<p style="margin: 0.5rem 0; color: #374151; white-space: pre-wrap;">${utils.escapeHtml(r.comentario)}</p>` : ''}
              <span style="font-size: 0.8rem; color: #9ca3af;">${utils.formatearFecha(r.creado_en)}</span>
            </div>
          `;
        });
      }
      html += `</div>`;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `Reseñas de ${utils.escapeHtml(nombre)}`;
      document.getElementById("modalInteresados").classList.add("active");
    }
  },

  // ============================================
  // Módulo: Recordatorios
  // ============================================

  recordatorios: {
    async comprobar() {
      if (!estadoApp.usuario) return;
      if (sessionStorage.getItem("recordatoriosDescartados") === "1") return;

      try {
        const data = await utils.request("/recordatorios/pendientes");
        const pendientes = data.pendientes || [];
        const banner = document.getElementById("recordatoriosBanner");
        if (!banner) return;

        if (pendientes.length === 0) {
          banner.style.display = "none";
          return;
        }

        const masAntigua = Math.max(...pendientes.map(p => p.dias_esperando));
        banner.innerHTML = `
          <span>⏰ Tienes <strong>${pendientes.length}</strong> postulaci${pendientes.length === 1 ? 'ón' : 'ones'} sin responder
          (la más antigua lleva <strong>${masAntigua} día${masAntigua === 1 ? '' : 's'}</strong> esperando).</span>
          <div class="recordatorios-acciones">
            <button class="btn-primary btn-small" onclick="app.recordatorios.revisar()">Revisar</button>
            <button class="btn-text btn-small" onclick="app.recordatorios.descartar()">Descartar</button>
          </div>
        `;
        banner.style.display = "flex";
      } catch (error) {
        console.error("Error al comprobar recordatorios:", error);
      }
    },

    revisar() {
      if (estadoApp.tipoUsuario === 'clinica') {
        app.stats.mostrarCandidatosInteresados();
      } else {
        app.stats.mostrarPostulacionesRecibidas();
      }
    },

    descartar() {
      sessionStorage.setItem("recordatoriosDescartados", "1");
      const banner = document.getElementById("recordatoriosBanner");
      if (banner) banner.style.display = "none";
    }
  },

  // ============================================
  // Módulo: Chat
  // ============================================

  chat: {
    pollingInterval: null,
    conversacionActual: null,
    ultimaSenalEscribiendo: 0,

    async abrir() {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      this.conversacionActual = null;
      document.getElementById("modalChat").classList.add("active");
      await this.renderConversaciones();
      this.iniciarPolling();
    },

    cerrar() {
      this.detenerPolling();
      this.conversacionActual = null;
      document.getElementById("modalChat").classList.remove("active");
      app.chat.actualizarContador();
    },

    // Abre el chat directamente en la conversación con un usuario sobre una publicación
    async abrirConDestinatario(publicacionId, otroId, otroNombre) {
      if (!estadoApp.usuario) {
        utils.mostrarAlerta("Debes iniciar sesión", "error");
        return;
      }
      app.modal.cerrarTodosModales();
      document.getElementById("modalChat").classList.add("active");
      await this.abrirConversacion(publicacionId, otroId, otroNombre);
      this.iniciarPolling();
    },

    async actualizarContador() {
      if (!estadoApp.usuario) return;
      try {
        const data = await utils.request("/chat/no-leidos");
        const badge = document.getElementById("chatBadge");
        if (data.total > 0) {
          badge.textContent = data.total;
          badge.style.display = "inline-block";
        } else {
          badge.style.display = "none";
        }
      } catch (error) {
        console.error("Error al contar mensajes no leídos:", error);
      }
    },

    async renderConversaciones() {
      try {
        const data = await utils.request("/chat/conversaciones");
        const conversaciones = data.conversaciones || [];

        document.getElementById("chatTitle").textContent = "💬 Mensajes";

        if (conversaciones.length === 0) {
          document.getElementById("chatBody").innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #6b7280;">
              <p>No tienes conversaciones todavía.</p>
              <p style="font-size: 0.9rem;">El chat se activa cuando una postulación es aceptada: entra en la publicación correspondiente y pulsa "💬 Enviar mensaje".</p>
            </div>
          `;
          return;
        }

        let html = `<div class="chat-conversaciones">`;
        conversaciones.forEach(c => {
          const etiquetaPub = `${c.publicacion_tipo === 'oferta' ? 'Oferta' : 'Solicitud'} · ${utils.escapeHtml(c.publicacion_ciudad || '')}`;
          html += `
            <div class="chat-conversacion-item" onclick="app.chat.abrirConversacion(${c.publicacion_id}, ${c.otro_id}, '${utils.escapeHtml(c.otro_nombre).replace(/'/g, "\\'")}')">
              <div class="chat-conversacion-info">
                <strong>${utils.escapeHtml(c.otro_nombre || 'Usuario')}</strong>
                <span class="chat-conversacion-pub">${etiquetaPub}</span>
                <p class="chat-conversacion-ultimo">${utils.escapeHtml((c.ultimo_mensaje || '').slice(0, 60))}${(c.ultimo_mensaje || '').length > 60 ? '…' : ''}</p>
              </div>
              <div class="chat-conversacion-meta">
                <span class="chat-conversacion-fecha">${utils.formatearFecha(c.ultima_fecha)}</span>
                ${c.no_leidos > 0 ? `<span class="chat-no-leidos">${c.no_leidos}</span>` : ''}
              </div>
            </div>
          `;
        });
        html += `</div>`;
        document.getElementById("chatBody").innerHTML = html;
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async abrirConversacion(publicacionId, otroId, otroNombre) {
      this.conversacionActual = { publicacion_id: publicacionId, otro_id: otroId, otro_nombre: otroNombre };

      document.getElementById("chatTitle").textContent = `💬 ${otroNombre}`;
      document.getElementById("chatBody").innerHTML = `
        <div class="chat-hilo">
          <button class="btn-text btn-small" onclick="app.chat.volverALista()" style="margin-bottom: 0.5rem;">← Todas las conversaciones</button>
          <div id="chatEscribiendo" class="chat-escribiendo" style="visibility: hidden;">escribiendo…</div>
          <div id="chatMensajes" class="chat-mensajes"><p style="color: #9ca3af; text-align: center;">Cargando…</p></div>
          <form class="chat-input-row" onsubmit="event.preventDefault(); app.chat.enviar();">
            <input id="chatInput" type="text" placeholder="Escribe un mensaje…" autocomplete="off" oninput="app.chat.notificarEscribiendo()">
            <button type="submit" class="btn-primary">Enviar</button>
          </form>
        </div>
      `;
      await this.refrescarHilo(true);
      const input = document.getElementById("chatInput");
      if (input) input.focus();
    },

    async volverALista() {
      this.conversacionActual = null;
      await this.renderConversaciones();
    },

    async refrescarHilo(forzarScroll = false) {
      const conv = this.conversacionActual;
      if (!conv) return;

      try {
        const data = await utils.request(`/chat/mensajes/${conv.publicacion_id}/${conv.otro_id}`);
        const mensajes = data.mensajes || [];
        const contenedor = document.getElementById("chatMensajes");
        if (!contenedor) return;

        const estabaAbajo = forzarScroll ||
          (contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < 60);

        if (mensajes.length === 0) {
          contenedor.innerHTML = `<p style="color: #9ca3af; text-align: center;">Todavía no hay mensajes. ¡Escribe el primero!</p>`;
        } else {
          contenedor.innerHTML = mensajes.map(m => {
            const esMio = m.usuario_id === estadoApp.usuario.id;
            const ticks = esMio
              ? `<span class="chat-ticks ${m.leido ? 'chat-ticks-leido' : ''}">${m.leido ? '✓✓' : '✓'}</span>`
              : '';
            const hora = new Date(m.creado_en).toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' });
            return `
              <div class="chat-burbuja ${esMio ? 'chat-burbuja-mia' : 'chat-burbuja-otro'}">
                <p>${utils.escapeHtml(m.cuerpo)}</p>
                <span class="chat-burbuja-meta">${utils.formatearFecha(m.creado_en)} ${hora} ${ticks}</span>
              </div>
            `;
          }).join('');
        }

        const escribiendoEl = document.getElementById("chatEscribiendo");
        if (escribiendoEl) {
          escribiendoEl.style.visibility = data.escribiendo ? "visible" : "hidden";
        }

        if (estabaAbajo) {
          contenedor.scrollTop = contenedor.scrollHeight;
        }
      } catch (error) {
        console.error("Error al refrescar chat:", error);
      }
    },

    async enviar() {
      const conv = this.conversacionActual;
      const input = document.getElementById("chatInput");
      if (!conv || !input || !input.value.trim()) return;

      const cuerpo = input.value.trim();
      input.value = "";

      try {
        await utils.request("/chat/mensajes", {
          method: "POST",
          body: JSON.stringify({
            publicacion_id: conv.publicacion_id,
            destinatario_id: conv.otro_id,
            cuerpo
          })
        });
        await this.refrescarHilo(true);
      } catch (error) {
        input.value = cuerpo;
        utils.mostrarAlerta(error.message, "error");
      }
    },

    notificarEscribiendo() {
      const conv = this.conversacionActual;
      if (!conv) return;
      // Throttle: como mucho una señal cada 2 segundos
      const ahora = Date.now();
      if (ahora - this.ultimaSenalEscribiendo < 2000) return;
      this.ultimaSenalEscribiendo = ahora;

      utils.request("/chat/escribiendo", {
        method: "POST",
        body: JSON.stringify({
          publicacion_id: conv.publicacion_id,
          destinatario_id: conv.otro_id
        })
      }).catch(err => console.error("Error señal escribiendo:", err));
    },

    iniciarPolling() {
      this.detenerPolling();
      this.pollingInterval = setInterval(async () => {
        const modal = document.getElementById("modalChat");
        if (!modal || !modal.classList.contains("active")) {
          this.detenerPolling();
          return;
        }
        if (this.conversacionActual) {
          await this.refrescarHilo();
        } else {
          await this.renderConversaciones();
        }
      }, 3000);
    },

    detenerPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    }
  },

  // ============================================
  // Módulo: Especialidades
  // ============================================

  especialidades: {
    async cargar() {
      try {
        const especialidades = await utils.request("/especialidades");
        estadoApp.especialidades = especialidades;
        app.especialidades.renderizarSelectos();
      } catch (error) {
        console.error(error);
      }
    },

    renderizarSelectos() {
      const selectores = [
        "filterEspecialidad",
        "ofertaEspecialidad",
        "solicitudEspecialidad"
      ];

      selectores.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        const opcionesHTML = estadoApp.especialidades
          .map(e => `<option value="${e.id}">${e.nombre}</option>`)
          .join("");

        const valorActual = select.value;
        select.innerHTML = `<option value="">Todas las especialidades</option>${opcionesHTML}`;
        select.value = valorActual;
      });
    }
  },

  // ============================================
  // Módulo: Catálogos fijos (equipamiento, certificaciones)
  // ============================================

  catalogos: {
    equipamiento: [],
    certificaciones: [],

    async cargar() {
      if (this.equipamiento.length > 0 || this.certificaciones.length > 0) return;
      try {
        const data = await utils.request("/catalogos");
        this.equipamiento = data.equipamiento || [];
        this.certificaciones = data.certificaciones || [];
      } catch (error) {
        console.error("Error al cargar catálogos:", error);
      }
    },

    // Rellena el <select> de filtro de equipamiento/certificación
    renderizarFiltros() {
      const selEquipo = document.getElementById("filterEquipamiento");
      if (selEquipo) {
        const actual = selEquipo.value;
        selEquipo.innerHTML = `<option value="">Cualquier equipamiento</option>` +
          this.equipamiento.map(e => `<option value="${utils.escapeHtml(e)}">${utils.escapeHtml(e)}</option>`).join("");
        selEquipo.value = actual;
      }
      const selCert = document.getElementById("filterCertificacion");
      if (selCert) {
        const actual = selCert.value;
        selCert.innerHTML = `<option value="">Cualquier certificación</option>` +
          this.certificaciones.map(c => `<option value="${utils.escapeHtml(c)}">${utils.escapeHtml(c)}</option>`).join("");
        selCert.value = actual;
      }
    },

    // Checkboxes de equipamiento en el formulario de publicar (prefijo: 'oferta' o 'suplencia')
    renderizarEquipamientoPublicar(prefijo) {
      const contenedor = document.getElementById(`${prefijo}EquipamientoContainer`);
      if (!contenedor) return;
      contenedor.innerHTML = this.equipamiento.map(e => `
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" value="${utils.escapeHtml(e)}">
          ${utils.escapeHtml(e)}
        </label>
      `).join("");
    },

    // Checkboxes de certificaciones en "Mis datos" del dentista
    renderizarCertificacionesPerfil(seleccionadas) {
      const contenedor = document.getElementById("certificacionesContainer");
      if (!contenedor) return;
      contenedor.innerHTML = this.certificaciones.map(c => `
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" value="${utils.escapeHtml(c)}" ${seleccionadas.includes(c) ? 'checked' : ''}>
          ${utils.escapeHtml(c)}
        </label>
      `).join("");
    }
  },

  candidaturas: {
    async enviarPostulacion() {
      if (!estadoApp.publicacionActual) return;

      const mensaje = document.getElementById("postulacionMensaje").value;
      const errorDiv = document.getElementById("postulacionError");

      try {
        await utils.request("/candidaturas", {
          method: "POST",
          body: JSON.stringify({
            publicacion_id: estadoApp.publicacionActual.id,
            mensaje: mensaje || null
          })
        });

        errorDiv.style.display = "none";
        utils.mostrarAlerta("✅ ¡Postulación enviada!", "success");
        app.modal.cerrarPostularseModal();
        app.modal.cerrarDetalle();
        await app.publicaciones.cargar();
        await app.ui.actualizarStats();
      } catch (error) {
        console.error("Error en postulación:", error);
        const mensajeError = error.message || "Error al enviar postulación";

        // Mostrar error dentro del modal
        errorDiv.innerHTML = mensajeError;
        errorDiv.style.display = "block";
      }
    },

    async postularse(publicacionId) {
      // Función antigua, mantener por compatibilidad
      estadoApp.publicacionActual = { id: publicacionId };
      app.modal.abrirPostularseModal();
    },

    async cargarMisPostulaciones() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const candidaturas = data.candidaturas || [];
        const container = document.getElementById("misPostulacionesContainer");
        if (!container) return;
        if (candidaturas.length === 0) {
          container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No tienes postulaciones aún</p></div>`;
          return;
        }
        const html = candidaturas.map(c => {
          const estadoColor = utils.colorEstado(c.estado);
          return `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;"><div style="display: flex; justify-content: space-between; align-items: start;"><div style="flex: 1;"><h3 style="margin: 0 0 0.5rem 0; color: #1f2937;">${utils.escapeHtml(c.titulo)}</h3><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Empresa:</strong> ${utils.escapeHtml(c.empresa_nombre)}</p><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Ciudad:</strong> ${utils.escapeHtml(c.ciudad || 'No especificada')}</p><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Contrato:</strong> ${utils.escapeHtml(c.contrato)} | <strong>Jornada:</strong> ${utils.escapeHtml(c.jornada)}</p></div><div style="text-align: right;"><span style="background: ${estadoColor}; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.85rem; text-transform: capitalize;">${utils.textoEstado(c.estado)}</span><button class="btn-text btn-small" onclick="app.candidaturas.retirarPostulacion(${c.id})" style="margin-top: 0.5rem; display: block;">Retirar</button></div></div></div>`;
        });
        container.innerHTML = `<div>${html.join('')}</div>`;
      } catch (error) {
        console.error(error);
      }
    },

    async retirarPostulacion(candidaturaId) {
      if (!confirm("¿Retirar postulación?")) return;
      try {
        await utils.request(`/candidaturas/${candidaturaId}`, { method: "DELETE" });
        utils.mostrarAlerta("✅ Postulación retirada", "success");

        // Cerrar modales que pudieran mostrar la postulación ya retirada
        ["modalDetalle", "modalInteresados"].forEach(id => {
          document.getElementById(id)?.classList.remove("active");
        });

        // Refrescar solo la vista donde estaba este botón, sin recargar toda
        // la página (eso perdía filtros y scroll, y cortaba el aviso de éxito)
        if (document.getElementById("misPostulacionesContainer")) {
          await app.candidaturas.cargarMisPostulaciones();
        } else if (document.querySelector("#publicacionesContainer .kanban-board")) {
          await app.kanban.render();
        } else if (document.getElementById("publicacionesContainer")) {
          await app.publicaciones.cargar();
        }
        await app.ui.actualizarStats();
      } catch (error) {
        utils.mostrarAlerta("❌ " + error.message, "error");
      }
    },

    async cargarCandidatos(publicacionId) {
      try {
        const data = await utils.request(`/publicaciones/${publicacionId}/candidatos`);
        const candidatos = data.candidatos || [];
        const container = document.getElementById("candidatosBody");
        if (!container) return;
        if (candidatos.length === 0) {
          container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No hay candidatos aún</p></div>`;
          return;
        }
        const html = candidatos.map(c => {
          const estadoColor = utils.colorEstado(c.estado);
          return `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;"><div style="display: flex; justify-content: space-between; align-items: start;"><div style="flex: 1;"><h3 style="margin: 0 0 0.5rem 0; color: #1f2937;">${utils.escapeHtml(c.nombre)}</h3><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Email:</strong> ${utils.escapeHtml(c.email)}</p>${c.telefono ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Teléfono:</strong> ${utils.escapeHtml(c.telefono)}</p>` : ''}${c.movil ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Móvil:</strong> ${utils.escapeHtml(c.movil)}</p>` : ''}${c.ciudad ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Ciudad:</strong> ${utils.escapeHtml(c.ciudad)}</p>` : ''}${c.mensaje ? `<p style="margin: 0.5rem 0 0 0; padding: 0.75rem; background: #f3f4f6; border-radius: 6px; border-left: 3px solid #2563eb; color: #374151; font-size: 0.9rem;"><strong>Mensaje:</strong> ${utils.escapeHtml(c.mensaje)}</p>` : ''}</div><div style="text-align: right;"><span style="background: ${estadoColor}; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.85rem; text-transform: capitalize; display: inline-block; margin-bottom: 0.5rem;">${utils.textoEstado(c.estado)}</span><div style="display: flex; gap: 0.5rem; flex-direction: column;">${utils.selectorEstado(c.id, c.estado, `app.candidaturas.actualizarEstado(${c.id}, this.value, ${publicacionId})`)}</div></div></div></div>`;
        });
        container.innerHTML = `<div>${html.join('')}</div>`;
      } catch (error) {
        console.error(error);
      }
    },

    async actualizarEstado(candidaturaId, nuevoEstado, publicacionId) {
      try {
        await utils.request(`/candidaturas/${candidaturaId}`, {
          method: "PUT",
          body: JSON.stringify({ estado: nuevoEstado })
        });
        utils.mostrarAlerta(`✅ Candidatura ${nuevoEstado}`, "success");
        app.candidaturas.cargarCandidatos(publicacionId);
      } catch (error) {
        utils.mostrarAlerta("❌ " + error.message, "error");
      }
    }
  }
};

// Cerradores globales de modales (presionando Esc)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    app.modal.cerrarTodosModales();
  }
});

// Cerrador por clic fuera del modal - SOLO para modales activos
document.addEventListener("click", (e) => {
  // Solo cerrar si es click en un modal activo
  if (e.target.classList && e.target.classList.contains("modal") && e.target.classList.contains("active")) {
    e.target.classList.remove("active");
    app.modal.cerrarTodosModales();
  }
});


// Función de debug para encontrar qué está bloqueando clicks
window.findBlocker = () => {
  console.log("=== BUSCANDO ELEMENTO QUE BLOQUEA ===");
  const buttons = Array.from(document.querySelectorAll('.stat-item, [onclick*="mostrar"]'));
  buttons.forEach(btn => {
    const rect = btn.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const element = document.elementFromPoint(centerX, centerY);
    console.log("Button:", btn.textContent.trim());
    console.log("Element at position:", element?.id || element?.className || element?.tagName);
    console.log("z-index:", getComputedStyle(element)?.zIndex || "auto");
    console.log("pointer-events:", getComputedStyle(element)?.pointerEvents || "auto");
    console.log("display:", getComputedStyle(element)?.display || "auto");
    console.log("visibility:", getComputedStyle(element)?.visibility || "auto");
    console.log("---");
  });
};

// Inicializar la aplicación
app.ui.init();
