<?php
// api.php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE');
header('Access-Control-Allow-Headers: Content-Type');

require_once 'config.php';

session_start();

// Función para registrar actividad
function registrarActividad($conn, $usuario, $accion, $tabla = null, $registro_id = null, $detalles = null) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
    $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown';
    
    $stmt = $conn->prepare("INSERT INTO logs_actividad (usuario, accion, tabla_afectada, registro_id, detalles, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("sssisss", $usuario, $accion, $tabla, $registro_id, $detalles, $ip, $user_agent);
    $stmt->execute();
    $stmt->close();
}

// Función para verificar sesión
function verificarSesion() {
    if (!isset($_SESSION['usuario']) || !isset($_SESSION['role'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Sesión no válida']);
        exit;
    }
}

// Función para verificar si es admin
function esAdmin() {
    return isset($_SESSION['role']) && $_SESSION['role'] === 'superadmin';
}

$conn = getDBConnection();
$action = $_GET['action'] ?? '';

try {
    switch ($action) {
        
        // ========== AUTENTICACIÓN ==========
        case 'login':
            $data = json_decode(file_get_contents('php://input'), true);
            $username = strtoupper($data['username'] ?? '');
            $password = $data['password'] ?? '';
            
            $stmt = $conn->prepare("SELECT * FROM usuarios WHERE username = ?");
            $stmt->bind_param("s", $username);
            $stmt->execute();
            $result = $stmt->get_result();
            
            if ($result->num_rows > 0) {
                $usuario = $result->fetch_assoc();
                
                if (password_verify($password, $usuario['password'])) {
                    $_SESSION['usuario'] = $usuario['username'];
                    $_SESSION['role'] = $usuario['role'];
                    $_SESSION['dependencia'] = $usuario['dependencia'];
                    $_SESSION['nombre'] = $usuario['nombre'];
                    
                    registrarActividad($conn, $usuario['username'], 'LOGIN');
                    
                    echo json_encode([
                        'success' => true,
                        'user' => [
                            'username' => $usuario['username'],
                            'role' => $usuario['role'],
                            'dependencia' => $usuario['dependencia'],
                            'nombre' => $usuario['nombre']
                        ]
                    ]);
                } else {
                    echo json_encode(['success' => false, 'message' => 'Contraseña incorrecta']);
                }
            } else {
                echo json_encode(['success' => false, 'message' => 'Usuario no encontrado']);
            }
            
            $stmt->close();
            break;
            
        case 'logout':
            if (isset($_SESSION['usuario'])) {
                registrarActividad($conn, $_SESSION['usuario'], 'LOGOUT');
            }
            session_destroy();
            echo json_encode(['success' => true]);
            break;
            
        // ========== REGISTROS TRIMESTRALES ==========
        case 'guardar_trimestral':
            verificarSesion();
            
            $data = json_decode(file_get_contents('php://input'), true);
            
            $stmt = $conn->prepare("INSERT INTO registros_trimestral (
                trimestre, id_rusp, primer_apellido, segundo_apellido, nombre, curp,
                nivel_puesto, nivel_tabular, ramo_ur, dependencia, correo_institucional,
                telefono_institucional, nivel_educativo, institucion_educativa, modalidad,
                estado_avance, observaciones, enlace_nombre, enlace_apellido1,
                enlace_apellido2, enlace_correo, enlace_telefono, usuario_registro
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            
            $stmt->bind_param("sssssssssssssssssssssss",
                $data['trimestre'],
                $data['id_rusp'],
                $data['primer_apellido'],
                $data['segundo_apellido'],
                $data['nombre'],
                $data['curp'],
                $data['nivel_puesto'],
                $data['nivel_tabular'],
                $data['ramo_ur'],
                $data['dependencia'],
                $data['correo_institucional'],
                $data['telefono_institucional'],
                $data['nivel_educativo'],
                $data['institucion_educativa'],
                $data['modalidad'],
                $data['estado_avance'],
                $data['observaciones'],
                $data['enlace_nombre'],
                $data['enlace_apellido1'],
                $data['enlace_apellido2'],
                $data['enlace_correo'],
                $data['enlace_telefono'],
                $_SESSION['usuario']
            );
            
            if ($stmt->execute()) {
                $registro_id = $stmt->insert_id;
                registrarActividad($conn, $_SESSION['usuario'], 'CREAR_REGISTRO_TRIMESTRAL', 'registros_trimestral', $registro_id);
                echo json_encode(['success' => true, 'id' => $registro_id]);
            } else {
                echo json_encode(['success' => false, 'message' => $stmt->error]);
            }
            
            $stmt->close();
            break;
            
        case 'obtener_registros_trimestral':
            verificarSesion();
            
            $where = "";
            if ($_SESSION['role'] === 'enlace') {
                $where = " WHERE dependencia = '" . $conn->real_escape_string($_SESSION['dependencia']) . "'";
            }
            
            $result = $conn->query("SELECT * FROM registros_trimestral" . $where . " ORDER BY fecha_registro DESC");
            
            $registros = [];
            while ($row = $result->fetch_assoc()) {
                $registros[] = $row;
            }
            
            echo json_encode(['success' => true, 'data' => $registros]);
            break;
            
        case 'actualizar_campo_trimestral':
            verificarSesion();
            
            if (!esAdmin()) {
                echo json_encode(['success' => false, 'message' => 'Sin permisos']);
                break;
            }
            
            $data = json_decode(file_get_contents('php://input'), true);
            $id = $data['id'];
            $campo = $data['campo'];
            $valor = $data['valor'];
            
            // Validar campo permitido
            $campos_permitidos = ['nivel_educativo', 'institucion_educativa', 'modalidad', 'estado_avance', 'observaciones'];
            if (!in_array($campo, $campos_permitidos)) {
                echo json_encode(['success' => false, 'message' => 'Campo no permitido']);
                break;
            }
            
            $stmt = $conn->prepare("UPDATE registros_trimestral SET $campo = ? WHERE id = ?");
            $stmt->bind_param("si", $valor, $id);
            
            if ($stmt->execute()) {
                registrarActividad($conn, $_SESSION['usuario'], 'ACTUALIZAR_CAMPO_TRIMESTRAL', 'registros_trimestral', $id, "Campo: $campo, Nuevo valor: $valor");
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'message' => $stmt->error]);
            }
            
            $stmt->close();
            break;
            
        // ========== EVIDENCIAS MENSUALES ==========
        case 'guardar_evidencia':
            verificarSesion();
            
            // Manejar upload de archivo
            if (!isset($_FILES['archivo']) || $_FILES['archivo']['error'] !== UPLOAD_ERR_OK) {
                echo json_encode(['success' => false, 'message' => 'Error al subir archivo']);
                break;
            }
            
            $archivo = $_FILES['archivo'];
            $ext = pathinfo($archivo['name'], PATHINFO_EXTENSION);
            
            if (strtolower($ext) !== 'pdf') {
                echo json_encode(['success' => false, 'message' => 'Solo se permiten archivos PDF']);
                break;
            }
            
            // Crear directorio si no existe
            $upload_dir = 'uploads/evidencias/' . $_POST['anio'] . '/' . $_POST['mes'] . '/';
            if (!file_exists($upload_dir)) {
                mkdir($upload_dir, 0777, true);
            }
            
            $nombre_archivo = preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $_POST['dependencia']) . '_' . $_POST['mes'] . '_' . time() . '.pdf';
            $ruta_destino = $upload_dir . $nombre_archivo;
            
            if (move_uploaded_file($archivo['tmp_name'], $ruta_destino)) {
                $stmt = $conn->prepare("INSERT INTO evidencias_mensuales (
                    mes, anio, dependencia, enlace_nombre, enlace_apellido1,
                    enlace_apellido2, enlace_correo, enlace_correo_adicional,
                    enlace_telefono, archivo_nombre, archivo_ruta, usuario_registro
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                
                $stmt->bind_param("sissssssssss",
                    $_POST['mes'],
                    $_POST['anio'],
                    $_POST['dependencia'],
                    $_POST['enlace_nombre'],
                    $_POST['enlace_apellido1'],
                    $_POST['enlace_apellido2'],
                    $_POST['enlace_correo'],
                    $_POST['enlace_correo_adicional'],
                    $_POST['enlace_telefono'],
                    $nombre_archivo,
                    $ruta_destino,
                    $_SESSION['usuario']
                );
                
                if ($stmt->execute()) {
                    $registro_id = $stmt->insert_id;
                    registrarActividad($conn, $_SESSION['usuario'], 'SUBIR_EVIDENCIA', 'evidencias_mensuales', $registro_id);
                    echo json_encode(['success' => true, 'id' => $registro_id]);
                } else {
                    unlink($ruta_destino); // Eliminar archivo si falla la BD
                    echo json_encode(['success' => false, 'message' => $stmt->error]);
                }
                
                $stmt->close();
            } else {
                echo json_encode(['success' => false, 'message' => 'Error al mover archivo']);
            }
            break;
            
        case 'obtener_evidencias':
            verificarSesion();
            
            $where = "";
            if ($_SESSION['role'] === 'enlace') {
                $where = " WHERE dependencia = '" . $conn->real_escape_string($_SESSION['dependencia']) . "'";
            }
            
            $result = $conn->query("SELECT * FROM evidencias_mensuales" . $where . " ORDER BY fecha_registro DESC");
            
            $evidencias = [];
            while ($row = $result->fetch_assoc()) {
                $evidencias[] = $row;
            }
            
            echo json_encode(['success' => true, 'data' => $evidencias]);
            break;
            
        case 'actualizar_estado_evidencia':
            verificarSesion();
            
            if (!esAdmin()) {
                echo json_encode(['success' => false, 'message' => 'Sin permisos']);
                break;
            }
            
            $data = json_decode(file_get_contents('php://input'), true);
            $id = $data['id'];
            $estado = $data['estado'];
            
            $stmt = $conn->prepare("UPDATE evidencias_mensuales SET estado = ?, fecha_revision = NOW(), revisor = ? WHERE id = ?");
            $stmt->bind_param("ssi", $estado, $_SESSION['usuario'], $id);
            
            if ($stmt->execute()) {
                registrarActividad($conn, $_SESSION['usuario'], 'ACTUALIZAR_ESTADO_EVIDENCIA', 'evidencias_mensuales', $id, "Nuevo estado: $estado");
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'message' => $stmt->error]);
            }
            
            $stmt->close();
            break;
            
        // ========== CONFIGURACIÓN ==========
        case 'obtener_config':
            verificarSesion();
            
            $result = $conn->query("SELECT * FROM configuracion_sistema");
            
            $config = [];
            while ($row = $result->fetch_assoc()) {
                $config[$row['clave']] = $row['valor'];
            }
            
            echo json_encode(['success' => true, 'config' => $config]);
            break;
            
        case 'actualizar_config':
            verificarSesion();
            
            if (!esAdmin()) {
                echo json_encode(['success' => false, 'message' => 'Sin permisos']);
                break;
            }
            
            $data = json_decode(file_get_contents('php://input'), true);
            $clave = $data['clave'];
            $valor = $data['valor'];
            
            $stmt = $conn->prepare("UPDATE configuracion_sistema SET valor = ? WHERE clave = ?");
            $stmt->bind_param("ss", $valor, $clave);
            
            if ($stmt->execute()) {
                registrarActividad($conn, $_SESSION['usuario'], 'ACTUALIZAR_CONFIGURACION', 'configuracion_sistema', null, "Clave: $clave, Valor: $valor");
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'message' => $stmt->error]);
            }
            
            $stmt->close();
            break;
            
        // ========== EXPORTACIÓN ==========
        case 'exportar':
            verificarSesion();
            
            $formato = $_GET['formato'] ?? 'excel';
            $tabla = $_GET['tabla'] ?? 'trimestral';
            
            $where = "";
            if ($_SESSION['role'] === 'enlace') {
                $dependencia = $conn->real_escape_string($_SESSION['dependencia']);
                $where = " WHERE dependencia = '$dependencia'";
            }
            
            $query = $tabla === 'trimestral' 
                ? "SELECT * FROM registros_trimestral" . $where 
                : "SELECT * FROM evidencias_mensuales" . $where;
                
            $result = $conn->query($query);
            
            if ($formato === 'csv') {
                header('Content-Type: text/csv');
                header('Content-Disposition: attachment; filename="export_' . $tabla . '_' . date('Y-m-d') . '.csv"');
                
                $output = fopen('php://output', 'w');
                
                // Encabezados
                $first_row = $result->fetch_assoc();
                if ($first_row) {
                    fputcsv($output, array_keys($first_row));
                    fputcsv($output, $first_row);
                }
                
                while ($row = $result->fetch_assoc()) {
                    fputcsv($output, $row);
                }
                
                fclose($output);
                
            } elseif ($formato === 'sql') {
                header('Content-Type: text/plain');
                header('Content-Disposition: attachment; filename="export_' . $tabla . '_' . date('Y-m-d') . '.sql"');
                
                echo "-- Exportación de $tabla\n";
                echo "-- Fecha: " . date('Y-m-d H:i:s') . "\n\n";
                
                while ($row = $result->fetch_assoc()) {
                    $columns = array_keys($row);
                    $values = array_map(function($v) use ($conn) {
                        return "'" . $conn->real_escape_string($v) . "'";
                    }, array_values($row));
                    
                    echo "INSERT INTO " . ($tabla === 'trimestral' ? 'registros_trimestral' : 'evidencias_mensuales') . " (" . implode(', ', $columns) . ") VALUES (" . implode(', ', $values) . ");\n";
                }
            }
            
            registrarActividad($conn, $_SESSION['usuario'], 'EXPORTAR_DATOS', $tabla, null, "Formato: $formato");
            exit;
            
        default:
            echo json_encode(['success' => false, 'message' => 'Acción no válida']);
            break;
    }
    
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => 'Error: ' . $e->getMessage()]);
}

$conn->close();
?>
