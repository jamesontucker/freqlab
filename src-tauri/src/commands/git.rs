use std::process::Command;

/// Create a git command with extended PATH for bundled app compatibility
fn git_command() -> Command {
    let mut cmd = Command::new("git");
    cmd.env("PATH", super::get_extended_path());
    cmd
}

/// Initialize a git repository in the given path (blocking - use init_repo_async for async contexts)
fn init_repo_sync(path: &str) -> Result<(), String> {
    let output = git_command()
        .current_dir(path)
        .args(["init"])
        .output()
        .map_err(|e| format!("Failed to run git init: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git init failed: {}", stderr));
    }

    // Configure git user for this repo (avoid global config issues)
    let _ = git_command()
        .current_dir(path)
        .args(["config", "user.email", "freqlab@local"])
        .output();

    let _ = git_command()
        .current_dir(path)
        .args(["config", "user.name", "freqlab"])
        .output();

    Ok(())
}

/// Initialize a git repository in the given path (async - runs on blocking thread pool)
pub async fn init_repo(path: &str) -> Result<(), String> {
    let path = path.to_string();
    tokio::task::spawn_blocking(move || init_repo_sync(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Create a .gitignore file with standard Rust ignores
pub fn create_gitignore(path: &str) -> Result<(), String> {
    let gitignore_content = r#"# Build artifacts
target/

# Cargo lock (optional for libraries)
# Cargo.lock

# IDE
.idea/
.vscode/
*.swp
*.swo

# macOS
.DS_Store

# App state (chat history, sessions) - not source code
.freqlab/

# Claude working files - not versioned source code
.claude/
CLAUDE.md
docs/
plans/
*.plan.md
"#;

    std::fs::write(format!("{}/.gitignore", path), gitignore_content)
        .map_err(|e| format!("Failed to create .gitignore: {}", e))?;

    Ok(())
}

/// Stage all changes and commit with the given message (blocking - use commit_changes for async)
fn commit_changes_sync(path: &str, message: &str) -> Result<String, String> {
    eprintln!("[DEBUG] commit_changes_sync: path={}", path);

    // Only stage source code and essential config files - ignore plan files, docs, etc.
    // This prevents intermediate planning/documentation from creating versions
    let source_patterns = [
        "src/",           // Rust source code (includes lib.rs, ui.html)
        "Cargo.toml",     // Project manifest
        "Cargo.lock",     // Dependencies lock
        ".gitignore",     // Git config (created at project setup)
    ];

    for pattern in &source_patterns {
        let _ = git_command()
            .current_dir(path)
            .args(["add", pattern])
            .output();
        // Ignore errors - pattern might not match any files
    }

    eprintln!("[DEBUG] Staged source files only (src/, Cargo.toml, Cargo.lock, .gitignore)");

    // Check if there are STAGED changes to commit (not just any changes)
    // git diff --cached --quiet exits with 1 if there are staged changes, 0 if none
    let diff_output = git_command()
        .current_dir(path)
        .args(["diff", "--cached", "--quiet"])
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if diff_output.status.success() {
        // Exit code 0 means no staged changes
        eprintln!("[DEBUG] No staged changes to commit");
        return Err("no_changes".to_string());
    }
    eprintln!("[DEBUG] Found staged changes to commit");

    // Commit
    let commit_output = git_command()
        .current_dir(path)
        .args(["commit", "-m", message])
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        // Ignore "nothing to commit" errors
        if !stderr.contains("nothing to commit") {
            return Err(format!("git commit failed: {}", stderr));
        }
    }

    // Return the commit hash
    get_current_commit_sync(path)
}

/// Stage all changes and commit with the given message (async - runs on blocking thread pool)
pub async fn commit_changes(path: &str, message: &str) -> Result<String, String> {
    let path = path.to_string();
    let message = message.to_string();
    tokio::task::spawn_blocking(move || commit_changes_sync(&path, &message))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Get the current HEAD commit hash (blocking)
fn get_current_commit_sync(path: &str) -> Result<String, String> {
    let output = git_command()
        .current_dir(path)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git rev-parse failed: {}", stderr));
    }

    let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(hash)
}

/// Get the current HEAD commit hash (async)
pub async fn get_head_commit(path: &str) -> Result<String, String> {
    let path = path.to_string();
    tokio::task::spawn_blocking(move || get_current_commit_sync(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Revert files to a specific commit - blocking implementation
fn revert_to_commit_sync(
    project_path: &str,
    commit_hash: &str,
    original_prompt: &str,
) -> Result<String, String> {
    eprintln!("[DEBUG] revert_to_commit: commit={}, path={}", commit_hash, project_path);

    // Verify the commit exists first
    let verify = git_command()
        .current_dir(project_path)
        .args(["cat-file", "-t", commit_hash])
        .output()
        .map_err(|e| format!("Failed to verify commit: {}", e))?;

    if !verify.status.success() {
        return Err(format!("Commit {} does not exist", commit_hash));
    }

    // Checkout only source files from the target commit with force flag
    // Exclude .freqlab/ which contains chat history and session state
    let checkout_output = git_command()
        .current_dir(project_path)
        .args([
            "checkout",
            "-f",  // Force checkout
            commit_hash,
            "--",
            "src/",
            "Cargo.toml",
        ])
        .output()
        .map_err(|e| format!("Failed to run git checkout: {}", e))?;

    eprintln!("[DEBUG] Checkout status: {}", checkout_output.status);
    eprintln!("[DEBUG] Checkout stderr: {}", String::from_utf8_lossy(&checkout_output.stderr));

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        // Ignore errors about paths not existing (e.g., Cargo.lock might not exist)
        if !stderr.contains("did not match any") && !stderr.contains("pathspec") {
            return Err(format!("git checkout failed: {}", stderr));
        }
    }

    // Also try Cargo.lock (optional, may not exist)
    let _ = git_command()
        .current_dir(project_path)
        .args(["checkout", "-f", commit_hash, "--", "Cargo.lock"])
        .output();

    // Create a new commit for the revert (if there are changes)
    let revert_message = format!("Reverted to: {}", truncate_string(original_prompt, 50));
    match commit_changes_sync(project_path, &revert_message) {
        Ok(hash) => {
            eprintln!("[DEBUG] Created revert commit: {}", hash);
            Ok(hash)
        }
        Err(e) if e == "no_changes" => {
            // No changes to commit - files were already at this state
            eprintln!("[DEBUG] No changes after checkout (files already at target state)");
            get_current_commit_sync(project_path)
        }
        Err(e) => Err(e),
    }
}

/// Revert files to a specific commit (non-destructive - creates new commit)
/// Only reverts source code files, not app state (.freqlab/)
/// Runs on blocking thread pool to avoid UI freezes
#[tauri::command]
pub async fn revert_to_commit(
    project_path: String,
    commit_hash: String,
    original_prompt: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        revert_to_commit_sync(&project_path, &commit_hash, &original_prompt)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Ensure non-source files are not tracked by git (for existing projects)
/// This adds patterns to .gitignore and removes them from tracking if already tracked
pub fn ensure_freqlab_ignored(path: &str) -> Result<(), String> {
    let gitignore_path = format!("{}/.gitignore", path);
    let mut content = std::fs::read_to_string(&gitignore_path).unwrap_or_default();
    let mut updated = false;

    // Patterns that should be ignored (not versioned as source code)
    let ignore_patterns = [
        (".freqlab/", "# App state (chat history, sessions) - not source code"),
        (".claude/", "# Claude working files - not versioned source code"),
        ("CLAUDE.md", ""),
        ("docs/", ""),
        ("plans/", ""),
        ("*.plan.md", ""),
    ];

    for (pattern, comment) in &ignore_patterns {
        // Check if pattern is already in .gitignore
        if !content.contains(pattern) {
            if !content.ends_with('\n') && !content.is_empty() {
                content.push('\n');
            }
            // Add comment if provided and not already present
            if !comment.is_empty() && !content.contains(comment) {
                content.push_str(&format!("\n{}\n", comment));
            }
            content.push_str(&format!("{}\n", pattern));
            updated = true;
        }
    }

    if updated {
        std::fs::write(&gitignore_path, content)
            .map_err(|e| format!("Failed to update .gitignore: {}", e))?;
    }

    // Remove these from git tracking if they're tracked
    let paths_to_untrack = [".freqlab/", ".claude/", "CLAUDE.md", "docs/", "plans/"];
    for untrack_path in &paths_to_untrack {
        let _ = git_command()
            .current_dir(path)
            .args(["rm", "-r", "--cached", untrack_path])
            .output();
        // Ignore errors - might not be tracked
    }

    Ok(())
}

/// Check if a path is a git repository
pub fn is_git_repo(path: &str) -> bool {
    let output = git_command()
        .current_dir(path)
        .args(["rev-parse", "--git-dir"])
        .output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// Truncate a string to a maximum length, adding "..." if truncated
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}
