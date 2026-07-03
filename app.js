/* =========================================================================
   Control del Comedor de Personal — Hotel (versión ONLINE con Supabase)
   Requiere config.js con SUPABASE_URL / SUPABASE_ANON_KEY ya cargados,
   y el schema.sql ya ejecutado en el proyecto de Supabase.
   ========================================================================= */

const sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SUPERVISORS = [
  { id: "abrun", name: "Alejandro Brun", role: "Supervisor de cocina" },
  { id: "mmartinez", name: "Mauro Martinez", role: "Supervisor de cocina" },
  { id: "mjimenez", name: "Miguel Jimenez", role: "Supervisor de cocina" },
  { id: "rnieva", name: "Rodrigo Nieva", role: "Supervisor de cocina" },
  { id: "evillasmil", name: "Esteban Villasmil", role: "Sous Chef" },
  { id: "epenzo", name: "Ezequiel Penzo", role: "Chef" },
];

const PM_CHECKPOINTS = [
  { id: "inicio", label: "Inicio de turno", hint: "Al comenzar el turno, 18:00 hs" },
  { id: "durante", label: "Durante el servicio", hint: "En algún momento entre 18:00 y 19:30 hs" },
];

const PM_QUESTIONS = [
  { id: "temperatura", label: "Temperatura de los alimentos" },
  { id: "calidad", label: "Calidad de la comida" },
  { id: "variedad", label: "Variedad" },
  { id: "layout", label: "Layout / presentación del comedor" },
  { id: "sabor", label: "Sabor" },
  { id: "higiene", label: "Higiene y limpieza del comedor" },
  { id: "cantidad", label: "Cantidad / stock suficiente" },
];

const NOCHE_CANTIDAD = { id: "cantidad_noche", label: "Cantidad suficiente para el equipo" };
const NOCHE_HIGIENE = { id: "higiene_noche", label: "Higiene y correcto guardado de la comida" };

const RATING_THRESHOLD = 6; // puntaje <= este valor obliga a completar el detalle

/* ---------------------------- Datos (Supabase) ---------------------------- */

function rowToRegistro(row) {
  return {
    id: row.id,
    turno: row.turno,
    checkpoint: row.checkpoint,
    checkpointLabel: row.checkpoint_label,
    supervisorId: row.supervisor_id,
    supervisorName: row.supervisor_name,
    fecha: row.fecha,
    hora: (row.hora || "").slice(0, 5),
    createdAt: row.created_at,
    observaciones: row.observaciones || "",
    checklistMenu: row.checklist_menu || null,
    respuestas: row.respuestas || [],
    fotos: row.fotos || [],
  };
}

async function loadRegistros() {
  const { data, error } = await sbClient
    .from("registros")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Error cargando registros de Supabase", error);
    throw error;
  }
  return (data || []).map(rowToRegistro);
}

