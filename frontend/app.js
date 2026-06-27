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

      if (!nombre || !email || !password || !direccion || !codigo_postal || !telefono) {
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

      if (!nombre || !email || !password) {
        utils.mostrarAlerta("Por favor completa todos los campos", "error");
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
      if (ciudad && !estadoApp.filtros.soloMias) url += `ciudad=${encodeURIComponent(ciudad)}&`;
      if (especialidad && !estadoApp.filtros.soloMias) url += `especialidad=${especialidad}&`;
      if (contrato && !estadoApp.filtros.soloMias) url += `contrato=${encodeURIComponent(contrato)}&`;
      if (jornada && !estadoApp.filtros.soloMias) url += `jornada=${encodeURIComponent(jornada)}&`;

      try {
        let publicaciones = await utils.request(url.slice(0, -1));

        // Si está marcado "Mis publicaciones", filtrar por usuario actual
        if (estadoApp.filtros.soloMias && estadoApp.usuario) {
          publicaciones = publicaciones.filter(p => p.usuario_id === estadoApp.usuario.id);
        }

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

        formData = {
          tipo: "oferta",
          titulo: document.getElementById("ofertaTitulo").value,
          descripcion: document.getElementById("ofertaDescripcion").value,
          ciudad: document.getElementById("ofertaCiudad").value,
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

        formData = {
          tipo: "solicitud",
          titulo: document.getElementById("solicitudTitulo").value,
          descripcion: document.getElementById("solicitudDescripcion").value,
          ciudad: document.getElementById("solicitudCiudad").value,
          especialidades: especialidades,
          contrato: document.getElementById("solicitudContrato").value || null,
          jornada: document.getElementById("solicitudJornada").value || null,
          nombre_contacto: document.getElementById("solicitudNombreContacto").value,
          email_contacto: document.getElementById("solicitudEmailContacto").value,
          telefono_contacto: document.getElementById("solicitudTelefonoContacto").value || null
        };
      }

      if (!formData.titulo || !formData.ciudad || !formData.descripcion || !formData.nombre_contacto || !formData.email_contacto) {
        utils.mostrarAlerta("Por favor completa todos los campos obligatorios", "error");
        return;
      }

      try {
        // Separar especialidades del formData
        const especialidades = formData.especialidades || [];
        const datosPublicacion = { ...formData };
        delete datosPublicacion.especialidades;

        const respuesta = await utils.request("/publicaciones", {
          method: "POST",
          body: JSON.stringify(datosPublicacion)
        });

        // Si hay especialidades, guardarlas
        if (especialidades.length > 0 && respuesta.id) {
          await utils.request(`/publicaciones/${respuesta.id}/especialidades`, {
            method: "POST",
            body: JSON.stringify({ especialidades })
          });
        }

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
    }
  },

  // ============================================
  // Módulo: Filtros
  // ============================================

  filtros: {
    mostrarTodas() {
      estadoApp.filtros.soloMias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      event.target.classList.add("active");

      // Actualizar título de filtros
      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "Búsquedas de Candidatos";
      } else {
        filtersTitle.textContent = "Ofertas Disponibles";
      }

      app.publicaciones.cargar();
    },

    mostrarMias() {
      estadoApp.filtros.soloMias = true;
      estadoApp.filtros.contactadas = false;
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      event.target.classList.add("active");

      // Actualizar título de filtros
      const filtersTitle = document.getElementById("filtrosTitle");
      if (estadoApp.tipoUsuario === 'clinica') {
        filtersTitle.textContent = "Mis Ofertas";
      } else {
        filtersTitle.textContent = "Mi Búsqueda";
      }

      app.publicaciones.cargar();
    },

    mostrarContactadas() {
      estadoApp.filtros.soloMias = false;
      estadoApp.filtros.contactadas = true;
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      event.target.classList.add("active");

      const filtersTitle = document.getElementById("filtrosTitle");
      filtersTitle.textContent = "Solicitudes contactadas";

      app.publicaciones.cargarContactadas();
    },

    setTipo(tipo) {
      estadoApp.filtros.tipo = tipo;
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      event.target.classList.add("active");

      app.publicaciones.cargar();
    }
  },

  // ============================================
  // Módulo: Modal
  // ============================================

  modal: {
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

    abrirDetalle(publicacion) {
      estadoApp.publicacionActual = publicacion;
      const badges = [];

      if (publicacion.especialidad_id) {
        const especialidad = estadoApp.especialidades.find(e => e.id === publicacion.especialidad_id);
        if (especialidad) badges.push(especialidad.nombre);
      }
      if (publicacion.contrato) badges.push(publicacion.contrato);
      if (publicacion.jornada) badges.push(publicacion.jornada);

      let html = `
        <div class="card-details">
          <div class="detail">
            <span class="detail-icon">📍</span>
            <span>${publicacion.ciudad}</span>
          </div>
      `;

      if (publicacion.salario) {
        html += `
          <div class="detail">
            <span class="detail-icon">💰</span>
            <span>${publicacion.salario}</span>
          </div>
        `;
      }

      html += `
          <div class="detail">
            <span class="detail-icon">📅</span>
            <span>${utils.formatearFecha(publicacion.creado_en)}</span>
          </div>
        </div>

        ${badges.length > 0 ? `<div class="badges">${badges.map(b => `<span class="badge">${b}</span>`).join("")}</div>` : ""}

        <h4 style="margin: 1rem 0 0.5rem; color: #0F4C75; font-weight: 700;">Descripción</h4>
        <p style="white-space: pre-wrap; line-height: 1.6;">${publicacion.descripcion}</p>

        <div id="detalleContacto">
          <h4 style="margin: 1rem 0 0.5rem; color: #0F4C75; font-weight: 700;">Contacto</h4>
          <div style="background: #F8FAFF; padding: 1rem; border-radius: 8px; border-left: 4px solid #0F4C75;">
            <p style="font-weight: 700; color: #0F4C75;">${publicacion.nombre_contacto}</p>
            <p>📧 <a href="mailto:${publicacion.email_contacto}" style="color: #0F4C75; text-decoration: none;">${publicacion.email_contacto}</a></p>
            ${publicacion.telefono_contacto ? `<p>📞 <a href="tel:${publicacion.telefono_contacto}" style="color: #0F4C75; text-decoration: none;">${publicacion.telefono_contacto}</a></p>` : ""}
          </div>
        </div>
      `;

      document.getElementById("detalleBody").innerHTML = html;
      document.getElementById("detalleTitle").textContent = publicacion.tipo === "oferta" ? "Oferta de trabajo" : "Solicitud de empleo";

      // Ocultar botón "Enviar mensaje" y sección de contacto si es propia
      const btnEnviarMensaje = document.getElementById("btnEnviarMensaje");
      const detalleContacto = document.getElementById("detalleContacto");
      if (publicacion.usuario_id === estadoApp.usuario?.id) {
        btnEnviarMensaje.style.display = "none";
        detalleContacto.style.display = "none";
      } else {
        btnEnviarMensaje.style.display = "block";
        detalleContacto.style.display = "block";
      }

      document.getElementById("modalDetalle").classList.add("active");
    },

    cerrarDetalle() {
      document.getElementById("modalDetalle").classList.remove("active");
    },

    abrirContacto() {
      document.getElementById("modalDetalle").classList.remove("active");
      document.getElementById("modalContacto").classList.add("active");
    },

    cerrarContacto() {
      document.getElementById("modalContacto").classList.remove("active");
    },

    async abrirInteresados(publicacionId, tipo) {
      try {
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
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    cerrarInteresados() {
      document.getElementById("modalInteresados").classList.remove("active");
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

    async mostrarDesglosePorEspecialidad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-especialidad");
        let html = "<h3>Dentistas por Especialidad</h3><div class='desglose-list'>";

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
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorCiudad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-ciudad");
        let html = "<h3>Dentistas por Ciudad</h3><div class='desglose-list'>";

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
        document.getElementById("modalInteresados").classList.add("active");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    async mostrarDesglosePorCiudadEspecialidad() {
      try {
        const datos = await utils.request("/stats/dentistas-por-ciudad-especialidad");
        let html = "<h3>Dentistas por Ciudad y Especialidad</h3><div class='desglose-grupos'>";

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

          agrupadoPorCiudad[ciudad].forEach(o => {
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarOfertaCompleta(${JSON.stringify(o).replace(/"/g, '&quot;')})">
                <strong>${o.titulo}</strong>
                <span class="desglose-numero">Oferta</span>
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
            const resp = s.respuestas > 0 ? `${s.respuestas} respuesta${s.respuestas !== 1 ? 's' : ''}` : 'Sin respuestas';
            html += `
              <div class="desglose-item-sub desglose-clickable" onclick="app.stats.mostrarSolicitudConRespuesta(${s.id})">
                <div>
                  <strong>${s.titulo}</strong>
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

      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0; color: var(--primary);">${oferta.titulo}</h3>

          <div class="info-section">
            <h4>Detalles</h4>
            <p><strong>Ciudad:</strong> ${oferta.ciudad}</p>
            <p><strong>Especialidad:</strong> ${esp?.nombre || 'No especificada'}</p>
            ${oferta.contrato ? `<p><strong>Tipo de contrato:</strong> ${oferta.contrato}</p>` : ''}
            ${oferta.jornada ? `<p><strong>Jornada:</strong> ${oferta.jornada}</p>` : ''}
            ${oferta.salario ? `<p><strong>Salario:</strong> ${oferta.salario}</p>` : ''}
          </div>

          <div class="info-section">
            <h4>Descripción</h4>
            <p style="white-space: pre-wrap;">${oferta.descripcion}</p>
          </div>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Nombre:</strong> ${oferta.nombre_contacto}</p>
            <p><strong>Email:</strong> <a href="mailto:${oferta.email_contacto}">${oferta.email_contacto}</a></p>
            ${oferta.telefono_contacto ? `<p><strong>Teléfono:</strong> <a href="tel:${oferta.telefono_contacto}">${oferta.telefono_contacto}</a></p>` : ''}
          </div>
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

        let html = `
          <div class="perfil-dentista">
            <h3 style="margin-top: 0; color: var(--primary);">${solicitud.titulo}</h3>

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
        app.stats.mostrarListaCandidatos(candidatos, "Posibles Candidatos");
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

    async mostrarContactados() {
      try {
        const contactados = await utils.request(`/stats/contactados-lista/${estadoApp.usuario.id}`);
        app.stats.mostrarListaCandidatos(contactados, "Candidatos Contactados");
      } catch (error) {
        utils.mostrarAlerta(error.message, "error");
      }
    },

    mostrarListaCandidatos(candidatos, titulo) {
      if (candidatos.length === 0) {
        utils.mostrarAlerta(`No hay ${titulo.toLowerCase()}`, "info");
        return;
      }

      let html = `<h3>${candidatos.length} ${titulo}</h3><div class="candidatos-list">`;
      candidatos.forEach(c => {
        html += `
          <div class="candidato-item candidato-clickable" onclick="app.stats.mostrarPerfilDentista(${JSON.stringify(c).replace(/"/g, '&quot;')})">
            <div>
              <strong>${c.nombre}</strong>
              <p>${c.email}</p>
              <p style="font-size: 0.85rem; color: var(--gray-600);">📍 ${c.ciudad || 'Sin ciudad'}</p>
            </div>
          </div>
        `;
      });
      html += "</div>";

      document.getElementById("interesadosBody").innerHTML = html;
      document.getElementById("modalInteresados").querySelector(".modal-header h2").textContent = titulo;
      document.getElementById("modalInteresados").classList.add("active");
    },

    mostrarPerfilDentista(dentista) {
      let html = `
        <div class="perfil-dentista">
          <h3 style="margin-top: 0;">${dentista.nombre}</h3>

          <div class="info-section">
            <h4>Contacto</h4>
            <p><strong>Email:</strong> <a href="mailto:${dentista.email}">${dentista.email}</a></p>
            ${dentista.telefono ? `<p><strong>Teléfono:</strong> <a href="tel:${dentista.telefono}">${dentista.telefono}</a></p>` : ''}
          </div>

          <div class="info-section">
            <h4>Ubicación</h4>
            <p><strong>Ciudad:</strong> ${dentista.ciudad || 'No especificada'}</p>
            ${dentista.direccion ? `<p><strong>Dirección:</strong> ${dentista.direccion}</p>` : ''}
            ${dentista.codigo_postal ? `<p><strong>Código Postal:</strong> ${dentista.codigo_postal}</p>` : ''}
            ${dentista.pais ? `<p><strong>País:</strong> ${dentista.pais}</p>` : ''}
          </div>

          ${dentista.especialidad ? `
            <div class="info-section">
              <h4>Especialidad</h4>
              <p><strong>${dentista.especialidad}</strong></p>
            </div>
          ` : ''}
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
        filtersTitle.textContent = "Búsquedas de Candidatos";
        filtersTitle.style.display = "block";
        btnTodas.style.display = "inline-block";
        btnMias.style.display = "inline-block";
        btnContactadas.style.display = "inline-block";
        btnTodas.textContent = "Búsquedas de Candidatos";
        btnMias.textContent = "Mis Ofertas";
      } else {
        // Mostrar nombre + 1 apellido del candidato
        const nombrePartes = (estadoApp.usuario?.nombre || 'Candidato').split(' ');
        const nombreCorto = nombrePartes.length >= 2 ? `${nombrePartes[0]} ${nombrePartes[1]}` : nombrePartes[0];
        heroTitle.textContent = `🦷 ${nombreCorto}`;
        filtersTitle.textContent = "Ofertas Disponibles";
        filtersTitle.style.display = "block";
        btnTodas.style.display = "inline-block";
        btnMias.style.display = "inline-block";
        btnContactadas.style.display = "none";
        btnTodas.textContent = "Ofertas Disponibles";
        btnMias.textContent = "Mi Búsqueda";
      }

      estadoApp.filtros.soloMias = false;
      document.querySelectorAll(".tipo-toggle button").forEach(btn => btn.classList.remove("active"));
      document.getElementById("btnTodas").classList.add("active");

      await app.publicaciones.cargar();
      await app.ui.actualizarStats();
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

          statsGrid.innerHTML = `
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarTotalDentistas()">
              <span>👥</span>
              <h3>${totalDentistas.total}</h3>
              <p>Dentistas Disponibles</p>
              <div class="stat-tooltip">Total de dentistas en la plataforma. Clic para ver desglose por especialidad, ciudad o ambas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarPosiblesCandidatos()">
              <span>🔍</span>
              <h3>${posiblesCandidatos.total}</h3>
              <p>Candidatos Coincidentes</p>
              <div class="stat-tooltip">Dentistas que coinciden con ciudad y especialidad de mis ofertas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarCandidatosInteresados()">
              <span>📧</span>
              <h3>${candidatosInteresados.total}</h3>
              <p>Postulaciones Recibidas</p>
              <div class="stat-tooltip">Dentistas que se han postulado a mis ofertas</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarContactados()">
              <span>✉️</span>
              <h3>${contactados}</h3>
              <p>Candidatos Contactados</p>
              <div class="stat-tooltip">Dentistas a los que hemos enviado un mensaje</div>
            </div>
          `;
        } else {
          // Candidato: mostrar Ofertas disponibles y Mi búsqueda
          const todas = await utils.request("/publicaciones");
          const ofertas = todas.filter(p => p.tipo === 'oferta').length;
          const misSolicitudes = todas.filter(p => p.tipo === 'solicitud' && p.usuario_id === estadoApp.usuario.id);

          statsGrid.innerHTML = `
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarOfertasActivas()">
              <span>📋</span>
              <h3>${ofertas}</h3>
              <p>Ofertas Disponibles</p>
              <div class="stat-tooltip">Ofertas de trabajo disponibles de todas las especialidades y ciudades</div>
            </div>
            <div class="stat-item stat-clickable" onclick="app.stats.mostrarMisSolicitudes()">
              <span>📝</span>
              <h3>${misSolicitudes.length}</h3>
              <p>Mi Búsqueda</p>
              <div class="stat-tooltip">Mi perfil de búsqueda publicado. Clínicas interesadas pueden contactarme</div>
            </div>
          `;
        }
      } catch (error) {
        console.error(error);
      }
    },

    async renderizarPublicaciones() {
      const container = document.getElementById("publicacionesContainer");

      if (estadoApp.publicaciones.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <h3>No hay publicaciones</h3>
            <p>Intenta cambiar los filtros o vuelve más tarde.</p>
          </div>
        `;
        return;
      }

      const html = await Promise.all(estadoApp.publicaciones.map(async pub => {
        const especialidad = pub.especialidad_id ? estadoApp.especialidades.find(e => e.id === pub.especialidad_id) : null;
        const tipoBadge = pub.tipo === "oferta" ? "Oferta" : "Solicitud";
        const tipoClase = pub.tipo === "oferta" ? "type-oferta" : "type-solicitud";

        let interesadosHTML = "";
        if (estadoApp.filtros.soloMias && estadoApp.usuario && pub.usuario_id === estadoApp.usuario.id) {
          try {
            const mensajes = await utils.request(`/mensajes/${pub.id}`);
            const interesados = new Set(mensajes.map(m => m.remitente_email)).size;
            const label = pub.tipo === "oferta" ? "Candidatos" : "Empresas";
            interesadosHTML = `
              <button class="btn-interesados" onclick="app.modal.abrirInteresados(${pub.id}, '${pub.tipo}')">
                👥 ${interesados} ${label}
              </button>
            `;
          } catch (error) {
            console.error("Error al obtener mensajes:", error);
          }
        }

        return `
          <div class="card ${tipoClase}">
            <div class="card-header">
              <span class="card-type ${tipoClase}">${tipoBadge}</span>
            </div>
            <h3>${pub.titulo}</h3>
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
            <div class="card-footer">
              <button class="btn-primary" onclick="app.modal.abrirDetalle(${JSON.stringify(pub).replace(/"/g, '&quot;')})">Ver detalles</button>
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
  }
};

// Cerradores globales de modales (presionando Esc)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal.active").forEach(modal => {
      modal.classList.remove("active");
    });
  }
});

// Cerrador por clic fuera del modal
document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("active");
    }
  });
});

// Inicializar la aplicación
app.ui.init();
