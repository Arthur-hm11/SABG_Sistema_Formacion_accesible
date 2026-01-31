

// ===== SCRIPT #1 =====

const API_BASE = "";
const LOGIN_URL = API_BASE + "/api/auth/login";

// ===================== FIX: Evitar ReferenceError si falta updateStatsFromRegistros =====================
if (typeof window.updateStatsFromRegistros !== 'function') {
  window.updateStatsFromRegistros = function(registros) {
    try {
      if (!Array.isArray(registros)) return;

      // Actualiza un contador genérico si existe (no rompe si no existe)
      const totalRegistrosEl = document.getElementById('totalRegistros');
      if (totalRegistrosEl) {
        totalRegistrosEl.textContent = registros.length.toLocaleString('es-MX');
      }
    } catch (e) {
      console.warn('updateStatsFromRegistros fallback:', e);
    }
  };
}
// =======================================================================================================

    // ========================================
    // SISTEMA DE ROLES Y VARIABLES GLOBALES
    // ========================================
    let userRole = 'enlace';

/* =========================================================
   SEGURIDAD (doble validación) + AUDITORÍA SILENCIOSA
   - No muestra roles en UI
   - Bloquea acciones críticas si no es superadmin
   - Registra acciones en localStorage y (opcional) envía a /api/audit/log
========================================================= */
function isSuperAdmin() {
    return (userRole === 'superadmin');
}

function requireSuperAdmin(actionLabel) {
    if (isSuperAdmin()) return true;
    // Mensaje genérico (sin exponer roles)
    alert('⚠️ Acceso restringido.');
    // Auditoría de intento no autorizado
    auditLog(actionLabel, 'DENIED', { reason: 'not_superadmin' });
    return false;
}


// ========================================
// VISIBILIDAD POR ROL (sin exponer roles)
// - "Cargar Excel" solo para administradores
// ========================================
function isAdminUser() {
    // Evita ReferenceError si 'userRole' no existe en el scope global
    const roleRaw =
        (typeof userRole !== 'undefined' && userRole) ? userRole :
        (localStorage.getItem('SABG_ROL') || '');
    const role = String(roleRaw).toLowerCase().trim();
    return role === 'admin' || role === 'superadmin' || role.includes('admin');
}