async function saveRegistro(registro) {
  const row = {
    turno: registro.turno,
    checkpoint: registro.checkpoint,
    checkpoint_label: registro.checkpointLabel,
    supervisor_id: registro.supervisorId,
    supervisor_name: registro.supervisorName,
    fecha: registro.fecha,
    hora: registro.hora,
    observaciones: registro.observaciones || "",
    checklist_menu: registro.checklistMenu || null,
    respuestas: registro.respuestas,
    fotos: registro.fotos,
  };
  const { error } = await sbClient.from("registros").insert(row);
  if (error) {
    console.error("Error guardando registro en Supabase", error);
    throw error;
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowParts() {
  const d = new Date();
  const fecha = d.toISOString().slice(0, 10);
  const hora = d.toTimeString().slice(0, 5);
  return { fecha, hora, iso: d.toISOString() };
}

function formatFechaDisplay(fechaISO) {
  const [y, m, d] = fechaISO.split("-");
  return `${d}/${m}/${y}`;
}

function supervisorName(id) {
  const s = SUPERVISORS.find((s) => s.id === id);
  return s ? s.name : id;
}

/* ------------------------------ Fotos (Supabase Storage) ---------------------------- */

// Redimensiona y comprime la imagen en el navegador antes de subirla
// (ahorra datos móviles y espacio en el bucket de Storage).
function readAndCompressImage(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round(height * (maxDim / width));
              width = maxDim;
            } else {
              width = Math.round(width * (maxDim / height));
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          resolve(e.target.result);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Campo reutilizable de carga de fotos: botón de cámara + botón de galería +
// galería de miniaturas con estado de "subiendo" y botón para quitar.
// Cada foto se sube a Supabase Storage apenas se selecciona; getFotos()
// devuelve el estado actual (incluye las que todavía están subiendo).
function buildPhotoField(idSuffix) {
  let fotos = []; // [{ id, previewDataUrl, url, uploading, error }]
  const gallery = el("div", { class: "photo-gallery" });

  function renderGallery() {
    gallery.innerHTML = "";
    fotos.forEach((f) => {
      const img = el("img", {
        src: f.previewDataUrl,
        onclick: () => {
          if (f.url && typeof window !== "undefined" && window.open) window.open(f.url, "_blank");
        },
      });
      const removeBtn = el(
        "button",
        {
          type: "button",
          class: "photo-remove",
          title: "Quitar foto",
          onclick: () => {
            fotos = fotos.filter((x) => x.id !== f.id);
            renderGallery();
          },
        },
        "×"
      );
      const thumbChildren = [img, removeBtn];
      if (f.uploading) {
        thumbChildren.push(el("div", { class: "photo-status" }, "Subiendo..."));
      } else if (f.error) {
        thumbChildren.push(el("div", { class: "photo-status error" }, "Error al subir"));
      }
      gallery.appendChild(el("div", { class: "photo-thumb" }, thumbChildren));
    });
  }

  async function processFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const entry = { id: uid(), previewDataUrl: null, url: null, uploading: true, error: false };
      try {
        entry.previewDataUrl = await readAndCompressImage(file);
      } catch (err) {
        console.error("No se pudo procesar la imagen", err);
        continue;
      }
      fotos.push(entry);
      renderGallery();

      try {
        const blob = await (await fetch(entry.previewDataUrl)).blob();
        const path = `${idSuffix}/${Date.now()}-${entry.id}.jpg`;
        const { error: uploadError } = await sbClient.storage
          .from(PHOTOS_BUCKET)
          .upload(path, blob, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;
        const { data: pub } = sbClient.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
        entry.url = pub.publicUrl;
        entry.uploading = false;
      } catch (err) {
        console.error("No se pudo subir la foto", err);
        entry.uploading = false;
        entry.error = true;
      }
      renderGallery();
    }
  }

  const cameraInput = el("input", {
    type: "file",
    accept: "image/*",
    capture: "environment",
    id: "photo-camera-" + idSuffix,
    style: "display:none",
    onchange: async (e) => {
      await processFiles(e.target.files);
      e.target.value = "";
    },
  });

  const galleryInput = el("input", {
    type: "file",
    accept: "image/*",
    multiple: "multiple",
    id: "photo-gallery-" + idSuffix,
    style: "display:none",
    onchange: async (e) => {
      await processFiles(e.target.files);
      e.target.value = "";
    },
  });

  const cameraBtn = el(
    "button",
    { type: "button", class: "btn secondary photo-btn", onclick: () => cameraInput.click() },
    "📷 Tomar foto"
  );

  const galleryBtn = el(
    "button",
    { type: "button", class: "btn secondary photo-btn", onclick: () => galleryInput.click() },
    "🖼️ Elegir de galería"
  );

  const wrapper = el("div", { class: "field" }, [
    el("label", {}, ["Fotos del comedor ", el("span", { class: "required-mark" }, "*")]),
    el("div", { class: "photo-buttons" }, [cameraBtn, galleryBtn, cameraInput, galleryInput]),
    el("div", { class: "hint" }, [
      el("span", { class: "required-mark" }, "*"),
      " Obligatorio: subí al menos 1 foto antes de guardar.",
    ]),
    gallery,
  ]);

  return {
    wrapper,
    getFotos: () => fotos,
    // Fotos ya subidas con éxito, listas para guardar en el registro.
    getUploadedFotos: () => fotos.filter((f) => f.url).map((f) => ({ id: f.id, url: f.url })),
  };
}

/* ---------------------------------- Estado ---------------------------------- */

let state = { view: "home", params: {} };

function goTo(view, params = {}) {
  state = { view, params };
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------------------------- Render ----------------------------------- */

const app = document.getElementById("app");

function render() {
  app.innerHTML = "";
  switch (state.view) {
    case "home":
      renderHome();
      break;
    case "pm-setup":
      renderPmSetup();
      break;
    case "pm-form":
      renderPmForm();
      break;
    case "noche-setup":
      renderNocheSetup();
      break;
    case "noche-form":
      renderNocheForm();
      break;
    case "success":
      renderSuccess();
      break;
    case "historial":
      renderHistorial();
      break;
    default:
      renderHome();
  }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

/* ------------------------------------ Home ------------------------------------ */

function renderHome() {
  const hero = el("div", { class: "hero" }, [
    el("p", {}, "Registro de control del comedor de personal — Hotel"),
  ]);

  const pmCard = el(
    "div",
    { class: "choice-card", onclick: () => goTo("pm-setup") },
    [
      el("span", { class: "badge" }, "Turno PM · 18:00 a 19:30 hs"),
      el("h3", {}, "Control turno PM"),
      el("p", {}, "Registro al inicio del turno y durante el servicio de comida: temperatura, calidad, variedad, layout, sabor, higiene y stock."),
    ]
  );

  const nocheCard = el(
    "div",
    { class: "choice-card", onclick: () => goTo("noche-setup") },
    [
      el("span", { class: "badge" }, "Turno Noche"),
      el("h3", {}, "Control turno Noche"),
      el("p", {}, "Verificación de la comida dejada en la heladera para el equipo: platos del menú, cantidad e higiene de guardado."),
    ]
  );

  app.appendChild(hero);
  app.appendChild(el("div", { class: "choice-grid" }, [pmCard, nocheCard]));
}

/* --------------------------------- PM: setup ---------------------------------- */

function renderPmSetup() {
  const supervisorSelect = el(
    "select",
    { id: "sup-select" },
    [el("option", { value: "" }, "Seleccionar supervisor...")].concat(
      SUPERVISORS.map((s) => el("option", { value: s.id }, `${s.name} (${s.role})`))
    )
  );

  const checkpointSelect = el(
    "select",
    { id: "cp-select" },
    [el("option", { value: "" }, "Seleccionar momento...")].concat(
      PM_CHECKPOINTS.map((c) => el("option", { value: c.id }, `${c.label} — ${c.hint}`))
    )
  );

  const errorBox = el("div", { class: "error-msg", style: "display:none" }, "");

  const card = el("div", { class: "card" }, [
    el("h2", {}, "Turno PM (18:00 a 19:30 hs)"),
    el("p", { class: "hint", style: "color:#667085;margin-top:-8px;" }, "Elegí quién completa el control y en qué momento del turno."),
    errorBox,
    el("div", { class: "field" }, [el("label", {}, "Supervisor"), supervisorSelect]),
    el("div", { class: "field" }, [el("label", {}, "Momento del control"), checkpointSelect]),
    el("div", { class: "actions" }, [
      el("button", { class: "btn secondary", onclick: () => goTo("home") }, "Volver"),
      el(
        "button",
        {
          class: "btn",
          onclick: () => {
            const sup = supervisorSelect.value;
            const cp = checkpointSelect.value;
            if (!sup || !cp) {
              errorBox.textContent = "Completá el supervisor y el momento del control.";
              errorBox.style.display = "block";
              return;
            }
            goTo("pm-form", { supervisorId: sup, checkpoint: cp });
          },
        },
        "Comenzar control"
      ),
    ]),
  ]);

  app.appendChild(card);
}

/* --------------------------------- PM: form ------------------------------------ */

function renderPmForm() {
  const { supervisorId, checkpoint } = state.params;
  const cpInfo = PM_CHECKPOINTS.find((c) => c.id === checkpoint);

  const answers = {};
  PM_QUESTIONS.forEach((q) => (answers[q.id] = { puntaje: null, detalle: "" }));
  let observaciones = "";

  const errorBox = el("div", { class: "error-msg", style: "display:none" }, "");

  function buildQuestion(q) {
    const scoreLabel = el("span", { class: "score-label" }, "Sin puntaje");
    const buttonsWrap = el("div", { class: "score-buttons" });
    const detail = el("textarea", {
      placeholder: "Detalle (opcional)",
      oninput: (e) => {
        answers[q.id].detalle = e.target.value;
      },
    });
    const detailHint = el("div", { class: "hint" }, "Opcional.");

    for (let i = 1; i <= 10; i++) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "score-btn",
          onclick: () => {
            answers[q.id].puntaje = i;
            [...buttonsWrap.children].forEach((b) => b.classList.remove("selected", "low"));
            btn.classList.add("selected");
            const low = i <= RATING_THRESHOLD;
            if (low) btn.classList.add("low");
            scoreLabel.textContent = `Puntaje: ${i}/10`;
            scoreLabel.className = "score-label " + (low ? "low" : "high");
            block.classList.toggle("alert", low);
            detailHint.innerHTML = low
              ? '<span class="required-mark">*</span> Obligatorio: puntaje 6 o menos requiere detalle.'
              : "Opcional.";
            detail.required = low;
          },
        },
        String(i)
      );
      buttonsWrap.appendChild(btn);
    }

    const block = el("div", { class: "question-block" }, [
      el("div", { class: "question-title" }, [el("span", {}, q.label), scoreLabel]),
      buttonsWrap,
      detail,
      detailHint,
    ]);
    return block;
  }

  const questionsWrap = el("div", {}, PM_QUESTIONS.map(buildQuestion));

  const obsField = el("textarea", {
    placeholder: "Observaciones generales (opcional)",
    oninput: (e) => (observaciones = e.target.value),
  });

  const photoField = buildPhotoField("pm");
  const registroTime = nowParts();

  const saveBtn = el(
    "button",
    {
      class: "btn",
      onclick: async () => {
        const missing = [];
        const missingDetail = [];
        PM_QUESTIONS.forEach((q) => {
          const a = answers[q.id];
          if (a.puntaje === null) missing.push(q.label);
          else if (a.puntaje <= RATING_THRESHOLD && !a.detalle.trim()) missingDetail.push(q.label);
        });
        if (missing.length) {
          errorBox.textContent = "Falta puntuar: " + missing.join(", ");
          errorBox.style.display = "block";
          return;
        }
        if (missingDetail.length) {
          errorBox.textContent = "Puntaje 6 o menos requiere detalle en: " + missingDetail.join(", ");
          errorBox.style.display = "block";
          return;
        }
        const fotosState = photoField.getFotos();
        if (fotosState.length === 0) {
          errorBox.textContent = "Subí al menos una foto del comedor antes de guardar.";
          errorBox.style.display = "block";
          return;
        }
        if (fotosState.some((f) => f.uploading)) {
          errorBox.textContent = "Esperá a que terminen de subir las fotos.";
          errorBox.style.display = "block";
          return;
        }
        if (fotosState.some((f) => f.error)) {
          errorBox.textContent = "Alguna foto no se pudo subir — quitala (×) o volvé a intentar antes de guardar.";
          errorBox.style.display = "block";
          return;
        }
        const fotos = photoField.getUploadedFotos();
        if (fotos.length === 0) {
          errorBox.textContent = "Subí al menos una foto del comedor antes de guardar.";
          errorBox.style.display = "block";
          return;
        }
        errorBox.style.display = "none";

        const { fecha, hora } = nowParts();
        const registro = {
          turno: "PM",
          checkpoint: checkpoint,
          checkpointLabel: cpInfo.label,
          supervisorId,
          supervisorName: supervisorName(supervisorId),
          fecha,
          hora,
          observaciones,
          respuestas: PM_QUESTIONS.map((q) => ({
            id: q.id,
            label: q.label,
            puntaje: answers[q.id].puntaje,
            detalle: answers[q.id].detalle.trim(),
          })),
          fotos,
        };

        saveBtn.disabled = true;
        saveBtn.textContent = "Guardando...";
        try {
          await saveRegistro(registro);
          goTo("success", { turno: "PM", fecha, hora });
        } catch (err) {
          errorBox.textContent = "No se pudo guardar (revisá tu conexión a internet). Volvé a intentar.";
          errorBox.style.display = "block";
          saveBtn.disabled = false;
          saveBtn.textContent = "Guardar control";
        }
      },
    },
    "Guardar control"
  );

  const card = el("div", { class: "card" }, [
    el("h2", {}, `Turno PM — ${cpInfo.label}`),
    el(
      "p",
      { style: "color:#667085;margin-top:-8px;" },
      `Supervisor: ${supervisorName(supervisorId)} · ${cpInfo.hint}`
    ),
    el(
      "p",
      { class: "hint" },
      `Se va a registrar con la fecha y hora del momento en que guardes el control (ahora: ${formatFechaDisplay(registroTime.fecha)} · ${registroTime.hora} hs).`
    ),
    errorBox,
    questionsWrap,
    el("div", { class: "field" }, [el("label", {}, "Observaciones generales"), obsField]),
    photoField.wrapper,
    el("div", { class: "actions" }, [
      el("button", { class: "btn secondary", onclick: () => goTo("pm-setup") }, "Volver"),
      saveBtn,
    ]),
  ]);

  app.appendChild(card);
}

/* -------------------------------- Noche: setup --------------------------------- */

function renderNocheSetup() {
  const supervisorSelect = el(
    "select",
    { id: "sup-select-noche" },
    [el("option", { value: "" }, "Seleccionar supervisor...")].concat(
      SUPERVISORS.map((s) => el("option", { value: s.id }, `${s.name} (${s.role})`))
    )
  );

  const errorBox = el("div", { class: "error-msg", style: "display:none" }, "");

  const card = el("div", { class: "card" }, [
    el("h2", {}, "Turno Noche"),
    el(
      "p",
      { style: "color:#667085;margin-top:-8px;" },
      "Verificación de la comida dejada en la heladera para que el equipo se la caliente."
    ),
    errorBox,
    el("div", { class: "field" }, [el("label", {}, "Supervisor"), supervisorSelect]),
    el("div", { class: "actions" }, [
      el("button", { class: "btn secondary", onclick: () => goTo("home") }, "Volver"),
      el(
        "button",
        {
          class: "btn",
          onclick: () => {
            const sup = supervisorSelect.value;
            if (!sup) {
              errorBox.textContent = "Seleccioná el supervisor.";
              errorBox.style.display = "block";
              return;
            }
            goTo("noche-form", { supervisorId: sup });
          },
        },
        "Comenzar control"
      ),
    ]),
  ]);

  app.appendChild(card);
}

/* -------------------------------- Noche: form ---------------------------------- */

function renderNocheForm() {
  const { supervisorId } = state.params;

  let menuCompleto = null;
  let faltantes = "";
  const cantidad = { puntaje: null, detalle: "" };
  const higiene = { puntaje: null, detalle: "" };
  let observaciones = "";

  const errorBox = el("div", { class: "error-msg", style: "display:none" }, "");

  const faltantesTextarea = el("textarea", {
    placeholder: "Detalle qué platos o ítems faltan...",
    style: "display:none",
    oninput: (e) => (faltantes = e.target.value),
  });
  const faltantesHint = el("div", { class: "hint", style: "display:none" }, [
    el("span", { class: "required-mark" }, "*"),
    " Obligatorio si falta algún plato o ítem.",
  ]);

  const radioSi = el("input", { type: "radio", name: "menu-completo", value: "si" });
  const radioNo = el("input", { type: "radio", name: "menu-completo", value: "no" });
  radioSi.addEventListener("change", () => {
    menuCompleto = true;
    faltantesTextarea.style.display = "none";
    faltantesHint.style.display = "none";
    faltantesTextarea.required = false;
  });
  radioNo.addEventListener("change", () => {
    menuCompleto = false;
    faltantesTextarea.style.display = "block";
    faltantesHint.style.display = "block";
    faltantesTextarea.required = true;
  });

  const menuBlock = el("div", { class: "question-block" }, [
    el("div", { class: "question-title" }, [
      el("span", {}, "¿Están todos los platos/ítems del menú del día?"),
    ]),
    el("div", { class: "radio-group" }, [
      el("label", {}, [radioSi, " Sí, está completo"]),
      el("label", {}, [radioNo, " No, falta algo"]),
    ]),
    faltantesTextarea,
    faltantesHint,
  ]);

  function buildRatingBlock(q, target) {
    const scoreLabel = el("span", { class: "score-label" }, "Sin puntaje");
    const buttonsWrap = el("div", { class: "score-buttons" });
    const detail = el("textarea", {
      placeholder: "Detalle (opcional)",
      oninput: (e) => (target.detalle = e.target.value),
    });
    const detailHint = el("div", { class: "hint" }, "Opcional.");

    for (let i = 1; i <= 10; i++) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "score-btn",
          onclick: () => {
            target.puntaje = i;
            [...buttonsWrap.children].forEach((b) => b.classList.remove("selected", "low"));
            btn.classList.add("selected");
            const low = i <= RATING_THRESHOLD;
            if (low) btn.classList.add("low");
            scoreLabel.textContent = `Puntaje: ${i}/10`;
            scoreLabel.className = "score-label " + (low ? "low" : "high");
            block.classList.toggle("alert", low);
            detailHint.innerHTML = low
              ? '<span class="required-mark">*</span> Obligatorio: puntaje 6 o menos requiere detalle.'
              : "Opcional.";
            detail.required = low;
          },
        },
        String(i)
      );
      buttonsWrap.appendChild(btn);
    }

    const block = el("div", { class: "question-block" }, [
      el("div", { class: "question-title" }, [el("span", {}, q.label), scoreLabel]),
      buttonsWrap,
      detail,
      detailHint,
    ]);
    return block;
  }

  const cantidadBlock = buildRatingBlock(NOCHE_CANTIDAD, cantidad);
  const higieneBlock = buildRatingBlock(NOCHE_HIGIENE, higiene);

  const obsField = el("textarea", {
    placeholder: "Observaciones generales (opcional)",
    oninput: (e) => (observaciones = e.target.value),
  });

  const photoField = buildPhotoField("noche");
  const registroTime = nowParts();

  const saveBtn = el(
    "button",
    {
      class: "btn",
      onclick: async () => {
        const errors = [];
        if (menuCompleto === null) errors.push("Indicá si el menú está completo.");
        if (menuCompleto === false && !faltantes.trim())
          errors.push("Detallá qué platos o ítems faltan.");
        if (cantidad.puntaje === null) errors.push("Puntuá la cantidad suficiente.");
        if (cantidad.puntaje !== null && cantidad.puntaje <= RATING_THRESHOLD && !cantidad.detalle.trim())
          errors.push("Detallá el motivo del puntaje bajo en cantidad.");
        if (higiene.puntaje === null) errors.push("Puntuá la higiene y guardado.");
        if (higiene.puntaje !== null && higiene.puntaje <= RATING_THRESHOLD && !higiene.detalle.trim())
          errors.push("Detallá el motivo del puntaje bajo en higiene.");

        const fotosState = photoField.getFotos();
        if (fotosState.length === 0) errors.push("Subí al menos una foto del comedor.");
        if (fotosState.some((f) => f.uploading)) errors.push("Esperá a que terminen de subir las fotos.");
        if (fotosState.some((f) => f.error)) errors.push("Alguna foto no se pudo subir — quitala o reintentá.");

        if (errors.length) {
          errorBox.innerHTML = errors.join("<br/>");
          errorBox.style.display = "block";
          return;
        }
        const fotos = photoField.getUploadedFotos();
        if (fotos.length === 0) {
          errorBox.textContent = "Subí al menos una foto del comedor.";
          errorBox.style.display = "block";
          return;
        }
        errorBox.style.display = "none";

        const { fecha, hora } = nowParts();
        const registro = {
          turno: "NOCHE",
          checkpoint: "unico",
          checkpointLabel: "Verificación de heladera",
          supervisorId,
          supervisorName: supervisorName(supervisorId),
          fecha,
          hora,
          observaciones,
          checklistMenu: { completo: menuCompleto, faltantes: faltantes.trim() },
          respuestas: [
            { id: NOCHE_CANTIDAD.id, label: NOCHE_CANTIDAD.label, puntaje: cantidad.puntaje, detalle: cantidad.detalle.trim() },
            { id: NOCHE_HIGIENE.id, label: NOCHE_HIGIENE.label, puntaje: higiene.puntaje, detalle: higiene.detalle.trim() },
          ],
          fotos,
        };

        saveBtn.disabled = true;
        saveBtn.textContent = "Guardando...";
        try {
          await saveRegistro(registro);
          goTo("success", { turno: "NOCHE", fecha, hora });
        } catch (err) {
          errorBox.textContent = "No se pudo guardar (revisá tu conexión a internet). Volvé a intentar.";
          errorBox.style.display = "block";
          saveBtn.disabled = false;
          saveBtn.textContent = "Guardar control";
        }
      },
    },
    "Guardar control"
  );

  const card = el("div", { class: "card" }, [
    el("h2", {}, "Turno Noche — Verificación de heladera"),
    el(
      "p",
      { style: "color:#667085;margin-top:-8px;" },
      `Supervisor: ${supervisorName(supervisorId)}`
    ),
    el(
      "p",
      { class: "hint" },
      `Se va a registrar con la fecha y hora del momento en que guardes el control (ahora: ${formatFechaDisplay(registroTime.fecha)} · ${registroTime.hora} hs).`
    ),
    errorBox,
    menuBlock,
    cantidadBlock,
    higieneBlock,
    el("div", { class: "field" }, [el("label", {}, "Observaciones generales"), obsField]),
    photoField.wrapper,
    el("div", { class: "actions" }, [
      el("button", { class: "btn secondary", onclick: () => goTo("noche-setup") }, "Volver"),
      saveBtn,
    ]),
  ]);

  app.appendChild(card);
}

