use serde_json::Value;
use std::{fs, io::{Read, Write}, net::{TcpListener, TcpStream}, path::PathBuf, sync::atomic::{AtomicU64, Ordering}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State};

const VAULT_FILE: &str = "vault.json";
const SYNC_PORT: u16 = 47821;
static BACKUP_COUNTER: AtomicU64 = AtomicU64::new(0);

struct SyncState { token: String, available: bool }

#[derive(serde::Serialize)]
struct SyncInfo { url: String, token: String, available: bool }

#[derive(serde::Serialize)]
struct BackupInfo { name: String, updated_at: String }

fn make_sync_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn vault_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(VAULT_FILE))
}

#[tauri::command]
fn load_vault(app: AppHandle) -> Result<Option<String>, String> {
    let path = vault_path(&app)?;
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_vault(app: AppHandle, vault_json: String) -> Result<(), String> {
    let vault: Value = serde_json::from_str(&vault_json).map_err(|_| "El contenido de la bóveda no es JSON válido".to_owned())?;
    let valid = vault.get("version").and_then(Value::as_u64) == Some(1)
        && vault.get("kdf").and_then(Value::as_str) == Some("PBKDF2-SHA256")
        && vault.get("iterations").and_then(Value::as_u64).unwrap_or(0) >= 600_000
        && vault.get("updatedAt").and_then(Value::as_str).is_some()
        && ["salt", "iv", "ciphertext"].iter().all(|field| vault.get(field).and_then(Value::as_str).is_some());
    if !valid {
        return Err("El formato de la bóveda cifrada no es compatible".to_owned());
    }

    let path = vault_path(&app)?;
    let directory = path.parent().ok_or_else(|| "No se encontró la carpeta de datos".to_owned())?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    temporary.write_all(vault_json.as_bytes()).map_err(|error| error.to_string())?;
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.error.to_string())?;
    let _ = save_backup_snapshot(&app, &vault_json);
    Ok(())
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let setting = data_dir.join("backup-directory.txt");
    let directory = match fs::read_to_string(setting) {
        Ok(path) => PathBuf::from(path.trim()).canonicalize().map(|path| path.join("Boveda Pro Backups")).unwrap_or_else(|_| data_dir.join("backups")),
        Err(_) => data_dir.join("backups"),
    };
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

#[tauri::command]
fn get_backup_directory(app: AppHandle) -> Result<String, String> {
    Ok(backups_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_backup_directory(app: AppHandle, path: Option<String>) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let setting = data_dir.join("backup-directory.txt");
    if let Some(path) = path {
        let directory = PathBuf::from(path).canonicalize().map_err(|error| error.to_string())?;
        if !directory.is_dir() { return Err("Selecciona una carpeta existente".to_owned()); }
        fs::write(setting, directory.to_string_lossy().as_bytes()).map_err(|error| error.to_string())?;
        Ok(directory.join("Boveda Pro Backups").to_string_lossy().into_owned())
    } else {
        let _ = fs::remove_file(setting);
        Ok(backups_dir(&app)?.to_string_lossy().into_owned())
    }
}

fn save_backup_snapshot(app: &AppHandle, vault_json: &str) -> Result<(), String> {
    let dir = backups_dir(app)?;
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let sequence = BACKUP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = format!("backup-{millis}-{sequence}.json");
    let mut file = tempfile::NamedTempFile::new_in(&dir).map_err(|error| error.to_string())?;
    file.write_all(vault_json.as_bytes()).map_err(|error| error.to_string())?;
    file.as_file().sync_all().map_err(|error| error.to_string())?;
    file.persist(dir.join(name)).map_err(|error| error.error.to_string())?;
    let mut snapshots: Vec<_> = fs::read_dir(&dir).map_err(|error| error.to_string())?.filter_map(Result::ok).filter(|entry| entry.file_name().to_string_lossy().starts_with("backup-") && entry.path().extension().is_some_and(|extension| extension == "json")).collect();
    snapshots.sort_by_key(|entry| entry.metadata().and_then(|metadata| metadata.modified()).unwrap_or(UNIX_EPOCH));
    while snapshots.len() > 20 { if let Some(oldest) = snapshots.first() { let _ = fs::remove_file(oldest.path()); snapshots.remove(0); } }
    Ok(())
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let dir = backups_dir(&app)?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())?.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("backup-") || !name.ends_with(".json") { continue; }
        if let Ok(contents) = fs::read_to_string(entry.path()) {
            if let Ok(value) = serde_json::from_str::<Value>(&contents) {
                if let Some(updated_at) = value.get("updatedAt").and_then(Value::as_str) { backups.push(BackupInfo { name, updated_at: updated_at.to_owned() }); }
            }
        }
    }
    backups.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(backups)
}