function applyRoleVisibility() {
    const excelBox = document.getElementById('excelUploadBox');
    if (excelBox) {
        if (isAdminUser()) excelBox.classList.remove('hidden');
        else excelBox.classList.add('hidden');
    }

}
// ========================================
// Carga masiva (Admin): CSV exportado desde Excel
// Nota: Para evitar dependencias extra en el frontend, el cargador soporta CSV.
// Si necesitas XLSX directo, se implementa del lado del servidor o con SheetJS.
// ========================================
function normalizeHeaderKey(h) {
    return String(h || '')
        .toLowerCase()
        .trim()
        .replace(/\u00e1/g,'a').replace(/\u00e9/g,'e').replace(/\u00ed/g,'i').replace(/\u00f3/g,'o').replace(/\u00fa/g,'u').replace(/\u00f1/g,'n')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function parseCSV(text) {
    // Parser CSV simple con soporte de comillas dobles
    const rows = [];
    let row = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];

        if (c === '"') {
            if (inQuotes && next === '"') { // escape ""
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (!inQuotes && (c === ',' || c === ';')) {
            row.push(cur);
            cur = '';
            continue;
        }

        if (!inQuotes && (c === '\n' || c === '\r')) {
            if (c === '\r' && next === '\n') i++; // Windows CRLF
            row.push(cur);
            rows.push(row);
            row = [];
            cur = '';
            continue;
        }

        cur += c;
    }

    // última celda
    if (cur.length || row.length) {
        row.push(cur);
        rows.push(row);
    }

    // limpiar filas vacías
    return rows.filter(r => r.some(cell => String(cell || '').trim() !== ''));
}


function triggerExcelUpload() {
    try {
        if (!isAdminUser()) {
            alert('⛔ Solo administradores pueden cargar archivos.');
            return;
        }
        const input = document.getElementById('excelFile');
        if (!input) {
            alert('No se encontró el selector de archivo.');
            return;
        }
        // Reset para permitir seleccionar el mismo archivo otra vez
        input.value = '';
        input.click();
    } catch (e) {
        console.error(e);
        alert('Error al abrir el selector de archivo.');
    }
}

// ===== Anti doble carga (global, sin romper nada) =====
window.__uploadInProgress = false;
window.__lastUploadSig = null;

function fileSignature(file) {
  // firma simple: nombre + tamaño + lastModified
  if (!file) return null;
  return `${file.name}__${file.size}__${file.lastModified}`;
}
// ===== UI: Modal de reporte de carga masiva (bonito y trazable) =====
(function ensureBulkReportStyles(){
  if (document.getElementById('bulkReportStyles')) return;
  const style = document.createElement('style');
  style.id = 'bulkReportStyles';
  style.textContent = `
    .bulk-report-overlay{
      position:fixed; inset:0; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      z-index:999999;
    }
    .bulk-report-modal{
      width:min(920px, 94vw);
      max-height:86vh;
      overflow:auto;
      background:#fff;
      border-radius:14px;
      box-shadow:0 20px 60px rgba(0,0,0,.35);
      padding:18px 18px 14px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .bulk-report-head{
      display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
      border-bottom:1px solid rgba(0,0,0,.08);
      padding-bottom:10px; margin-bottom:12px;
    }
    .bulk-report-head h3{ margin:0; font-size:18px; }
    .bulk-report-sub{ margin:4px 0 0; color:#555; font-size:13px; line-height:1.35; }
    .bulk-report-close{
      border:0; background:#111; color:#fff;
      padding:8px 12px; border-radius:10px; cursor:pointer;
      font-size:13px;
    }
    .bulk-kpis{
      display:grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap:10px;
      margin:10px 0 14px;
    }
    .bulk-kpi{
      border:1px solid rgba(0,0,0,.08);
      border-radius:12px;
      padding:10px 12px;
      background:rgba(0,0,0,.02);
    }
    .bulk-kpi .label{ color:#666; font-size:12px; }
    .bulk-kpi .value{ font-size:20px; font-weight:700; margin-top:2px; }
    .bulk-kpi .hint{ color:#777; font-size:12px; margin-top:4px; line-height:1.25; }
    .bulk-report-section{ margin-top:10px; }
    .bulk-report-section h4{ margin:10px 0 8px; font-size:14px; }
    .bulk-report-table{
      width:100%;
      border-collapse:collapse;
      font-size:12.5px;
      border:1px solid rgba(0,0,0,.08);
      border-radius:12px;
      overflow:hidden;
    }
    .bulk-report-table th, .bulk-report-table td{
      padding:9px 10px;
      border-bottom:1px solid rgba(0,0,0,.06);
      vertical-align:top;
    }
    .bulk-report-table th{
      background:rgba(0,0,0,.03);
      text-align:left;
      font-weight:650;
    }
    .bulk-report-badge{
      display:inline-block;
      padding:4px 8px;
      border-radius:999px;
      font-size:12px;
      background:rgba(0,0,0,.06);
    }
    .bulk-report-badge.ok{ background:rgba(34,197,94,.15); }
    .bulk-report-badge.warn{ background:rgba(245,158,11,.18); }
    .bulk-report-badge.err{ background:rgba(239,68,68,.15); }
    details.bulk-details summary{ cursor:pointer; font-weight:650; margin:6px 0; }
    .bulk-mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  `;
  document.head.appendChild(style);
})();

function showBulkReportModal(aggregateReport, extra={}){
  try{
    // Cerrar si ya existe
    const prev = document.getElementById('bulkReportOverlay');
    if (prev) prev.remove();

    const rep = aggregateReport || {};
    const inserted = Number(rep.inserted || rep.insertados || rep.count || 0);
    const ok = Number(inserted || 0);
    const dup = Number(rep.duplicates_omitted || 0);
    const empty = Number(rep.empty_discarded || 0);
    const invCurp = Number(rep.curp_invalid_to_null || 0);
    const errorsCount = Number(rep.errors_count || 0);
    const received = Number(rep.received || 0);
    const processed = Number(rep.processed || 0);

    const statusClass = errorsCount > 0 ? 'warn' : 'ok';
    const statusText = errorsCount > 0 ? 'Carga parcial / con observaciones' : 'Carga completada';
    const overlay = document.createElement('div');
    overlay.id = 'bulkReportOverlay';
    overlay.className = 'bulk-report-overlay';
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'bulk-report-modal';

    const head = document.createElement('div');
    head.className = 'bulk-report-head';
    head.innerHTML = `
      <div>
        <h3>📦 Reporte de carga masiva <span class="bulk-report-badge ${statusClass}">${statusText}</span></h3>
        <div class="bulk-report-sub">
          Recibidos: <b>${received}</b> · Procesados: <b>${processed}</b> · Insertados: <b>${inserted}</b>
          ${dup ? ` · Duplicados omitidos: <b>${dup}</b>` : ''}
          ${empty ? ` · Filas vacías descartadas: <b>${empty}</b>` : ''}
        </div>
      </div>
      <button class="bulk-report-close" type="button">Cerrar</button>
    `;
    head.querySelector('.bulk-report-close').addEventListener('click', ()=> overlay.remove());

    const kpis = document.createElement('div');
    kpis.className = 'bulk-kpis';
    kpis.innerHTML = `
      <div class="bulk-kpi"><div class="label">Insertados</div><div class="value">${inserted}</div><div class="hint">Registros guardados en la tabla</div></div>
      <div class="bulk-kpi"><div class="label">Duplicados omitidos</div><div class="value">${dup}</div><div class="hint">Requiere UNIQUE (curp, trimestre) WHERE curp IS NOT NULL</div></div>
      <div class="bulk-kpi"><div class="label">CURP inválida → NULL</div><div class="value">${invCurp}</div><div class="hint">CURP vacía o inválida se guarda como NULL</div></div>
      <div class="bulk-kpi"><div class="label">Filas vacías descartadas</div><div class="value">${empty}</div><div class="hint">Filas sin datos (solo espacios / títulos)</div></div>
      <div class="bulk-kpi"><div class="label">Errores</div><div class="value">${errorsCount}</div><div class="hint">Si hay, revisa detalle abajo</div></div>
      <div class="bulk-kpi"><div class="label">Recibidos</div><div class="value">${received}</div><div class="hint">Filas recibidas del frontend</div></div>
    `;

    const section = document.createElement('div');
    section.className = 'bulk-report-section';

    const errors = Array.isArray(rep.errors) ? rep.errors : [];
    const showErrors = errors.length > 0 || errorsCount > 0;

    let errorsHtml = '';
    if (showErrors){
      const rows = errors.slice(0, 50).map((e, idx)=>{
        const msg = (e && (e.message || e.error)) ? (e.message || e.error) : JSON.stringify(e);
        const curp = e?.curp ?? '';
        const tri = e?.trimestre ?? '';
        const rusp = e?.id_rusp ?? '';
        const nombre = [e?.nombre, e?.primer_apellido, e?.segundo_apellido].filter(Boolean).join(' ');
        return `
          <tr>
            <td>${idx+1}</td>
            <td class="bulk-mono">${String(tri||'').slice(0,40)}</td>
            <td class="bulk-mono">${String(curp||'').slice(0,24)}</td>
            <td class="bulk-mono">${String(rusp||'').slice(0,30)}</td>
            <td>${String(nombre||'').slice(0,120)}</td>
            <td class="bulk-mono">${String(msg||'').slice(0,260)}</td>
          </tr>
        `;
      }).join('');

      errorsHtml = `
        <details class="bulk-details" open>
          <summary>🧾 Detalle de errores (${errorsCount || errors.length})</summary>
          <table class="bulk-report-table">
            <thead>
              <tr>
                <th>#</th><th>Trimestre</th><th>CURP</th><th>ID RUSP</th><th>Nombre</th><th>Error</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6">No hay detalle disponible.</td></tr>`}</tbody>
          </table>
        </details>
      `;
    }

    // Extra raw summary (opcional)
    const raw = extra?.raw ? String(extra.raw).slice(0, 1200) : '';
    const rawHtml = raw ? `
      <details class="bulk-details">
        <summary>🧠 Respuesta cruda (debug)</summary>
        <pre class="bulk-mono" style="white-space:pre-wrap; margin:8px 0; background:rgba(0,0,0,.03); padding:10px; border-radius:12px;">${raw.replace(/[<>&]/g, (m)=>({ '<':'&lt;','>':'&gt;','&':'&amp;' }[m]))}</pre>
      </details>
    ` : '';

    section.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <span class="bulk-report-badge ${statusClass}">Insertados: ${inserted}</span>
        ${dup ? `<span class="bulk-report-badge">Omitidos por duplicado: ${dup}</span>` : ''}
        ${invCurp ? `<span class="bulk-report-badge">CURP inválida→NULL: ${invCurp}</span>` : ''}
        ${empty ? `<span class="bulk-report-badge">Filas vacías: ${empty}</span>` : ''}
        ${errorsCount ? `<span class="bulk-report-badge err">Errores: ${errorsCount}</span>` : ''}
      </div>
      ${errorsHtml}
      ${rawHtml}
    `;

    modal.appendChild(head);
    modal.appendChild(kpis);
    modal.appendChild(section);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }catch(e){
    console.error('No se pudo mostrar modal de reporte:', e);
    alert('✅ Carga completada. (No se pudo renderizar el reporte visual; revisa consola).');
  }
}





async function uploadExcel() {
  // ==== BLOQUEO DE DOBLE CARGA ====
  if (window.__uploadInProgress) {
    alert('⚠️ Ya hay una carga en proceso. Espera a que termine para evitar duplicados.');
    return;
  }

  // Detectar el input file (busca el primero type="file" si no hay id conocido)
  const input = document.getElementById('excelFile') || document.querySelector('input[type="file"]');
  const file = input?.files?.[0];
  const sig = fileSignature(file);

  if (sig && window.__lastUploadSig === sig) {
    alert('⚠️ Este mismo archivo ya se intentó cargar. Si necesitas recargarlo, selecciona el archivo nuevamente (o refresca la página) y vuelve a intentar.');
    return;
  }

  window.__uploadInProgress = true;
  window.__lastUploadSig = sig;

    try {
        if (!isAdminUser()) {
            alert('⛔ Solo administradores pueden cargar archivos.');
            return;
        }

        const input = document.getElementById('excelFile');
        const file = input && input.files ? input.files[0] : null;

        if (!file) {
            alert('📎 Primero selecciona un archivo.');
            return;
        }

        const filename = String(file.name || '').toLowerCase();

        // Overlay
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.add('active');
        const loadingText = document.querySelector('.loading-text');
        if (loadingText) loadingText.textContent = '📥 Procesando archivo...';

        if (filename.endsWith('.csv')) {
            const text = await file.text();
            const rows = parseCSV(text);

            if (!rows || rows.length < 2) {
                alert('⚠️ El CSV no tiene registros (o está vacío).');
                return;
            }

            
            // Detectar fila de encabezados (algunos CSV traen filas extra antes del header)
            const normRows = rows.map(r => (r || []).map(c => normalizeHeaderKey(c)));
            const expectedCandidates = [
                'trimestre','trim','periodo',
                'id_rusp','rusp','idrusp',
                'primer_apellido','apellido_paterno','ap_paterno','paterno',
                'segundo_apellido','apellido_materno','ap_materno','materno',
                'nombre','nombres','nombre_s',
                'curp',
                'correo_institucional','correo','email','e_mail',
                'telefono_institucional','telefono','tel','telefono_oficina',
                'nivel_educativo','nivel_de_estudios','nivel_estudios',
                'institucion_educativa','institucion','escuela',
                'modalidad',
                'estado_avance','avance','estatus',
                'observaciones','obs','comentarios',
                'enlace_nombre','enlace_primer_apellido','enlace_segundo_apellido','enlace_correo','enlace_telefono',
                'nivel_puesto','nivel_tabular','ramo_ur','dependencia'
            ];

            let headerIdx = 0;
            let bestScore = -1;

            // Busca en las primeras 25 filas la que parezca encabezado
            const scanMax = Math.min(normRows.length, 25);
            for (let i = 0; i < scanMax; i++) {
                const row = normRows[i] || [];
                let score = 0;
                for (const c of expectedCandidates) {
                    if (row.includes(normalizeHeaderKey(c))) score++;
                }
                if (score > bestScore) {
                    bestScore = score;
                    headerIdx = i;
                }
            }

            if (bestScore < 2) {
                // No encontramos encabezados válidos: evita "0 guardados" engañoso
                const preview = (rows[0] || []).slice(0, 12).join(' | ');
                alert('⚠️ No se detectaron encabezados válidos en el CSV.\n\n' + 'Asegúrate de exportar como CSV desde la pestaña correcta y que la primera fila contenga columnas como TRIMESTRE, ID_RUSP, CURP, etc.\n\n' + 'Vista previa de la primera fila:\n' + preview);
                return;
            }

            const headerRow = normRows[headerIdx];
            const bodyRows = rows.slice(headerIdx + 1);


            // Mapeos comunes (por si los encabezados vienen en español)
            const alias = {
                trimestre: ['trimestre', 'trim', 'periodo'],
                id_rusp: ['id_rusp', 'rusp', 'idrusp'],
                primer_apellido: ['primer_apellido', 'apellido_paterno', 'ap_paterno', 'paterno'],
                segundo_apellido: ['segundo_apellido', 'apellido_materno', 'ap_materno', 'materno'],
                nombre: ['nombre', 'nombres', 'nombre_s'],
                curp: ['curp'],
                correo_institucional: ['correo_institucional', 'correo', 'email', 'e_mail'],
                telefono_institucional: ['telefono_institucional', 'telefono', 'tel', 'telefono_oficina'],
                nivel_educativo: ['nivel_educativo', 'nivel_de_estudios', 'nivel_estudios'],
                institucion_educativa: ['institucion_educativa', 'institucion', 'escuela'],
                modalidad: ['modalidad'],
                estado_avance: ['estado_avance', 'avance', 'estatus'],
                observaciones: ['observaciones', 'obs', 'comentarios']
            ,
                enlace_nombre: ['enlace_nombre', 'enlace nombre', 'nombre_enlace', 'enlace'],
                enlace_primer_apellido: ['enlace_primer_apellido', 'enlace primer apellido', 'primer_apellido_enlace', 'apellido_paterno_enlace'],
                enlace_segundo_apellido: ['enlace_segundo_apellido', 'enlace segundo apellido', 'segundo_apellido_enlace', 'apellido_materno_enlace'],
                enlace_correo: ['enlace_correo', 'correo_enlace', 'email_enlace', 'correo del enlace'],
                enlace_telefono: ['enlace_telefono', 'telefono_enlace', 'tel_enlace', 'telefono del enlace'],
                nivel_puesto: ['nivel_puesto', 'nivel de puesto', 'puesto', 'nivel puesto'],
                nivel_tabular: ['nivel_tabular', 'nivel tabular', 'tabular', 'nivel tab'],
                ramo_ur: ['ramo_ur', 'ramo-ur', 'ramo ur', 'ur', 'ramo'],
                dependencia: ['dependencia', 'institucion', 'dependencia/entidad', 'entidad']

            };

            function findIndexForKey(key) {
                const candidates = alias[key] || [key];
                for (const cand of candidates) {
                    const idx = headerRow.indexOf(normalizeHeaderKey(cand));
                    if (idx !== -1) return idx;
                }
                return -1;
            }

            // Resolver índices
            const idxMap = {};
            Object.keys(alias).forEach(k => { idxMap[k] = findIndexForKey(k); });

            let ok = 0;
            let fail = 0;
            const errors = [];

            // Construir todos los payloads primero (sin spamear el backend)
            const allPayloads = [];

            for (let r = 0; r < bodyRows.length; r++) {
                const row = bodyRows[r];

                // construir payload
                const payload = {};
                Object.keys(idxMap).forEach(k => {
                    const idx = idxMap[k];
                    payload[k] = idx >= 0 ? String(row[idx] || '').trim() : '';
                });

                // valores por defecto
                payload.usuario_registro = userName || '';

                // omitir filas vacías
                const hasData = Object.keys(payload).some(k => k !== 'usuario_registro' && String(payload[k] || '').trim() !== '');
                if (!hasData) continue;

                allPayloads.push(payload);
            }

            if (allPayloads.length === 0) {
                alert('⚠️ No se detectaron filas con datos para cargar.');
                return;
            }

            
// Enviar por lotes ESTABLE para archivos grandes (30k+)
// - Lotes pequeños
// - Concurrencia controlada (2)
// - Reintentos por lote
// - Reanudación automática si se recarga (localStorage)
const BATCH = 120;          // recomendado para 30k (ajustable)
const CONCURRENCY = 2;      // estable en Vercel
const MAX_RETRIES = 3;
const RESUME_KEY = 'SABG_TRIM_BULK_CURSOR_V1';

// Construir lotes
const batches = [];
for (let i = 0; i < allPayloads.length; i += BATCH) {
    batches.push(allPayloads.slice(i, i + BATCH));
}

// Cursor (reanudación)
let cursor = 0;
try { cursor = Number(localStorage.getItem(RESUME_KEY) || '0') || 0; } catch (_) { cursor = 0; }
if (cursor < 0) cursor = 0;
if (cursor >= batches.length) cursor = 0;

// Totales
let insertedTotal = 0;
let skippedTotal = 0; // compat (si backend reporta omitidos)
let backendErrorsTotal = 0;
let duplicatesOmittedTotal = 0;

// Reporte agregado (sumado por lotes)
const agg = {
    received: 0,
    empty_discarded: 0,
    processed: 0,
    curp_invalid_to_null: 0,
    inserted: 0,
    duplicates_omitted: 0,
    errors_count: 0,
    errors: []
};

// Helper: POST robusto
async function postBulk(batch) {
    let resp, rawText;
    let result = {};
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            resp = await fetch('/api/trimestral/bulkCreate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: batch })
            });

            rawText = await resp.text();
            try { result = JSON.parse(rawText); } catch (_) { result = {}; }

            const success = (result && (result.success === true || result.ok === true));
            if (resp.ok && success) {
                // Normalizar formato nuevo a legacy
                if (result.ok === true && result.afectados != null && !result.report) {
                    result.report = {
                        received: batch.length,
                        processed: batch.length,
                        inserted: Number(result.afectados) || 0,
                        duplicates_omitted: 0,
                        errors_count: Number(result.errores) || 0,
                        errors: []
                    };
                    result.success = true;
                }
                return { ok: true, result };
            }

            const detail = (result && (result.message || result.error)) ? (result.message || result.error) : (rawText || 'Sin detalle');
            console.warn(`bulkCreate intento ${attempt}/${MAX_RETRIES} falló: HTTP ${resp.status}`, detail);

        } catch (err) {
            console.warn(`bulkCreate intento ${attempt}/${MAX_RETRIES} error:`, err);
            rawText = String(err?.message || err || 'Error');
            result = {};
        }

        await new Promise(r => setTimeout(r, 350 * attempt));
    }
    const status = resp ? resp.status : 'NO_RESP';
    const detail = (result && (result.message || result.error)) ? (result.message || result.error) : (rawText || 'Sin detalle');
    return { ok: false, status, detail };
}

// Cola concurrente
let nextIndex = cursor;
async function worker() {
    while (nextIndex < batches.length) {
        const myIndex = nextIndex++;
        const batch = batches[myIndex];

        // Progreso (aprox)
        const processedSoFar = Math.min((myIndex * BATCH), allPayloads.length);
        if (loadingText) {
            loadingText.textContent = `📥 Cargando... ${processedSoFar}/${allPayloads.length} (insertados: ${insertedTotal})`;
        }

        const resp = await postBulk(batch);

        if (!resp.ok) {
            errors.push(`Lote ${myIndex + 1}/${batches.length}: HTTP ${resp.status} - ${String(resp.detail).slice(0, 1200)}`);
            console.error('bulkCreate error FINAL', resp.status, resp.detail);
            fail += batch.length;

            // Guardar avance (reanudación)
            try { localStorage.setItem(RESUME_KEY, String(myIndex + 1)); } catch (_) {}
            continue;
        }

        const result = resp.result;
        const rep = (result && result.report) ? result.report : (result || {});

        // Agregados trazables (sumados por lote)
        agg.received += Number(rep.received || batch.length || 0);
        agg.empty_discarded += Number(rep.empty_discarded || 0);
        agg.processed += Number(rep.processed || batch.length || 0);
        agg.curp_invalid_to_null += Number(rep.curp_invalid_to_null || 0);

        const ins = Number(rep.inserted || 0);
        const dup = Number(rep.duplicates_omitted || 0);
        const errc = Number(rep.errors_count || 0);

        insertedTotal += ins;
        duplicatesOmittedTotal += dup;
        backendErrorsTotal += errc;

        // Guardar detalle de errores (hasta 50 en total)
        if (Array.isArray(rep.errors) && rep.errors.length) {
            for (const e of rep.errors) {
                if (agg.errors.length >= 50) break;
                agg.errors.push(e);
            }
        }

        // Guardar avance (reanudación)
        try { localStorage.setItem(RESUME_KEY, String(myIndex + 1)); } catch (_) {}
    }
}

// Lanzar workers
const workers = [];
for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
await Promise.all(workers);

// Terminado: limpiar cursor
try { localStorage.removeItem(RESUME_KEY); } catch (_) {}

            ok = insertedTotal;

            // Completar reporte agregado
            agg.inserted = insertedTotal;
            agg.duplicates_omitted = duplicatesOmittedTotal;
            agg.errors_count = backendErrorsTotal;

            // Consideramos como "fail" los errores de backend reportados (si los hay) + lotes fallidos (ya sumados arriba)
            fail += backendErrorsTotal;
// refrescar tabla
            if (typeof cargarRegistrosTrimestral === 'function') {
                await cargarRegistrosTrimestral();
            }

            // Mostrar reporte visual (bonito)
            showBulkReportModal(agg, { raw: (typeof rawText !== 'undefined' ? rawText : '') });

            // Mensaje corto (por si el usuario no ve el modal)
            if (fail === 0) {
                console.log(`✅ Carga completada: ${ok} insertados. Omitidos por duplicado: ${duplicatesOmittedTotal}.`);
            } else {
                console.warn('Errores de carga masiva:', errors);
                console.warn(`⚠️ Carga parcial: ${ok} insertados / ${fail} con error.`);
            }
        } else {
            alert('ℹ️ Por ahora, la carga masiva soporta CSV (exportado desde Excel).\n\n1) En Excel: Archivo → Guardar como → CSV\n2) Súbelo aquí y se registrará fila por fila.');
        }
    } finally {
        
    window.__uploadInProgress = false;
const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.remove('active');
        const input = document.getElementById('excelFile');
        if (input) input.value = ''; // limpiar para permitir volver a seleccionar
    }
}
// Exponer para handlers inline
window.uploadExcel = uploadExcel;