/* ---------------------------------- Success ------------------------------------ */

function renderSuccess() {
  const { fecha, hora } = state.params;
  const timestampText =
    fecha && hora
      ? `Guardado el ${formatFechaDisplay(fecha)} a las ${hora} hs.`
      : "El registro quedó guardado.";
  const box = el("div", { class: "card success-box" }, [
    el("div", { class: "icon" }, "✓"),
    el("h2", {}, "Control guardado"),
    el("p", { style: "color:#667085;" }, timestampText),
    el("div", { class: "actions", style: "justify-content:center;" }, [
      el("button", { class: "btn secondary", onclick: () => goTo("home") }, "Volver al inicio"),
      el("button", { class: "btn", onclick: () => goTo("historial") }, "Ver historial"),
    ]),
  ]);
  app.appendChild(box);
}

/* --------------------------------- Historial ----------------------------------- */

function renderHistorial() {
  const loadingBox = el("div", { class: "card" }, [
    el("p", { style: "text-align:center;color:#667085;" }, "Cargando historial..."),
  ]);
  app.appendChild(loadingBox);

  loadRegistros()
    .then((all) => {
      app.innerHTML = "";
      renderHistorialContent(all);
    })
    .catch(() => {
      app.innerHTML = "";
      app.appendChild(
        el("div", { class: "card" }, [
          el("div", { class: "error-msg" }, "No se pudo cargar el historial (revisá tu conexión a internet)."),
          el("button", { class: "btn secondary", onclick: () => goTo("historial") }, "Reintentar"),
        ])
      );
    });
}

