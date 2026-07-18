use crate::protocol::{ExitEvent, OutgoingMessage, OutputEvent, SpawnParams, SpawnResult};
use anyhow::{Context, Result, anyhow};
use std::{collections::HashMap, process::Stdio, sync::Arc};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{Mutex, mpsc},
};

#[derive(Clone)]
pub struct ProcessSupervisor {
    processes: Arc<Mutex<HashMap<String, u32>>>,
    outgoing: mpsc::Sender<OutgoingMessage>,
}

impl ProcessSupervisor {
    pub fn new(outgoing: mpsc::Sender<OutgoingMessage>) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            outgoing,
        }
    }

    pub async fn spawn(&self, spec: SpawnParams) -> Result<SpawnResult> {
        if self.processes.lock().await.contains_key(&spec.id) {
            return Err(anyhow!("process '{}' already exists", spec.id));
        }
        let mut command = shell_command(&spec);
        command
            .current_dir(&spec.cwd)
            .envs(&spec.environment)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command
            .spawn()
            .with_context(|| format!("failed to spawn '{}'", spec.command))?;
        let pid = child
            .id()
            .ok_or_else(|| anyhow!("spawned process has no PID"))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.processes.lock().await.insert(spec.id.clone(), pid);
        if let Some(stream) = stdout {
            self.forward_output(spec.id.clone(), "stdout", stream);
        }
        if let Some(stream) = stderr {
            self.forward_output(spec.id.clone(), "stderr", stream);
        }
        let processes = self.processes.clone();
        let outgoing = self.outgoing.clone();
        let id = spec.id;
        tokio::spawn(async move {
            let status = child.wait().await;
            processes.lock().await.remove(&id);
            let (code, signal) = match status {
                Ok(status) => exit_parts(status),
                Err(error) => {
                    eprintln!("failed waiting for process '{id}': {error}");
                    (None, None)
                }
            };
            if let Ok(event) = OutgoingMessage::event(
                "exit",
                ExitEvent {
                    id,
                    pid,
                    code,
                    signal,
                },
            ) {
                let _ = outgoing.send(event).await;
            }
        });
        Ok(SpawnResult { pid })
    }

    fn forward_output<R>(&self, id: String, stream: &'static str, mut reader: R)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
    {
        let outgoing = self.outgoing.clone();
        tokio::spawn(async move {
            let mut buffer = vec![0_u8; 8192];
            loop {
                match reader.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(size) => {
                        let data = String::from_utf8_lossy(&buffer[..size]).into_owned();
                        if let Ok(event) = OutgoingMessage::event(
                            "output",
                            OutputEvent {
                                id: id.clone(),
                                stream,
                                data,
                            },
                        ) && outgoing.send(event).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        eprintln!("failed reading {stream} for '{id}': {error}");
                        break;
                    }
                }
            }
        });
    }

    pub async fn terminate(&self, id: &str, signal: Option<&str>) -> Result<bool> {
        let Some(pid) = self.processes.lock().await.get(id).copied() else {
            return Ok(false);
        };
        terminate_tree(pid, signal.unwrap_or("SIGTERM")).await?;
        Ok(true)
    }

    pub async fn shutdown(&self) -> Result<()> {
        let pids = self
            .processes
            .lock()
            .await
            .values()
            .copied()
            .collect::<Vec<_>>();
        for pid in &pids {
            let _ = terminate_tree(*pid, "SIGTERM").await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        for pid in self
            .processes
            .lock()
            .await
            .values()
            .copied()
            .collect::<Vec<_>>()
        {
            let _ = terminate_tree(pid, "SIGKILL").await;
        }
        Ok(())
    }
}

fn shell_command(spec: &SpawnParams) -> Command {
    if !spec.shell {
        let mut command = Command::new(&spec.command);
        command.args(&spec.args);
        return command;
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd.exe");
        command.arg("/d").arg("/s").arg("/c").arg(shell_line(spec));
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(shell_line(spec));
        command
    }
}

fn shell_line(spec: &SpawnParams) -> String {
    std::iter::once(spec.command.as_str())
        .chain(spec.args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(unix)]
async fn terminate_tree(pid: u32, signal: &str) -> Result<()> {
    let number = match signal {
        "SIGKILL" => libc::SIGKILL,
        "SIGINT" => libc::SIGINT,
        "SIGHUP" => libc::SIGHUP,
        _ => libc::SIGTERM,
    };
    let result = unsafe { libc::kill(-(pid as i32), number) };
    if result == -1 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error.into());
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn terminate_tree(pid: u32, signal: &str) -> Result<()> {
    let mut command = Command::new("taskkill");
    command.arg("/PID").arg(pid.to_string()).arg("/T");
    if signal == "SIGKILL" {
        command.arg("/F");
    }
    let status = command.status().await?;
    if !status.success() {
        return Err(anyhow!("taskkill failed with {status}"));
    }
    Ok(())
}

fn exit_parts(status: std::process::ExitStatus) -> (Option<i32>, Option<String>) {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        let signal = status.signal().map(|value| signal_name(value).to_string());
        (status.code(), signal)
    }
    #[cfg(not(unix))]
    {
        (status.code(), None)
    }
}

#[cfg(unix)]
fn signal_name(signal: i32) -> &'static str {
    match signal {
        libc::SIGTERM => "SIGTERM",
        libc::SIGKILL => "SIGKILL",
        libc::SIGINT => "SIGINT",
        libc::SIGHUP => "SIGHUP",
        _ => "UNKNOWN",
    }
}