function auditLog(action, status, details = {}) {
    try {
        const entry = {
            ts: new Date().toISOString(),
            action,
            status,
            user: (localStorage.getItem('SABG_USUARIO') || ''),
            name: (typeof userName !== 'undefined' ? userName : ''),
            dependencia: (typeof userDependencia !== 'undefined' ? userDependencia : ''),
            role: (typeof userRole !== 'undefined' ? userRole : ''),
            details
        };

        // Guardar local (auditoría silenciosa)
        const key = 'SABG_AUDIT_LOG';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.push(entry);
        // Mantener tamaño razonable
        if (arr.length > 500) arr.splice(0, arr.length - 500);
        localStorage.setItem(key, JSON.stringify(arr));

        // Envío opcional al backend (si existe). No rompe si no hay endpoint.
        fetch('/api/audit/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        }).catch(() => {}).catch(() => {});
    } catch (e) {
        // Silencioso: no romper la app
    }


function formatNumberMX(n){
    try{
        return new Intl.NumberFormat('es-MX').format(Number(n) || 0);
    }catch(e){
        return (Number(n)||0).toString();
    }
}

function updateStatsFromRegistros(registros){
    try{
        const total = Array.isArray(registros) ? registros.length : 0;

        const uniqDependencias = new Set();
        const uniqCurp = new Set();

        let activos = 0;

        (registros || []).forEach(r => {
            const dep = (r.dependencia || '').trim();
            if(dep) uniqDependencias.add(dep);

            const curp = (r.curp || '').trim();
            if(curp) uniqCurp.add(curp);

            // Consideramos "activo" todo lo que NO sea deserción
            const estado = (r.estado_avance || '').trim().toUpperCase();
            if(estado && estado !== 'PERSONA QUE DESERTÓ') activos += 1;
        });

        const dependencias = uniqDependencias.size;
        const servidores = uniqCurp.size || total;

        const cumplimiento = total > 0 ? Math.round((activos / total) * 100) : 0;

        const elDep = document.getElementById('statDependencias');
        const elSrv = document.getElementById('statServidores');
        const elCum = document.getElementById('statCumplimiento');
        const elAct = document.getElementById('statActivos');

        if(elDep) elDep.textContent = formatNumberMX(dependencias);
        if(elSrv) elSrv.textContent = formatNumberMX(servidores);
        if(elCum) elCum.textContent = (cumplimiento + '%');
        if(elAct) elAct.textContent = formatNumberMX(activos);
    }catch(e){
        // silencioso
    }
}

}
    let edicionBloqueada = true;
    let userDependencia = null;
    let userName = '';

    // Base de datos de usuarios (en producción esto vendría de un backend)
    const usuarios = {
        // Super Admin
        '': { 
            password: 'admin2024', 
            role: 'superadmin',
            dependencia: null,
            nombre: 'Administrador'
        },
        // Dependencias
        'SABG': { 
            password: 'sabg2024', 
            role: 'enlace',
            dependencia: 'SECRETARÍA ANTICORRUPCIÓN Y BUEN GOBIERNO',
            nombre: 'Enlace SABG'
        },
        'SCT': { 
            password: 'sct2024', 
            role: 'enlace',
            dependencia: 'SECRETARÍA DE COMUNICACIONES Y TRANSPORTES',
            nombre: 'Enlace SCT'
        },
        'SHCP': { 
            password: 'shcp2024', 
            role: 'enlace',
            dependencia: 'SECRETARÍA DE HACIENDA Y CRÉDITO PÚBLICO',
            nombre: 'Enlace SHCP'
        },
        'SEP': { 
            password: 'sep2024', 
            role: 'enlace',
            dependencia: 'SECRETARÍA DE EDUCACIÓN PÚBLICA',
            nombre: 'Enlace SEP'
        },
        'ALTAMIRA': { 
            password: 'altamira2024', 
            role: 'enlace',
            dependencia: 'ISTRACIÓN DEL SISTEMA PORTUARIO NACIONAL ALTAMIRA',
            nombre: 'Enlace Altamira'
        },
        'PROGRESO': { 
            password: 'progreso2024', 
            role: 'enlace',
            dependencia: 'ISTRACIÓN DEL SISTEMA PORTUARIO NACIONAL PROGRESO',
            nombre: 'Enlace Progreso'
        }
    };

    // ========================================
    // FUNCIONES DE AUTENTICACIÓN
    // ========================================
     // Control Modal Registro
    function mostrarRegistro() {
        document.getElementById("registroModal").classList.remove("hidden");
    }

    function cerrarRegistro() {
        document.getElementById("registroModal").classList.add("hidden");
        document.getElementById("reg_usuario").value = "";
        const regDep = document.getElementById("reg_dependencia") || document.getElementById("reg_institucion");
        if (regDep) regDep.value = "";
        document.getElementById("reg_password").value = "";
    }

    // ========================================
    // RESTAURAR CONTRASEÑA
    // ========================================
    
    function mostrarRestaurarPassword() {
        document.getElementById("restaurarPasswordModal").classList.remove("hidden");
    }

    function cerrarRestaurarPassword() {
        document.getElementById("restaurarPasswordModal").classList.add("hidden");
        document.getElementById("restore_usuario").value = "";
        document.getElementById("restore_email").value = "";
    }

    async function restaurarPassword() {
        const usuarioInput = document.getElementById("restore_usuario");
        const emailInput = document.getElementById("restore_email");

        const usuario = usuarioInput.value.trim();
        const email = emailInput.value.trim();

        if (!usuario || !email) {
            alert("❌ Completa todos los campos");
            return;
        }

        try {
            alert(`📧 Se han enviado las instrucciones para restaurar tu contraseña al correo:\n\n${email}\n\nPor favor revisa tu bandeja de entrada y spam.\n\nNota: Esta funcionalidad está en desarrollo. Por favor contacta al administrador.`);
            cerrarRestaurarPassword();
            
        } catch (error) {
            alert("❌ Error de conexión con el servidor");
        }
    }
            // ========================================
// LOGIN DE USUARIO
// ========================================

// ========================================
// LOGIN DE USUARIO
// ========================================
async function loginUsuario() {
    const usuario = document.getElementById("usuario").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!usuario || !password) {
        alert("❌ Por favor completa todos los campos");
        return;
    }

    try {
        document.getElementById('loadingOverlay')?.classList.add('active');

        // ✅ ÚNICA RUTA
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ usuario, password })
        });

        // Leer respuesta de forma segura (evita: Unexpected token / [object Object])
        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            throw new Error(`Respuesta no JSON (HTTP ${response.status}). ${text.slice(0,120)}`);
        }

        if (!response.ok || !data?.success) {
            const msg = data?.error || data?.message || `Error HTTP ${response.status}`;
            throw new Error(msg);
        }

        // ✅ Variables de sesión (en memoria)
        userRole = data.rol;
        userName = data.nombre;
        userDependencia = data.dependencia;

        // ✅ Persistir para refrescos/permiso (sin token por ahora)
        localStorage.setItem('SABG_USUARIO', data.usuario || usuario);
        localStorage.setItem('SABG_NOMBRE', data.nombre || '');
        localStorage.setItem('SABG_ROL', data.rol || '');
        localStorage.setItem('SABG_DEPENDENCIA', data.dependencia || '');

        // Aplicar permisos visuales por rol
        applyRoleVisibility();

        

    // Hook submit del formulario trimestral (evita recarga y usa la función existente)
    const trimestralForm = document.getElementById("trimestralForm");
    if (trimestralForm && typeof guardarRegistroTrimestral === "function") {
        trimestralForm.addEventListener("submit", (e) => {
            e.preventDefault();
            guardarRegistroTrimestral();
        });
    }
