use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static LOG_FILE: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

/// Get the log file path (in user's home directory)
fn get_log_path() -> PathBuf {
    let home = super::get_home_dir();
    let home = if home.is_empty() { ".".to_string() } else { home };
    PathBuf::from(home)
        .join("Freqlab")
        .join("logs")
        .join("freqlab.log")
}

/// Initialize logging - creates log directory if needed
pub fn init_logging() {
    let log_path = get_log_path();

    // Create logs directory if it doesn't exist
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Store the path
    if let Ok(mut path) = LOG_FILE.lock() {
        *path = Some(log_path.clone());
    }

    // Write startup marker
    log_message("INFO", "freqlab", "Application started");
}

/// Write a log message to the log file
pub fn log_message(level: &str, module: &str, message: &str) {
    let log_path = get_log_path();

    // Also print to stderr for dev mode
    eprintln!("[{}] [{}] {}", level, module, message);

    // Append to log file
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "[{}] [{}] [{}] {}", timestamp, level, module, message);
    }
}

/// Get the log file path as a string
#[tauri::command]
pub async fn get_log_file_path() -> Result<String, String> {
    Ok(get_log_path().to_string_lossy().to_string())
}

/// Get the log file contents
#[tauri::command]
pub async fn read_log_file() -> Result<String, String> {
    let log_path = get_log_path();

    if !log_path.exists() {
        return Ok("No log file yet.".to_string());
    }

    fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read log file: {}", e))
}

/// Clear the log file
#[tauri::command]
pub async fn clear_log_file() -> Result<(), String> {
    let log_path = get_log_path();

    if log_path.exists() {
        fs::write(&log_path, "")
            .map_err(|e| format!("Failed to clear log file: {}", e))?;
    }

    log_message("INFO", "freqlab", "Log file cleared");
    Ok(())
}

/// Get log file size in bytes
#[tauri::command]
pub async fn get_log_file_size() -> Result<u64, String> {
    let log_path = get_log_path();

    if !log_path.exists() {
        return Ok(0);
    }

    fs::metadata(&log_path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to get log file size: {}", e))
}