function renderHistorialContent(all) {
  const turnoFilter = el("select", { id: "f-turno" }, [
    el("option", { value: "" }, "Todos los turnos"),
    el("option", { value: "PM" }, "Turno PM"),
    el("option", { value: "NOCHE" }, "Turno Noche"),
  ]);
  const supFilter = el(
    "select",
    { id: "f-sup" },
    [el("option", { value: "" }, "Todos los supervisores")].concat(
      SUPERVISORS.map((s) => el("option", { value: s.id }, s.name))
    )
  );
  const dateFilter = el("input", { type: "date", id: "f-fecha" });

  const tableWrap = el("div", { class: "table-wrap" });

  function hasAlert(r) {
    if (r.respuestas.some((a) => a.puntaje !== null && a.puntaje <= RATING_THRESHOLD)) return true;
    if (r.checklistMenu && r.checklistMenu.completo === false) return true;
    return false;
  }

  function applyFilters() {
    let list = all;
    if (turnoFilter.value) list = list.filter((r) => r.turno === turnoFilter.value);
    if (supFilter.value) list = list.filter((r) => r.supervisorId === supFilter.value);
    if (dateFilter.value) list = list.filter((r) => r.fecha === dateFilter.value);
    renderTable(list);
  }

  function renderTable(list) {
    tableWrap.innerHTML = "";
    if (!list.length) {
      tableWrap.appendChild(el("div", { class: "empty-state" }, "No hay registros para estos filtros."));
      return;
    }

    const table = el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Fecha / Hora"),
          el("th", {}, "Turno"),
          el("th", {}, "Momento"),
          el("th", {}, "Supervisor"),
          el("th", {}, "Estado"),
          el("th", {}, ""),
        ]),
      ]),
    ]);
    const tbody = el("tbody", {});

    list.forEach((r) => {
      const alert = hasAlert(r);
      const row = el("tr", { class: alert ? "has-alert" : "" }, [
        el("td", {}, `${formatFechaDisplay(r.fecha)} · ${r.hora} hs`),
        el("td", {}, el("span", { class: "pill " + (r.turno === "PM" ? "pm" : "noche") }, r.turno)),
        el("td", {}, r.checkpointLabel),
        el("td", {}, r.supervisorName),
        el("td", {}, el("span", { class: "pill " + (alert ? "alert" : "ok") }, alert ? "Con alertas" : "OK")),
        el("td", {}, el("button", { class: "detail-toggle" }, "Ver detalle")),
      ]);

      const detailRow = el("tr", { style: "display:none;" }, [
        el("td", { colspan: "6" }, buildDetail(r)),
      ]);

      row.querySelector(".detail-toggle").addEventListener("click", () => {
        const visible = detailRow.style.display !== "none";
        detailRow.style.display = visible ? "none" : "table-row";
        row.querySelector(".detail-toggle").textContent = visible ? "Ver detalle" : "Ocultar detalle";
      });

      tbody.appendChild(row);
      tbody.appendChild(detailRow);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  function buildDetail(r) {
    const wrap = el("div", { style: "padding:10px 0;" });
    if (r.checklistMenu) {
      wrap.appendChild(
        el(
          "p",
          {},
          `Menú del día completo: ${r.checklistMenu.completo ? "Sí" : "No"}` +
            (r.checklistMenu.completo === false && r.checklistMenu.faltantes
              ? ` — Falta: ${r.checklistMenu.faltantes}`
              : "")
        )
      );
    }
    r.respuestas.forEach((a) => {
      const low = a.puntaje !== null && a.puntaje <= RATING_THRESHOLD;
      wrap.appendChild(
        el("p", {}, [
          el("strong", {}, `${a.label}: `),
          el("span", { class: low ? "pill alert" : "pill ok" }, `${a.puntaje}/10`),
          a.detalle ? el("span", {}, ` — ${a.detalle}`) : null,
        ])
      );
    });
    if (r.observaciones) {
      wrap.appendChild(el("p", {}, [el("strong", {}, "Observaciones: "), r.observaciones]));
    }
    if (r.fotos && r.fotos.length) {
      const gallery = el(
        "div",
        { class: "photo-gallery" },
        r.fotos.map((f) =>
          el("div", { class: "photo-thumb" }, [
            el("img", {
              src: f.url,
              onclick: () => {
                if (typeof window !== "undefined" && window.open) window.open(f.url, "_blank");
              },
            }),
          ])
        )
      );
      wrap.appendChild(el("p", {}, el("strong", {}, `Fotos (${r.fotos.length}):`)));
      wrap.appendChild(gallery);
    }
    return wrap;
  }

  turnoFilter.addEventListener("change", applyFilters);
  supFilter.addEventListener("change", applyFilters);
  dateFilter.addEventListener("change", applyFilters);

  const exportBtn = el(
    "button",
    { class: "btn secondary", onclick: () => exportCsv(all) },
    "Exportar CSV"
  );

  const topActions = el("div", { class: "top-actions" }, [
    el("h2", { style: "margin:0;" }, "Historial de controles"),
    exportBtn,
  ]);

  const card = el("div", { class: "card" }, [
    topActions,
    el("div", { class: "filters" }, [turnoFilter, supFilter, dateFilter]),
    tableWrap,
  ]);

  app.appendChild(card);
  renderTable(all);
}

function exportCsv(list) {
  if (!list.length) {
    alert("No hay registros para exportar.");
    return;
  }
  const rows = [["Fecha", "Hora", "Turno", "Momento", "Supervisor", "Pregunta", "Puntaje", "Detalle", "Observaciones"]];
  list.forEach((r) => {
    if (r.respuestas && r.respuestas.length) {
      r.respuestas.forEach((a) => {
        rows.push([
          r.fecha,
          r.hora,
          r.turno,
          r.checkpointLabel,
          r.supervisorName,
          a.label,
          a.puntaje ?? "",
          a.detalle ?? "",
          r.observaciones ?? "",
        ]);
      });
    } else {
      rows.push([r.fecha, r.hora, r.turno, r.checkpointLabel, r.supervisorName, "", "", "", r.observaciones ?? ""]);
    }
  });
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comedor_registros_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------- Navegación ---------------------------------- */

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => goTo(btn.dataset.route));
});

render();