// Auditoría
        try { auditLog('LOGIN', 'OK', { usuario: (data.usuario || usuario) }); } catch(e) {}

        // UI
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.textContent = `👤 ${data.nombre}`;
        const userRoleEl = document.getElementById('userRole');
        if (userRoleEl) userRoleEl.textContent = '';

        document.getElementById('loginScreen')?.classList.add('hidden');

        // Visibilidad estricta de controles admin
        const adminEls = [
            'adminPanelTrimestral',
            'exportButtonsTrimestral',
            'estadoEdicion',
            'notasTablaTrimestral'
        ];
        adminEls.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (userRole === 'superadmin') el.classList.remove('hidden');
            else el.classList.add('hidden');
        });

        if (userRole === 'superadmin') {
            document.getElementById('adminPanelTrimestral')?.classList.remove('hidden');
            document.getElementById('exportButtonsTrimestral')?.classList.remove('hidden');
            document.getElementById('estadoEdicion')?.classList.remove('hidden');
            document.getElementById('notasTablaTrimestral')?.classList.remove('hidden');
            document.getElementById('adminPanelEvidencias')?.classList.remove('hidden');
            document.getElementById('tabVerTabla')?.classList.remove('hidden');
            document.getElementById('dropdownItemTabla')?.classList.remove('admin-only');
            document.getElementById('dropdownItemRevision')?.classList.remove('admin-only');
        }

        await cargarRegistrosTrimestral();

        // Refresco cada 60s
        try {
            if (window.__rtTrimestralInterval) clearInterval(window.__rtTrimestralInterval);
            window.__rtTrimestralInterval = setInterval(() => {
                const u = localStorage.getItem('SABG_USUARIO');
                if (u) cargarRegistrosTrimestral();
            }, 60000);
        } catch (e) {}

        alert(`✅ ¡Bienvenido ${data.nombre}!`);

    } catch (error) {
        // Nunca alert(objeto)
        alert('❌ ' + (error?.message || 'Error de conexión con el servidor'));
    } finally {
        document.getElementById('loadingOverlay')?.classList.remove('active');
    }
}

