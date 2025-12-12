<?php
// config.php
define('DB_HOST', 'localhost');
define('DB_USER', 'tu_usuario_mysql');
define('DB_PASS', 'tu_contraseña_mysql');
define('DB_NAME', 'sistema_formacion');

function getDBConnection() {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    
    if ($conn->connect_error) {
        die(json_encode(['success' => false, 'message' => 'Error de conexión: ' . $conn->connect_error]));
    }
    
    $conn->set_charset("utf8mb4");
    return $conn;
}
?>
