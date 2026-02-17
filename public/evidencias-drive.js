/* SABG - Evidencias PDF -> Apps Script -> Drive (SIN Render) */
(() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzBf07jF2UaPMxshfYD7GWGUabYQOxGVqoxguEWsZj9Desl3CKYZbLwY2tAV4zjOVv2bg/exec";
  const MAX_MB = 8;

  function getMonthLabel(){
    // Tu modal tiene: <h2 id="modalTitle">Registro de Evidencias Mensuales</h2>
    // Si en tu UI agregas "- Febrero 2026", lo toma. Si no, regresa "Mes desconocido".
    const el = document.getElementById("modalTitle") || document.querySelector("#monthModal h2");
    const t = (el?.textContent || "").trim();
    if (t.includes("-")) return t.split("-").slice(1).join("-").trim();
    return "Mes desconocido";
  }

  function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result||"").split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function ensureFileInfoUI(file){
    const box = document.getElementById("fileUpload");
    if (!box || !file) return;
    let info = document.getElementById("pdfFileInfo");
    if (!info){
      info = document.createElement("div");
      info.id = "pdfFileInfo";
      info.style.marginTop = "10px";
      info.style.fontSize = "0.95rem";
      info.style.color = "#334155";
      box.appendChild(info);
    }
    info.textContent = `📄 ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
  }

  async function submitEvidencia(event){
    event.preventDefault();

    const form = document.getElementById("evidenciaForm");
    const pdfInput = document.getElementById("pdfFile");
    const file = pdfInput?.files?.[0];

    if (!APPS_SCRIPT_URL || !APPS_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")){
      alert("❌ Falta configurar la URL de Apps Script (/exec).");
      return;
    }

    if (!file){
      alert("❌ Selecciona un PDF antes de enviar.");
      return;
    }

    const sizeMB = file.size / (1024*1024);
    if (sizeMB > MAX_MB + 0.2){
      alert(`❌ El PDF pesa ${sizeMB.toFixed(2)} MB. Máximo: ${MAX_MB} MB.`);
      return;
    }

    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)){
      alert("❌ Solo se permiten archivos PDF.");
      return;
    }

    // Captura los campos del formulario (en tu HTML no tienen id, así que lo hacemos por orden)
    const inputs = [...form.querySelectorAll('input[type="text"], input[type="email"]')];
    const fields = inputs.map((el, idx) => ({ idx, value: (el.value || "").trim() }));

    const payload = {
      monthLabel: getMonthLabel(),
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      base64: await fileToBase64(file),
      fields
    };

    try{
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const out = await res.json().catch(()=>null);

      if (!res.ok || !out || !out.ok){
        console.error("Upload fail:", res.status, out);
        alert("❌ Error al subir a Drive: " + (out?.error || ("HTTP " + res.status)));
        return;
      }

      alert("✅ Evidencia subida a Drive. ID: " + out.fileId);

      // Cierra modal si existe función global
      if (typeof window.closeModal === "function") window.closeModal();
      form.reset();

      // Limpia UI file info
      const info = document.getElementById("pdfFileInfo");
      if (info) info.remove();
    }catch(err){
      console.error(err);
      alert("❌ Fallo de red al subir evidencia. Revisa consola.");
    }
  }

  // Exponer función global para el onsubmit del form
  window.submitEvidencia = submitEvidencia;

  // Wiring: click del dropzone ya existe en tu HTML. Aquí agregamos drag&drop real + UI.
  function wire(){
    const box = document.getElementById("fileUpload");
    const input = document.getElementById("pdfFile");
    if (!box || !input) return;

    input.addEventListener("change", () => {
      const f = input.files?.[0];
      ensureFileInfoUI(f);
    });

    box.addEventListener("dragover", (e) => { e.preventDefault(); });
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)){
        alert("❌ Solo se permiten archivos PDF.");
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles:true }));
    });
  }

  document.addEventListener("DOMContentLoaded", wire);
})();
