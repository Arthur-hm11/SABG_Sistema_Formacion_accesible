<?php
// install.php - Ejecutar una sola vez para crear las tablas
require_once 'config.php';

$conn = getDBConnection();

// Crear tabla de usuarios
$sql_usuarios = "CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('superadmin', 'enlace') NOT NULL,
    dependencia VARCHAR(255),
    nombre VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// Crear tabla de registros trimestrales
$sql_trimestral = "CREATE TABLE IF NOT EXISTS registros_trimestral (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trimestre VARCHAR(50) NOT NULL,
    id_rusp VARCHAR(50) NOT NULL,
    primer_apellido VARCHAR(100) NOT NULL,
    segundo_apellido VARCHAR(100) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    curp VARCHAR(18) NOT NULL,
    nivel_puesto VARCHAR(100) NOT NULL,
    nivel_tabular VARCHAR(20) NOT NULL,
    ramo_ur VARCHAR(50) NOT NULL,
    dependencia VARCHAR(255) NOT NULL,
    correo_institucional VARCHAR(150) NOT NULL,
    telefono_institucional VARCHAR(50) NOT NULL,
    nivel_educativo VARCHAR(50) NOT NULL,
    institucion_educativa VARCHAR(255) NOT NULL,
    modalidad VARCHAR(255) NOT NULL,
    estado_avance VARCHAR(255) NOT NULL,
    observaciones TEXT,
    enlace_nombre VARCHAR(150) NOT NULL,
    enlace_apellido1 VARCHAR(100) NOT NULL,
    enlace_apellido2 VARCHAR(100) NOT NULL,
    enlace_correo VARCHAR(150) NOT NULL,
    enlace_telefono VARCHAR(50) NOT NULL,
    usuario_registro VARCHAR(50) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dependencia (dependencia),
    INDEX idx_trimestre (trimestre),
    INDEX idx_estado (estado_avance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// Crear tabla de evidencias mensuales
$sql_evidencias = "CREATE TABLE IF NOT EXISTS evidencias_mensuales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mes VARCHAR(20) NOT NULL,
    anio INT NOT NULL,
    dependencia VARCHAR(255) NOT NULL,
    enlace_nombre VARCHAR(150) NOT NULL,
    enlace_apellido1 VARCHAR(100) NOT NULL,
    enlace_apellido2 VARCHAR(100) NOT NULL,
    enlace_correo VARCHAR(150) NOT NULL,
    enlace_correo_adicional VARCHAR(150),
    enlace_telefono VARCHAR(50) NOT NULL,
    archivo_nombre VARCHAR(255) NOT NULL,
    archivo_ruta VARCHAR(500) NOT NULL,
    estado ENUM('COMPLETADO', 'SIN COMPLETAR', 'PENDIENTE') DEFAULT 'PENDIENTE',
    usuario_registro VARCHAR(50) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_revision TIMESTAMP NULL,
    revisor VARCHAR(50),
    INDEX idx_mes (mes, anio),
    INDEX idx_dependencia (dependencia),
    INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// Crear tabla de configuración del sistema
$sql_configuracion = "CREATE TABLE IF NOT EXISTS configuracion_sistema (
    id INT AUTO_INCREMENT PRIMARY KEY,
    clave VARCHAR(50) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    descripcion TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// Crear tabla de logs de actividad
$sql_logs = "CREATE TABLE IF NOT EXISTS logs_actividad (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL,
    accion VARCHAR(100) NOT NULL,
    tabla_afectada VARCHAR(50),
    registro_id INT,
    detalles TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_usuario (usuario),
    INDEX idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// Ejecutar creación de tablas
$tablas = [
    'usuarios' => $sql_usuarios,
    'registros_trimestral' => $sql_trimestral,
    'evidencias_mensuales' => $sql_evidencias,
    'configuracion_sistema' => $sql_configuracion,
    'logs_actividad' => $sql_logs
];

$resultados = [];

foreach ($tablas as $nombre => $sql) {
    if ($conn->query($sql)) {
        $resultados[$nombre] = "✅ Tabla '$nombre' creada exitosamente";
    } else {
        $resultados[$nombre] = "❌ Error en tabla '$nombre': " . $conn->error;
    }
}

// Insertar usuarios por defecto
$usuarios_default = [
    ['ADMIN', password_hash('admin2024', PASSWORD_BCRYPT), 'superadmin', NULL, 'Administrador'],
    ['SABG', password_hash('sabg2024', PASSWORD_BCRYPT), 'enlace', 'SECRETARÍA ANTICORRUPCIÓN Y BUEN GOBIERNO', 'Enlace SABG'],
    ['SCT', password_hash('sct2024', PASSWORD_BCRYPT), 'enlace', 'SECRETARÍA DE COMUNICACIONES Y TRANSPORTES', 'Enlace SCT'],
    ['SHCP', password_hash('shcp2024', PASSWORD_BCRYPT), 'enlace', 'SECRETARÍA DE HACIENDA Y CRÉDITO PÚBLICO', 'Enlace SHCP'],
    ['SEP', password_hash('sep2024', PASSWORD_BCRYPT), 'enlace', 'SECRETARÍA DE EDUCACIÓN PÚBLICA', 'Enlace SEP'],
    ['ALTAMIRA', password_hash('altamira2024', PASSWORD_BCRYPT), 'enlace', 'ADMINISTRACIÓN DEL SISTEMA PORTUARIO NACIONAL ALTAMIRA', 'Enlace Altamira'],
    ['PROGRESO', password_hash('progreso2024', PASSWORD_BCRYPT), 'enlace', 'ADMINISTRACIÓN DEL SISTEMA PORTUARIO NACIONAL PROGRESO', 'Enlace Progreso']
];

$stmt = $conn->prepare("INSERT IGNORE INTO usuarios (username, password, role, dependencia, nombre) VALUES (?, ?, ?, ?, ?)");

foreach ($usuarios_default as $usuario) {
    $stmt->bind_param("sssss", $usuario[0], $usuario[1], $usuario[2], $usuario[3], $usuario[4]);
    $stmt->execute();
}

// Insertar configuración por defecto
$config_default = [
    ['edicion_bloqueada', '1', 'Control de edición de registros: 1=bloqueado, 0=desbloqueado'],
    ['panel_revision_visible', '0', 'Panel de revisión DCEVE: 1=visible, 0=oculto'],
    ['trimestre_actual', 'OCTUBRE_DICIEMBRE', 'Trimestre actual del sistema']
];

$stmt_config = $conn->prepare("INSERT IGNORE INTO configuracion_sistema (clave, valor, descripcion) VALUES (?, ?, ?)");

foreach ($config_default as $config) {
    $stmt_config->bind_param("sss", $config[0], $config[1], $config[2]);
    $stmt_config->execute();
}

$stmt->close();
$stmt_config->close();
$conn->close();
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instalación - Sistema de Formación Académica</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        h1 {
            color: #6B2C40;
        }
        .resultado {
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
            background: #e8f5e9;
            border-left: 4px solid #4caf50;
        }
        .error {
            background: #ffebee;
            border-left-color: #f44336;
        }
        .info {
            background: #e3f2fd;
            border-left-color: #2196f3;
            padding: 15px;
            margin-top: 20px;
        }
        .btn {
            display: inline-block;
            padding: 12px 24px;
            background: #6B2C40;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎓 Instalación del Sistema de Formación Académica</h1>
        
        <h2>Resultados de la Instalación:</h2>
        <?php foreach ($resultados as $nombre => $mensaje): ?>
            <div class="resultado <?php echo strpos($mensaje, '❌') !== false ? 'error' : ''; ?>">
                <?php echo $mensaje; ?>
            </div>
        <?php endforeach; ?>
        
        <div class="resultado">
            ✅ Usuarios por defecto creados: <?php echo count($usuarios_default); ?>
        </div>
        
        <div class="resultado">
            ✅ Configuraciones por defecto creadas: <?php echo count($config_default); ?>
        </div>
        
        <div class="info">
            <h3>📝 Usuarios Creados:</h3>
            <ul>
                <li><strong>ADMIN</strong> - password: admin2024 (Super Administrador)</li>
                <li><strong>SABG</strong> - password: sabg2024 (Enlace)</li>
                <li><strong>SCT</strong> - password: sct2024 (Enlace)</li>
                <li><strong>SHCP</strong> - password: shcp2024 (Enlace)</li>
                <li><strong>SEP</strong> - password: sep2024 (Enlace)</li>
                <li><strong>ALTAMIRA</strong> - password: altamira2024 (Enlace)</li>
                <li><strong>PROGRESO</strong> - password: progreso2024 (Enlace)</li>
            </ul>
        </div>
        
        <div class="info">
            <h3>⚠️ Importante:</h3>
            <p>1. Por seguridad, <strong>elimine o proteja este archivo</strong> después de la instalación.</p>
            <p>2. Cambie las contraseñas por defecto después del primer inicio de sesión.</p>
            <p>3. Asegúrese de que la carpeta <code>uploads/evidencias/</code> tenga permisos de escritura.</p>
        </div>
        
        <a href="index.php" class="btn">🚀 Ir al Sistema</a>
    </div>
</body>
</html>