// Login de Usuario (FUNCIÓN COMPLETA)

   async function registrarUsuario() {
    // Obtener valores y limpiar
    let curp = document.getElementById("reg_curp").value || "";
    let nombre = document.getElementById("reg_nombre").value || "";
    let primer_apellido = document.getElementById("reg_primer_apellido").value || "";
    let segundo_apellido = document.getElementById("reg_segundo_apellido").value || "";
    let correo = document.getElementById("reg_correo").value || "";
    let dependencia = document.getElementById("reg_dependencia").value || "";
    let usuario = document.getElementById("reg_usuario").value || "";
    let password = document.getElementById("reg_password").value || "";

    // Limpiar espacios y convertir a mayúsculas donde corresponda
    curp = curp.trim().toUpperCase();
    nombre = nombre.trim();
    primer_apellido = primer_apellido.trim();
    segundo_apellido = segundo_apellido.trim();
    correo = correo.trim().toLowerCase();
    dependencia = dependencia.trim();
    usuario = usuario.trim().toUpperCase();
    password = password.trim();

    // Validar campos vacíos
    if (!curp) {
        alert("❌ El campo CURP es obligatorio");
        document.getElementById("reg_curp").focus();
        return;
    }

    if (!nombre) {
        alert("❌ El campo Nombre es obligatorio");
        document.getElementById("reg_nombre").focus();
        return;
    }

    if (!primer_apellido) {
        alert("❌ El campo Primer Apellido es obligatorio");
        document.getElementById("reg_primer_apellido").focus();
        return;
    }

    if (!segundo_apellido) {
        alert("❌ El campo Segundo Apellido es obligatorio");
        document.getElementById("reg_segundo_apellido").focus();
        return;
    }

    if (!correo) {
        alert("❌ El campo Correo es obligatorio");
        document.getElementById("reg_correo").focus();
        return;
    }

    if (!dependencia) {
        alert("❌ El campo Dependencia es obligatorio");
        document.getElementById("reg_dependencia").focus();
        return;
    }

    if (!usuario) {
        alert("❌ El campo Usuario es obligatorio");
        document.getElementById("reg_usuario").focus();
        return;
    }

    if (!password) {
        alert("❌ El campo Contraseña es obligatorio");
        document.getElementById("reg_password").focus();
        return;
    }

    // Validar longitud CURP
    if (curp.length !== 18) {
        alert("❌ CURP inválido\n\nDebe tener exactamente 18 caracteres.\nActualmente tiene: " + curp.length + " caracteres");
        document.getElementById("reg_curp").focus();
        return;
    }

    // Validar formato CURP
    const curpPattern = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9]{2}$/;
    if (!curpPattern.test(curp)) {
        alert("❌ Formato de CURP inválido\n\nFormato correcto:\n• 4 letras\n• 6 números\n• H o M\n• 5 letras\n• 2 números\n\nEjemplo: SALR990312MDFLPC06");
        document.getElementById("reg_curp").focus();
        return;
    }

    // Validar usuario
    if (usuario.length < 3) {
        alert("❌ El usuario debe tener al menos 3 caracteres");
        document.getElementById("reg_usuario").focus();
        return;
    }

    // Validar contraseña
    if (password.length < 6) {
        alert("❌ La contraseña debe tener al menos 6 caracteres");
        document.getElementById("reg_password").focus();
        return;
    }

    // Validar email
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(correo)) {
        alert("❌ Formato de correo electrónico inválido");
        document.getElementById("reg_correo").focus();
        return;
    }

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                curp: curp,
                nombre: nombre,
                primer_apellido: primer_apellido,
                segundo_apellido: segundo_apellido,
                correo: correo,
                dependencia: dependencia,
                usuario: usuario,
                password: password
            })
        });

        const data = await response.json();

        if (data.success) {
            alert("✅ Usuario registrado correctamente\n\n👤 Usuario: " + data.usuario + "\n\n🔑 Ya puedes iniciar sesión con tus credenciales.");
            cerrarRegistro();
            document.getElementById("formRegistro").reset();
        } else {
            alert("❌ Error al registrar:\n\n" + data.error);
        }
        
    } catch (error) {
        alert("❌ Error de conexión con el servidor.\n\nPor favor verifica tu conexión a internet e intenta nuevamente.");
    }
}

    // Logout
    function logout() {
        if (confirm('¿Está seguro que desea cerrar sesión?')) {
            document.getElementById('usuario').value = '';
            document.getElementById('password').value = '';
            
            userRole = 'enlace';
            userDependencia = null;
            userName = '';
            
            localStorage.removeItem('SABG_TOKEN');
            localStorage.removeItem('SABG_USUARIO');
            localStorage.removeItem('SABG_NOMBRE');
            localStorage.removeItem('SABG_ROL');
            localStorage.removeItem('SABG_DEPENDENCIA');
            document.getElementById('loginScreen').classList.remove('hidden');
            
            document.querySelectorAll('#registrosTable tbody tr').forEach(row => {
                row.style.display = '';
            });
            
            setTimeout(() => {
                alert('👋 Sesión cerrada exitosamente\n\n¡Hasta pronto!');
            }, 300);
        }
    }

    // ========================================
    // FUNCIONES DE NAVEGACIÓN
    // ========================================

    function toggleDropdown(dropdownId, btn) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu.id !== dropdownId) {
                menu.classList.remove('show');
            }
        });
        
        document.querySelectorAll('.main-nav-btn').forEach(button => {
            if (button !== btn) {
                button.classList.remove('expanded');
            }
        });
        
        const dropdown = document.getElementById(dropdownId);
        dropdown.classList.toggle('show');
        btn.classList.toggle('expanded');
    }

    document.addEventListener('click', function(event) {
        if (!event.target.closest('.nav-item')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.classList.remove('show');
            });
            document.querySelectorAll('.main-nav-btn').forEach(btn => {
                btn.classList.remove('expanded');
            });
        }
    });

    function showSectionAndTab(sectionId, tabId) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show');
        });
        document.querySelectorAll('.main-nav-btn').forEach(btn => {
            btn.classList.remove('expanded');
        });
        
        document.querySelectorAll('.main-nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.querySelectorAll('.main-section').forEach(section => {
            section.classList.remove('active');
        });
        
        document.getElementById(sectionId).classList.add('active');
        
        if (sectionId === 'trimestral') {
            document.querySelectorAll('#trimestral .tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            document.querySelectorAll('#trimestral .tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            document.getElementById(tabId).classList.add('active');
            
            const tabs = document.querySelectorAll('#trimestral .tab');
            tabs.forEach(tab => {
                if ((tabId === 'instructivo' && tab.textContent.includes('Instructivo')) ||
                    (tabId === 'formulario' && tab.textContent.includes('Formulario')) ||
                    (tabId === 'tabla' && tab.textContent.includes('Tabla'))) {
                    tab.classList.add('active');
                }
            });
            
            if (tabId === 'tabla') {
                setTimeout(() => {
                    filtrarTablaPorDependencia();
                }, 100);
            }
        }
        
        if (sectionId === 'evidencias') {
            document.querySelectorAll('#evidencias .subsection').forEach(subsection => {
                subsection.classList.remove('active');
            });
            
            document.getElementById(tabId).classList.add('active');
        }
    
        // ✅ Cargar datos reales al abrir la pestaña "Tabla de Registros" (evita que se queden filas de muestra)
        if (sectionId === 'trimestral' && tabId === 'tabla') {
            try { cargarRegistrosTrimestral(); } catch (e) { console.warn('No se pudieron cargar registros:', e); }
        }

}

    function showMainSection(sectionId) {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show');
        });
        document.querySelectorAll('.main-nav-btn').forEach(btn => {
            btn.classList.remove('expanded');
        });
        
        const sections = document.querySelectorAll('.main-section');
        const navButtons = document.querySelectorAll('.main-nav-btn');

        sections.forEach(section => {
            section.classList.remove('active');
        });

        navButtons.forEach(btn => {
            btn.classList.remove('active');
        });

        document.getElementById(sectionId).classList.add('active');
        
        navButtons.forEach(btn => {
            if (btn.textContent.includes('Inicio') && sectionId === 'inicio') {
                btn.classList.add('active');
            }
        });
    }

    function showTrimestralTab(tabId) {
        // ✅ Acceso a la tabla habilitado para todos los usuarios
const tabs = document.querySelectorAll('#trimestral .tab');
        const tabContents = document.querySelectorAll('#trimestral .tab-content');

        tabs.forEach(tab => {
            tab.classList.remove('active');
        });

        tabContents.forEach(content => {
            content.classList.remove('active');
        });

        tabs.forEach(tab => {
            if ((tabId === 'instructivo' && tab.textContent.includes('Instructivo')) ||
                (tabId === 'formulario' && tab.textContent.includes('Formulario')) ||
                (tabId === 'tabla' && tab.textContent.includes('Tabla'))) {
                tab.classList.add('active');
            }
        });

        document.getElementById(tabId).classList.add('active');
    }

    // ========================================
    // FUNCIONES DE ISTRACIÓN
    // ========================================
    function togglePanelRevision() {
        const panel = document.getElementById('revision');
        
        if (panel.classList.contains('active')) {
            panel.classList.remove('active');
            document.getElementById('registro').classList.add('active');
            alert('🔒 Panel de Revisión DCEVE ahora oculto');
        } else {
            panel.classList.add('active');
            document.getElementById('registro').classList.remove('active');
            alert('✅ Panel de Revisión DCEVE ahora visible');
        }
    }

    function desbloquearEdicion() {
