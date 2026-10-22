use serde_json::Value;
use std::{fs, io::Write};
use tauri::{AppHandle, Manager};

const VAULT_FILE: &str = "vault.json";

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
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![load_vault, save_vault])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Bóveda Pro");
}
