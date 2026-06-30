const API = "http://localhost:3000";

let estadoApp = {
  token: localStorage.getItem("token"),
  usuario: localStorage.getItem("usuario") ? JSON.parse(localStorage.getItem("usuario")) : null,
  tipoUsuario: localStorage.getItem("tipoUsuario"), // 'clinica' o 'dentista'
  publicaciones: [],
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

      try {
        const response = await utils.request("/auth/registro", {
          method: "POST",
          body: JSON.stringify({ nombre, email, password, tipo: 'clinica', telefono, direccion, codigo_postal, pais })
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

      try {
        const response = await utils.request("/auth/registro", {
          method: "POST",
          body: JSON.stringify({ nombre, email, password, tipo: 'dentista', telefono })
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

    logout() {
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
    async cargar() {
      // Cerrar todos los modales antes de cargar
      app.modal.cerrarTodosModales();

      // Determinar tipo según modo
      let tipo;
      if (estadoApp.filtros.soloMias) {
        // Mis publicaciones: empresas ven sus OFERTAS, candidatos ven sus SOLICITUDES
        tipo = estadoApp.tipoUsuario === 'clinica' ? 'oferta' : 'solicitud';
      } else {
        // Ver todas: empresas ven SOLICITUDES, candidatos ven OFERTAS
        tipo = estadoApp.tipoUsuario === 'clinica' ? 'solicitud' : 'oferta';
      }

      const ciudad = document.getElementById("filterCiudad").value;
      const especialidad = document.getElementById("filterEspecialidad").value;
      const contrato = document.getElementById("filterContrato").value;
      const jornada = document.getElementById("filterJornada").value;

      estadoApp.filtros = { tipo, ciudad, especialidad, contrato, jornada, soloMias: estadoApp.filtros.soloMias };

      let url = "/publicaciones?";
      if (tipo) url += `tipo=${tipo}&`;
      if (estadoApp.filtros.soloMias && estadoApp.usuario) {
        url += `usuario_id=${estadoApp.usuario.id}&`;
      } else {
        if (ciudad) url += `ciudad=${encodeURIComponent(ciudad)}&`;
        if (especialidad) url += `especialidad=${especialidad}&`;
        if (contrato) url += `contrato=${encodeURIComponent(contrato)}&`;
        if (jornada) url += `jornada=${encodeURIComponent(jornada)}&`;
      }

      try {
        let publicaciones = await utils.request(url.slice(0, -1));
        estadoApp.publicaciones = publicaciones;
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
          salario: document.getElementById("ofertaSalario").value || null,
          nombre_contacto: document.getElementById("ofertaNombreContacto").value,
          email_contacto: document.getElementById("ofertaEmailContacto").value,
          telefono_contacto: document.getElementById("ofertaTelefonoContacto").value || null
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
          nombre_contacto: document.getElementById("solicitudNombreContacto").value,
          email_contacto: document.getElementById("solicitudEmailContacto").value,
          telefono_contacto: document.getElementById("solicitudTelefonoContacto").value || null
        };
      }

      if (!formData.ciudad || !formData.descripcion || !formData.nombre_contacto || !formData.email_contacto) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      // Validar email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email_contacto)) {
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

        if (tipo === "oferta") {
          document.getElementById("tab-oferta").querySelector("form").reset();
        } else {
          document.getElementById("tab-solicitud").querySelector("form").reset();
        }
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
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
      document.querySelectorAll(".tipo-toggle button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Solicitudes contactadas";

      app.publicaciones.cargarContactadas();
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
        // Empresa solo ve tab de Oferta
        document.getElementById("tabBtnOferta").style.display = "inline-block";
        document.getElementById("tabBtnSolicitud").style.display = "none";
        document.getElementById("tab-oferta").classList.add("active");
        document.getElementById("tab-solicitud").classList.remove("active");
        document.getElementById("tabBtnOferta").classList.add("active");
        app.publicaciones.cargarEspecialidadesPublicar('oferta');
      } else {
        // Candidato solo ve tab de Solicitud
        document.getElementById("tabBtnOferta").style.display = "none";
        document.getElementById("tabBtnSolicitud").style.display = "inline-block";
        document.getElementById("tab-solicitud").classList.add("active");
        document.getElementById("tab-oferta").classList.remove("active");
        document.getElementById("tabBtnSolicitud").classList.add("active");
        app.publicaciones.cargarEspecialidadesPublicar('solicitud');
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
    },

    abrirDetalleConManejo(publicacion) {
      this.abrirDetalle(publicacion).catch(error => {
        console.error("Error al cargar detalles:", error);
        utils.mostrarAlerta("Error al cargar detalles de la publicación", "error");
      });
    },

    async abrirDetalle(publicacion) {
      estadoApp.publicacionActual = publicacion;

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

      let html = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; width: 30%; color: #0F4C75;">ID:</td>
              <td style="padding: 0.8rem;">${publicacion.id}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">Tipo:</td>
              <td style="padding: 0.8rem;">${publicacion.tipo === 'oferta' ? '📋 Oferta' : '🔍 Solicitud'}</td>
            </tr>
            ${publicacion.usuario_nombre ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">Publicado por:</td>
              <td style="padding: 0.8rem;">${publicacion.usuario_nombre} (${publicacion.usuario_tipo === 'clinica' ? '🏥 Clínica' : '👨‍⚕️ Dentista'})</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📍 Ciudad:</td>
              <td style="padding: 0.8rem;">${publicacion.ciudad}</td>
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
              <td style="padding: 0.8rem;">${publicacion.contrato}</td>
            </tr>
            ` : ''}
            ${publicacion.jornada ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">⏰ Jornada:</td>
              <td style="padding: 0.8rem;">${publicacion.jornada}</td>
            </tr>
            ` : ''}
            ${publicacion.salario ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">💰 Salario:</td>
              <td style="padding: 0.8rem;">${publicacion.salario}</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📅 Publicado:</td>
              <td style="padding: 0.8rem;">${utils.formatearFecha(publicacion.creado_en)}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">👤 Contacto - Nombre:</td>
              <td style="padding: 0.8rem;">${publicacion.nombre_contacto}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📧 Contacto - Email:</td>
              <td style="padding: 0.8rem;"><a href="mailto:${publicacion.email_contacto}" style="color: #0F4C75; text-decoration: none;">${publicacion.email_contacto}</a></td>
            </tr>
            ${publicacion.telefono_contacto ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📞 Contacto - Teléfono:</td>
              <td style="padding: 0.8rem;"><a href="tel:${publicacion.telefono_contacto}" style="color: #0F4C75; text-decoration: none;">${publicacion.telefono_contacto}</a></td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <h4 style="margin: 1rem 0 0.5rem; color: #0F4C75; font-weight: 700;">Descripción</h4>
        <p style="white-space: pre-wrap; line-height: 1.6; background: #fff; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb;">${publicacion.descripcion}</p>

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
      }

      document.getElementById("detalleBody").innerHTML = html;
      document.getElementById("detalleTitle").textContent = publicacion.tipo === "oferta" ? "Oferta de trabajo" : "Solicitud de empleo";

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
            <textarea id="editDescripcion" required>${pub.descripcion}</textarea>
          </div>
          <div class="form-group">
            <label for="editCiudad">Ciudad *</label>
            <input id="editCiudad" type="text" value="${pub.ciudad}" required>
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
            <label for="editContrato">Tipo de contrato</label>
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
            <input id="editSalario" type="text" value="${pub.salario || ''}">
          </div>
          <div class="form-group">
            <label for="editNombreContacto">Nombre de contacto *</label>
            <input id="editNombreContacto" type="text" value="${pub.nombre_contacto}" required>
          </div>
          <div class="form-group">
            <label for="editEmailContacto">Email de contacto *</label>
            <input id="editEmailContacto" type="email" value="${pub.email_contacto}" required>
          </div>
          <div class="form-group">
            <label for="editTelefonoContacto">Teléfono de contacto</label>
            <input id="editTelefonoContacto" type="text" value="${pub.telefono_contacto || ''}">
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
        titulo.textContent = `Candidatos: ${publicacionTitulo}`;
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
          // Para dentistas: usar la misma lógica que mostrarPostulacionesRecibidas
          const postulaciones = await utils.request(`/stats/postulaciones-recibidas-dentista-lista/${estadoApp.usuario.id}`);
          const filtradas = postulaciones.filter(p => p.publicacion_id === publicacionId);
          app.stats.mostrarListaPostulacionesRecibidas(filtradas, `Empresas Interesadas`);
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
                    <strong>${m.remitente_nombre}</strong>
                    <span class="interesado-email">${m.remitente_email}</span>
                  </div>
                  <p class="interesado-mensaje">${m.cuerpo}</p>
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
        let html = "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarClinicasEspecialidad('${(d.especialidad || "Sin especialidad").replace(/'/g, "\\'")}')">
                <strong>${d.especialidad || "Sin especialidad"}</strong>
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
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarClinicasCiudad('${d.ciudad.replace(/'/g, "\\'")}')">
                <strong>${d.ciudad}</strong>
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
        let html = "<div class='desglose-grupos'>";

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
              html += `<div class='desglose-grupo'><h4>${ciudadActual}</h4>`;
            }
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarClinicasCiudadEspecialidad('${d.ciudad.replace(/'/g, "\\'")}', '${(d.especialidad || "Sin especialidad").replace(/'/g, "\\'")}')">
                <strong>${d.especialidad || "Sin especialidad"}</strong>
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
        let html = "<div class='desglose-list'>";

        if (datos.length === 0) {
          html += "<p>Sin datos</p>";
        } else {
          datos.forEach(d => {
            html += `
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarDentistasEspecialidad('${(d.especialidad || "Sin especialidad").replace(/'/g, "\\'")}')">
                <strong>${d.especialidad || "Sin especialidad"}</strong>
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
              <div class="desglose-item desglose-clickable" onclick="app.stats.mostrarDentistasCiudad('${d.ciudad.replace(/'/g, "\\'")}')">
                <strong>${d.ciudad}</strong>
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
        let html = "<div class='desglose-grupos'>";

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
              html += `<div class='desglose-grupo'><h4>${ciudadActual}</h4>`;
            }
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarDentistasCiudadEspecialidad('${d.ciudad.replace(/'/g, "\\'")}', '${(d.especialidad || "Sin especialidad").replace(/'/g, "\\'")}')">
                <strong>${d.especialidad || "Sin especialidad"}</strong>
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
        app.stats.mostrarListaCandidatos(dentistas, `Dentistas - ${especialidad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasCiudad(ciudad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-ciudad-lista/${encodeURIComponent(ciudad)}`);
        app.stats.mostrarListaCandidatos(dentistas, `Dentistas - ${ciudad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDentistasCiudadEspecialidad(ciudad, especialidad) {
      try {
        const dentistas = await utils.request(`/stats/dentistas-por-ciudad-especialidad-lista/${encodeURIComponent(ciudad)}/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaCandidatos(dentistas, `Dentistas - ${ciudad} - ${especialidad}`);
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
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${ciudad}`);
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarClinicasCiudadEspecialidad(ciudad, especialidad) {
      try {
        const clinicas = await utils.request(`/stats/clinicas-por-ciudad-especialidad-lista/${encodeURIComponent(ciudad)}/${encodeURIComponent(especialidad)}`);
        app.stats.mostrarListaClinicas(clinicas, `Clínicas - ${ciudad} - ${especialidad}`);
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
          const clave = `${especialidades}-${ciudad}`;

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

      Object.values(porPublicacion).forEach(pub => {
        const clinicasList = Object.values(pub.clinicas);
        totalClinicas += clinicasList.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${pub.especialidades} - 📍 ${pub.ciudad}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Clínicas coincidentes: ${clinicasList.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        clinicasList.forEach(c => {
          html += `
            <div style="background: white; border-left: 3px solid #0F4C75; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${c.nombre}</strong>
                <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${c.email}</p>
                ${c.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${c.ciudad}</p>` : ''}
              </div>
              <button class="btn-primary" onclick="app.stats.mostrarPerfilClinica(${JSON.stringify(c).replace(/"/g, '&quot;')})" style="white-space: nowrap; margin-left: 1rem;">Ver detalles</button>
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

    mostrarListaClinicas(clinicas, titulo) {
      if (clinicas.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      let html = `<div class="candidatos-list">`;

      clinicas.forEach(c => {
        html += `
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">${c.nombre}</h4>
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📧 Email:</strong> ${c.email}</p>
            ${c.telefono ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📞 Teléfono:</strong> ${c.telefono}</p>` : ''}
            ${c.movil ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📱 Móvil:</strong> ${c.movil}</p>` : ''}
            <p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>📍 Ciudad:</strong> ${c.ciudad}</p>
            ${c.direccion ? `<p style="margin: 0.3rem 0; font-size: 0.9rem; color: #6b7280;"><strong>🏠 Dirección:</strong> ${c.direccion}</p>` : ''}
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${clinicas.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarPerfilClinica(clinica) {
      let html = `
        <div style="padding: 1.5rem;">
          <h3 style="margin-top: 0; color: var(--primary);">${clinica.nombre}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>📧 Email:</strong> ${clinica.email}</p>
            ${clinica.telefono ? `<p><strong>📞 Teléfono:</strong> ${clinica.telefono}</p>` : ''}
            ${clinica.movil ? `<p><strong>📱 Móvil:</strong> ${clinica.movil}</p>` : ''}
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            <p><strong>📍 Ciudad:</strong> ${clinica.ciudad}</p>
            ${clinica.direccion ? `<p><strong>🏠 Dirección:</strong> ${clinica.direccion}</p>` : ''}
            ${clinica.codigo_postal ? `<p><strong>📮 Código Postal:</strong> ${clinica.codigo_postal}</p>` : ''}
            ${clinica.pais ? `<p><strong>🌍 País:</strong> ${clinica.pais}</p>` : ''}
          </div>
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
        const todas = await utils.request("/publicaciones");
        const ofertas = todas.filter(p => p.tipo === 'oferta' && p.activo === 1);

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
          html += `<div class="desglose-grupo"><h4>${ciudad}</h4>`;

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

          const html = app.stats.generarHtmlPostulaciones(postulaciones);
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

    generarHtmlPostulaciones(postulaciones) {
      if (postulaciones.length === 0) {
        return '<div style="padding: 2rem; text-align: center; color: #6b7280;"><p>No hay postulaciones</p></div>';
      }

      let html = `<div class="candidatos-list">`;
      postulaciones.forEach(post => {
        const estadoColor = {'pendiente': '#f59e0b', 'aceptada': '#10b981', 'rechazada': '#ef4444'}[post.estado];
        const tituloPublicacion = post.ciudad || 'Publicación';
        html += `
          <div style="background: white; border: 2px solid ${estadoColor}; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
              <div>
                <h4 style="margin: 0 0 0.3rem 0; color: #0f4c75; font-size: 1.2rem; font-weight: 700;">${tituloPublicacion}</h4>
                ${post.empresa_nombre ? `<p style="margin: 0; color: #6b7280; font-size: 0.95rem;">🏢 ${post.empresa_nombre}</p>` : ''}
              </div>
              <span style="background: ${estadoColor}; color: white; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; text-transform: capitalize; white-space: nowrap;">${post.estado}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; font-size: 0.9rem; color: #6b7280;">
              <p style="margin: 0;"><strong>📍 Ciudad:</strong> ${post.ciudad}</p>
              ${post.contrato ? `<p style="margin: 0;"><strong>📋 Contrato:</strong> ${post.contrato}</p>` : ''}
              ${post.jornada ? `<p style="margin: 0;"><strong>⏰ Jornada:</strong> ${post.jornada}</p>` : ''}
              ${post.salario ? `<p style="margin: 0;"><strong>💰 Salario:</strong> ${post.salario}</p>` : ''}
            </div>
            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 1rem;">
              <p style="margin: 0; color: #6b7280; white-space: pre-wrap; line-height: 1.6; font-size: 0.9rem;">${post.descripcion || 'Sin descripción'}</p>
            </div>
            ${post.mensaje ? `<div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #0ea5e9;">
              <p style="margin: 0; font-size: 0.85rem; color: #0c4a6e; font-weight: 600;">💬 Tu mensaje:</p>
              <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #0c4a6e; white-space: pre-wrap;">${post.mensaje}</p>
            </div>` : ''}
            <button onclick="app.candidaturas.retirarPostulacion(${post.id})" style="margin-top: 1.5rem; background: #ef4444; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600; width: 100%; transition: background 0.2s;">🗑️ Retirar postulación</button>
          </div>
        `;
      });
      html += "</div>";
      return html;
    },

    mostrarListaPostulaciones(postulaciones, titulo) {
      if (postulaciones.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      let html = `<div class="candidatos-list">`;

      postulaciones.forEach(post => {
        const estadoColor = {'pendiente': '#f59e0b', 'aceptada': '#10b981', 'rechazada': '#ef4444'}[post.estado];
        const tituloPublicacion = post.ciudad || 'Publicación';
        html += `
          <div style="background: white; border: 2px solid ${estadoColor}; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
              <div>
                <h4 style="margin: 0 0 0.3rem 0; color: #0f4c75; font-size: 1.2rem; font-weight: 700;">${tituloPublicacion}</h4>
                ${post.empresa_nombre ? `<p style="margin: 0; color: #6b7280; font-size: 0.95rem;">🏢 ${post.empresa_nombre}</p>` : ''}
              </div>
              <span style="background: ${estadoColor}; color: white; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; text-transform: capitalize; white-space: nowrap;">${post.estado}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; font-size: 0.9rem; color: #6b7280;">
              <p style="margin: 0;"><strong>📍 Ciudad:</strong> ${post.ciudad}</p>
              ${post.contrato ? `<p style="margin: 0;"><strong>📋 Contrato:</strong> ${post.contrato}</p>` : ''}
              ${post.jornada ? `<p style="margin: 0;"><strong>⏰ Jornada:</strong> ${post.jornada}</p>` : ''}
              ${post.salario ? `<p style="margin: 0;"><strong>💰 Salario:</strong> ${post.salario}</p>` : ''}
            </div>
            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 1rem;">
              <p style="margin: 0; color: #6b7280; white-space: pre-wrap; line-height: 1.6; font-size: 0.9rem;">${post.descripcion || 'Sin descripción'}</p>
            </div>
            ${post.mensaje ? `<div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #0ea5e9;">
              <p style="margin: 0; font-size: 0.85rem; color: #0c4a6e; font-weight: 600;">💬 Tu mensaje:</p>
              <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; color: #0c4a6e; white-space: pre-wrap;">${post.mensaje}</p>
            </div>` : ''}
            <button onclick="app.candidaturas.retirarPostulacion(${post.id})" style="margin-top: 1.5rem; background: #ef4444; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600; width: 100%; transition: background 0.2s;">🗑️ Retirar postulación</button>
          </div>
        `;
      });

      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = `${titulo} (${postulaciones.length})`;
      document.getElementById("modalInteresados").classList.add("active");
    },

    async mostrarMisPostulacionesDentistas() {
      try {
        const data = await utils.request("/candidaturas/mis-postulaciones");
        const misPostulaciones = data.candidaturas || [];

        // Filtrar solo postulaciones a solicitudes de dentistas
        const postulacionesDentistas = misPostulaciones.filter(p => {
          const pub = estadoApp.publicaciones.find(pub => pub.id === p.publicacion_id);
          return pub && pub.tipo === 'solicitud';
        });

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
        const postulacionesAceptadas = misPostulaciones.filter(p => {
          const pub = estadoApp.publicaciones.find(pub => pub.id === p.publicacion_id);
          return pub && pub.tipo === 'solicitud' && p.estado === 'aceptada';
        });

        app.stats.mostrarListaPostulaciones(postulacionesAceptadas, "Mis Postulaciones a Dentistas Aceptadas");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarMisSolicitudes() {
      try {
        const todas = await utils.request("/publicaciones");
        const misSolicitudes = todas.filter(p => p.tipo === 'solicitud' && p.usuario_id === estadoApp.usuario.id);

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
          html += `<div class="desglose-grupo"><h4>${ciudad}</h4>`;

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
      const titulo = esp ? `${esp.nombre} - ${oferta.ciudad}` : oferta.ciudad;

      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0; color: var(--primary);">${titulo}</h3>

          <div class="info-section">
            <h4>Detalles</h4>
            <p><strong>Ciudad:</strong> ${oferta.ciudad}</p>
            ${esp ? `<p><strong>Especialidades:</strong> ${esp.nombre}</p>` : ''}
            ${oferta.contrato ? `<p><strong>Tipo de contrato:</strong> ${oferta.contrato}</p>` : ''}
            ${oferta.jornada ? `<p><strong>Jornada:</strong> ${oferta.jornada}</p>` : ''}
            ${oferta.salario ? `<p><strong>Salario:</strong> ${oferta.salario}</p>` : ''}
          </div>

          ${oferta.descripcion ? `
          <div class="info-section">
            <h4>Descripción</h4>
            <p style="white-space: pre-wrap;">${oferta.descripcion}</p>
          </div>
          ` : ''}

          ${oferta.nombre_contacto ? `
          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Nombre:</strong> ${oferta.nombre_contacto}</p>
            ${oferta.email_contacto ? `<p><strong>Email:</strong> <a href="mailto:${oferta.email_contacto}">${oferta.email_contacto}</a></p>` : ''}
            ${oferta.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${oferta.telefono_contacto}">${oferta.telefono_contacto}</a></p>` : ''}
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
        const todas = await utils.request("/publicaciones");
        const solicitud = todas.find(p => p.id === solicitudId);

        if (!solicitud) {
          utils.mostrarAlerta("Solicitud no encontrada", "error");
          return;
        }

        const esp = estadoApp.especialidades.find(e => e.id === solicitud.especialidad_id);

        // Obtener mensajes
        const mensajes = await utils.request(`/mensajes/${solicitudId}`);

        const tituloSolicitud = esp ? `${esp.nombre} - ${solicitud.ciudad}` : solicitud.ciudad;

        let html = `
          <div class="perfil-dentista">
            <h3 style="margin-top: 0; color: var(--primary);">${tituloSolicitud}</h3>

            <div class="info-section">
              <h4>Detalles</h4>
              <p><strong>Ciudad:</strong> ${solicitud.ciudad}</p>
              <p><strong>Especialidad:</strong> ${esp?.nombre || 'No especificada'}</p>
              ${solicitud.jornada ? `<p><strong>Disponibilidad:</strong> ${solicitud.jornada}</p>` : ''}
              ${solicitud.salario ? `<p><strong>Salario esperado:</strong> ${solicitud.salario}</p>` : ''}
              ${solicitud.contrato ? `<p><strong>Tipo de contrato:</strong> ${solicitud.contrato}</p>` : ''}
            </div>

            <div class="info-section">
              <h4>Descripción</h4>
              <p style="white-space: pre-wrap;">${solicitud.descripcion}</p>
            </div>

            <div class="info-section">
              <h4>Mi Contacto</h4>
              ${solicitud.nombre_contacto ? `<p><strong>Nombre:</strong> ${solicitud.nombre_contacto}</p>` : ''}
              ${solicitud.email_contacto ? `<p><strong>Email:</strong> <a href="mailto:${solicitud.email_contacto}">${solicitud.email_contacto}</a></p>` : ''}
              ${solicitud.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${solicitud.telefono_contacto}">${solicitud.telefono_contacto}</a></p>` : ''}
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
                <p><strong>De:</strong> ${m.remitente_nombre}</p>
                <p><strong>Email:</strong> <a href="mailto:${m.remitente_email}">${m.remitente_email}</a></p>
                <p style="white-space: pre-wrap; margin-top: 1rem; font-style: italic;">💬 "${m.cuerpo}"</p>
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
          const clave = `${especialidades}-${ciudad}`;

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

      Object.values(porPublicacion).forEach(pub => {
        totalPostulaciones += pub.postulaciones.length;

        html += `
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: #0f4c75; font-size: 1.1rem; font-weight: 700;">
              🦷 ${pub.especialidades} - 📍 ${pub.ciudad}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Clínicas postuladas: ${pub.postulaciones.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        pub.postulaciones.forEach(p => {
          const estadoColor = {'pendiente': '#f59e0b', 'aceptada': '#10b981', 'rechazada': '#ef4444'}[p.estado];
          html += `
            <div style="background: white; border-left: 3px solid ${estadoColor}; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; cursor: pointer;" onclick="app.stats.mostrarDetallePostulacion(${JSON.stringify(p).replace(/"/g, '&quot;')})">
                <div>
                  <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${p.nombre}</strong>
                  <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${p.email}</p>
                  ${p.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${p.ciudad}</p>` : ''}
                </div>
                <span style="background: ${estadoColor}; color: white; padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.75rem; text-transform: capitalize; white-space: nowrap; margin-left: 1rem;">${p.estado}</span>
              </div>
              <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                ${p.estado === 'pendiente' ? `
                  <button onclick="event.stopPropagation(); app.stats.cambiarEstadoCandidatura(${p.id}, 'aceptada')" style="background: #10b981; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">✅ Aceptar</button>
                  <button onclick="event.stopPropagation(); app.stats.cambiarEstadoCandidatura(${p.id}, 'rechazada')" style="background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">❌ Rechazar</button>
                ` : `
                  <button onclick="event.stopPropagation(); app.stats.cambiarEstadoCandidatura(${p.id}, 'pendiente')" style="background: #f59e0b; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">↩️ Deshacer</button>
                `}
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

    mostrarDetallePostulacion(postulacion) {
      let html = `
        <div style="padding: 1.5rem;">
          <h3 style="margin-top: 0; color: var(--primary);">${postulacion.nombre}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>📧 Email:</strong> ${postulacion.email}</p>
            ${postulacion.telefono ? `<p><strong>📞 Teléfono:</strong> ${postulacion.telefono}</p>` : ''}
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            ${postulacion.ciudad ? `<p><strong>📍 Ciudad:</strong> ${postulacion.ciudad}</p>` : ''}
            ${postulacion.direccion ? `<p><strong>🏠 Dirección:</strong> ${postulacion.direccion}</p>` : ''}
            ${postulacion.codigo_postal ? `<p><strong>📮 Código Postal:</strong> ${postulacion.codigo_postal}</p>` : ''}
          </div>

          <div class="info-section">
            <h4>Estado de la Postulación</h4>
            <p><strong>Estado:</strong> ${postulacion.estado}</p>
            ${postulacion.mensaje ? `<p><strong>Mensaje:</strong> ${postulacion.mensaje}</p>` : ''}
          </div>
        </div>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = postulacion.nombre;
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
          const clave = `${especialidades}-${ciudad}`;

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
              🦷 ${pub.especialidades} - 📍 ${pub.ciudad}
            </h4>
            <p style="margin: 0 0 1rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Dentistas coincidentes: ${dentistas.length}</strong></p>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 1rem;">
        `;

        dentistas.forEach(d => {
          html += `
            <div style="background: white; border-left: 3px solid #0F4C75; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #0f4c75; display: block; margin-bottom: 0.3rem;">${d.nombre}</strong>
                <p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📧 ${d.email}</p>
                ${d.ciudad ? `<p style="margin: 0.2rem 0; font-size: 0.9rem; color: #6b7280;">📍 ${d.ciudad}</p>` : ''}
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
            <h4 style="margin: 0 0 0.5rem 0; color: #0f4c75;">📋 Publicación ${idx + 1}</h4>
            <p style="margin: 0 0 1rem 0; color: #1f2937; font-size: 0.9rem;"><strong>🦷 Especialidades:</strong> ${especialidadesText || 'Sin especialidades'} | <strong>📍 Ciudad:</strong> ${oferta.oferta_ciudad}</p>
            <div style="border-top: 1px solid #d1d5db; padding-top: 1rem;">
              <p style="margin: 0 0 0.5rem 0; font-weight: 600; color: #1f2937;">Candidatos (${oferta.candidatos.length})</p>
        `;

        oferta.candidatos.forEach(c => {
          const estadoColor = {'pendiente': '#f59e0b', 'aceptada': '#10b981', 'rechazada': '#ef4444'}[c.estado];
          html += `
            <div style="background: white; padding: 1rem; border-radius: 6px; margin-bottom: 0.75rem; border-left: 3px solid ${estadoColor};">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1; cursor: pointer;" onclick="app.stats.mostrarPerfilDentista(${JSON.stringify(c).replace(/"/g, '&quot;')})">
                  <strong>${c.nombre}</strong>
                  <p style="margin: 0.3rem 0 0 0; font-size: 0.85rem; color: #6b7280;">${c.email}</p>
                  ${c.ciudad ? `<p style="margin: 0.2rem 0 0 0; font-size: 0.85rem; color: #6b7280;">📍 ${c.ciudad}</p>` : ''}
                </div>
                <span style="background: ${estadoColor}; color: white; padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.8rem; text-transform: capitalize; white-space: nowrap; margin-left: 1rem;">${c.estado}</span>
              </div>
              ${c.mensaje ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; padding: 0.75rem; background: #f0f9ff; border-radius: 4px; border-left: 2px solid #0ea5e9; color: #0c4a6e;"><strong>Mensaje:</strong> ${c.mensaje}</p>` : ''}
              <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                ${c.estado === 'pendiente' ? `
                  <button onclick="app.stats.cambiarEstadoCandidatura(${c.id}, 'aceptada')" style="background: #10b981; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">✅ Aceptar</button>
                  <button onclick="app.stats.cambiarEstadoCandidatura(${c.id}, 'rechazada')" style="background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">❌ Rechazar</button>
                ` : `
                  <button onclick="app.stats.cambiarEstadoCandidatura(${c.id}, 'pendiente')" style="background: #6b7280; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">↩️ Deshacer</button>
                `}
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
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; width: 30%; color: #0F4C75;">Nombre:</td>
              <td style="padding: 0.8rem;">${dentista.nombre || '-'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📧 Email:</td>
              <td style="padding: 0.8rem;"><a href="mailto:${dentista.email}" style="color: #0F4C75; text-decoration: none;">${dentista.email || '-'}</a></td>
            </tr>
            ${(dentista.telefono || dentista.movil) ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📞 Teléfono:</td>
              <td style="padding: 0.8rem;"><a href="tel:${dentista.telefono || dentista.movil}" style="color: #0F4C75; text-decoration: none;">${dentista.telefono || dentista.movil}</a></td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📍 Ciudad:</td>
              <td style="padding: 0.8rem;">${dentista.ciudad || '-'}</td>
            </tr>
            ${dentista.direccion ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🏠 Dirección:</td>
              <td style="padding: 0.8rem;">${dentista.direccion}</td>
            </tr>
            ` : ''}
            ${dentista.codigo_postal ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">📮 Código Postal:</td>
              <td style="padding: 0.8rem;">${dentista.codigo_postal}</td>
            </tr>
            ` : ''}
            ${dentista.pais ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🌍 País:</td>
              <td style="padding: 0.8rem;">${dentista.pais}</td>
            </tr>
            ` : ''}
            ${especialidadesText ? `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.8rem; font-weight: 700; background: #F8FAFF; color: #0F4C75;">🦷 Especialidades:</td>
              <td style="padding: 0.8rem;">${especialidadesText}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>
      `;

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = "Perfil: " + dentista.nombre;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarPerfilDentista(dentista) {
      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0;">${dentista.nombre}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Email:</strong> <a href="mailto:${dentista.email}">${dentista.email}</a></p>
            ${(dentista.telefono || dentista.movil) ? `<p><strong>Teléfono:</strong> <a href="tel:${dentista.telefono || dentista.movil}">${dentista.telefono || dentista.movil}</a></p>` : ''}
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            ${dentista.ciudad ? `<p><strong>Ciudad:</strong> ${dentista.ciudad}</p>` : ''}
            ${dentista.direccion ? `<p><strong>Dirección:</strong> ${dentista.direccion}</p>` : ''}
            ${dentista.codigo_postal ? `<p><strong>Código Postal:</strong> ${dentista.codigo_postal}</p>` : ''}
            ${dentista.pais ? `<p><strong>País:</strong> ${dentista.pais}</p>` : ''}
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

    manejarDrop(event, tipo) {
      event.preventDefault();
      const zone = event.currentTarget;
      zone.classList.remove('dragover');

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        const input = tipo === 'cv' ? document.getElementById("cvInput") : document.getElementById("portfolioInput");
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(files[0]);
        input.files = dataTransfer.files;

        if (tipo === 'cv') {
          app.archivos.subirCV();
        } else {
          app.archivos.subirPortfolio();
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
            <p style="font-weight: 700; color: #0F4C75; margin-bottom: 0.5rem;">📄 ${cv.nombre_archivo}</p>
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

      // Renderizar Portfolio
      const portfolioList = document.getElementById("portfolioList");
      if (portfolios.length > 0) {
        portfolioList.innerHTML = portfolios.map(p => `
          <div style="background: #F8FAFF; padding: 1rem; border-radius: 8px; border-left: 4px solid #2ec4b6; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="font-weight: 700; color: #2ec4b6; margin-bottom: 0.3rem;">🎨 ${p.nombre_archivo}</p>
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
  // Módulo: Perfil
  // ============================================

  perfil: {
    async cargar() {
      if (!estadoApp.usuario) return;

      // Mostrar/ocultar tabs según tipo de usuario
      if (estadoApp.tipoUsuario === 'clinica') {
        document.getElementById("tabDatos").style.display = "inline-block";
        document.getElementById("tabCv").style.display = "none";
        document.getElementById("tabPortfolio").style.display = "none";
        document.getElementById("perfilTitle").textContent = "Datos de la Empresa";
      } else {
        document.getElementById("tabDatos").style.display = "inline-block";
        document.getElementById("tabCv").style.display = "inline-block";
        document.getElementById("tabPortfolio").style.display = "inline-block";
        document.getElementById("perfilTitle").textContent = "Mi perfil";
      }

      app.perfil.mostrarFormularioEdicion();

      // Cargar archivos solo para candidatos
      if (estadoApp.tipoUsuario === 'dentista') {
        app.archivos.cargarArchivosUsuario();
      }
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
              <input type="text" id="perfilNombre" value="${u.nombre}" required>
            </div>

            <div class="form-group">
              <label>Email</label>
              <input type="email" id="perfilEmail" value="${u.email}" required>
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Se enviará un email de confirmación al cambiar</small>
            </div>

            <div class="form-group">
              <label>Fijo</label>
              <input type="tel" id="perfilTelefono" value="${u.telefono || ''}">
            </div>

            <div class="form-group">
              <label>Móbil</label>
              <input type="tel" id="perfilMovil" value="${u.movil || ''}">
            </div>

            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="perfilDireccion" value="${u.direccion || ''}">
            </div>

            <div class="form-group">
              <label>Código Postal</label>
              <input type="text" id="perfilCodigoPostal" value="${u.codigo_postal || ''}">
            </div>

            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="perfilCiudad" value="${u.ciudad || ''}">
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" id="perfilPais" value="${u.pais || ''}">
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
        `;

        // Cargar especialidades para empresa
        await app.perfil.cargarEspecialidades();
      } else {
        misDatosContainer.innerHTML = `
          <form id="formPerfilCandidato" onsubmit="app.perfil.guardar(event)">
            <div class="form-group">
              <label>Nombre Completo</label>
              <input type="text" id="perfilNombre" value="${u.nombre}" required>
            </div>

            <div class="form-group">
              <label>Email</label>
              <input type="email" id="perfilEmail" value="${u.email}" required>
              <small style="color: var(--gray-600); margin-top: 0.3rem; display: block;">Se enviará un email de confirmación al cambiar</small>
            </div>

            <div class="form-group">
              <label>Fijo</label>
              <input type="tel" id="perfilTelefono" value="${u.telefono || ''}">
            </div>

            <div class="form-group">
              <label>Móbil</label>
              <input type="tel" id="perfilMovil" value="${u.movil || ''}">
            </div>

            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="perfilDireccion" value="${u.direccion || ''}">
            </div>

            <div class="form-group">
              <label>Código Postal</label>
              <input type="text" id="perfilCodigoPostal" value="${u.codigo_postal || ''}">
            </div>

            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="perfilCiudad" value="${u.ciudad || ''}">
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" id="perfilPais" value="${u.pais || ''}">
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
        `;

        // Cargar especialidades para candidatos
        await app.perfil.cargarEspecialidades();
      }
      } catch (error) {
        utils.mostrarAlerta("Error al cargar perfil: " + error.message, "error");
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
        direccion: document.getElementById("perfilDireccion").value || null,
        codigo_postal: document.getElementById("perfilCodigoPostal").value || null,
        pais: document.getElementById("perfilPais").value || null
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

      // Actualizar stats cada 30 segundos
      this.statsPollingInterval = setInterval(async () => {
        try {
          await app.ui.actualizarStats();
        } catch (error) {
          console.error("Error al actualizar stats:", error);
        }
      }, 30000);
    },

    detenerActualizacionAutomatica() {
      if (this.statsPollingInterval) {
        clearInterval(this.statsPollingInterval);
        this.statsPollingInterval = null;
      }
    },

    async init() {
      await app.especialidades.cargar();

      if (estadoApp.token && estadoApp.usuario) {
        app.ui.mostrarPlataforma();
      } else {
        app.ui.mostrarLanding();
      }
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
      document.getElementById("heroLanding").style.display = "none";
      document.getElementById("heroPlataforma").style.display = "block";
      document.getElementById("statsContainer").style.display = "block";
      document.getElementById("mainContainer").style.display = "block";
      document.getElementById("navButtonsLanding").style.display = "none";
      document.getElementById("navButtonsLogueado").style.display = "flex";
      document.getElementById("btnPublicar").style.display = "inline-block";
      document.getElementById("btnPerfil").style.display = "inline-block";
      document.getElementById("btnLogout").style.display = "inline-block";

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
        document.getElementById("btnMisPostulacionesDentistas").style.display = "none";
        document.getElementById("btnMisPostulacionesDentistasAceptadas").style.display = "none";
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
          const todas = await utils.request("/publicaciones");
          const ofertas = todas.filter(p => p.tipo === 'oferta').length;
          const misPostulaciones = await utils.request(`/stats/mis-postulaciones/${estadoApp.usuario.id}`);
          const clinicasPotenciales = await utils.request(`/stats/clinicas-potenciales/${estadoApp.usuario.id}`);
          const postulacionesRecibidas = await utils.request(`/stats/postulaciones-recibidas-dentista/${estadoApp.usuario.id}`);

          statsGrid.innerHTML = `
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarTotalClinicas()">
              <span>📋</span>
              <h3>${ofertas}</h3>
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
      if (estadoApp.usuario) {
        try {
          const data = await utils.request("/candidaturas/mis-postulaciones");
          misPostulaciones = data.candidaturas || [];
        } catch (error) {
          console.error("Error al cargar postulaciones:", error);
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
        const especialidad = pub.especialidad_id ? estadoApp.especialidades.find(e => e.id === pub.especialidad_id) : null;
        const generatedTitle = especialidad ? `${especialidad.nombre} - ${pub.ciudad}` : `Dentista - ${pub.ciudad}`;
        let tipoBadge, tipoClase;
        if (pub.tipo === "oferta") {
          tipoBadge = "";
          tipoClase = "type-oferta";
        } else {
          // tipo: 'solicitud' (dentistas)
          tipoBadge = "";
          tipoClase = "type-solicitud";
        }

        let interesadosHTML = "";
        // Solo mostrar interesados para solicitudes (dentistas buscando trabajo), no para ofertas (usamos candidaturas)
        if (estadoApp.filtros.soloMias && estadoApp.usuario && pub.usuario_id === estadoApp.usuario.id && pub.tipo === 'solicitud') {
          try {
            const mensajes = await utils.request(`/mensajes/${pub.id}`);
            const interesados = new Set(mensajes.map(m => m.remitente_email)).size;
            interesadosHTML = `
              <button class="btn-interesados" onclick="app.modal.abrirInteresados(${pub.id}, '${pub.tipo}')">
                👥 ${interesados} Empresas
              </button>
            `;
          } catch (error) {
            console.error("Error al obtener mensajes:", error);
          }
        }

        return `
          <div class="card ${tipoClase}">
            <div class="card-header">
              ${tipoBadge ? `<span class="card-type ${tipoClase}">${tipoBadge}</span>` : ""}
            </div>
            <h3>${generatedTitle}</h3>
            <div class="card-details">
              <div class="detail">
                <span class="detail-icon">📍</span>
                <span>${pub.ciudad}</span>
              </div>
              ${especialidad ? `<div class="detail"><span class="detail-icon">🦷</span><span>${especialidad.nombre}</span></div>` : ""}
              ${pub.contrato ? `<div class="detail"><span class="detail-icon">📋</span><span>${pub.contrato}</span></div>` : ""}
              ${pub.jornada ? `<div class="detail"><span class="detail-icon">⏰</span><span>${pub.jornada}</span></div>` : ""}
            </div>
            <div class="badges">
              ${pub.nombre_contacto ? `<span class="badge">${pub.nombre_contacto}</span>` : ""}
              <span class="badge" style="margin-left: auto;">${utils.formatearFecha(pub.creado_en)}</span>
            </div>
            <div class="card-footer" style="display: flex; gap: 0.5rem;">
              <button class="btn-primary" onclick="app.modal.abrirDetalleConManejo(${JSON.stringify(pub).replace(/"/g, '&quot;')})" style="flex: 1;">Ver detalles</button>
              ${(() => {
                if (estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id)) {
                  return `<button class="btn-danger" onclick="app.publicaciones.retirarPublicacion(${pub.id})" style="flex: 1;">🗑️ Retirar</button>`;
                }
                return '';
              })()}
              ${(() => {
                if (estadoApp.tipoUsuario === 'dentista' && pub.tipo === 'oferta') {
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
              ${estadoApp.tipoUsuario === 'clinica' && pub.tipo === 'oferta' && estadoApp.usuario && parseInt(pub.usuario_id) === parseInt(estadoApp.usuario.id) && candidatosPorOferta[pub.id] > 0 ? `<button class="btn-outline" onclick="app.modal.abrirCandidatos(${pub.id}, '${generatedTitle.replace(/'/g, "\\'")}')" style="flex: 1;">👥 Candidatos (${candidatosPorOferta[pub.id]})</button>` : ''}
              ${interesadosHTML}
            </div>
          </div>
        `;
      }));

      container.innerHTML = `<div class="publicaciones">${html.join("")}</div>`;
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
          const estadoColor = {'pendiente': '#f59e0b', 'aceptada': '#10b981', 'rechazada': '#ef4444'}[c.estado];
          return `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;"><div style="display: flex; justify-content: space-between; align-items: start;"><div style="flex: 1;"><h3 style="margin: 0 0 0.5rem 0; color: #1f2937;">${c.titulo}</h3><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Empresa:</strong> ${c.empresa_nombre}</p><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Ciudad:</strong> ${c.ciudad || 'No especificada'}</p><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Contrato:</strong> ${c.contrato} | <strong>Jornada:</strong> ${c.jornada}</p></div><div style="text-align: right;"><span style="background: ${estadoColor}; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.85rem; text-transform: capitalize;">${c.estado}</span><button class="btn-text btn-small" onclick="app.candidaturas.retirarPostulacion(${c.id})" style="margin-top: 0.5rem; display: block;">Retirar</button></div></div></div>`;
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
        // Cerrar modal de detalles si está abierto
        const modalDetalle = document.getElementById("modalDetalle");
        if (modalDetalle) {
          modalDetalle.classList.remove("active");
        }
        // Forzar recarga completa de página
        location.reload();
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
          const estadoColor = {'pendiente': '#f59e0b', 'aceptada': '#10b981', 'rechazada': '#ef4444'}[c.estado];
          return `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;"><div style="display: flex; justify-content: space-between; align-items: start;"><div style="flex: 1;"><h3 style="margin: 0 0 0.5rem 0; color: #1f2937;">${c.nombre}</h3><p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Email:</strong> ${c.email}</p>${c.telefono ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Teléfono:</strong> ${c.telefono}</p>` : ''}${c.movil ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Móvil:</strong> ${c.movil}</p>` : ''}${c.ciudad ? `<p style="margin: 0.3rem 0; color: #6b7280; font-size: 0.9rem;"><strong>Ciudad:</strong> ${c.ciudad}</p>` : ''}${c.mensaje ? `<p style="margin: 0.5rem 0 0 0; padding: 0.75rem; background: #f3f4f6; border-radius: 6px; border-left: 3px solid #2563eb; color: #374151; font-size: 0.9rem;"><strong>Mensaje:</strong> ${c.mensaje}</p>` : ''}</div><div style="text-align: right;"><span style="background: ${estadoColor}; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.85rem; text-transform: capitalize; display: inline-block; margin-bottom: 0.5rem;">${c.estado}</span><div style="display: flex; gap: 0.5rem; flex-direction: column;">${c.estado === 'pendiente' ? `<button class="btn-primary btn-small" onclick="app.candidaturas.actualizarEstado(${c.id}, 'aceptada', ${publicacionId})" style="font-size: 0.85rem;">✓ Aceptar</button><button class="btn-outline btn-small" onclick="app.candidaturas.actualizarEstado(${c.id}, 'rechazada', ${publicacionId})" style="font-size: 0.85rem;">✗ Rechazar</button>` : ''}</div></div></div></div>`;
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