#[tauri::command]
fn read_backup(app: AppHandle, name: String) -> Result<String, String> {
    if !name.starts_with("backup-") || !name.ends_with(".json") || !name.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '.') { return Err("Nombre de respaldo no válido".to_owned()); }
    fs::read_to_string(backups_dir(&app)?.join(name)).map_err(|error| error.to_string())
}

#[tauri::command]
fn sync_info(state: State<'_, SyncState>) -> SyncInfo {
    SyncInfo { url: format!("http://127.0.0.1:{SYNC_PORT}/v1/vault"), token: state.token.clone(), available: state.available }
}

fn reply(stream: &mut TcpStream, status: &str, body: &str, origin: Option<&str>) {
    let cors = origin.map(|value| format!("Access-Control-Allow-Origin: {value}\r\nVary: Origin\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\n")).unwrap_or_default();
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nPragma: no-cache\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n{cors}\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
}

fn handle_sync_request(mut stream: TcpStream, token: &str, vault_file: &PathBuf) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buffer = [0u8; 8192];
    let mut size = 0;
    while size < buffer.len() {
        match stream.read(&mut buffer[size..]) {
            Ok(0) => break,
            Ok(read) => { size += read; if buffer[..size].windows(4).any(|window| window == b"\r\n\r\n") { break; } }
            Err(_) => return,
        }
    }
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut origin = None;
    let mut authorization = "";
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("origin") && (value.trim().starts_with("chrome-extension://") || value.trim().starts_with("moz-extension://")) { origin = Some(value.trim()); }
            if name.eq_ignore_ascii_case("authorization") { authorization = value.trim(); }
        }
    }
    if origin.is_none() { reply(&mut stream, "403 Forbidden", "{\"error\":\"extension origin required\"}", None); return; }
    if request_line.starts_with("OPTIONS ") { reply(&mut stream, "204 No Content", "", origin); return; }
    if !request_line.starts_with("GET /v1/vault ") { reply(&mut stream, "404 Not Found", "{\"error\":\"not found\"}", origin); return; }
    if authorization != format!("Bearer {token}") { reply(&mut stream, "401 Unauthorized", "{\"error\":\"invalid token\"}", origin); return; }
    let vault = match fs::read_to_string(vault_file) {
        Ok(json) => match serde_json::from_str::<Value>(&json) { Ok(value) => value, Err(_) => { reply(&mut stream, "500 Internal Server Error", "{\"error\":\"vault data invalid\"}", origin); return; } },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(_) => { reply(&mut stream, "500 Internal Server Error", "{\"error\":\"vault unavailable\"}", origin); return; }
    };
    let body = serde_json::json!({"vault": vault}).to_string();
    reply(&mut stream, "200 OK", &body, origin);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let token_path = data_dir.join("sync-token.txt");
            let token = match fs::read_to_string(&token_path) {
                Ok(token) if token.trim().len() == 64 && token.trim().chars().all(|character| character.is_ascii_hexdigit()) => token.trim().to_owned(),
                Ok(_) => {
                    let token = make_sync_token().map_err(std::io::Error::other)?;
                    fs::write(&token_path, &token)?;
                    token
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    let token = make_sync_token().map_err(std::io::Error::other)?;
                    fs::write(&token_path, &token)?;
                    token
                }
                Err(error) => return Err(Box::new(error)),
            };
            let vault_file = data_dir.join(VAULT_FILE);
            let listener = TcpListener::bind(("127.0.0.1", SYNC_PORT));
            let available = if let Ok(listener) = listener {
                listener.set_nonblocking(true)?;
                let token_copy = token.clone();
                std::thread::spawn(move || loop {
                    match listener.accept() {
                        Ok((stream, _)) => { let token = token_copy.clone(); let path = vault_file.clone(); std::thread::spawn(move || handle_sync_request(stream, &token, &path)); }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                        Err(_) => break,
                    }
                });
                true
            } else { false };
            app.manage(SyncState { token, available });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_vault, save_vault, sync_info, list_backups, read_backup, get_backup_directory, set_backup_directory])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Bóveda Pro");
}
